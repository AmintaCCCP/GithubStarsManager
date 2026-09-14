# V1 本地插件开发指南

V1 插件是用户明确安装并授权的本地 Node.js 插件。每个插件运行在独立
`worker_threads.Worker` 中，用于隔离生命周期、崩溃和超时。

Worker 不是安全沙箱。插件代码仍可能直接使用 Node.js 访问本机文件、环境变量和网络，
因此只能启用已经审查并信任的本地插件。宿主不会主动把 GitHub Token、AI Key、
Electron API 或 Zustand Store 传给插件。

V1.1 增加了 Release processor、只读语义化 `github.*` Host API，以及必须由用户确认
保存位置的 Release Asset 下载。这里的 GitHub API 查询宿主当前已加载的脱敏快照，
不会把 Token、认证 Header 或任意网络请求能力交给插件。

V1.2 增加页面贡献。仅含页面、没有 `main` 的插件不会启动 Node Worker；页面在
`sandbox="allow-scripts"` iframe 中运行，不能读取宿主 DOM、Electron API、Token 或
Zustand Store。若同时声明 `main`，该 Worker 仍是受信任本地代码，页面隔离不改变其权限。

## 最小目录

```text
my-plugin/
├─ manifest.json
└─ worker.js
```

可以从设置页的“插件 → 安装本地插件”选择该目录。安装完成后插件默认禁用，
用户确认 Manifest 中列出的全部权限后才会启动。

## Manifest

```json
{
  "manifestVersion": 1,
  "id": "com.example.markdown-exporter",
  "name": "Markdown Exporter",
  "version": "0.1.0",
  "apiVersion": "1",
  "main": "worker.js",
  "permissions": ["repositories:read", "storage", "clipboard:write"],
  "contributes": {
    "repositoryActions": [
      {
        "id": "copy-repository",
        "title": "Copy repository",
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
    ]
  }
}
```

插件 ID、版本、权限、贡献点和入口路径都会被严格校验。入口必须位于插件目录中；
绝对路径、路径穿越和符号链接会被拒绝。

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

`activate(context)` 只收到插件 ID、已授权权限、脱敏日志和按插件隔离的 Storage：

```js
await context.storage.set('settings', { enabled: true });
const settings = await context.storage.get('settings');
await context.storage.delete('settings');
await context.log.info('Activated', { enabled: settings?.enabled });
```

只有声明并获批 `storage` 权限后才会提供 `context.storage`。日志中的常见 Token、
Authorization Header 和敏感字段会被脱敏，但插件仍不应主动记录隐私数据。

声明 `repositories:read` 或 `releases:read` 后，插件可获得对应的只读查询：

```js
const matches = await context.github.searchRepositories('electron', { limit: 20 });
const repository = await context.github.getRepository(repositoryId);
const release = await context.github.getRelease(releaseId);
```

这些查询只访问宿主内存中的脱敏快照，不会发起实时 GitHub API 请求。

## 返回结构

Repository Action 返回宿主可理解的意图：

```js
return { type: 'text', content: '...', suggestedAction: 'copy' };
return { type: 'notice', level: 'info', message: 'Done' };
return { type: 'open-external', url: 'https://example.com' };
```

- `copy` 需要 `clipboard:write`。
- `open-external` 需要 `external:open`，且只接受无凭据的 HTTPS URL。
- 插件不能返回 HTML 或任意宿主命令。

Processor 只能返回本次输入中已有仓库 ID 的摘要、标签和分类建议：

```js
return {
  repositories: [{ id: 1, summary: 'Active', tags: ['healthy'] }]
};
```

Exporter 返回纯文本和可选文件名；宿主根据 Manifest 决定扩展名和 MIME 类型：

```js
return { content: '# Repositories', fileName: 'stars.md' };
```

Release processor 返回当前 Release 内的一个 Asset ID、置信度和简短原因：

```js
return {
  recommendedAssetId: 123,
  confidence: 0.92,
  reason: 'Windows x64 installer'
};
```

宿主会验证 Asset 归属。只有插件声明并获批 `downloads:create` 后，推荐结果才显示
“宿主下载”；用户点击后仍需在原生保存对话框中确认文件名、来源和保存位置。插件拿不到
下载 URL 与本地路径，也不能自动安装文件。

## 限制

