# V1 本地插件开发指南

> 面向本地插件作者的技术参考（`apiVersion: "1"`，涵盖 V1.0–V1.6 全部能力）。
>
> 更多文档：[Wiki · 插件使用](../wiki/Plugin-Usage.md) · [Wiki · 插件开发](../wiki/Plugin-Development.md) · [Wiki · Plugin Development (EN)](../wiki/Plugin-Development-EN.md) · [官方示例](../../examples/plugins/)

## 能力演进总览

| 版本 | 核心能力 | 参考实现 |
|---|---|---|
| **V1.0** | 本地 Worker 插件（`worker_threads.Worker`）、Manifest 校验、隔离 `storage`、仓库操作 / 处理器 / 导出器 | [`markdown-exporter`](../../examples/plugins/markdown-exporter) |
| **V1.1** | Release 处理器（`runReleaseProcessor`）、只读内存快照 `github.*` API、用户确认的 Release Asset 宿主下载 | [`smart-release-recommender`](../../examples/plugins/smart-release-recommender) |
| **V1.2** | 沙箱页面贡献（`contributes.pages`）、`plugin-page:` 自定义协议、严格 CSP、`postMessage` 能力桥 | — |
| **V1.3** | 页面高级能力：逐次确认的 `ai.generate`（`ai:invoke`）与 SearXNG `web.search`（`web:search`） | — |
| **V1.4** | 仓库卡片弹窗动作（`opensPage`）、仓库元数据与 README 上下文下发、页面输出能力（剪贴板文本/图片、原生保存文件） | [`repo-info-card`](../../examples/plugins/repo-info-card) |
| **V1.5** | 页面只读网络代理 `network.request`（`network:api.github.com`）、账号标签 `accountTag` / `acct` | [`repo-insights`](../../examples/plugins/repo-insights) |
| **V1.6** | 紧凑小弹窗形态（`display: "popup"`）、页面外链能力 `shell.openExternal`（`external:open`）、自定义图标与卡片快捷操作排序、自助插件源市场 | [`repo-custom-fields`](../../examples/plugins/repo-custom-fields) |

## 安全边界与信任模型

| 插件形态 | 运行环境 | 信任假设 |
|---|---|---|
| **Worker 插件**（含 `main`） | 独立 `worker_threads.Worker` | **受信任的本地 Node.js 代码**。Worker 仅隔离生命周期、崩溃与超时，**不是安全沙箱**；插件代码仍可能直接访问本机文件、环境变量和网络。 |
| **页面插件**（`contributes.pages`，可无 `main`） | `sandbox="allow-scripts allow-same-origin"` iframe + `plugin-page://<id>` 协议 | **不可信页面内容**。无 Node.js、无 Electron API、无凭据；`allow-same-origin` 仅保留独立协议源以便宿主校验来源并拒绝文档导航替换，与宿主仍属不同源。 |

> [!WARNING]
> 宿主不会主动把 GitHub Token、AI Key、WebDAV 密码、Electron API、原始 IPC 或 Zustand Store 传给插件。若插件同时声明 `main` 与 `pages`，页面沙箱不会降低 Worker 的本地权限。

## 最小目录与安装入口

Worker 插件：

```text
my-plugin/
├─ manifest.json
└─ worker.js
```

纯页面插件（或仅含 `opensPage` 弹窗动作的插件）可省略 `main`：

```text
my-plugin/
├─ manifest.json
└─ ui/
   ├─ index.html
   ├─ index.js
   └─ style.css
```

安装与管理入口位于桌面端 **设置 → 连接与诊断 → 插件管理**：

- **安装本地插件**：选择包含 `manifest.json` 的本地目录。
- **插件市场（社区插件注册表）**：用户可添加公开的 GitHub 仓库目录 URL（`https://github.com/{owner}/{repo}[/tree/{ref}[/path]]`）作为插件源，客户端按提交 SHA 固定拉取对应子目录并复用本地安装校验流程。
- 无论本地安装还是市场安装，新插件默认**已禁用**，必须经用户确认 Manifest 中列出的全部权限后才会启用；通过市场更新时，若权限未变更且原插件已启用，原子替换后会保持启用状态，否则自动停用等待重新确认。
- 卸载时宿主会删除安装目录，并让用户选择「保留数据并卸载」或「卸载并删除数据」（后者同时清理 `plugin-data/` 存储与 `plugin-logs/` 日志）。

## 权限清单

