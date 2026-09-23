# 提案：社区插件注册表（静态注册表 + GitHub Release）

状态：提案，等待维护者决定托管位置与签名密钥归属
对应开发守则：§17 Plugin Store / Community Registry、§18 签名 / 撤销 / 更新

## 为什么是"静态注册表 + 固定版本"

插件系统已有 manifest 校验、权限确认、sandboxed Plugin Pages、capability router 与 CSP，但这不等于所有插件都有运行时隔离：`manifest.main` 会在 Node.js Worker 中执行，可直接访问文件系统、环境变量、网络与进程能力，Host capability router 无法约束这些直接调用。社区分发还缺少**分发、信任与本机代码隔离**这一层。可选路线有三条：

| 路线 | 问题 |
|---|---|
| 客户端直连插件作者仓库的最新 Release | 版本不可复现；作者随时可以替换同名资产；无法在合并前审查 |
| 自建服务端索引 | 需要长期运维、宕机即装不了插件；与"客户端可离线工作"的取向冲突 |
| **静态 JSON 注册表 + 固定 Release URL + SHA-256** | 每次变更都走一次可审查的 PR；客户端只认注册表里写死的版本与哈希；出问题可以拉黑 |

选第三条：把"信任"收敛成一次人工审核 + 一串不可变的哈希，客户端不猜、不自动跟随最新版。

## 目录结构

```
registry/
├─ community-plugins.json        已被接受的插件版本
├─ removed-plugins.json          被撤销 / 拉黑的插件（含原因）
└─ schemas/
   ├─ community-plugin.schema.json
   └─ removed-plugin.schema.json
```

暂定放在主仓库。另一个选项是单独开一个 `githubstarsmanager-plugins` 仓库，好处是注册表的提交历史不会污染主仓库、审核权限可以单独授予；代价是多一个仓库要跟踪。**这一条需要维护者定。**

## 记录字段

`community-plugins.json` 是数组，每个条目对应"一个插件的一个版本"：

```json
{
  "id": "com.example.repo-health",
  "version": "1.2.0",
  "apiVersion": "1",
  "source": "https://github.com/example/github-stars-manager-repo-health",
  "releaseUrl": "https://github.com/example/github-stars-manager-repo-health/releases/download/v1.2.0/repo-health-1.2.0.zip",
  "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "permissions": ["repositories:read", "storage"],
  "networkTargets": [],
  "dataUsage": "只读取本地已收藏仓库的元数据用于计算健康分，不外发。",
  "review": {
    "status": "approved",
    "date": "2026-09-21",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  }
}
```

- `id` 必须与 manifest 里的一致；同一 `id` 可以有多个版本条目，客户端取**它自己支持的最高版本**（由 `apiVersion` 决定），不取"最新"。
- `(id, version)` 组合必须唯一；同一插件可以登记多个不同版本。
- `sha256` 是 zip 包的哈希。客户端下载后必须校验，校验失败直接丢弃并提示。
- `networkTargets` 必须与 `permissions` 中的 `network:<domain>` 完全一致；客户端网络权限提示只使用通过 CI 核对的这份声明。
- `review.commit` 是被审核的提交。人工审核对象必须是 `releaseUrl` 指向、重新计算后 SHA-256 等于 `sha256` 的同一份 ZIP，而不只是源码工作树；Release tag 或可验证的构建证明必须把该 ZIP 绑定到 `review.commit`。

`removed-plugins.json`：

```json
{
  "id": "com.example.bad-actor",
  "versions": ["1.0.0", "1.0.1"],
  "reason": "1.0.1 在未声明的情况下向第三方域名发送了仓库列表。",
  "date": "2026-09-21",
  "action": "revoke"
}
```

`action` 取 `revoke` 或 `block`。`revoke` 对匹配版本立即停用，并禁止安装、更新或回滚到该版本；`block` 禁止新的安装、更新与回滚，但不强制停用已安装版本。客户端在列出版本、安装、更新和回滚前都必须检查移除记录。若异常数据同时命中多条记录，`revoke` 优先；CI 会拒绝重叠记录，包括同版本的 `block`/`revoke` 冲突以及 `versions: []` 与具体版本记录并存。

