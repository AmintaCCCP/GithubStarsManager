# 阶段日志 2：Installable Asset Detection（v0.10.0）

- 日期：2026-09-20
- 分支：`plugin-system-v0-9`（基线 `8b1bfeb`）
- 依据：[`开发守则.md`](../../../开发守则.md) §2 与 [`docs/plans/2026-09-17-product-roadmap.md`](../plans/2026-09-17-product-roadmap.md) §5
- 提交：`feat: detect installable release assets`
- 代码量：+约 1200 行（含测试）→ minor 提升至 `0.10.0`

## 1. 目标与边界

统一回答「这个 Release 里哪个资产可以在当前设备上安装」，并把它做成可被 Release 视图、
Discovery、My Apps、AI、MCP 与插件复用的一份结果。

明确不做（roadmap §5.3）：

- 不下载后执行、不自动运行安装程序。
- 不因为扩展名像安装包就断言软件安全——UI 文案显式说明「未验证安装包安全性」。
- 不把 ZIP 一律当作可安装软件（见 §3 的平台判定）。
- 不自动选择来源不明的第三方镜像：下载仍走既有 GitHub allowlist 链路。

## 2. 统一模型

[`src/types/installableAsset.ts`](../../src/types/installableAsset.ts)：`InstallableAsset`
（assetId / fileName / downloadUrl / size / platform / architecture / packageType /
confidence / reason）与 `InstallableAssetDetectionResult`（`matches` + `excluded[]`）。

模型里显式保留 `excluded`（资产 id + 文件名 + 原因）：这样 UI 能回答「为什么某个资产没被推荐」，
而不是让排除静默发生。这直接对应用户「始终可以手动选择其他 Release Asset」的前提——
用户需要知道还有什么、以及为什么没被选中。

## 3. 识别规则

[`src/utils/installableAssets.ts`](../../src/utils/installableAssets.ts)，纯函数、无网络：

| 环节 | 做法 |
|---|---|
| 平台 | **复用** [`detectAssetPlatform`](../../src/utils/releaseAssets.ts) 与它导出的 `OS_TOKEN_PLATFORM` 词表，不另写平台表 |
| 包类型 | 新增后缀表（长后缀优先）：`.exe .msi .zip .7z .dmg .pkg .deb .rpm .AppImage .tar.gz .apk .aab` |
| 架构 | 新增词表：`x64`（`x86_64`/`amd64`/`x64`/`win64`）、`arm64`（`aarch64`/`arm64`）、`x86`（`ia32`/`i386…i686`/裸 `x86` 且后面不是 `64`）、`universal`（`universal`/`universal2`/`multiarch`） |
| 排除 | 源代码归档、校验和、签名、调试符号、Electron blockmap、SBOM |
| 置信度 | 决定性扩展名 + 已知架构 = `high`；只满足其一 = `medium`；容器格式且架构未知 = `low` |

三条刻意的判定规则：

1. **`win32` 不是 32 位标记**。Electron 用 `win32` 命名 Windows 构建，把它当 x86 会让
   `app-win32-x64.zip` 这种常见命名被误判。参考实现（`examples/plugins/smart-release-recommender/worker.js`）
   的注释也是这么写的，这里保持一致。
2. **文件名声明多个平台直接排除**（`project-win32-linux-x64.zip`），与参考实现一致；
   **扩展名与文件名冲突也排除**（`app-1.2.0-linux.dmg`）——宁可排除并说明，也不要挑一个可能装错的包。
3. **容器格式缺平台标记时不猜平台**（`myapp-1.0.zip`）：只在 `content_type` 提供 MIME 证据时
   才回落（复用 `detectAssetPlatform` 的最后一层）。其余情形排除并说明原因，
   资产表里仍可手动下载。

不确定时的处理是「并列候选」：设备架构未知就不做架构过滤（x64 与 arm64 同时列出），
文件名同时声明多架构就不猜架构、降级为 `medium` 并注明。

## 4. 当前设备识别

[`src/utils/deviceTarget.ts`](../../src/utils/deviceTarget.ts)：`detectDevicePlatformSync()`
（`navigator.userAgentData.platform` → `navigator.platform` → UA 字符串）与
`resolveDeviceArchitecture()`（high-entropy hints，带进程内缓存）。

两个刻意的选择：

- **不新增 Electron IPC**。渲染进程用 `navigator.userAgentData` 就能拿到宿主 OS/CPU 架构，
  而 Web 版本来就没有 Electron 进程。为读一个平台号新增 IPC 会扩大 Host 接口面，
  与「不扩大 Electron 权限边界」相悖。插件运行时的 `hostEnvironment {os, arch}` 保持不变，各管一摊。