未实现的预留权限可以出现在 Manifest 中，但不会解锁对应 Host API：

| 权限 | 适用范围 | 行为与约束 |
|---|---|---|
| `repositories:read` | Worker + 页面 | 读取宿主已加载的仓库快照，**包含已收藏的私有仓库元数据**；启用时会有单独提示。 |
| `privateRepositories:read` | Worker + 页面 | 预留的独立过滤权限；当前与 `repositories:read` 同样覆盖私有仓库，也可单独满足仓库贡献校验。 |
| `releases:read` | Worker + 页面 | 读取宿主已加载的 Release / Asset 快照（不含下载 URL）。 |
| `storage` | Worker + 页面 | 按插件隔离的持久化 JSON 存储。 |
| `clipboard:write` | Worker + 页面 | Worker Action 的 `copy` 建议，以及页面 Bridge 的 `clipboard.write` / `clipboard.writeImage`（V1.4）。 |
| `external:open` | Worker + 页面 | Worker Action 的 `open-external`（仅无凭据 HTTPS），以及页面 Bridge 的 `shell.openExternal`（V1.6，http/https 白名单）。 |
| `downloads:create` | Worker + 页面 | Release 推荐显示「宿主下载」，以及页面 Bridge 的 `downloads.saveFile`（V1.4）；始终由用户在原生对话框中确认保存位置。 |
| `ai:invoke` | **仅页面 Bridge** | 逐次弹窗确认后调用当前激活的 AI Provider；Worker `context` 不提供此能力。 |
| `web:search` | **仅页面 Bridge** | 逐次弹窗确认后查询用户配置的 SearXNG HTTPS 实例；Worker `context` 不提供此能力。 |
| `network:<domain>` | **仅页面 Bridge**（V1.5） | 按主机授权的只读 GET 代理；当前仅支持 `api.github.com` 且路径受白名单限制（见「V1.5 页面网络能力」）。域名须为公网主机名，禁止 `localhost`；Worker 不提供此能力。 |
| `repositories:write` | 预留 | V1 不提供写入仓库的 Host API。 |
| `gists:read` | 预留 | V1 不提供 Gist 查询 API。 |

## Manifest 规范

