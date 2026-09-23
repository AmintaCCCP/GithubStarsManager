# Community plugin registry

这个目录是社区插件的**静态注册表**：客户端只从 `community-plugins.json` 里记录的固定版本安装插件，并在解包前校验 `sha256`。没有服务端，也没有"跟随最新版"。

完整流程、审核清单与未决问题见 [`docs/proposals/community-plugin-registry.md`](../docs/proposals/community-plugin-registry.md)。

## 文件

| 文件 | 用途 |
|---|---|
| `community-plugins.json` | 已被接受的插件版本。一个条目 = 一个插件的**一个**版本。 |
| `removed-plugins.json` | 被撤销或拉黑的插件。`revoke` 停用匹配的已安装版本并阻止安装/更新/回滚，`block` 只阻止新的安装/更新/回滚。 |
| `schemas/community-plugin.schema.json` | `community-plugins.json` 的 JSON Schema。 |
| `schemas/removed-plugin.schema.json` | `removed-plugins.json` 的 JSON Schema。 |

## 贡献流程

1. 插件作者把插件发到自己的 GitHub 仓库，并打 Release、附上 zip 资产。
2. 往本仓库提 PR，**只改 `community-plugins.json`**，新增一条指向该 Release 的固定 URL 与 `sha256`。
3. CI 核对 `(id, version)` 唯一性、网络声明和移除记录语义，拉取 zip 复算 SHA-256，并验证 Release tag 或构建证明把资产绑定到 `review.commit`；随后扫描 zip slip、symlink、eval、shell、未声明网络、遥测、自更新、混淆和远程资源等。
4. 维护者审核经过哈希校验的同一份 zip（描述与行为是否一致、权限是否必要、联网域名与数据用途是否写明、License 是否合规）。第一阶段社区注册表不接受含 `manifest.main` 的本机代码插件。
5. 合并后客户端才会看到它。

## 客户端约定

- 只安装注册表里写明的固定版本，校验 `sha256` 失败即丢弃。
- 有更高兼容版本时**提示**更新（含 changelog 与权限差异），由用户确认；第一阶段不做自动更新。
- 版本选择、安装、更新和回滚前均检查 `removed-plugins.json`；`revoke` 还会立即停用匹配的已安装版本，异常重叠时优先于 `block`。

本地运行 `npm run check:plugin-registry` 可检查跨条目的唯一性、网络声明一致性和移除记录冲突；JSON Schema 继续负责单条记录的结构约束。
