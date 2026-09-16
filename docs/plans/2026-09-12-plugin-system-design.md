# GithubStarsManager 插件系统设计提案

状态：Draft
日期：2026-09-12
目标平台：Electron Desktop
适用范围：插件发现、权限声明、受限扩展点、后续沙箱页面与 Host Capability

## 1. 背景

GithubStarsManager 已具备仓库管理、AI 分析、向量搜索、Release 追踪、Gist、Fork、WebDAV、可选后端和 MCP 等能力，但目前没有面向第三方开发者的运行时扩展机制。

项目现有前端采用以下分层：

```text
View → Feature Hook / ViewModel → Application Command → Service → Store
```

插件系统必须遵守现有分层，不允许插件绕过 Hook、Service 或 Host API 直接访问 Zustand Store、Electron IPC、凭据和底层运行环境。

本提案的核心原则是：

> Plugins should request capabilities, not inherit Electron privileges.

即：插件申请经过宿主定义和检查的能力，而不是继承 Electron 或 Node.js 权限。

## 2. 目标

插件系统最终应支持：

1. 仓库和批量仓库操作，例如复制信息、生成报告和打开外部页面。
2. 仓库、Release、Gist 等数据处理器。
3. Markdown、CSV、JSON 等导出器。
4. Smart Release Asset Recommendation 等 Release 扩展。
5. Repo Health、替代品推荐和重复项目检测等分析功能。
6. 由宿主代理的 GitHub、AI、Web Search 和下载能力。
7. 使用隔离页面实现完整插件 Dashboard。
8. 清晰展示插件权限、版本、来源和运行错误。

## 3. 非目标

Plugin API v1 不提供：

- 任意 Node.js API。
- 原始 Electron IPC。
- GitHub Token、AI API Key、WebDAV 密码、aria2 Secret 等凭据。
- 任意文件系统读写。
- 任意进程或 Shell 执行。
- 不受限制的网络访问。
- 直接访问或订阅 Zustand Store。
- 将第三方 React 组件直接 import 到主 Renderer。
- 远程代码插件商店、自动更新或静默安装。
- 自动运行软件安装程序。
- 对恶意本地插件提供完整安全沙箱的承诺。

## 4. 风险等级与实施阶段

| 等级 | 能力 | 风险 | 计划 |
|---|---|---:|---|
| L1 | 仓库操作、数据处理、导出、插件存储和日志 | 低 | V1 |
| L2 | sandboxed 插件完整页面 | 中低 | V1.2 |
| L3 | GitHub、AI、Web Search、下载和受控网络 Host API | 中 | V1.1～V1.3 |
| L4 | 任意文件系统、Node、Shell、进程执行和自动安装 | 高 | 暂不支持 |

## 4.1 威胁模型

插件系统至少要考虑以下攻击者和失败场景：

| 场景 | 可能后果 | 主要防线 |
|---|---|---|
| 恶意插件 | 窃取收藏、项目偏好或凭据 | 不暴露凭据、Capability Router、数据裁剪 |
| 被入侵的正常插件 | 更新后新增外传行为 | 锁定来源、哈希/签名、权限增加重新确认 |
| 插件包构造攻击 | ZIP Slip、符号链接逃逸、覆盖宿主文件 | 安全解压、固定安装目录、路径校验 |
| 插件 UI 攻击宿主 | DOM 探测、钓鱼、伪造系统界面 | sandbox iframe、CSP、清晰插件身份标识 |
| SSRF | 探测或攻击 localhost、局域网服务 | HTTPS allowlist、DNS/IP 校验、重定向复检 |
| 资源耗尽 | 无限循环、大响应、存储膨胀 | 超时、终止、大小限制、配额和速率限制 |
| 混淆代理攻击 | 插件借宿主 GitHub/AI 能力执行越权操作 | 语义化 API、固定参数范围、用户作用域检查 |
| 日志泄露 | Token、URL 参数、提示词或私有仓库内容进入日志 | 结构化日志、字段 allowlist、统一脱敏 |