未知顶层字段与未知贡献字段一律拒绝。`manifestVersion` 必须为 `1`，`apiVersion` 必须为 `"1"`。入口路径必须位于插件目录内；绝对路径、`..` 穿越与符号链接会被拒绝。

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
  "permissions": ["repositories:read", "storage", "clipboard:write"],
  "contributes": {
    "repositoryActions": [
      {
        "id": "copy-repository",
        "title": "Copy repository",
        "icon": "file-text",
        "placement": "repository-card"
      }
    ],
    "repositoryProcessors": [
      { "id": "health", "title": "Repository health" }
    ],
    "releaseProcessors": [
      { "id": "recommend-asset", "title": "Recommend asset" }
    ],
    "exporters": [
      {
        "id": "markdown",
        "title": "Markdown",
        "fileExtension": ".md",
        "mimeType": "text/markdown"
      }
    ],
    "pages": [
      { "id": "dashboard", "title": "Repository Health", "entry": "ui/index.html" }
    ]
  }
}
```

### `repositoryActions` 图标与卡片快捷操作

- `icon`（可选字符串）：指定该动作的默认图标 key，支持宿主内置的 59 个 Lucide 图标 key（例如 `plug`、`sparkles`、`chart`、`file-text`、`code`、`tag`、`bookmark`、`rocket` 等，完整列表见 [`src/plugins/pluginIcons.ts`](../../src/plugins/pluginIcons.ts)）。宿主会自动去除首尾空白、转小写并剥离可选的 `lucide:` 前缀；无法识别的 key 会回退到默认 `plug` 图标。
- 用户可在 **设置 → 连接与诊断 → 插件管理** 中点击插件卡片上的 **自定义图标** 覆盖插件图标，渲染优先级为：**用户自定义图标 > Manifest `action.icon` > 默认 `plug` 图标**。
- `placement: "repository-card"` 的已启用动作会自动出现在 **设置 → 应用 → 外观设置 → 仓库卡片快捷操作** 列表中，用户可开启快捷显示将其固定到仓库卡片操作栏，并通过拖拽把手或上移/下移按钮调整顺序（关闭快捷显示时仍保留在卡片 `…` 菜单中）。

## Worker API

入口使用 CommonJS 导出：

```js
module.exports = {
  async activate(context) {},
  async deactivate() {},
  async runAction({ actionId, repositories }) {},
  async runProcessor({ processorId, repositories }) {},
  async runReleaseProcessor({ processorId, repository, release, hostEnvironment }) {},
  async runExporter({ exporterId, repositories }) {},
};
```

`activate(context)` 收到的 `context` 经 `Object.freeze` 冻结，包含插件 ID、已授权权限列表、脱敏日志，以及按权限按需挂载的 `storage` 与 `github`：

```js
await context.storage.set('settings', { enabled: true });
const settings = await context.storage.get('settings');
await context.storage.delete('settings');
await context.log.info('Activated', { enabled: settings?.enabled });
```

- 仅在声明并获批 `storage` 后才提供 `context.storage`。
- 常见 Token、`Authorization` Header 及敏感字段名会被自动脱敏，日志也会接入桌面端 **诊断日志 → 插件** 视图；插件仍不应主动输出隐私信息。

声明 `repositories:read` / `privateRepositories:read` 或 `releases:read` 后，可获得只读快照查询：

```js
const matches = await context.github.searchRepositories('electron', { limit: 20 });
const repository = await context.github.getRepository(repositoryId);
const release = await context.github.getRelease(releaseId);
```

这些查询只访问宿主内存中的脱敏快照，不会发起实时 GitHub API 请求。

### 返回结构

- **Repository Action**：返回宿主可理解的意图（不能返回 HTML 或任意宿主命令）：

```js
return { type: 'text', content: '...', suggestedAction: 'copy' }; // 或 'save'
return { type: 'notice', level: 'info', message: 'Done' };        // info | warning | error
return { type: 'open-external', url: 'https://example.com' };
```

- **Repository Processor**：只能返回本次输入仓库 ID 的摘要、标签与分类建议（当前无独立 UI 消费）：

```js
return {
  repositories: [{ id: 1, summary: 'Active', tags: ['healthy'], category: 'tools' }]
};
```

- **Exporter**：返回纯文本和可选文件名；扩展名和 MIME 类型以 Manifest 为准：

```js
return { content: '# Repositories', fileName: 'stars.md' };
```

- **Release Processor**：返回当前 Release 内的一个 Asset ID、置信度 `[0, 1]` 和简短原因（≤ 2000 字符）：

```js
return {
  recommendedAssetId: 123,
  confidence: 0.92,
  reason: 'Windows x64 installer'
};
```

宿主会验证 Asset 归属。仅在获批 `downloads:create` 后，推荐结果才显示「宿主下载」；用户点击后须在原生保存对话框中确认来源、文件名与保存位置。插件拿不到下载 URL 或本地路径，也不能自动安装文件。

## V1.2 完整插件页面

纯页面型 Manifest 可省略 `main`：

```json
{
  "manifestVersion": 1,
  "id": "com.githubstarsmanager.repo-insights",
  "name": "Repo Insights",
  "version": "0.1.1",
  "apiVersion": "1",
  "permissions": ["repositories:read", "network:api.github.com", "storage"],
  "contributes": {
    "pages": [{ "id": "insights", "title": "Repository Insights", "entry": "ui/index.html" }]
  }
}
```

启用后可在 **设置 → 连接与诊断 → 插件管理** 点击「打开页面：…」。宿主通过 `plugin-page:` 协议提供页面目录内的静态资源（禁止路径穿越、符号链接逃逸以及读取 `manifest.json` / `main`）。iframe 的 CSP 为 `default-src 'none'`，默认拒绝联网、嵌套页面、Worker、表单和内联脚本。React/Vue 等前端框架需预构建为静态文件并使用相对路径，不要引入 CDN 脚本。

> [!TIP]
> CSP 的 `style-src` 同样不包含 `'unsafe-inline'`：动态插入 `<style>` 或内联 `style` 属性会被静默拦截。需要运行时生成样式时，请使用外链样式表或 Constructable Stylesheet（`new CSSStyleSheet()` + `replaceSync()` 后挂到 `root.adoptedStyleSheets`）。在 Shadow DOM 中 `:root` 无法匹配内部元素，CSS 自定义属性应挂在 `#card` 等实际根节点上（参考 `examples/plugins/repo-info-card`）。

### `postMessage` 能力桥协议

iframe 加载完成后宿主发送 `plugin-page:init`（含一次性 `token` 以及弹窗模式下的 `context`）。页面通过 `window.parent.postMessage` 发起能力请求：

