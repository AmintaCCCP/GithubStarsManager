# GitHub OAuth 登录方案（web 回调 + Device Flow）

## 目标

在保留现有 PAT token 登录不变的前提下，新增 GitHub OAuth 2.0 登录：
- 全栈自托管部署（有后端）走 web 回调（后端持 client_secret）。
- Electron 纯本地模式走 Device Flow（仅需 public client_id）。
- 登录页自动探测：后端可用且启用了 OAuth → web 回调；否则 Electron 下显示 Device Flow；都不可用则不显示（现有 token 登录兜底）。
- 同一 GitHub 账号（user.id 相同）与 token 登录数据互通：复用既有 accountIdKey 工作区机制，零迁移。

## 审计结论（方案定稿前已核实）

- App 无 react-router（纯单页 + 状态切换），ticket 用 URL hash `#oauth?ticket=...` 传递，LoginScreen 直接读 `window.location.hash`，无路由改动。
- `GET /api/oauth/config` 必须免鉴权（登录前调用），与 start/callback/exchange 一起挂在 `app.use('/api', authMiddleware)`（index.ts:200）之前。
- helmet CSP 只作用于页面响应，不拦截顶层 302 跳转 GitHub；全局限流 5000/15min 对 OAuth 端点无影响；均无需改动。
- LoginScreen.tsx:89 已有非 Electron 场景取 origin 的先例；Electron 判定用 isElectron()（electronProxy.ts:164）。
- Vite dev 无 /api 代理，开发调试 OAuth 需手动配置 backend URL，与现有 backend 登录一致，不新增 dev 代理。

## 硬约束

1. 不得改动现有登录流程任何分支行为；不得触碰 accountWorkspaces、persistence、authSlice 数据结构。
2. 后端 `/api/*` 均被 authMiddleware 保护，OAuth 免鉴权路由必须挂载在 auth 中间件之前，且回调路径必须是显式路由（避开 SPA fallback）。
3. client_secret 只能存在于服务端环境变量；客户端（含 Electron 包）只能含 client_id。
4. OAuth 登录成功后的收尾必须复用 `authenticateWithGitHub(token)` → `setUser`/`setGitHubToken` → `syncTokenToBackend` 现有路径，确保与 token 登录行为一致。
5. logSanitizer 已脱敏 code/access_token；新增日志不得输出 secret。

## 后端（server/src/routes/oauth.ts，挂载于 index.ts auth 中间件之前）

- `GET /api/oauth/config` → `{ enabled: boolean, clientId: string | null }`。enabled = GITHUB_OAUTH_CLIENT_ID 与 SECRET 均配置。
- `GET /api/oauth/github/start` → 生成一次性 state（内存 Map，TTL 10min，单次），302 → github.com/login/oauth/authorize（scope: read:user user:email repo gist，redirect_uri 取 GITHUB_OAUTH_CALLBACK_URL）。
- `GET /api/oauth/github/callback` → 校验 state（一次性销毁）→ POST github.com/login/oauth/access_token 换 token → GET /user → 生成一次性 ticket（TTL 60s）→ 302 回 `<前端地址>/#/oauth?ticket=...`（前端地址取 GITHUB_OAUTH_FRONTEND_URL）。
- `POST /api/oauth/github/exchange` → body {ticket} → `{ githubToken, user }`，ticket 用后即焚。免鉴权（ticket 一次性短 TTL 已足够）。

新环境变量（server/src/config.ts + docker-compose.fullstack.yml + DOCKER.md）：
- GITHUB_OAUTH_CLIENT_ID / GITHUB_OAUTH_CLIENT_SECRET
- GITHUB_OAUTH_CALLBACK_URL（如 https://host/api/oauth/github/callback）
- GITHUB_OAUTH_FRONTEND_URL（如 https://host/）

## 前端

- LoginScreen：登录卡片下新增"使用 GitHub 登录"区域。渲染前 GET /api/oauth/config（仅 backend 已配置时），enabled → 显示跳转按钮（window.location = start URL）。
- Electron 纯本地（backend.isAvailable === false 且 window.electronAPI 存在）→ 显示"使用 GitHub 登录（Device Flow）"按钮，调用 preload 暴露的 `oauthDeviceFlow()`。
- 新增 `src/features/lifecycle/hooks/useOAuthLogin.ts`：处理 ticket exchange → authenticateWithGitHub → setUser/setGitHubToken/syncTokenToBackend → syncBackendData。Device Flow 复用同一收尾函数。
- 登录页 URL 含 #oauth?ticket= 时优先走 exchange 流程（loading 态，失败回登录表单）。

## Electron

- electron/oauthDeviceFlow.js：startDeviceFlow(clientId) → 生成 user code 窗口（BrowserWindow 小窗展示 code + "打开浏览器"按钮）→ 轮询 access_token（interval 5s，GitHub 规范）→ resolve token。preload 暴露 `oauthDeviceFlow(): Promise<string>`。
- clientId 来源：桌面端无服务端，Device Flow 的 client_id 属于项目级 OAuth App（公开），构建期注入或常量。

## i18n / 测试

- locales/*/login.json 增加 oauth 文案（en/zh-CN 全量，其余语言机器补齐）。
- 测试：oauth 路由（state/ticket 一次性、TTL、免鉴权挂载位）；useOAuthLogin（exchange 成功/失败/token 无效）；LoginScreen（enabled 才显示按钮、Electron 分支）；oauthDeviceFlow（轮询与取消）。

## 验收

- 现有 token 登录、backend 登录、restore 流程行为不变（现有测试全绿）。
- OAuth 登录同一账号与 PAT 登录命中同一 accountWorkspace（user.id 相同）。
- 未配置 OAuth 环境变量时 UI 无 OAuth 入口，零行为差异。
- npm run typecheck / lint / test:run / build 全绿。