安全模型必须明确区分：

- **可信宿主代码**：GithubStarsManager 本身。
- **用户主动安装的本地插件**：V1 中视为受信任或半受信任，仍执行最小权限。
- **插件页面内容**：视为不可信内容。
- **公共商店插件**：未来必须默认视为不可信供应链输入。

## 4.2 隐私原则

1. **数据最小化**：只向插件发送完成当前操作所需字段，不能默认发送完整 Store snapshot。
2. **目的绑定**：插件获得的输入仅用于用户当前触发的操作；后台批量读取需单独声明。
3. **显式触发优先**：V1 action 由用户点击执行，不允许静默监听所有 Store 变化。
4. **本地优先**：没有联网 capability 的插件必须能够在完全离线状态下运行。
5. **凭据零暴露**：插件只得到宿主代理结果，任何情况下都不返回 Token、Key、Cookie 或认证 Header。
6. **私有仓库敏感标记**：向插件传递私有仓库数据前需单独提示；未来可设计 `privateRepositories:read` 独立权限。
7. **可撤销**：用户可以停用插件、撤销权限并删除插件数据。
8. **可解释**：设置页显示插件最近调用过哪些 capability、何时联网、目标域名和是否成功。
9. **可删除**：卸载时提供“保留数据”或“同时删除插件数据”的明确选择。
10. **不做遥测默认同意**：插件不得继承宿主遥测通道；插件自己的遥测必须声明网络域名和用途。

推荐将传给插件的仓库类型单独定义，而不是复用内部 `Repository`：

```ts
interface PluginRepositorySummary {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string | null;
  language: string | null;
  stars: number;
  forks: number;
  archived: boolean;
  pushedAt: string | null;
  latestReleaseAt: string | null;
  isPrivate: boolean;
}
```

默认不包含 README 全文、本地备注、AI 对话、访问历史、用户身份、内部数据库字段和任何凭据。需要更详细内容时使用独立 capability 按次请求。

## 4.3 权限组合风险

权限不能只逐项评估，还要评估组合后的能力：

| 权限组合 | 实际风险 | 建议 |
|---|---|---|
| `repositories:read` + 任意联网 | 可外传全部收藏 | 禁止任意联网 |
| `privateRepositories:read` + 域名联网 | 可外传私有项目元数据 | 高风险提示，默认拒绝后台调用 |
| `ai.generate` + README 内容 | 内容会发送给用户配置的 AI Provider | 调用前说明 Provider 和数据范围 |
| `releases:read` + `downloads:create` | 可诱导下载恶意资产 | 宿主校验来源并要求用户确认 |
| `storage` + 后台运行 | 可持续建立用户画像 | V1 不允许后台常驻触发 |
| `external:open` + 可控 URL | 可用于钓鱼 | HTTPS、URL 展示、危险 scheme 拒绝 |

安装确认页应突出展示高风险组合，而不是只列一串技术权限名。

## 5. 总体架构

```text
┌──────────────────────── GithubStarsManager ────────────────────────┐
│                                                                    │
│  React Renderer                         Electron Main Process       │
│  ┌────────────────────┐                 ┌────────────────────────┐  │
│  │ Settings Plugin UI │                 │ PluginManager          │  │
│  │ Plugin Registry    │──受限 IPC──────→│ Manifest Validation    │  │
│  │ Contribution Slots │←───────────────│ Permission Decisions   │  │
│  └────────────────────┘                 │ Lifecycle / Timeouts   │  │
│           │                              └───────────┬────────────┘  │
│           │ sandboxed iframe                        │               │
│           ↓                                         ↓               │
│  ┌────────────────────┐                 ┌────────────────────────┐  │
│  │ Plugin Page        │←─postMessage───→│ Capability Router      │  │
│  │ No Node / No Token │                 │ GitHub / AI / Download │  │
│  └────────────────────┘                 └───────────┬────────────┘  │
│                                                     │               │
│                                            Isolated Plugin Runtime  │
└────────────────────────────────────────────────────────────────────┘
```

