# 诊断日志体系建设方案（Diagnostic Logging Overhaul）

日期：2026-10-04（v2，已按审计报告修订）
状态：待评审
审计：`audit-diagnostic-logging-design.md`（核实记录见第七节——采纳 7 项修正与 5 项防护，驳回 3 项不实声明）
交付方式：**单分支、单 PR、单 commit**（内部工作项仅为实施顺序，见第四节）
目标：让"用户提供诊断日志"成为定位任意模块问题的充分手段；调试模式能捕获**所有**对外请求；全程不改变现有功能行为。

---

## 一、现状诊断（基于代码走查，数字已按审计核实修正）

当前体系是**三个互不相通的日志孤岛 + 手写的局部抓包**，覆盖面天然残缺：

| 组成 | 位置 | 现状 | 缺陷 |
|---|---|---|---|
| 渲染进程 Logger | `src/services/logger.ts` | 内存环形缓冲 2000 条，写时脱敏，经 DOM CustomEvent（`gsm:diagnostic-log-added`）推给 UI；全仓 22 个文件引用（含测试） | **无持久化**，刷新/崩溃即丢 |
| 后端 Logger | `server/src/services/logger.ts` | 同款内存环形缓冲 + `/api/logs` | 仅内存；桌面用户多数不启用后端 |
| 插件日志 | `electron/plugins/pluginLogger.js` | 每插件一个 JSONL 文件，1MB 轮转，已落盘 | 不在诊断面板、不在导出包里，等于没建 |
| 主进程 | `electron/main.js` | 只有裸 `console.log` | **零日志**：无文件落盘、无进程级异常捕获、无崩溃事件 |
| 全局错误捕获 | — | 无 `window.onerror` / `unhandledrejection` / `process.on('uncaughtException')` | 逃逸出 try/catch 的错误只能靠 DevTools 看 |
| 调试抓包 | `githubApi.ts`、`backendAdapter.ts`、`aiService.ts`、`webdavService.ts` 共 4 处 | 每处手写 `if (logger.isDebugMode()) {...}` 克隆响应记录 | **纯手工埋点且自身有盲区**：githubApi 内 4 处直连 fetch（`getGistFileRaw` 787/802、RSS 1644/1851）绕过 `makeRequest` 的调试块；webdavService 仅 upload/download 两处有极简记录，`davFetch`/`testConnection`/`listFiles` 等操作零记录 |
| 漏抓的调用方 | — | — | 渲染侧 10+ 个服务文件直接裸 `fetch()`（vectorSearch、translate、telegram、xTweet、update、rpcDownload、grepApp、weeklyIssues、externalDiscoveryFeed、useNetworkActions 等）；主进程三栈（undici fetch / `net.fetch` / `node:https`）全部漏抓 |
| 环境信息 | `DiagnosticLogsPanel.tsx:393-405` 导出 env 块 | 仅 10 个浏览器字段 | 无 OS/架构、无 Electron/Node/Chrome 版本、无插件清单、无代理状态、无会话标识 |
| 导出 | `DiagnosticLogsPanel.tsx:377-419` | 浏览器 Blob 下载，只含前端环形缓冲 + 后端内存日志 | 不含主进程、不含插件、不含网络记录；且刷新后数据已丢 |

结论：问题的根源不是"埋点太少"，而是**没有日志内核**（主进程无落盘、无全局兜底）和**抓包靠手埋**（新代码天然漏抓）。方案围绕这两点重建。

---

## 二、设计原则（"不影响现有功能"的硬保障）

