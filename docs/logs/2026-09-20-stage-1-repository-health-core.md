# 阶段日志 1：Repository Health Core（v0.9.0）

- 日期：2026-09-20
- 分支：`plugin-system-v0-9`（基线 `b06a347`，已快进到 `upstream/plugin-system-v0-9`）
- 依据：[`开发守则.md`](../../../开发守则.md) §1 与 [`docs/plans/2026-09-17-product-roadmap.md`](../plans/2026-09-17-product-roadmap.md) §4
- 阶段提交：`feat: add repository health facts`
- 代码量：29 个文件，+2112 / −31 → 按仓库既有节奏（1166–7110 行的功能提交对应 minor 提升）取 minor 版本号 `0.9.0`

## 1. 目标与边界

提供**客观**的 Repository Health Facts，不给统一总分：

- Core 只输出可验证事实与保守观测（`archived` / `disabled` / `no-releases` / `no-recent-activity`）。
- 不提供 0–100 健康分数，不做「健康 / 不健康」结论——主观评分属于插件。
- 明确拒绝「最近提交少 = 不健康」：`no-recent-activity` 只是中性观测，阈值 12 个月仅用于展示。
- 未知事实一律为 `undefined` / `null`，绝不猜测（例如未同步过 Release 时不声称「没有 Release」）。

## 2. 统一模型

新增 [`src/types/health.ts`](../../src/types/health.ts)：

- `RepositoryHealthSnapshot`：roadmap 建议模型 + `fork` / `isTemplate` / `releasesFetched` /
  `releasesPerYear` / `latestStableVersion` / `latestPrereleaseVersion` / `ageDays` /
  `daysSinceLastPush` / `signals`。
- `RepositoryHealthFact`：三态取值语义 —— `undefined` = 未知，`null` = 已知为空（如无 license），
  有值 = 已知；并带 `group` / `kind` / `source`（`repository` / `releases` / `enrichment`）。
- `RepositoryHealthGroup`：固定 `activity` → `maintenance` → `community` → `maturity`。

推导集中在 [`src/utils/repositoryHealth.ts`](../../src/utils/repositoryHealth.ts)，纯函数、无网络请求：

| 能力 | 说明 |
|---|---|
| `deriveRepositoryHealthSnapshot` | 由 `Repository` + 本地 `Release[]`（+ 可选 enrichment）推导全部事实 |
| `deriveRepositoryHealthSignals` | 4 种保守观测，顺序固定，`since` 仅在时间型观测上有值 |
| `groupRepositoryHealthFacts` | 展开为 UI 分组视图，不含任何格式化（留给 UI / 后续 i18n） |
| `isArchivedRepository` / `hasRecentActivity` / `hasDeclaredLicense` | 列表筛选谓词，与 UI 口径同源 |

**没有新增持久化 Store slice，也没有 Store migration**：快照是派生投影，不进入
`Repository` 实体持久化路径，因此不触碰 Issue #304 的后端同步哈希契约。

## 3. 让事实真正可达：同步层的最小改动

`/user/starred` 原始响应本就带 `archived` / `disabled` / `fork` / `is_template` /
`open_issues_count` / `default_branch`，但 `Repository` 类型没有声明，且后端不存储这些列。
按「先确认安全性再动手」的顺序处理：

1. [`src/types/index.ts`](../../src/types/index.ts)：把这 6 个字段加入 `Repository`（可选）。
   它们是运行时对象里**已经存在**的字段，因此类型补全不改变 `JSON.stringify` 的任何字节。
2. [`src/utils/repositoryMerge.ts`](../../src/utils/repositoryMerge.ts)：同名字段**成对**加入
   `CLIENT_ONLY_REPOSITORY_FIELDS`（不参与后端同步指纹）与 `LOCAL_REPOSITORY_FIELDS`
   （拉取时保留本地值）。只加一边会破坏既有不变式——只加 CLIENT_ONLY 会在每次拉取时被清空，
   只加 LOCAL 会保留但触发多余的「已变化」判定。
3. [`src/features/repositories/hooks/useSearchActions.ts`](../../src/features/repositories/hooks/useSearchActions.ts)：
   星标同步的既有仓库字段白名单加入这 6 个字段（归档状态会随上游变化），
   源缺失时回落到本地已知值，避免事实退化成「未知」。
4. [`src/services/githubApi.ts`](../../src/services/githubApi.ts)：详情路径（REST + GraphQL）
   捕获这些字段；GraphQL 片段补上 `isArchived` / `isDisabled` / `isFork` / `isTemplate` /
   `openIssues` / `defaultBranchRef`，否则 GraphQL 路径拿不到值。字段在
   `GitHubRepoDetailRead` 中保持可选，避免破坏既有测试夹具。

后端 `server/` 与 `cloudflare-worker/` **未改动**：后端不存这些列，因此 MCP 侧对
「未知」与「未归档」保持严格区分（见 §5）。

## 4. 复用面