## 提交流程

```
插件作者仓库
  → 向本仓库提 PR（只改 registry/community-plugins.json）
  → CI 自动扫描（见下）
  → 维护者人工审核（见下）
  → 合并
  → 客户端按固定版本 + SHA-256 安装
```

插件作者**不直接改代码**，只提交一个指向自己 Release 的条目。

## CI 自动扫描清单

PR 里出现新条目时，CI 需要把对应 zip 拉下来做静态检查：

- manifest 结构合法、`(id, version)` 组合唯一、`id` 与注册表条目一致、`apiVersion` 在支持范围内
- 重新计算下载 ZIP 的 SHA-256 并与 `sha256` 比较；核对资产属于 `source` 仓库，并通过 Release tag commit 或可验证构建证明绑定到 `review.commit`
- `networkTargets` 与所有 `network:<domain>` 权限完全一致，不能一边声明联网权限、一边给出空目标列表
- `removed-plugins.json` 不含版本重叠、`block`/`revoke` 冲突或全版本记录与具体版本记录的歧义组合
- 文件数量与解压后体积上限
- **zip slip**：条目路径不得逃出解压根目录
- **symlink**：包内不允许符号链接
- 依赖漏洞扫描
- 硬编码密钥 / token 扫描
- `eval`、`new Function`、动态代码加载
- `child_process`、shell 调用、进程执行
- install scripts（`preinstall` / `postinstall`）
- 未声明的网络访问（与 `networkTargets` 对照）
- 遥测 / 上报行为
- 自更新逻辑（插件不得自行更新）
- 代码混淆迹象
- 远程资源引用（`http(s)://` 字面量）
- 页面 CSP 与 message bridge 的用法是否越界
- 第一阶段拒绝包含 `manifest.main` 的社区插件。未来只有在提供有效运行时隔离，并向用户明确披露本机代码权限后，才允许这类插件进入社区注册表

扫描结果作为 PR 评论贴出，人工审核在此基础上做判断——CI 只回答"有没有明显问题"，不回答"这个插件值得信任吗"。

## 人工审核清单

- 描述与行为一致（README 说的和代码做的是同一件事）
- 权限是必要的（读权限能解决的不给写权限）
- 联网域名合理且与 `networkTargets` 一致
- 数据用途清晰，不上传私有仓库信息、不上传浏览历史
- 停用后没有后台任务残留
- UI 不冒充宿主（不伪造系统提示、不伪装成官方设置页）
- License 合规
- 审核经过 SHA-256 复算的发布 ZIP 本身，而不是只审源码仓库的工作树
- **每个新版本都重新检查**；权限增加时，客户端必须重新向用户确认

## 客户端行为

- 只从注册表安装**固定版本**并校验 SHA-256，校验失败不安装。
- 已安装插件启动时对照注册表：有更高兼容版本 → 提示更新（含 changelog 与**权限差异**），由用户手动确认。**第一阶段不做自动更新。**
- 在版本选择、安装、更新和回滚前检查 `removed-plugins.json`：`revoke` 停用匹配的已安装版本并阻止后续使用，`block` 只阻止新的安装、更新和回滚；异常重叠时 `revoke` 优先。
- 保留回滚所需的元数据（原版本、原哈希），但"回滚"同样由用户触发。

## 未决问题

1. 注册表放主仓库还是单独仓库？
2. 注册表本身要不要签名？如果要，密钥由谁持有、怎么轮换？在没有签名的情况下，哈希 + 审核记录已经能挡住"作者偷偷换包"，但挡不住"注册表仓库被改"。第一版建议先不引入签名，等有真实用户量再补。
3. 谁有审核权？如果只有维护者一人，插件生态的扩张速度会被这个瓶颈限制，需要提前约定"低风险权限可以快速合并"的分级。
4. 插件名与 id 的抢注规则（先到先得？与已存在插件相似度检查？）。