1. **只加不改**：`Logger` 类（`src/services/logger.ts`）**完全零改动**——它的输出已经通过 DOM CustomEvent `gsm:diagnostic-log-added` 广播（logger.ts:58），持久化桥直接监听该事件即可，业务侧 22 个引用点与新功能互不感知。LogEntry 只增字段不删字段。
2. **捕获层永不抛错**：所有捕获代码（fetch patch、netTap、全局 handler、落盘、启动清理）整体 try/catch，捕获失败静默降级为纯内存，绝不影响业务请求路径。
3. **网络捕获纯旁路**：请求/响应原样透传；`response.clone()` 仅在调试模式开启、且体积/类型/频率三重守卫通过时发生（大文件、二进制、SSE 流、超频一律不克隆），请求头/体先脱敏再截断；**绝不消费业务侧的 ReadableStream**——克隆后异步读取克隆分支。
4. **性能预算**：普通模式下捕获路径只做字符串截断 + 正则脱敏（微秒级）；日志落主进程走**批量 IPC**（2 秒或 32 条一拍），不做逐条 IPC；主进程写文件用带背压的串行队列。
5. **隐私默认安全**：脱敏规则现有**三份实现**（`src/utils/logSanitizer.ts`、`server/src/services/logSanitizer.ts`、`electron/plugins/pluginLogger.js` 内联规则），主进程内核将新增第四份（`electron/redact.js`，TS 不可直接复用）——用**共享测试向量做交叉一致性测试**锁住行为（见 3.1）；请求体捕获**仅调试模式**开启；写入时 + 导出时双重脱敏。
6. **磁盘预算**：普通模式 5MB/日、调试模式 20MB/日，保留 7 天、总量 20MB（调试模式放宽到 40MB），启动时清理；清理与写盘失败均静默降级为内存，不向业务层抛错、不阻塞启动。

---

## 三、目标架构

```
┌─ 渲染进程 ──────────────────────────────────────┐
│ 业务代码（零改动，含 22 个 logger 引用点）         │
│   └→ window.fetch ─→ [fetchCapture 装饰器] ─→ 真实网络
│ Logger（不动）──CustomEvent──→ diagnosticsBridge │
│   ├ 全局兜底: onerror / unhandledrejection       │
│   ├ 防洪聚合（repeatCount）                       │
│   └ 批量节流(2s/32条) ──invoke──┐                 │
│     卸载前冲刷 ────send(单向)────┤                 │
└─────────────────────────────────┼────────────────┘
                                  ▼
┌─ 主进程 ──────────────────────────────────────────────────────────────┐
│ diagLogger（唯一磁盘内核: <userData>/logs/diagnostics/ 日 JSONL）       │
│   ← 渲染进程批次（不再二次防洪）                                        │
│   ← 主进程自身记录 + process 级异常 + render/child-process-gone          │
│   ← undici/内置fetch netTap（2+3 处调用点）  ← 插件 fetchImpl 包装      │
│   ← session.webRequest 观察者（Chromium 栈零改动全覆盖）                │
│   ← webSearch.js node:https 手动补记（唯一可行路径，已核实 agent:false） │
│   ← 插件 capability log 镜像（capabilityRouter 现有收口加一行）          │
│ systemInfo（OS/架构/版本/插件清单/代理状态/会话ID）                      │
│ diagnostics:exportBundle → 汇五源 → dialog.showSaveDialog 写盘          │
└──────────────────────────────────────────────────────────────────────┘
后端 server（可选部署）：现有 /api/logs 不动，导出时并入；插件日志文件直接进包
```

### 3.1 主进程日志内核 `electron/diagLogger.js`（新增）

```js
createDiagLogger({ logsDir, maxFileBytes, maxFiles = 7, maxTotalBytes })
// 普通模式 maxFileBytes=5MB；调试模式放宽 20MB；maxTotalBytes 相应 20MB/40MB
```

- 落盘格式：`<userData>/logs/diagnostics/diagnostics-YYYY-MM-DD.jsonl`，每行一个 entry；按日轮转 + 启动清理超预算文件。**清理失败 try/catch 吞掉，绝不阻塞应用启动**。
- `record(entry)`：写时脱敏 → 串行写队列（背压安全）；`ingestRenderer(entries)`：校验 + 限流（≤200 条/次）后入库，**对 `source=frontend` 的条目不做二次防洪**（渲染侧已聚合，避免 repeatCount 双重计数）；`readTail({ since, level, sources, limit })` 供面板与导出读取。
- 自身产生条目的防洪：同 `module+level+message` 哈希 10 秒窗口内聚合成带 `repeatCount` 的单条（重试风暴、断网轮询不再刷屏）。
- 自动记录的主进程事件（此前完全空白）：
  - `process.on('uncaughtException' | 'unhandledRejection')`（`electron.app`）
  - `app.on('render-process-gone' | 'child-process-gone')`（崩溃的关键证据）
  - `webContents.on('console-message')` 中 `level === 'error'` 的渲染进程逃逸输出（去重聚合，模块名 `electron.renderer-console`）
  - `app.on('will-quit')` 冲刷队列（审计已确认该选择正确，`before-quit` 语义不合）