```js
window.parent.postMessage({
  type: 'plugin-page:request',
  pluginId: 'com.githubstarsmanager.repo-insights',
  pageId: 'insights',
  requestId: 'request_1',
  token,
  method: 'repositories.search',
  args: { query: 'react', limit: 20 },
  origin: window.location.origin,
}, '*');
```

宿主窗口在开发期为 `localhost`、打包后为 `file://`，因此页面发往宿主必须使用 `'*'` 并在消息体中携带 `origin`；宿主严格校验 `event.source`、`event.origin === 'plugin-page://<插件 id>'`、消息内 `origin` 字段、一次性 `token` 与参数 Schema，回包时定向发往该精确来源。

页面 Bridge 支持的全部方法：

| 方法 | 所需权限 | 说明 |
|---|---|---|
| `repositories.search` | `repositories:read` / `privateRepositories:read` | 搜索内存仓库快照（`query` ≤ 200，`limit` 1–100） |
| `repositories.get` | `repositories:read` / `privateRepositories:read` | 按 `repositoryId` 读取单个仓库快照 |
| `releases.get` | `releases:read` | 按 `releaseId` 读取 Release 快照 |
| `storage.get` / `set` / `delete` | `storage` | 读写隔离插件存储 |
| `ai.generate` | `ai:invoke` | V1.3：逐次确认后调用当前激活 AI Provider |
| `web.search` | `web:search` | V1.3：逐次确认后查询用户配置的 SearXNG |
| `clipboard.write` | `clipboard:write` | V1.4：写入文本到系统剪贴板（≤ 200,000 字符） |
| `clipboard.writeImage` | `clipboard:write` | V1.4：解码 PNG base64 写入剪贴板图像（10 MiB 载荷上限） |
| `downloads.saveFile` | `downloads:create` | V1.4：原生保存对话框确认后写文件（10 MiB 载荷上限） |
| `network.request` | `network:<domain>` | V1.5：经宿主代理发起白名单只读 GET 请求 |
| `shell.openExternal` | `external:open` | V1.6：经宿主用系统浏览器打开 http/https 外链 |

## V1.3 页面高级能力（`ai.generate` 与 `web.search`）

这两项仅通过页面 Bridge 提供，不暴露 AI Key、搜索凭据或任意 `fetch`；Worker `context` 不提供对应方法。

```js
// 1) 调用当前激活 AI Provider（每次弹窗展示完整提示词与目标地址）
method: 'ai.generate',
args: {
  system: 'Summarize this repository', // ≤ 2000 字符
  user: 'Public repository details',   // 非空，≤ 160000 字符（支持携带完整 README）
  maxTokens: 500                       // 可选，1–4000
}
// 成功返回 value: 'generated text'（≤ 65536 字符）

// 2) 调用用户配置的 SearXNG HTTPS 实例（每次弹窗展示完整搜索词与实例地址）
method: 'web.search',
args: { query: 'open source alternatives', limit: 5 } // query ≤ 200，limit 1–10
// 成功返回 value: [{ title, url, snippet }]
```

- **AI 调用**：未配置 Provider 时失败，不会静默回退；请求正文不写入调试日志；关闭页面会中止进行中的请求。
- **网页搜索**：默认关闭且无预设公共实例，需用户在 **设置 → 连接与诊断 → 插件管理** 顶部填写启用 JSON 输出的公网 HTTPS SearXNG 地址。宿主拒绝非 HTTPS、带凭据、localhost/内网/原始 IP，不跟随重定向，超时 8 秒、响应上限 256 KiB。

## V1.4 弹窗动作（`opensPage`）与页面输出能力

页面型插件可在 `repositoryActions` 中声明 `opensPage`：用户在仓库卡片快捷按钮或 `…` 菜单点击该动作时，宿主不启动 Worker，而是把指定页面装进弹窗并随 `plugin-page:init` 下发仓库上下文。

```json
{
  "contributes": {
    "repositoryActions": [
      {
        "id": "generate-info-card",
        "title": "生成仓库信息卡",
        "placement": "repository-card",
        "opensPage": "info-card"
      }
    ],
    "pages": [
      { "id": "info-card", "title": "Repository Info Card", "entry": "ui/index.html" }
    ]
  }
}
```

校验与上下文约束：