### 5.1 Electron PluginManager

`PluginManager` 负责：

- 扫描 `<userData>/plugins/<plugin-id>/`。
- 读取并验证 `manifest.json`。
- 检查 `manifestVersion`、`apiVersion`、插件 ID 和入口路径。
- 管理插件启用、停用、卸载和错误状态。
- 启动和终止隔离运行时。
- 注册并清理插件贡献项。
- 对每次 Host API 调用执行权限检查。
- 为调用设置超时、请求大小和响应大小限制。

建议目录：

```text
electron/plugins/
├─ pluginManager.js
├─ pluginRuntime.js
├─ manifestSchema.js
├─ pluginProtocol.js
├─ capabilityRouter.js
└─ pluginStorage.js
```

### 5.2 插件运行时

第一阶段可使用 `worker_threads.Worker` 获得：

- 生命周期隔离。
- 主线程阻塞隔离。
- 插件崩溃隔离。
- 超时后终止运行时。

Worker 不是安全沙箱。运行普通 Node.js 插件代码时，它仍可能读取文件、环境变量或直接联网。因此 V1 必须将本地插件明确标记为“受信任或半受信任插件”，不能宣称能够安全执行恶意插件。

如果未来开放公共第三方生态，应评估独立 utility process、OS sandbox、WASM 或声明式插件等更强边界。

### 5.3 Renderer PluginHost

Renderer 只获取经过序列化和过滤的数据：

```text
src/plugins/
├─ types.ts
├─ pluginClient.ts
├─ pluginRegistry.ts
├─ slots.ts
└─ hooks/
   └─ usePluginActions.ts
```

插件运行时对象、函数、Worker 和 Electron 对象不得进入 Zustand Store。Renderer 中的 `PluginRegistry` 是可重建的内存状态，启动时通过 IPC 向 `PluginManager` 查询。

## 6. 插件包格式

```text
repo-health/
├─ manifest.json
├─ worker.js
└─ ui/
   ├─ index.html
   ├─ index.js
   └─ styles.css
```

最小清单示例：

```json
{
  "manifestVersion": 1,
  "id": "com.example.markdown-exporter",
  "name": "Markdown Exporter",
  "version": "0.1.0",
  "description": "Export selected repositories as Markdown",
  "author": "Example",
  "apiVersion": "1",
  "main": "worker.js",
  "permissions": ["repositories:read"],
  "contributes": {
    "repositoryActions": [
      {
        "id": "export-markdown",
        "title": "导出为 Markdown",
        "placement": "bulk-toolbar"
      }
    ]
  }
}
```

完整插件页面示例：

```json
{
  "manifestVersion": 1,
  "id": "com.example.repo-health",
  "name": "Repo Health",
  "version": "0.1.0",
  "apiVersion": "1",
  "permissions": ["repositories:read"],
  "contributes": {
    "pages": [
      {
        "id": "dashboard",
        "title": "Repository Health",
        "entry": "ui/index.html"
      }
    ]
  }
}
```

清单校验必须满足：

- 插件 ID 唯一且安装后不可更改。
- 入口文件必须位于插件目录内。
- 拒绝绝对路径、`..` 路径穿越和符号链接逃逸。
- 未知权限、未知贡献类型和不兼容 API 版本直接拒绝。
- 同一 major API 内保持向后兼容；breaking change 提升 major。

## 7. 扩展点

### 7.1 V1 扩展点

```ts
type PluginPlacement = 'repository-card' | 'bulk-toolbar';

interface RepositoryActionContribution {
  pluginId: string;
  actionId: string;
  title: string;
  placement: PluginPlacement;
}

interface RepositoryActionInput {
  repositories: PluginRepository[];
}

type PluginActionResult =
  | { type: 'text'; content: string; suggestedAction?: 'copy' | 'save' }
  | { type: 'open-external'; url: string }
  | { type: 'notice'; level: 'info' | 'warning' | 'error'; message: string };
```