- 每条 entry 统一携带 `sessionId`（每次启动生成的 UUID），全链路可关联。

测试：`electron/diagLogger.test.js`（node:test，依赖注入 fs/clock，仿 `desktopPrefs.test.js` 风格）。

### 3.2 渲染进程侧改造

- **`src/services/diagnosticsBridge.ts`（新增）—— Logger 零改动的关键**：
  - 监听**现有** DOM CustomEvent `gsm:diagnostic-log-added` 收集全部 Logger 输出；安装时先调 `logger.getEntries()` 一次回填启动期已产生的日志（含早期错误），再开始增量监听；同时监听 `gsm:diagnostic-logs-cleared` 同步清空落盘视图。
  - 持久化分级：普通模式落盘 `warn/error`；调试模式全量（与现有 `minLevel` 语义一致）。
  - 防洪聚合在本层完成（聚合后发给主进程的已是带 `repeatCount` 的条目）。
  - Electron 判定沿用 `src/services/electronProxy.ts` 现有 `window.electronAPI` 存在性检查；web 模式自动退化为纯内存（行为同今日）。
  - 批量节流：2 秒或 32 条一拍，常规路径 `ipcRenderer.invoke('diagnostics:append', entries)`；**另暴露 `diagnostics:flush` 走 `ipcRenderer.send`（单向、无 await）**，在 `pagehide` 与 `beforeunload` 时触发——保证页面刷新/崩溃前缓冲区日志不丢（审计指出的缺口）。
- **全局兜底（`src/main.tsx` 安装，新增 `src/services/globalErrorHandlers.ts`）**：`window.onerror`、`unhandledrejection`、资源加载错误 → 记为 `logger.error('ui.global', ...)`，与 ErrorBoundary（`src/components/ErrorBoundary.tsx` 现只在 React 树内生效）互补，覆盖逃逸错误。
- **`src/services/fetchCapture.ts`（新增，方案核心）**：在 `main.tsx` 渲染前一次性装饰 `window.fetch`（幂等守卫；提供 `uninstall()` 还原原始 fetch 供测试；vitest 环境不自动安装）。分级捕获：
  - **普通模式**：仅留痕失败——fetch 拒绝（网络层错误）记 `error`，HTTP 4xx/5xx 记 `warn`（URL/方法/状态码/耗时，无头无体）。日志量极小，且"报错全收集"自此成立。
  - **调试模式**：全量记录 + 请求头（值脱敏留键名）+ 请求体预览（仅 string body，截断 8KB）+ 响应头/体预览（`clone()` 后异步读取克隆分支，截断 16KB）。
  - 三重守卫：① `content-length > 256KB` 或二进制 content-type → 不克隆不读体，只记元数据；② **以响应的 Content-Type 判断流式**（`text/event-stream` → 跳过体捕获；不依赖请求头，审计指出的修正）；③ **体捕获频率预算**：全局每分钟最多 60 次，超出降级为仅元数据（防高并发小响应叠加的内存压力，审计补充）。
  - 网络台账独立环形存储（**上限 1000 条 FIFO 淘汰**），供导出与面板查看。
  - 与现有 4 处手工埋点**并存**：手工块携带业务语境（`operationTag`、限流余量等），fetchCapture 提供全量网络视角；面板按 URL+时间可对应，不做去重（保留手工块，避免触碰 `githubApi.ts` 热路径）。

### 3.3 主进程侧请求捕获

`electron/main.js` 现有网络栈约定受 `electron/outboundFetchGate.test.js` 源码扫描约束。**门禁测试已亲读核实**，全部断言为：① 必须存在匹配 `/\{\s*fetch:\s*undiciFetch\s*,\s*ProxyAgent\s*\}\s*=\s*require\('undici'\)/` 的解构行；② 全文禁止匹配 `/(?<![.\w$])fetch\s*\(/` 的裸调用。据此定死门禁安全策略（不采用运行时重赋值等取巧手段）：