- `opensPage` 必须指向本插件 `contributes.pages` 中已声明的页面 `id`，且 `placement` 必须为 `"repository-card"`。
- 仅含 `opensPage` 动作的插件无需 `main`，不会启动 Node Worker；仍需声明 `repositories:read` 或 `privateRepositories:read`。
- 全屏弹窗下发的 `init` 上下文包含 `{ repository, readme, language, theme, accountTag }`：
  - `repository` 为宿主白名单投影（含基础元数据及 `custom_description`、`ai_summary`，不含宿主内部状态）。
  - 全屏弹窗（默认 `display: "fullscreen"`）会异步抓取 `readme`，失败则为 `null`，到位后以同一 `token` 补发一次 `plugin-page:init`；紧凑弹窗（`display: "popup"`）**不抓取也不下发 `readme`**。
  - `language` 与 `theme` 跟随宿主当前界面语言与深浅色主题；从设置页直接打开页面时不含 `context`，页面应回退到默认行为（例如用 `repositories.search` 选仓库）。
  - `accountTag` 是当前 GitHub 身份的稳定匿名标签（切换账号时会重新下发 `init`）。

页面输出能力仅在页面 Bridge 可用，且 `clipboard.writeImage` 与 `downloads.saveFile` 的 `args` 载荷预算放宽至 **10 MiB**（其余方法为 1 MiB）；`downloads.saveFile` 的 `fileName` 禁止路径分隔符与前导点，插件无法获知最终保存路径。

## V1.5 页面网络能力（`network.request`）

页面型插件可声明 `network:api.github.com`，通过 `network.request` 让宿主代理只读 GET 请求。授权在启用插件时一次性确认（确认框附带专项说明），不逐次弹窗。

```js
method: 'network.request',
args: {
  host: 'api.github.com',
  path: '/repos/facebook/react/stats/commit_activity',
  query: { per_page: 12 } // 可选：仅允许 per_page / page（1–100）与 state（open|closed|all）
}
// 成功返回 value: { status, body, acct }
// 202 / 204 时 body 为 null；非 2xx 归一为 success: false（code: 'PLUGIN_NETWORK_HTTP_ERROR'）
```

主进程与渲染端双侧执行同一套白名单校验：

- **允许主机**：当前仅 `api.github.com`。
- **允许路径**：`/repos/{owner}/{repo}`、`/stats/commit_activity`、`/stats/participation`、`/stats/code_frequency`、`/contributors`、`/languages`、`/releases`、`/pulls`、`/tags`、`/stargazers`、`/stargazers/history`、`/community/profile`、`/security-advisories` 及 `/users/{login}`。禁止查询串拼接、片段、空白、空段及 `.` / `..`。
- **请求限制**：仅 GET；固定请求头（`Accept: application/vnd.github+json`、`X-GitHub-Api-Version`，有 Token 时由渲染端附 `Authorization: Bearer`，Token 不进 IPC 且页面不可见）；未配置 Token 时匿名访问（60 次/小时）；一律拒绝重定向（`redirect: 'error'`）；超时 15 秒、正文上限 4 MiB。
- **`stats/*` 202 处理**：GitHub 首次生成统计缓存时返回 `202`（`body: null`），页面应提示「统计生成中」并支持重试。

## V1.6 弹窗形态（`display`）与外链能力（`shell.openExternal`）

面向轻量表单（如仓库自定义字段），`repositoryActions` 支持可选 `display` 字段：

```json
{
  "contributes": {
    "repositoryActions": [
      {
        "id": "custom-fields",
        "title": "仓库自定义信息",
        "placement": "repository-card",
        "opensPage": "fields",
        "display": "popup"
      }
    ]
  }
}
```

- `display` 仅接受 `"fullscreen"`（默认）或 `"popup"`（固定宽度的非全屏小弹窗，高度 `min(72vh, 640px)`，由页面自身滚动）。
- `display` 只能与 `opensPage` 搭配使用；普通 Worker 动作带该字段会被拒绝安装。
- `popup` 形态跳过 README 抓取（`context` 为 `{ repository, language, theme, accountTag }`），其余能力桥与权限校验与全屏弹窗一致。

页面外链 `shell.openExternal`（需 `external:open` 权限）：