插件返回结构化意图，由宿主决定是否复制、保存、打开页面或显示通知。插件本身不直接操作宿主 UI、剪贴板和文件系统。

### 7.2 后续扩展点

- `repositoryProcessors`
- `releaseProcessors`
- `exporters`
- `pages`
- `repositoryBadges`
- `settings`

每个新增扩展点都必须有独立输入、输出、权限和失败行为，不能提供一个通用的“运行任意宿主命令”接口。

## 8. 权限和 Host Capability

### 8.1 基础权限

| 权限 | 含义 |
|---|---|
| `repositories:read` | 读取脱敏后的仓库信息 |
| `repositories:write` | 通过宿主命令修改允许的标签或分类 |
| `releases:read` | 读取 Release 和 Asset 元数据 |
| `gists:read` | 读取脱敏后的 Gist 元数据 |
| `storage` | 使用插件隔离存储 |
| `clipboard:write` | 请求宿主写入剪贴板 |
| `external:open` | 请求宿主打开经过校验的 HTTPS URL |
| `downloads:create` | 用户确认后，由宿主下载已验证属于当前 Release 的 Asset |

### 8.2 语义化 Capability 优先

优先提供：

```text
github.searchRepositories
github.getRepository
github.getRelease
ai.generate
web.search
downloads.downloadReleaseAsset
```

而不是直接提供：

```text
fetch(anyUrl)
fs.writeFile(anyPath)
exec(anyCommand)
```

GitHub 和 AI 请求由现有宿主 Service 代理。插件只能得到结果，不能得到 Token、Key 或自定义认证 Header。

### 8.3 域名级网络权限

仅当语义化 Host API 无法满足集成需求时，才考虑：

```json
{
  "permissions": [
    "network:api.github.com",
    "network:gitlab.com"
  ]
}
```

受控 HTTP API 必须同时执行：

- 仅允许 HTTPS。
- hostname 必须与 manifest 授权项精确匹配。
- 限制 HTTP method。
- 限制请求体和响应体大小。
- 设置连接与总响应超时。
- 禁止自定义敏感 Header。
- 禁止凭据自动附加。
- 禁止 `localhost`、loopback、局域网、link-local 和保留地址。
- 禁止 `file:`、`ftp:` 等非 HTTPS 协议。
- 每次重定向重新校验目标域名和 IP。
- DNS 解析后再次阻止私有地址，降低 DNS rebinding 和 SSRF 风险。

不提供 `network:any`。

### 8.4 永不直接开放的权限

```text
node:execute
shell:execute
process:spawn
filesystem:any
network:any
environment:read
credentials:read
ipc:any
```

## 9. 完整插件页面

完整页面不直接 import 插件的 React、Vue 或 Svelte bundle。宿主只加载插件自己的隔离页面：

```text
Host Route / Page Slot
        ↓
sandboxed iframe
        ↕ postMessage
Plugin Page Bridge
        ↓
Capability Router
```

插件页面应满足：

- 无 Node.js。
- 无 Electron API。
- 无宿主 Zustand Store。
- 无凭据。
- 无原始 IPC。
- 无任意文件系统。
- 默认无任意网络权限。
- 使用严格 CSP。
- `postMessage` 校验 source、origin、pluginId、requestId 和消息 schema。

完整 UI 与高权限是两件不同的事。插件可以展示复杂 Dashboard，但仍只通过受限 Capability 获取数据。

## 10. Smart Release Recommendation 能力映射

该插件可作为后续功能验证样例：