- **架构拿不到就承认拿不到**。high-entropy hints 只能异步取；Firefox/Safari 或 API 被拒时
  返回 `undefined`，调用方据此放弃架构过滤，而不是假定 x64。

## 5. UI

[`InstallableAssetRecommendation.tsx`](../../src/components/InstallableAssetRecommendation.tsx)
接入 `RepositoryReleaseSheet` 的资产页签，位于插件推荐块之下、资产表之上（该组件同时持有
`release` 与 `onDownload`，无需新数据源）：

- 首选候选 + 「下载此版本」按钮（**必须点击**，绝不自动下载）、置信度徽章、平台/架构/包类型/大小。
- 其他候选列表，每个都可单独下载。
- 排除说明：列出「源代码 / 校验和 / 签名 / 调试符号 / blockmap / 其他平台或架构」的排除数量。
- 无适配资产时整块**不渲染**（不制造噪音）。

下载动作**复用既有链路**：`buildReleaseDownloadLinks` 生成 `ReleaseDownloadLink`，
再交给 `RepositoryReleaseSheet` 的 `downloadAsset`（RPC / 认证下载 / 后端代理 / window.open）。
检测结果只提供 `assetId`，按 id 回查 link，因此没有第二套下载逻辑，也没有改动
`ReleaseDownloadLink` 的形状（它的测试做整数组 `toEqual`）。

顺带把 `formatFileSize` 从 `RepositoryReleaseSheet` 提到
[`src/utils/formatBytes.ts`](../../src/utils/formatBytes.ts)，让推荐块与资产表用同一套显示口径。

## 6. 刻意的分歧与未做

- **不复用 `PRESET_FILTERS`**：它把 `zip` / `tar.gz` 归入 Source，且用朴素子串匹配
  （`win` 会命中 `darwin`），与「可安装软件识别」的目标直接冲突。既有资产筛选器保持原样。
- **不改参考实现**：`examples/plugins/smart-release-recommender/worker.js` 里的架构/排除/打分
  逻辑无法反向依赖 `src/`（沙箱装的是打包后的插件，且插件不应读 Core 内部）。
  它是给第三方插件看的参考实现，保留自己的小词表是合理分歧；
  Core 侧的 Host 实现已在模块注释里标明对应关系。
- **本阶段不接入 Discovery / My Apps / 插件 / MCP**：开发守则 §2 的验收项只要求模型、识别规则、
  候选展示与手动选择，这三项已完成。把结果推给插件的 MCP 快照与插件 release 载荷需要先定下
  「服务端运行时的设备是谁」（自托管后端可能跑在容器里，报容器平台会误导用户），
  这件事值得单独一个小 PR；`hasInstallableAsset()` 已作为仓库级入口导出，供 Discovery
  与批量导入预览直接复用。

## 7. 验证

| 关卡 | 结果 |
|---|---|
| `node scripts/check-boundaries.cjs` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npx vitest run` | 105 文件 / 1062 用例，16 失败 —— 与阶段 1 及改动前基线**同一集合**（4 个重型 jsdom 组件测试的 5s 超时） |
| `npm run test:electron:mcp` / `test:electron:plugins` / `test:update-version` | 本阶段未触碰 electron / server / 脚本，保持阶段 1 的通过状态 |

新增测试：

- [`installableAssets.test.ts`](../../src/utils/installableAssets.test.ts)（30 例）：各平台包类型、
  6 类排除、多平台/扩展名冲突、架构冲突与通用包、未知架构并列候选、AAB 只识别、
  MIME 回落、排序稳定性、空输入、`hasInstallableAsset`。
- [`deviceTarget.test.ts`](../../src/utils/deviceTarget.test.ts)（12 例）：三级平台回退、
  high-entropy 架构映射与缓存、API 缺失/被拒/32 位 ARM 时返回 `undefined`。
- [`InstallableAssetRecommendation.test.tsx`](../../src/components/InstallableAssetRecommendation.test.tsx)（6 例）：
  点击才下载、复用 link 模型、安全免责声明、无候选不渲染、候选与排除说明、无法识别设备时并列候选。

`RepositoryReleaseSheet.test.tsx` 无需改动即通过（推荐块不渲染被排除的资产名，
平台徽章断言仍由资产表的 `.asset-platform-badge` 满足）。

## 8. 下一阶段候选

按开发守则的推荐顺序，下一阶段可以是：

1. `feat: add batch repository URL extraction`（§6 前半，纯逻辑、可测试、风险低）；
2. 或把可安装资产结果接入平台感知 Discovery（§8）与统一快照（插件/MCP），
   但需要先明确服务端运行时的设备归属。