- 单次 Action/Processor/Exporter 最多接收 1000 个仓库。
- Action/Processor 结果上限 1 MiB，Exporter 文本上限 5 MiB。
- 单个 Storage 值上限 64 KiB，每个插件总配额 1 MiB。
- 本地安装包最多 2000 个文件、总计 50 MiB，不允许符号链接。
- 每次运行时调用默认 5 秒超时；超时或协议错误会终止该插件运行时。

完整示例见 `examples/plugins/markdown-exporter` 和
`examples/plugins/smart-release-recommender`。

## V1.2 完整插件页面

页面型 Manifest 可省略 `main`：

```json
{
  "manifestVersion": 1,
  "id": "com.example.repo-health-page",
  "name": "Repo Health Page",
  "version": "0.1.0",
  "apiVersion": "1",
  "permissions": ["repositories:read"],
  "contributes": {
    "pages": [{ "id": "dashboard", "title": "Repository Health", "entry": "ui/index.html" }]
  }
}
```

启用后，在“设置 → 插件”点击对应的“打开页面”。宿主通过 `plugin-page:` 本地协议读取
页面目录内的 HTML、JS、CSS 和图片；禁止路径穿越及越过页面目录的符号链接。iframe 的
CSP 默认拒绝联网、嵌套页面、Worker、表单和内联脚本。React/Vue 等框架应预先构建成
静态文件，使用相对资源路径，不应引入 CDN 运行时代码。

页面与宿主通过有版本边界的 `postMessage` 协议通信。宿主在加载时发送
`plugin-page:init`，包含当前页面的临时 token。页面请求格式为：

```js
window.parent.postMessage({
  type: 'plugin-page:request',
  pluginId: 'com.example.repo-health-page',
  pageId: 'dashboard',
  requestId: 'request_1',
  token,
  method: 'repositories.search',
  args: { query: 'react', limit: 20 },
}, '*');
```

可用方法：`repositories.search`、`repositories.get`、`releases.get`、
`storage.get`、`storage.set`、`storage.delete`。每次请求都在宿主主进程重新检查
插件状态、页面声明、参数 schema 和 Manifest 权限。返回的是脱敏后的宿主内存快照，
并非实时 GitHub API；没有 `repositories:read`、`releases:read` 或 `storage` 权限时，
对应方法会被拒绝。页面消息还受来源、临时 token、大小、并发数和频率限制。

完整可安装示例见 `examples/plugins/repo-health-page`。页面关闭、插件停用或卸载后，
宿主不再提供该页面资源和能力调用。V1.2 仍是本地插件开发功能，不代表插件商店审核
或对所有恶意本地代码提供完整安全沙箱。

## V1.3 页面高级能力

页面型插件可额外声明 `ai:invoke` 和／或 `web:search`。这两项只通过受限页面的
`postMessage` Bridge 提供，不向插件暴露 AI Key、用户配置的搜索服务凭据、任意
`fetch` 或 Node API。带 `main` 的本地 Worker 仍是受信任代码；它不会因为声明这些
权限而获得对应的 Worker `context` 方法。

```js
// 每次请求均按 V1.2 的消息格式发送，method / args 换为：
method: 'ai.generate',
args: { system: 'Summarize this repository', user: 'Public repository details', maxTokens: 500 },
// 成功时返回 value: 'generated text'

method: 'web.search',
args: { query: 'open source alternatives', limit: 5 },
// 成功时返回 value: [{ title, url, snippet }]
```

宿主先检查插件启用状态、页面声明、参数和 Manifest 权限，再逐次显示完整 AI 输入
或搜索词，说明目标服务，要求用户确认。拒绝则不会向外发送。AI 仅使用宿主当前
激活的 Provider；宿主可能通过已配置的后端代理转发，插件只收到生成文本。插件
AI 请求正文不会写入调试日志；关闭页面会中止进行中的 AI 请求。未配置 Provider
时 AI 调用失败，不会自动切换到其他服务。

网页搜索由用户在“设置 → 插件”填写可信的 SearXNG HTTPS 实例地址；默认关闭，
没有预设公共实例。该实例须启用 JSON 输出。插件不能指定域名或 URL，只能提交
最长 200 字符的搜索词及 1～10 条结果上限；宿主拒绝非 HTTPS、带凭据和本地
地址，联网请求不跟随重定向，并限制超时与响应大小。搜索词会发送给用户所配置的
实例及其实际使用的搜索引擎，请不要在未经同意时把私有仓库、个人备注或密钥放进
搜索词。`network:<domain>` 仅是 Manifest 保留声明，V1.3 不提供通用网络请求 API。