```text
宿主提供
├─ repository 元数据
├─ release 元数据
├─ asset 列表
└─ hostEnvironment: os + arch

插件返回
├─ recommendedAssetId
├─ confidence
└─ reason

宿主负责
├─ 验证 asset 属于指定 release
├─ 展示推荐原因
├─ 用户确认
├─ 下载路径选择
├─ 下载进度
└─ 可选哈希校验
```

第一阶段只推荐和下载，不自动安装。未来若支持安装，也必须由宿主弹出包含来源、文件名和 SHA-256 的单次确认，插件不得直接执行安装程序。

## 11. 生命周期

```text
discovered
  → validated
  → disabled / enabled
  → activating
  → active
  → deactivating
  → disabled

任何阶段失败
  → error
```

要求：

- 插件默认禁用或安装后由用户明确确认权限。
- `activate` 超时后终止运行时并清理注册项。
- `deactivate` 必须移除插件注册的全部 action、processor 和 page。
- 单个插件错误不能阻止宿主启动。
- 插件错误必须可在设置页查看，但日志要脱敏。

## 12. 数据与持久化

```text
<userData>/
├─ plugins/<plugin-id>/          插件文件
├─ plugin-data/<plugin-id>.json  插件隔离数据
└─ plugins-state.json            启用状态、授权权限、错误状态
```

不将插件运行时对象写入现有 Zustand persist snapshot。插件状态由 Electron 管理，Renderer 启动后查询并构造内存 registry。

插件存储必须：

- 按插件 ID 隔离。
- 限制键和值大小及总配额。
- 只接受 JSON 可序列化数据。
- 使用安全写入策略，避免中断导致文件损坏。

## 13. IPC 边界

`electron/preload.js` 只暴露具体操作，不暴露 `ipcRenderer`：

```ts
interface ElectronPluginApi {
  list(): Promise<InstalledPlugin[]>;
  installFromDirectory(): Promise<InstallResult>;
  enable(pluginId: string): Promise<PluginOperationResult>;
  disable(pluginId: string): Promise<PluginOperationResult>;
  uninstall(pluginId: string, removePluginData?: boolean): Promise<PluginOperationResult>;
  runAction(request: RunPluginActionRequest): Promise<PluginActionResult>;
}
```

主进程必须重新验证所有 Renderer 输入，不能因为请求来自宿主页面就跳过 schema 校验。

## 14. 安装安全

V1 开发模式只支持从本地目录加载。正式安装流程再增加：

- 用户主动选择文件或目录。
- 安装前展示 ID、作者、版本、来源、SHA-256 和全部权限。
- 限制压缩包大小、解压后大小和文件数量。
- 防止 ZIP Slip、路径穿越和符号链接逃逸。
- 插件安装目录不可由 manifest 自定义。
- 更新后权限增加时必须重新确认。
- 卸载前先停用并终止插件运行时。卸载时提供“保留数据”或“同时删除插件数据”
  （隔离 Storage 与日志）的明确选择。

插件商店、签名、发布者身份和自动更新属于 V2。

## 15. 插件商城审核与发布治理

插件商城采用四层防线：

```text
运行时技术隔离
  → Capability 权限控制
  → 自动化安全扫描
  → 维护者人工审核 + 版本签名
```

人工审核用于发现恶意行为、权限与功能不匹配、低质量实现、抄袭和侵权，但不能替代运行时隔离。审核通过的插件也可能因开发者账号被盗、依赖投毒或后续版本变更而变得不安全。

### 15.1 信任等级

| 等级 | 含义 | 安装方式 |
|---|---|---|
| `Official` | 由项目维护者开发和维护 | 商城正常安装 |
| `Verified` | 发布者身份已验证，代码和版本经过深度审核 | 商城正常安装 |
| `Reviewed` | 当前版本经过人工审核 | 商城正常安装 |
| `Community` | 仅通过自动检查，未完成人工深审 | 商城警告后安装或暂不开放 |
| `Local` | 用户侧载的本地插件，未经商城审核 | 仅开发者模式 |