```js
// main.js 顶部：解构行字节级原样保留（断言①不受影响）
const { fetch: undiciFetch, ProxyAgent } = require('undici');
// 紧跟包装：新标识符均含大写 Fetch，`fetch.bind(` 不匹配裸调用正则（断言②不受影响）
const undiciFetchTapped = diagTap.wrapFetch(undiciFetch, { source: 'main:undici' });
const builtinFetchTapped = diagTap.wrapFetch(fetch.bind(globalThis), { source: 'main:node-fetch' });
```

| 网络栈 | 捕获手段 | 改动量（已逐一核实） |
|---|---|---|
| undici 直接调用（`main.js:439` telegram、`:507` webdav，共 2 处） | 调用点改名引用 `undiciFetchTapped` | 2 处机械替换 |
| 三元选择点（`:378`、`:584`、`:654`，形如 `dispatcher ? undiciFetch : fetch`） | 改为 `dispatcher ? undiciFetchTapped : builtinFetchTapped` —— **内置 fetch 回退路径同样入网**，此路径原方案漏了 | 3 处 |
| Chromium 栈（`net.fetch` 全部 ~8 个调用/传递点，含插件市场/注册表/资源下载） | **`session.webRequest` 观察者**（`onBeforeRequest/onCompleted/onErrorOccurred`）：零调用点改动，自动覆盖现在与未来所有 `net.fetch` | 1 段新代码 |
| undici 错误细节 | `diagTap.wrapFetch` 内复用 `electron/mainFetch.js` 现成的 `summarizeFetchError` 展开错误链 | — |
| `node:https`（`electron/plugins/webSearch.js`，已核实 `agent: false` + 自定义 `publicLookup`，**既不经 undici 也不经 Chromium session，观察者与包装均无法覆盖**） | 该文件内完成回调处手动补记——唯一可行路径 | 1 处 |
| 插件注入的 `fetchImpl`（`main.js:1166`） | 包一层 `diagTap.wrapFetch` | 1 处 |

`electron/netTap.js`（新增）：`wrapFetch(fetchImpl, { source })` 纯装饰——参数原样透传、异常原样抛出，仅记录 URL（脱敏）/方法/状态/耗时/错误链；普通模式只记失败，调试模式记全量含小体积响应预览。

### 3.4 环境信息 `electron/systemInfo.js`（新增）

导出与启动时写入日志流各一份快照：OS 平台/版本/架构、Electron/Chrome/Node 版本（`process.versions` + `app.getVersion()`）、语言/时区、代理配置形态（**不含密码**）、插件清单（id/版本/启用态）、仓库数量、路由模式（`routeMode`）、前后端调试开关状态、sessionId。替换现有 10 字段 env 块（字段向后兼容保留）。

### 3.5 诊断包导出 v2

- 新 IPC `diagnostics:exportBundle`：主进程汇总 **前端环形缓冲 + 主进程 JSONL 尾部 + 网络台账 + 后端 `/api/logs`（由渲染进程传入）+ 插件日志文件尾部 + 环境快照** → `dialog.showSaveDialog` 写盘（复用 `pluginHostOperations.saveFile`（`main.js:1132`）的既定模式：文件名消毒、覆盖确认、createDirectory）；web 模式保留现有 Blob 下载路径。
- 格式 `github-stars-manager-logs-v2`：保留 v1 的 `frontendLogs`/`backendLogs` 字段与 `sanitizationNote`，新增 `sources.{main,network,plugins}`、`app`、`sessionId`。
- 默认时间窗 24h（UI 可选 1h/24h/全部），包体上限 5MB，超限从最旧截断并留标记。

### 3.6 面板与调试开关（克制改动）

- `DiagnosticLogsPanel.tsx`：来源筛选从 前端/后端 扩为 **前端/主进程/后端/插件**；"生成诊断包"按钮（带时间窗）；网络台账在调试模式下可展开查看。现有筛选、事件类型（`logEventTypes.ts`）、指示器（`DebugModeIndicator.tsx`）全部不动。
- 新增 i18n key（过 `check:i18n` 门禁，zh/en 两份 locale）：`settings.logs.sourceMain`、`settings.logs.sourcePlugins`、`settings.logs.exportBundle`、`settings.logs.exportWindowHour`、`settings.logs.exportWindowDay`、`settings.logs.exportWindowAll`、`settings.logs.networkLedger`。
- 调试开关仍用 sessionStorage（会话级）。"跨重启保持调试模式"会改变现有行为语义，列为可选项不在本期实现。

---

## 四、实施计划（单分支 · 单 PR · 单 commit）

全部工作在**一个 PR、一个 commit** 内交付（commit message 建议：`feat(diagnostics): 建设全量诊断日志与全局请求捕获`）。以下为 commit 前的实施顺序与自检清单，不是分次发布。

### 实施顺序（同一 commit 内的构建序列）

1. **内核与红线**：`electron/redact.js`(+test) → `electron/diagLogger.js`(+test) → `electron/systemInfo.js`(+test) → `electron/netTap.js`(+test)
2. **主进程接线**：`main.js`（IPC `diagnostics:append`/`diagnostics:flush`/`diagnostics:exportBundle`、进程级 handler、webRequest 观察者、3+2 处 fetch 调用点包装、插件 fetchImpl 包装、will-quit）、`preload.js`、`webSearch.js` 1 处补记
3. **渲染进程**：`diagnosticsBridge.ts`(+test，CustomEvent 监听+防洪+批量节流+卸载冲刷)、`globalErrorHandlers.ts`、`fetchCapture.ts`(+test)、`electronProxy.ts` 类型、`main.tsx` 安装
4. **UI 与导出**：`DiagnosticLogsPanel.tsx`（来源筛选/诊断包按钮/台账视图）、i18n 文案（zh/en）
5. **测试与脚本**：`package.json` —— **注意 `test:electron:mcp` 是显式枚举而非 glob（已核实），新增测试文件不能自动发现**：新建 `test:electron:diagnostics` 脚本（`node --test electron/diagLogger.test.js electron/redact.test.js electron/netTap.test.js electron/systemInfo.test.js`）并挂入 `test:run` 链
6. **脱敏交叉一致性测试**：`tests/fixtures/sanitization-vectors.json` 共享测试向量（GitHub token/`sk-`/Bearer/gsm_mcp_/邮箱/URL 参数等），分别驱动 `src/utils/logSanitizer.ts`（vitest）、`electron/redact.js`（node:test）、`server/src/services/logSanitizer.ts`（server 侧测试）——三份实现 + 新增第四份，行为锁定一致

### Commit 前自检清单（全部通过才算完成）

- [ ] `npm run typecheck`、`npm run lint`、`npm run test:run`（含新增 `test:electron:diagnostics`）全绿
- [ ] `outboundFetchGate.test.js` 通过：解构行未动、无裸 `fetch(`（新增标识符已核对不触发正则）
- [ ] `check:i18n`、`check:bundle-size` 通过（fetchCapture/bridge 均为小模块）
- [ ] 手测矩阵：web 模式 / electron 模式 × 调试开关 × 代理开关 × AI 流式对话 × 大文件发布资源下载 × WebDAV 大传输 × 插件运行 —— 请求行为与改造前一致
- [ ] 实施前按审计建议 `grep -n 'undiciFetch\|net\.fetch' electron/main.js` 复核全部点位与本表一致（若有新增调用点，一并纳入包装）
- [ ] 磁盘日志在刷新/重启/杀进程后仍完整（冲刷路径验证）

### 工作量估计

合计 ≈ 2000 行（含测试）。拆分：内核与红线 ~700、主进程接线 ~400、渲染进程 ~500、UI/导出/i18n ~250、交叉测试与脚本 ~150。

---

## 五、风险与对策

| 风险 | 对策 |
|---|---|
| fetch patch 破坏流式响应（AI SSE） | **以响应 Content-Type 判定** `text/event-stream` 跳过克隆；流式专项手测 |
| fetch patch 消费业务 ReadableStream | 只 `clone()` 后异步读克隆分支，绝不触碰原响应流 |
| `clone()` 内存放大（发布资源下载） | 体积/类型双守卫 + **每分钟 60 次体捕获频率预算**；>256KB 只记元数据 |
| 逐条 IPC 风暴 | 批量节流（2s/32条）+ 每次 ≤200 条 + 渲染侧每秒计数超阈值自动降级为仅 error |
| 崩溃/刷新丢尾部日志 | `pagehide`/`beforeunload` 触发单向 `send` 冲刷；bridge 安装时回填启动期缓冲 |
| 磁盘写满 / 清理失败 | 轮转 + 预算（调试模式放宽至 20MB/日）+ 启动清理 try/catch 不阻塞启动；写失败静默降级 |
| 日志刷屏（重试风暴/断网轮询） | 防洪聚合（repeatCount）；**渲染侧聚合、主进程对 frontend 条目不二次聚合**，语义不混叠 |
| 网络台账内存膨胀 | 独立环形存储 1000 条 FIFO |
| 敏感信息入日志 | 写时双脱敏 + 导出时再脱敏；体捕获仅调试模式；**四份脱敏实现用共享测试向量锁定一致** |
| 与 outboundFetchGate 门禁冲突 | 已亲读断言：解构行字节级不动、新标识符不含裸 `fetch(`；实施前再 grep 复核点位 |
| 日志代码自身抛错拖垮业务 | 全捕获层 try/catch + 静默降级 |

## 六、明确不做（本期范围外）

- 不接第三方遥测/崩溃上报服务（Sentry 等）——数据只留本地由用户主动提供。
- 不改 MCP 本地服务（`mcpLocalServer.js`）的入站请求记录——它不是"对外请求"。
- 不改调试开关的持久化语义（sessionStorage 保持不变，列可选增强）。
- 后端 server 仅保留现有 `/api/logs` 形态，可选增加文件落盘（env 开关），不做 UI。
- 不捕获 `XMLHttpRequest` / `EventSource` / `WebSocket` —— **已核实全仓 src/ 零使用**；若未来引入，需在 fetchCapture 旁补对应探针（已在 fetchCapture 模块留扩展位注释）。
- 不捕获子进程输出 —— **已核实 electron/ 无 child_process/exec/spawn**，插件运行在 Worker 线程（`pluginRuntime.js`），无此面。

## 七、审计核实记录（2026-10-04）

逐条核实审计报告后：**采纳** 7 项修正与 5 项防护（对应本 v2 文档：Logger 零改动走 CustomEvent（3.2）、门禁断言亲读并定死策略（3.3）、第三份脱敏拷贝与共享测试向量（二.5 / 四.6）、现有手工抓包盲区与并存策略（一 / 3.2）、webSearch 唯一路径确认（3.3）、beforeunload 冲刷 / 台账上限 / 频率预算 / 防洪语义 / 清理不阻塞 / SSE 响应头判定 / 调试模式磁盘放宽 / 门禁测试显式枚举（3.1–3.2 / 四 / 五））。

**驳回** 3 项不实声明（证据如下）：

1. "Logger import 实测 35 个文件" —— 实测 `grep -rl "services/logger" src` = **22** 个（含测试），原方案"20+"本就准确。
2. "插件执行可能用子进程，stderr 未捕获" —— `grep child_process|execSync|.spawn(` 全 electron/ 零命中；插件跑在 Worker 线程（`pluginRuntime.js` `new Worker(pluginWorker.js, ...)`），该覆盖缺口不存在。
3. "XMLHttpRequest/WebSocket 覆盖缺口" —— 全仓 src/ 零使用，属假设性缺口而非现实缺口；已降级为"明确不做"条目备忘。

另修正数字：undici 调用点为 **2 处直接调用 + 3 处三元选择**（原方案"~6"含混，审计"5 处"未含内置 fetch 回退路径的覆盖——v2 已补 `builtinFetchTapped`）；`net.fetch` 调用/传递点 ~8 处；"20+ 服务漏抓"改为精确表述"渲染侧 10+ 个服务文件 + 主进程三栈"。
