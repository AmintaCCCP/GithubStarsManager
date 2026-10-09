# 桌面端应用内更新：仅使用 GitHub Releases 的可行性

状态：调研，供 #437 讨论；本提案不启用自动更新，也不改变现有发版流程。

## 结论

可以继续用 GitHub Releases 托管安装包和更新元数据，不必自建更新服务器。这里需要的是**下载并安装新版本**，不是替换运行中的前端代码。先下载完整安装包即可；差分下载是可选优化，不需要为新旧版本的每一种组合分别构建增量包。

比较稳妥的方向是桌面主进程使用 `electron-updater` 的 GitHub provider，保留当前手动打开 Release 的入口作为回退。这个方向的主要工作量不在按钮，而在发布产物、签名和跨版本安装验证。建议先做 Windows 的验证版本，再决定是否启用；macOS 在签名条件就绪前继续手动下载。Web/Docker 不参与桌面自动安装。

## 当前项目与目标之间的差距

| 环节 | 当前实现 | 若使用 `electron-updater` |
| --- | --- | --- |
| 检查更新 | `src/services/updateService.ts` 读取 `versions/version-info.xml`，Web 与桌面共用 | 桌面端从 GitHub Release 的更新元数据检查；现有版本文件和 Web 路径可以保留 |
| 下载动作 | `src/components/UpdateChecker.tsx` 打开下载链接 | 桌面主进程下载、报告进度，准备好后提示重启安装；失败时仍可手动下载 |
| 打包配置 | `electron-builder.yml` 设为 `publish: null`；CI 执行 `npm run dist -- --publish=never` | 让用于正式发布的构建生成对应平台的更新元数据，但仍由现有 release job 上传；PR/普通分支构建不发布 |
| Release 资产 | Windows NSIS `.exe`、macOS `.dmg`、Linux `.AppImage` | Windows 增加 `latest.yml`；macOS 需要 ZIP 和 `latest-mac.yml`；Linux 若启用还需相应元数据。元数据必须与同次构建的安装包匹配 |
| 签名 | macOS 未配置证书时采用 ad-hoc 签名 | macOS 自动更新需要可用的应用签名；Windows 签名也有利于减少系统安全提示，但与下载机制是两件事 |

现有 release job 允许部分平台构建失败仍发布。若保留此行为，必须确认一个平台的更新元数据只在其对应安装包存在且可安装时发布，否则客户端可能收到“有新版”却无法下载。不能仅凭 CI 成功或元数据文件存在就宣布自动更新可用。

## 方案取舍

1. **应用内下载完整安装包，再由用户运行。** 对发版流程影响较小，但下载进度、校验、安装器启动、失败恢复都需要自己维护；体验仍有一次安装器交互。
2. **`electron-updater` + GitHub Releases。** 使用已有的 Electron 更新机制，不需要服务器，也不需要枚举差分组合；但要调整正式发布产物、接入主进程更新事件和重启安装流程，并验证签名、权限及不同旧版本的升级。
3. **自行制作增量包或运行时代码热替换。** 不符合这个需求的最小实现范围，也会增加回滚、兼容与安全负担；不建议采用。

推荐先验证方案 2 的**完整安装包路径**。差分更新可在后续确认实际下载成本后再开；即使差分下载不可用，也应回退到完整包，而不是阻断更新。GitHub Actions 或 Releases 不可用时，客户端应维持当前版本并提供手动入口，不自行改写应用文件。

## 实施前要验证的事项

- 用正式发布配置做一次不对外推送的打包检查，确认 Windows/macOS 产物及元数据的文件名、哈希和下载地址一致；不要手写 `latest*.yml`。
- 在 Windows 上从至少一个已发布旧版升级，检查安装目录、用户数据、取消下载、重启安装和 GitHub 网络失败后的回退。
- macOS 先确认签名及 ZIP 产物能被更新器接受，再测试 Intel/Apple Silicon 升级；未满足前保留现有 DMG 手动安装。
- 明确 Linux AppImage 和 Web/Docker 仍走什么更新提示，避免把桌面更新按钮误用于浏览器页面。
- Release job 的部分成功语义要与更新元数据一致；GitHub 服务故障应只影响更新，不影响已安装应用使用。

参考：[`electron-builder` v26 自动更新文档](https://www.electron.build/v26/docs/features/auto-update/)、[v26 发布配置文档](https://www.electron.build/v26/docs/publish/)。