信任等级只描述来源和审核深度，不能解锁更强权限。`Official` 或 `Verified` 插件同样不能直接获得 Node、凭据、任意网络、文件系统或 Shell 权限。

### 15.2 发布审核流程

```text
开发者提交源码仓库 + 构建产物 + manifest
  → 自动校验 manifest、API 版本和权限
  → 固定依赖并生成 SBOM/依赖清单
  → 静态扫描危险 API、秘密信息和已知漏洞
  → 在隔离环境运行测试和行为检查
  → 维护者人工审查用途、源码、权限和网络目标
  → 从审核过的源码进行可复现构建（优先）
  → 记录 SHA-256、审核结论和版本签名
  → 发布不可变版本
```

每个插件版本单独审核。旧版本通过审核不代表新版本自动可信。

### 15.3 自动检查

至少检查：

- Manifest schema、插件 ID、API 版本和权限声明。
- 包体积、文件数量、路径穿越和符号链接。
- `child_process`、`shell`、`eval`、动态代码生成等危险调用。
- 未声明的网络目标和硬编码上传端点。
- 明文 Token、Key、私钥和测试凭据。
- 第三方依赖锁文件、已知高危漏洞和安装脚本。
- 压缩或混淆代码；商城版本原则上拒绝无法合理审查的混淆产物。
- 源码与构建产物是否对应，优先要求可复现构建。
- 插件 UI 的 CSP、外部资源和 `postMessage` 使用方式。

自动扫描命中不一定直接判定恶意，但必须阻止自动发布并进入人工复核。

### 15.4 人工审核清单

审核者至少确认：

1. 插件描述与实际行为一致。
2. 每项权限都有可验证的功能理由。
3. 权限组合没有不必要的数据外传能力。
4. 网络域名属于插件声明的服务，不包含跟踪或隐藏上传地址。
5. 插件不会收集超出功能需要的数据。
6. 私有仓库、README、AI 输入等敏感数据有明确提示。
7. 插件停用和卸载后不保留后台任务。
8. 错误和日志不会包含凭据或用户私有内容。
9. UI 不冒充宿主、系统权限弹窗或其他可信插件。
10. 许可证、名称、图标和代码来源不存在明显侵权。

### 15.5 更新、权限变化和回滚

- 商城版本不可原地覆盖；同一版本号必须对应固定哈希。
- 每个新版本重新运行自动检查，并按风险决定全量或差异人工审核。
- 新增权限、扩大域名或改变数据用途时必须重新人工审核。
- 客户端更新前展示新增权限，并要求用户重新同意。
- 未增加权限的更新也必须显示版本、发布者和变更说明。
- 商城保留最近的安全版本，支持快速回滚。
- 插件被撤回后停止新安装；对已安装用户展示明确告警，但不静默删除本地数据。

### 15.6 签名、索引和撤销

商城索引中的每个版本至少记录：

```json
{
  "pluginId": "com.example.repo-health",
  "version": "1.2.0",
  "sha256": "...",
  "publisher": "example",
  "trustLevel": "Reviewed",
  "permissions": ["repositories:read"],
  "reviewedCommit": "...",
  "reviewedAt": "2026-09-12T00:00:00Z",
  "signature": "..."
}
```

客户端安装前验证索引签名和插件包 SHA-256。签名私钥不能存放在仓库或普通 CI 日志中，应使用专门的 secrets/签名服务，并保留密钥轮换方案。

商城还需要可签名的撤销列表，记录：

- 被撤销的插件版本。
- 撤销原因和公告链接。
- 建议回退版本。
- 是否存在已知数据泄露或远程执行风险。

### 15.7 审核透明度和隐私

- 插件详情页公开权限、联网域名、数据用途、源码地址、版本哈希和审核等级。
- 显示“审核的是哪个版本”，不能只给插件永久的审核徽章。
- 审核者不得要求或接触用户真实 Token、私有仓库数据和生产凭据。
- 行为测试使用合成数据和专用测试账户。
- 审核日志不得公开插件作者或测试者的敏感信息。
- 提供安全问题举报、紧急下架和发布者申诉流程。