- 沙箱 iframe 中的普通 `<a>` 导航与弹窗会被宿主与 CSP 拦截，`shell.openExternal` 是页面在系统浏览器打开外链的唯一通道。
- 页面桥、能力路由与宿主操作三处共享同一 URL 白名单：仅 `http:` / `https:`、必须含主机名、长度 ≤ 2048，拒绝 `javascript:` / `file:` / `data:` 及字面回环/链路本地/唯一本地地址（`localhost`、`*.localhost`、`127.0.0.0/8`、`0.0.0.0`、`169.254.0.0/16`、`::1`、`::`、`fe80::/10`、`fc00::/7` 及其 IPv4 映射形式）。该校验仅检查字面主机名、**不解析 DNS**。
- Worker 动作的 `open-external` 仍沿用既有契约（仅无凭据 HTTPS），Worker 侧不注入 `shell.openExternal`。

## 多账号环境下的存储与隔离说明

桌面端多账号切换会按账号 Profile 隔离前端偏好设置（包括 `pluginCustomIcons` 插件自定义图标与 `repositoryCardActions` 卡片快捷操作排列），但以下目录仍位于应用级 `userData` 下由各账号共用：

- `plugins/`（已安装插件）、`plugins-marketplace.json`（插件源列表）、`plugin-data/`（插件隔离存储）、`plugin-logs/`（插件日志）。

> [!IMPORTANT]
> 如果你的插件会在 `storage` 中缓存与当前 GitHub 账号或私有仓库相关的数据，请使用 `plugin-page:init` 下发的 `context.accountTag`（或 `network.request` 返回的 `acct`，即 Token 的 SHA-256 前 16 位十六进制，匿名请求为 `'anon'`）作为存储命名空间前缀，避免切换账号后读到旧账号缓存（参考 [`examples/plugins/repo-insights`](../../examples/plugins/repo-insights)）。

## 限额汇总

| 项目 | 上限 |
|---|---|
| Manifest / 安装包 | 256 KiB / 2000 文件 / 50 MiB（禁止符号链接） |
| 单次仓库列表 / 快照上限 | 1000 仓库/次；快照 10000 仓库 / 20000 Release（合计 64 MiB） |
| Action / Processor / Exporter 输出 | 1 MiB / 1 MiB / 5 MiB |
| Storage 键 / 单值 / 插件总配额 | 128 字符 / 64 KiB / 1 MiB |
| 日志单条 / 文件 | 4000 字符 / 1 MiB（轮转 `.log.1`） |
| Worker 调用超时 | 5 秒 |
| 页面资源 / 并发 / 频率 | 单文件 20 MiB；8 并发 / 120 次每分钟 |
| 页面请求载荷 | 1 MiB（`clipboard.writeImage` / `downloads.saveFile` 为 10 MiB） |
| `network.request` 超时 / 正文 | 15 秒 / 4 MiB |
| `ai.generate`（system / user / 输出） | 2000 / 160000 / 65536 字符 |
| `web.search`（query / limit / 超时 / 响应） | 200 字符 / 1–10 / 8 秒 / 256 KiB |
| 剪贴板文本 / 宿主下载资源 | 200,000 字符 / 8 GiB |
| 市场插件源 / 单源目录探测 | 最多 50 个源 / 每源 200 个子目录 |

## 官方示例

仓库 [`examples/plugins/`](../../examples/plugins/) 包含 5 个完整可安装示例（同时也是插件市场的默认内置源）：

| 目录 | 形态 | 核心演示能力 |
|---|---|---|
| [`markdown-exporter`](../../examples/plugins/markdown-exporter) | Worker | 卡片 + 批量 Action、Processor、Exporter、`storage`、`clipboard:write` |
| [`smart-release-recommender`](../../examples/plugins/smart-release-recommender) | Worker | Release Processor、`hostEnvironment`、`downloads:create` 宿主下载 |
| [`repo-info-card`](../../examples/plugins/repo-info-card) | 页面（V1.4 全屏弹窗） | `opensPage`、仓库元数据 + README 上下文、`ai.generate` 长文本、Shadow DOM + Constructable Stylesheet、PNG 导出 |
| [`repo-insights`](../../examples/plugins/repo-insights) | 页面（V1.5 全屏弹窗） | `network.request` 实时指标、本地打包 Chart.js、健康度评分、`ai:invoke` 动态分析、按 `accountTag` 隔离的 `storage` 缓存 |
| [`repo-custom-fields`](../../examples/plugins/repo-custom-fields) | 页面（V1.6 紧凑弹窗） | `display: "popup"`、`shell.openExternal` 外链、`storage` 按仓库存字段、预览 ⇄ 编辑与拖拽排序 |