| 复用方 | 落点 |
|---|---|
| UI | 新增 [`RepositoryHealthPanel.tsx`](../../src/components/RepositoryHealthPanel.tsx)，接入 [`RepositoryReleaseSheet.tsx`](../../src/components/RepositoryReleaseSheet.tsx)（唯一同时持有 repository 与实时 releases 的界面）。分组展示 + 保守观测徽章 + 「以上为客观事实，不含健康总分」脚注 |
| 筛选 | `SearchFilters` 新增 `healthArchived` / `healthRecentActivity` / `healthHasLicense`；[`SearchBar.tsx`](../../src/components/SearchBar.tsx) 新增「仓库健康事实」筛选区，`clearFilters` / 激活计数同步 |
| 排序 | 新增 `sortBy: 'created'`（成熟度视角），`getSortValue` 与排序下拉同步 |
| Discovery / AI | [`aiService.ts`](../../src/services/aiService.ts) 两处 repoInfo 模板（自定义 / 内置提示）插入客观事实摘要，并显式标注「中性，不代表质量结论」 |
| MCP | [`electron/repoHealth.js`](../../electron/repoHealth.js) + [`server/src/mcp/repoHealth.ts`](../../server/src/mcp/repoHealth.ts) 镜像同一算法；`buildRepoEvidence` 输出 `health` 块，`gsm_search_repos` / `gsm_list_repos_by_category` 暴露 3 个 health 筛选与 `created` 排序 |
| Plugin API | [`pluginProtocol.js`](../../electron/plugins/pluginProtocol.js) `sanitizeRepository` 追加 6 个状态字段 + `has_fetched_releases`（全部属于既有 `repositories:read` 权限范围，不新增能力） |

MCP 侧修正了一处**既有的事实性错误**：原本 `evidence.repository.archived` 恒为 `null`，
并在 `limitations[0]` 固定声明 `archived is not stored locally`。现在只有在记录里确实
不存在该布尔值时才保持 `null` 并声明限制；一旦有值就照实上报。该限制串因此改为条件输出，
既有断言的夹具不含该字段，所以断言语义不变。

### 三份镜像实现是刻意的

`src/utils/repositoryHealth.ts`（ESM/TS）、`electron/repoHealth.js`（CommonJS）、
`server/src/mcp/repoHealth.ts`（ESM/TS）必须是三份：Electron 侧是 CJS 且
`electron-builder.yml` 不打包 `src/`，server 的 `rootDir: "src"` 禁止 import 应用源码树。
这与仓库既有的 `mcpDiscovery.js` / `server/src/mcp/repoSearch.ts` 镜像模式一致。
[`server/tests/mcp/parity.test.ts`](../../server/tests/mcp/parity.test.ts) 新增两条用例锁定
Electron 与后端两份输出**逐字段相等**，并锁定「未知保持未知」。

## 5. 刻意未做

- 不引入需要联网补全的事实（contributors、closed issues、Security Policy、CI、README/文档、
  默认分支最近提交）：模型已预留字段与 `enrichment` 来源，但在本阶段不联网获取，
  UI 显示为「未知」。这样避免了额外的 GitHub 请求预算与限流风险，且离线可用。
- **列表筛选不包含依赖 Release 的事实**（是否有 Release、最新版本）：`applyRepoFilters`
  拿不到 Release 数组，为它接一个全量 `releases` 订阅会造成整个搜索栏频繁重渲染。
  这些事实在 Health 面板、MCP 证据与插件快照中可用。
- `gsm_vector_search` 不暴露 health 筛选：向量检索有独立的 Worker 契约，且其注释明确
  不应假装提供精确的 corpus-wide filtered topK。保留其已批准的输入面。
- 不做健康总分、不做插件评分界面（交给插件生态）。

## 6. 验证

| 关卡 | 结果 |
|---|---|
| `node scripts/check-boundaries.cjs` | 通过（无分层违规） |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npx vitest run` | 102 文件 / 1012 用例，16 失败 —— 与改动前基线**完全相同**（`RepositoryCard`、`RepositoryCard.lazyReadme`、`ReadmeModal`、`ForkTimeline` 的 jsdom 5s 超时，属环境慢导致，非本次改动） |
| `npm run test:electron:mcp` | 24/24 通过（含证据与工具输入面断言） |
| `npm run test:electron:plugins` | 91/91 通过 |
| `npm run test:update-version` | 10/10 通过 |
| server 测试 | **未能运行**：`npm ci` 在 `better-sqlite3` 原生编译处失败（本机缺 C++ 构建工具链），属既有环境限制；server 侧改动已逐行复核，并新增 parity 用例待 CI 执行 |

新增/更新的测试：

- `src/utils/repositoryHealth.test.ts`（22 例）：推导、三态语义、观测顺序、`presto` 之类
  预发布误判防护、筛选谓词。
- `src/components/RepositoryHealthPanel.test.tsx`（6 例）：分组、无总分声明、未知不猜测、
  无 Release 数据时不报「No releases」。
- `electron/repoHealth.test.js`（6 例）：锁定 Electron 镜像算法。
- `server/tests/mcp/parity.test.ts`（+2 例）：跨运行时逐字段一致。

`RepositoryReleaseSheet.test.tsx` 的 Release 条目查询改为限定在 `release-list` 容器内，
因为 Health 面板同样会显示最新稳定版本 tag，全局查询会与之串台。

## 7. 版本号说明

根 `package.json` 此前停留在 `0.8.1`，而 `version-info.xml` 也没有 `0.9.0` 记录——
插件平台（`c53c07b`…`b06a347`）虽然在提交信息里自称 v0.9.0，却从未落版本号与更新日志。
本阶段既然要发布 `0.9.0`，就把 0.8.1 之后实际进入代码的插件平台内容与本次 Health 事实
一并写入该版本的 changelog，避免用户看到「0.9.0 只包含 Health 事实」的失真描述。

## 8. 下一阶段

阶段 2：Installable Asset Detection（roadmap §5 / 开发守则 §2）——
统一识别当前设备可安装的 Release 资产，输出 `InstallableAsset`（platform / architecture /
packageType / confidence / reason），排除 source code、checksum、signature、symbols、debug、
blockmap 等非安装资产，复用既有 `detectAssetPlatform` 与 Smart Release 的平台/架构判断，
不确定时展示多个候选且不声称安装包安全。