### 15.8 治理边界

初期维护者人数有限时，不应立刻承诺公共商城。推荐顺序：

```text
本地开发插件
  → 官方示例插件
  → 少量 Reviewed 插件清单
  → 签名商城
  → 分级审核和社区审核者
```

社区审核者可以参与代码审查，但最终签名和发布权限应限制在最小维护者集合中，并要求双人复核高风险权限插件。

## 16. V1 实施切片

第一轮 PR 只完成“发现和验证”，不执行插件代码。

### 16.1 范围

新增：

```text
electron/plugins/manifestSchema.js
electron/plugins/pluginManager.js
electron/plugins/manifestSchema.test.js
electron/plugins/pluginManager.test.js
```

修改：

```text
electron/main.js
electron/preload.js
package.json
```

功能：

1. 从 `<userData>/plugins` 扫描一级子目录。
2. 读取并验证 `manifest.json`。
3. 返回合法插件和可解释的无效插件记录。
4. 通过 `plugins:list` IPC 向 Renderer 暴露只读列表。
5. 此阶段没有 `require()`、`import()` 或 Worker 执行插件入口。

### 16.2 第一轮明确不做

- 插件安装 UI。
- 插件执行。
- 权限授权 UI。
- Zustand 接入。
- 仓库卡片或批量工具栏扩展点。
- 完整插件页面。
- 网络 Host API。

### 16.3 第一轮验收标准

- 合法 manifest 被列出。
- 缺失字段、错误类型和未知字段得到稳定错误码。
- 重复插件 ID 被拒绝。
- 不兼容的 `manifestVersion` 或 `apiVersion` 被拒绝。
- 入口路径穿越插件目录时被拒绝。
- 不存在的入口文件被拒绝。
- 一个损坏插件不会阻止其他插件被扫描。
- 不读取插件代码内容，不执行插件代码。
- IPC 返回值经过序列化，不泄露本地绝对路径。
- 现有 Electron MCP、代理、托盘和前端功能不受影响。

## 17. 后续版本路线

### V1：基础插件协议

- Manifest discovery 和 validation。
- 启用、停用和卸载。
- 受信任本地插件运行时。
- Repository actions。
- Processors 和 exporters。
- 插件隔离 storage 和 logging。

### V1.1：Release 能力

- Release processors。
- `github.*` Host API。
- `downloads.downloadReleaseAsset`。
- Smart Release Recommendation 示例插件。

### V1.2：完整插件页面

- Plugin page contribution。
- sandboxed iframe。
- `postMessage` bridge。
- CSP 和消息 schema。

### V1.3：高级宿主能力

- `ai.generate`。
- `web.search`。
- 必要时增加 domain-scoped HTTPS。

### V2：公共生态

- 自动安全扫描与人工审核工作流。
- 按版本记录的审核等级和不可变 SHA-256。
- 插件包与商城索引签名。
- 发布者身份、密钥轮换和撤销机制。
- 插件 registry/store、更新和回滚。
- 权限变化重新审核并要求用户重新确认。
- 更强的插件运行隔离。

## 18. 测试策略

### 单元测试

- Manifest schema 边界。
- 路径规范化和目录逃逸。
- API 版本兼容。
- 权限与 capability 映射。
- 生命周期状态转换。
- 插件 storage 配额。
- 网络目标校验和 SSRF 阻断。

### Electron 测试

- IPC 参数校验。
- PluginManager 扫描失败隔离。
- 插件运行时超时与终止。
- 禁用后贡献项全部清理。

### Renderer 测试

- Web 环境显示“插件仅桌面版可用”。
- 插件 action 能正确出现在指定 slot。
- action 错误只显示为宿主通知。
- sandbox 页面消息来源和 schema 校验。

### 回归验证

- `npm run lint`
- `npm run typecheck`
- `npm run check:boundaries`
- `npm run test:run`
- `npm run build`

## 19. 提交上游前的沟通方式

插件系统属于跨 Electron、Renderer、安全和公共 API 的大型改动。正式实现前应先提交 Discussion 或设计 Issue，明确：

- Electron-only 起步。
- 第一轮只做 manifest discovery，不执行第三方代码。
- 不暴露凭据、Node、任意网络或原始 IPC。
- 每个阶段独立 PR，可单独审查和回滚。
- Worker 不被描述为恶意代码安全沙箱。
- 完整 UI、联网和商店均不进入第一轮 PR。
- 商城采用自动扫描、人工审核和版本签名，但审核不会扩大插件运行权限。

这能让维护者先确认方向，避免一次修改大量文件后因项目范围或安全模型不被接受。

## 20. 待维护者确认的问题

1. 项目是否愿意接受 Electron-only 的插件能力，还是要求 Web 端也具备等价体验？
2. V1 插件是否明确限定为用户主动安装的受信任本地代码？
3. 第一个扩展点选择 `bulk-toolbar` 是否符合产品优先级？
4. 是否接受插件状态独立保存在 Electron `userData`，不进入 Zustand 和后端同步？
5. Plugin API 是否作为独立长期兼容的公共接口维护？
6. 完整插件页面使用 iframe 是否符合当前 UI 和 CSP 方向？
7. 项目是否愿意长期承担插件审核、签名密钥、撤销公告和安全响应责任？
8. 高风险插件是否要求至少两名维护者复核？

## 21. 开发起点

在维护者认可总体方向前，可以安全开始的工作只有第一轮“Manifest discovery”切片：

1. 定义最小 manifest schema 和稳定错误码。
2. 编写失败测试：合法、字段缺失、版本不兼容、重复 ID、路径穿越和损坏 JSON。
3. 实现纯扫描和验证逻辑。
4. 增加只读 `plugins:list` IPC。
5. 运行 Electron 测试和全量回归。

完成这一切后，宿主仍不会执行任何插件代码，因此安全影响和审查范围都保持可控。

## 22. 实施状态

截至 2026-09-13：

- 第一轮 Manifest discovery 与 validation 已实现。
- V1 本地插件协议已实现：安装、默认禁用、权限确认、启停、卸载（可选删除隔离数据）、
  Worker 生命周期、Repository Actions、Processors、Exporters、隔离 Storage 和脱敏日志。
  `repositories:read` 覆盖已收藏的私有仓库元数据；`repositories:write` 与 `gists:read`
  仍为预留声明。
- V1 明确仍是受信任本地插件模型；Worker 不作为恶意代码安全边界。
- V1.1 Release 能力已实现：Release processors、基于宿主脱敏快照的只读 `github.*`、
  用户确认后由宿主执行的 Release Asset 下载，以及 Smart Release Recommendation 示例插件。
- V1.2 完整插件页面已实现：页面贡献、`plugin-page:` 本地资源协议、sandboxed iframe、
  CSP、经校验的 `postMessage` Bridge，以及 Repo Health 页面示例。页面型插件可无 Worker；
  若插件同时包含 Worker，V1 的受信任本地代码限制仍然适用。
- V1.3 页面高级宿主能力已实现：逐次确认的 `ai.generate` 与 `web.search`；
  用户自行配置 SearXNG HTTPS 实例，插件不可指定任意联网目标。Worker 不获得
  这两项能力，继续按 V1 受信任本地代码模型运行。V2 公共生态尚未实现。

V1 开发协议和示例见 `docs/plugins/v1-development.md` 与
`examples/plugins/markdown-exporter`；V1.1 示例见
`examples/plugins/smart-release-recommender`。
V1.2 页面示例见 `examples/plugins/repo-health-page`。
V1.3 页面能力协议与隐私限制见 `docs/plugins/v1-development.md`。
