# allowlist 清零迁移实施规格 v2（ADR 0001 · B 方案：搬运 + 顺手提纯 · 单 PR）

- **Status**: 实施规格（Accepted on merge）
- **仓库根**: 本仓库（GithubStarsManager）
- **契约**: `docs/adr/0001-frontend-layering.md`（View → Hook → Application → Service → Store）
- **目标**: `eslint.config.js` 的 `COMPONENT_BOUNDARY_ALLOWLIST`（52-63 行，恰 10 项）与 `scripts/check-boundaries.cjs` 的 `COMPONENT_ALLOWLIST`（48-59 行，镜像 10 项）**机制整体删除**（非置空）；10 个 View 组件的远程调用与 Store 写入全部收敛进 hook。
- **行为基线**: 行为零变更。唯一例外 = `useRepositoryReleaseSheet` 委托共享 hook 的 **3 处已声明微差异**（§2.5，须在 PR 描述列明）；GistEditorModal 类型解套零行为影响。
- **吸收的审计结论**: 第一轮 A1–A8 + 第二轮 B1–B8（附录二表，共 16 条已逐条修复进本文）。
- **文案铁律**: 所有 toast/confirm/错误文案**以原文件现行为准逐字抄录**，禁止转写、概括或"顺手优化"。本文出现的文案仅为定位指引。

---

## 0. 背景与现状（10 项 allowlist 口径）

PR 0–8 完成非破坏性迁移，PR 9 用 ESLint + `check-boundaries.cjs` 固化边界并留 10 项分阶段 allowlist。**两处 allowlist 常量为唯一真值**（ADR §Phased enforcement 的 13 项举例名单已过期：LoginScreen/CategorySidebar/DebugModeIndicator 早已无违规，勿追查）。

ban list 12 项（`eslint.config.js:16-29` 与 `check-boundaries.cjs:32-45` 一致）：`githubApi / aiService / aiAnalysisHelper / aiAnalysisOptimizer / vectorSearchService / autoSync / webdavService / backendAdapter / rpcDownloadService / githubApiFactory / updateService / translateService`。注意 ADR 正文仍写 10 项（称 updateService/translateService 未禁）——**文档落后于实现，以 12 项为准**，ADR 勘误列 follow-up（§10），本 PR 不改 ADR。

| # | 文件 | 业务服务直引 | 迁移落点 |
|---|---|---|---|
| 1 | `src/components/SearchBar.tsx` | aiService、vectorSearchService、githubApi、githubApiFactory、autoSync（5 服务，最重，1618 行） | `useSearchActions`（新建，repositories/hooks） |
| 2 | `src/components/SubscriptionRepoCard.tsx` | aiAnalysisHelper、autoSync、githubApi | `useDiscoveryRepoActions`（新建，discovery/hooks） |
| 3 | `src/components/GistCard.tsx` | githubApiFactory、aiService | `useGistActions`（扩展） |
| 4 | `src/components/GistDetailModal.tsx` | githubApiFactory | `useGistActions.fetchGistFileRaw`（扩展） |
| 5 | `src/components/GistEditorModal.tsx` | 仅 `import type`，零运行时（误伤） | 类型改从 `useGistActions` 重导出引（§5） |
| 6 | `src/components/ReleaseCard.tsx` | rpcDownloadService、aiService | `useReleaseArtifactActions`（新建，src/hooks） |
| 7 | `src/components/ReadmeModal.tsx` | githubApi、backendAdapter（另引 routeMode，非 banned） | `useReadmeFetch`（新建，src/hooks） |
| 8 | `src/components/ReleaseSourceSettingsModal.tsx` | githubApi | `useReleaseTimelineActions.syncWatchedSources`（新增方法） |
| 9 | `src/components/RepositoryEditModal.tsx` | autoSync（仅 1 处） | `useCategorySyncActions`（既有，直接复用） |
| 10 | `src/components/SettingsPanel.tsx` | backendAdapter.backend.isAvailable 门控 | `useBackendAvailability`（新建，settings/hooks） |

`src/components/ui/**` 零违规，保持不动。`updateService/translateService` 在 components 已零违规，执行时勿再追查（第一轮 A6）。

---

## 1. 总则

### 1.1 原则

1. **只搬运不改语义**。每个动作按 §1.2 保序表逐句搬运，含 toast/confirm 文案、console 诊断、错误分支与降级路径。
2. **分析类动作不 forceSync**。只有 star/unstar/save/sync 类动作调用 `forceSyncToBackend()`，且 await 点与原文件一致（逐动作见 §1.2，硬约束）。
3. **API 形态贴近既有惯例**：零参 hook 内部自建 `t`（`useGistActions`/`useReleaseTimelineActions` 先例）；需注入时用 `{ t }` 参数（`useStarSyncActions`/`useBackendSettingsActions` 先例）；confirm/toast 走 `useDialog`；Store 读取用 selector + `useShallow`；返回值 `useMemo` 稳定（`useRepositoryCardActions` 先例；在被扩展的既有文件内保持该文件原有风格，不回溯改造）。
4. **原文件里 `useAppStore.getState()` 的非响应式读取保持 `getState()`**（如 SearchBar 的 vsConfig/storeRepos 读取），不改成响应式 selector。

### 1.2 逐动作保序表（搬运时逐一对照；**粗体**为 forceSync 点）

| # | 源动作（文件:行，基线行号） | 原调用顺序（→ 为顺序） | 归宿 |
|---|---|---|---|
| 1 | SearchBar.handleAISearch (370-559) | View-UI 状态留 View → isSearching/searchPhase → vectorScoreMapRef 清空 → [vsConfig 门控(enabled&&workerUrl&&activeEmbConfig) → 每次新建 EmbeddingClient/VectorSearchService → HyDE（仅 enableHyDE!==false&&hydeConfig；局部 AbortController + Promise.race 5s 超时降级回原 query）→ embed → query(topK??30, threshold??0.35) → 本地 keyword 加分 → AI rerank（仅 enableReranking!==false，无 signal，失败仅 console.warn 回退向量序）→ setSearchResults + setSearchFilters + skipNextTextSearchRef=true + vectorScoreMapRef 写入 + return] 或落关键词分支 [activeConfig? → searchRepositoriesWithReranking（失败回退 performBasicTextSearch）: performBasicTextSearch] → applyFilters(结果) → setSearchResults → setSearchFilters | useSearchActions.aiSearch / keywordSearch |
| 2 | SearchBar.handleStarSync (714-926) | token 校验 toast → setSyncingStars(true) → new GitHubApiService → getAllStarredRepositories → 与 getState().repositories 逐字段合并（license `?? null` 回填）→ [stars-and-lists 时: createGitHubListsApiService → getUserLists(login)（无 login 抛错）→ 建缺失自定义分类(addCustomCategory，id=`custom-sync-${Date.now()}-${idx}`) → preExistingLocked 集 → 打标签/设分类/加锁循环 → appliedTagsCount toast（两种文案）→ list 失败 toast 后**不中断**星标结果] → setRepositories(final) → **await forceSyncToBackend()** → setLastSync → 新仓库数 toast（success/info 两分支）→ catch：message 含 'token' 专属文案 / 通用文案 → finally setSyncingStars(false) | useSearchActions.syncStars |
| 3 | SearchBar.handleStarAndListSync (941-958) | confirm(warning，原文案) → handleStarSync('stars-and-lists') | **View 保留 confirm 包装**（§2.1；'auto'/'stars-only' 入口原无确认，勿加） |
| 4 | SubscriptionRepoCard.executeUnstar (91-125) | 无 token 静默 return → setIsStarring → 乐观 setOptimisticStarred(false) → new GitHubApiService → unstarRepository(owner,name) → deleteRepository(按 full_name 查 id) → **await forceSyncToBackend()** → 乐观清 null；catch：回滚乐观 + toast（原文案）；finally setIsStarring(false)。**成功无 toast**。确认走自定义 Modal（留 View，B8） | useDiscoveryRepoActions.executeUnstar |
| 5 | SubscriptionRepoCard.handleStar (128-183) | isStarring 短路 → 乐观(true) → starRepository(owner,name) → 构造 repositoryToAdd（rank/channel/platform 置 undefined + starred_at）→ addRepository → onStar(repo) → **await forceSyncToBackend()** → 乐观清 null → toast 成功；catch 回滚 + toast | useDiscoveryRepoActions.star |
| 6 | SubscriptionRepoCard.handleAnalyze (193-274) | 三段校验 toast（token→无配置→apiKeyStatus→baseUrl/apiKey/model，**文案取本文件原文**，与 useRepositoryCardActions 措辞不同）→ isAnalyzing 短路 → abort 上一请求（abortControllerRef，unmount abort）→ analyzeRepository({repository: repo, githubToken, aiConfig, language, categories, signal})（aiAnalysisHelper）→ aborted 则 return → 成功 patch（ai_summary/ai_tags/ai_platforms/analyzed_at/analysis_failed/analysis_error:undefined，**无 custom_category/category_locked**）→ updateDiscoveryRepo → onAnalyze(updatedRepo)。**无 forceSync、成功无 toast、无重分析 confirm**（勿照 RepositoryCard "补齐"）；catch（非 abort）：createFailedAnalysisResult → 失败 patch → updateDiscoveryRepo → toast | useDiscoveryRepoActions.analyze |
| 7 | GistCard.handleAnalyze (68-120) | 三段校验（gist 版原文案）→ 已分析则 confirm 覆盖（原文案）→ setAnalyzingGist(id,true)（store）+ 本地 flag → createGitHubApiService → getGistForAnalysis(id, gist) → new AIService → analyzeGist(detail, api.getGistContentPreview(detail))（**无 Abort**）→ updateGist(成功 patch) → toast；catch → updateGist(失败 patch) → toast；finally 双 flag 复位。**无 forceSync** | useGistActions.analyzeOne |
| 8 | GistCard.handleUnstar (122-143) | 无 token 静默 return → confirm(warning+confirmText 原文案) → api.unstarGist(id) → onUnstarred(gist.id) → updateGist({starred:false}) → toast；catch toast。**无 forceSync** | useGistActions.unstarGist |
| 9 | GistCard.handleDelete (145-174) | 无 token/isMine 静默 return → confirm(danger+confirmText 原文案) → api.deleteGist(id) → store.deleteGist → onDeleted(gist.id) → toast；catch：403/404/forbidden/scope/permission → 权限提示 toast（原文案）。**无 forceSync** | useGistActions.deleteGist |
| 10 | GistDetailModal.HighlightedCode effect (45-80) | needsRawFetch=(truncated\|\|!content)&&raw_url → 局部 AbortController（cleanup abort）→ 无 token：setRawError(原文案) → createGitHubApiService().getGistFileRaw(raw_url, signal) → setRawContent + onContentLoaded 回写（本地缓存 + store updateGist，key `${gist.id}:${filename}:${rawUrl}`）；catch：abort 先 return，'Aborted' → 取消文案；retry 按钮 retryTick。**Abort/retry/局部缓存留 View** | useGistActions.fetchGistFileRaw |
| 11 | ReleaseCard.handleRpcDownload (120-155) | key=`${url}@${updatedAt??''}` → sending 短路 → 重试先清 sent → forceUpdate → sendToRpcDownload(url, name, backendApiSecret\|\|undefined)（**三参**）→ success：mark sent + toast；failure：'RPC service not running' 专属分支 / result.error / 通用失败 → toast(error)；catch：RPC 未运行文案 → toast；finally sending=false + forceUpdate | useReleaseArtifactActions.sendRpcDownload |
| 12 | ReleaseCard.runSummaryAnalysis (160-206) | 无 activeConfig → toast（原文案）→ abort 上一（summaryAbortRef，unmount abort）→ new AIService → analyzeReleaseSummary(release.body\|\|'', {repoName, tagName, releaseName}, signal) → done(content)+展开；catch AbortError 静默 return / 否则 error(message)+展开+toast。无 store 写、**无 forceSync**。summary 状态机 idle/loading/done/error 为本地态不持久化 | useReleaseArtifactActions.generateSummary |
| 13 | ReadmeModal 两 fetcher (332-392) | shouldBypassBackend()\|\|!backend.isAvailable → 直连 GitHubApiService（content 路径无 token 抛原文案 / candidates 路径无 token 返回 []）；否则 backend.*，失败且非 abort、有 token → console.warn(原文案) + fallback 直连。两个 controller，fetch 前 abort 上一，unmount/关闭 abort+置 null | useReadmeFetch |
| 14 | ReleaseSourceSettingsModal → WatchCustomReleaseSyncPanel.handleSync (221-249) | 无 token/isSyncing **静默** return（无 toast）→ new GitHubApiService → getAllWatchedRepositories()（仅 /user/subscriptions）→ repositoryToCustomReleaseRepository(repo, WATCH_CUSTOM_RELEASE_SOURCE_ID) 映射 + 保留既有 release_hidden → setReleaseSourceRepositories(sourceId, repos)（store）→ toast(success)；catch toast(error)；finally isSyncing 复位。**无 forceSync、无 confirm、无 Abort** | useReleaseTimelineActions.syncWatchedSources |
| 15 | RepositoryEditModal.handleSave 尾部 (402-404) | updateRepository(updatedRepo) → **await forceSyncToBackend()** → onClose() | 复用 useCategorySyncActions |

### 1.3 禁止事项（红线）

- **禁止跨 feature 引 hook**（ADR 脚注²）：`useDiscoveryRepoActions` 不得 import `useRepositoryCardActions`（抄模式，不 import）；hook 只能调本 feature hook 或 `src/hooks/**` 共享 hook。
- **禁止新建 application 目录**：仅允许在既有 `src/features/repositories/application/` 内新增一个文件（§3.1）；search/gists/releases 的提纯全部放各 hook 文件内导出。新 application 目录列 follow-up。
- **禁止动 Store**：不改任何 slice 的 state/action 形状，不碰 `partialize/migrate/merge/version`；`src/store/useAppStore.modularization.test` 零改动。
- **禁止改 12 项 BANNED_COMPONENT_SERVICES**（两处门禁各 12 项，不增不减）。
- **禁止 `allowTypeImports: true`**：`check-boundaries.cjs` 的 `IMPORT_RE`（74-75 行）同样匹配 `import type`，只改 eslint 会导致 CI 红（A2）。
- **禁止在 View 残留任何 banned service import**（静态/`import type`/动态 `import()`/`export from` 四形式）；`isElectron`/`logger`/`routeMode` 等非 ban 项 import 不动。
- **禁止引入方案外新功能；禁止改任何 confirm/toast 文案。**

### 1.4 infra 白名单口径（B7）

机制是**黑名单制**：12 项 banned 以外皆可从组件 import。事实上的 infra 工具（未 banned、可继续在组件用）：`logger`、`electronProxy`/`isElectron`、`indexedDbStorage`、`mcpElectronBridge`、`aiRequestLimiter`、`discoveryAnalysisStorage`；另有 `routeMode`（`shouldBypassBackend`）——未 banned 未文档化的事实 infra，**本次不迁不动**（其决策逻辑随 fetch 进 hook，§2.4）。

### 1.5 application 纯度门禁口径（B6）

application 层门禁（`eslint.config.js:125-180`、`check-boundaries.cjs:143-183`）**只拦** `react/react-dom` import 与 `**/store/**`、`**/services/**` 路径。DOM/JSX 禁令**没有规则落地**，仅 ADR 脚注³约定——新增纯函数文件不要写 DOM/JSX，但验收无需断言。机制化列 follow-up（§10）。

---

## 2. Hook API 设计

### 2.1 `useSearchActions`（新建 `src/features/repositories/hooks/useSearchActions.ts`）— 最重

**归属**：SearchBar 是全局搜星标仓，归 repositories 域。零参，内部自建 `t`（参照 useGistActions）。

```ts
export interface SearchActions {
  isSearching: boolean;
  searchPhase: string | null;
  // 渲染相关 ref：View 的过滤 effect（SearchBar.tsx:239-277）仍要读写，故以 RefObject 暴露
  vectorScoreMapRef: MutableRefObject<{ query: string; scores: Map<string, number> } | null>;
  skipNextTextSearchRef: MutableRefObject<boolean>;
  aiSearch: (query: string, applyFilters: (repos: Repository[]) => Repository[]) => Promise<void>;
  keywordSearch: (query: string, applyFilters: (repos: Repository[]) => Repository[]) => Promise<void>;
  syncStars: (mode?: 'auto' | 'stars-only' | 'stars-and-lists') => Promise<void>;
}
```

- **ref 归属决策**：两 ref 的写点在 handleAISearch（→hook），读点在 View 过滤 effect（242/249/252/254/264/266 行，依赖 View 本地 applyFilters 闭包与 17 个 filter 依赖）。该 effect 整体搬入 hook 会扩大改动面、引入漂移风险，故 **ref 实体挂 hook、以 RefObject 暴露给 View 原样读写**——"只搬运不改语义"约束下风险最低的切法。hook 文件内注释写明该契约。
- **`applyFilters` 参数**：原 handleAISearch 在 490/546 行调用 View 本地闭包；hook 以参数接收（调用时传入，避免 stale closure），在**完全相同的两处**调用。
- `aiSearch`：逐句搬运 370-559 中非 View-UI 部分。View-UI 部分（setIsRealTimeSearch(false)/setShowSearchHistory(false)/setShowSuggestions(false)/搜索历史 localStorage 块）**留在 View**，View 的 handleAISearch 变薄包装（§4.1）。hook 从 setIsSearching(true)+setSearchPhase(null)+清 vectorScoreMapRef 起。向量门控读 `useAppStore.getState().vectorSearchConfig/embeddingConfigs`（保持原时机）。向量命中：setSearchResults→setSearchFilters→skipNextTextSearchRef=true→return；未命中/异常：`await keywordSearch(query, applyFilters)`（原为 fall-through，顺序调用等价）。HyDE 局部 controller+5s race、rerank 无 signal、console 诊断全保留。
- `keywordSearch`：搬运 517-552。`repositories` 用 hook selector 值；activeConfig 分支 → searchRepositoriesWithReranking（catch 回退 `performBasicTextSearch`，utils 导入非服务）；无配置 → performBasicTextSearch；尾部 applyFilters(filtered)→setSearchResults→setSearchFilters。独立暴露为可测性。
- `syncStars(mode='auto')`：逐句搬运 714-926（保序表 #2）。storeRepos 用 `useAppStore.getState().repositories`；allCategories 在回调内以与 View useMemo 同源同值的方式计算（getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides)）；lists 元素类型从 `getUserLists` 返回推导（`src/services/githubListsApi.ts:502`）。
- **confirm 归属（B8）**：`syncStars` **不内置 confirm**——原代码仅 stars-and-lists 下拉入口确认；View 保留 handleStarAndListSync 薄包装：confirm（原文案）→ `syncStars('stars-and-lists')`。
- **toast 归属**：全部随动作入 hook。**Abort**：仅 HyDE 局部 controller（随代码入 hook，无 ref 持久化）。
- **selector**（一个 useShallow 块）：`repositories, aiConfigs, activeAIConfig, language, setSearchFilters, setSearchResults, githubToken, setRepositories, setLastSync, setSyncingStars, syncMode, user, addCustomCategory, customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides`。`isSyncingStars` 等纯展示字段留 View 自己的 selector。
- 返回 `useMemo` 稳定（refs 天然稳定）。

### 2.2 `useGistActions` 扩展（`src/features/gists/hooks/useGistActions.ts`）

现状：零参、`useShallow(selectGistViewState)`（**已含** updateGist/deleteGist/setAnalyzingGist，selectors.ts:97-116，无需改 selector）、useDialog、内部 t。新增：

```ts
analyzeOne: (gist: Gist) => Promise<void>;
unstarGist: (gist: Gist, onUnstarred?: (gistId: string) => void) => Promise<void>;
deleteGist: (gist: Gist, onDeleted?: (gistId: string) => void) => Promise<void>;
fetchGistFileRaw: (rawUrl: string, signal?: AbortSignal) => Promise<string>;
isAnalyzingGist: (gistId: string) => boolean;
isMutating: boolean;
```

- `analyzeOne`：搬运保序表 #7，View 保留 `event.stopPropagation()` 前置。confirm（覆盖确认）**入 hook**。本地 isAnalyzingLocal 与 setAnalyzingGist 同置同清、渲染值恒等于 store 集合值——hook 只操作 store 的 analyzingGistIds，暴露 `isAnalyzingGist(id)`，**代码注释写明该等价性**防后人"修复"。无 Abort（原样）、无 forceSync。
- `unstarGist/deleteGist`：View 回调（onUnstarred/onDeleted）以**参数**传入，在原顺序点被调用。confirm **入 hook**（原文案）。`isMutating` 留 hook（每卡片实例化，等效原卡片本地态）。
- `fetchGistFileRaw(rawUrl, signal)`：薄封装——无 token 时 throw，err.message = GistDetailModal 原无 token 错误文案**逐字抄录**（View catch 写 rawError，渲染结果与原 setRawError 直写逐字一致）；有 token 则 `createGitHubApiService(token).getGistFileRaw(rawUrl, signal)`。**Abort 归 View**（HighlightedCode 局部 controller + retry 不动）。
- 返回对象追加以上成员，保持该文件"直接展开 state + 字段"风格，不追加 useMemo。

### 2.3 `useDiscoveryRepoActions`（新建 `src/features/discovery/hooks/useDiscoveryRepoActions.ts`）

注意：`discovery/hooks/` 已有 `useDiscoveryActions.ts`（频道加载/批量分析）——新 hook 与其并存、零重叠（卡片级动作），命名已核验无撞名。**禁止 import useRepositoryCardActions**（跨 feature 红线）；校验模板**参照** useRepositoryCardActions.analyze（B3），但文案用 SubscriptionRepoCard 原文。

```ts
export interface UseDiscoveryRepoActionsOptions { repo: DiscoveryRepo; }
export interface DiscoveryRepoActions {
  analyze: (onAnalyzed?: (repo: DiscoveryRepo) => void) => Promise<void>;
  star: (onStar?: (repo: DiscoveryRepo) => void) => Promise<void>;
  executeUnstar: () => Promise<void>;
  isAnalyzing: boolean;
  isStarring: boolean;
  isStarred: boolean;          // optimisticStarred ?? isStarredComputed（原 View 公式）
  optimisticStarred: boolean | null;
}
```

- **selector**（useShallow）：`githubToken, aiConfigs, activeAIConfig, language, customCategories, repositories, updateDiscoveryRepo, addRepository, deleteRepository`；`isStarredComputed = repositories.some(r => r.full_name === repo.full_name)` 用 useMemo。
- `analyze(onAnalyzed?)`：保序表 #6 逐句。AbortController ref 挂 hook，unmount effect 只 abort。成功/失败 patch 用 §3.1 纯函数。getAllCategories 调用点保持。
- `star(onStar?)`：保序表 #5；乐观态 `optimisticStarred` **从 View 移入 hook**；repositoryToAdd 构造用 §3.2 纯函数。
- `executeUnstar()`：保序表 #4。**无 confirm**——unstar 确认是自定义 Modal，**确认 UI 留 View**（B8）。原 finally 的 `setPendingUnstarAction(null)` 是 View 态，hook 不可触——View 确认按钮改为 `setUnstarConfirmOpen(false); setPendingUnstarAction(null); void executeUnstar();`（可见行为等价）。
- `isStarring` 本地态入 hook（star/unstar 共用）。

### 2.4 `useReadmeFetch`（新建 `src/hooks/useReadmeFetch.ts`，共享层）

放共享层理由：ReadmeModal 是通用 owner/name props 组件（RepositoryCard/SubscriptionRepoCard 等亦用），无归属 feature；`src/hooks/` 有 useAutoUpdateCheck 直调 service 先例，ADR 脚注² 允许 feature hook/View 调 `src/hooks/**`。

```ts
export interface UseReadmeFetchOptions { owner: string; name: string; }
export interface ReadmeFetchActions {
  fetchReadmeContent: (variant: ReadmeVariant) => Promise<string>;              // 332-364 路径
  fetchReadmeCandidates: (defaultBranch: string | undefined) => Promise<GitHubReadmeCandidateItem[]>; // 366-392 路径
  cancel: () => void;  // abort 两路 controller 并置 null；View 关闭 modal 时调；hook unmount 亦自动
}
export const pickReadmeCandidate = (
  variants: ReadmeVariant[], selectedKey: string | undefined, defaultVariant: ReadmeVariant,
): ReadmeVariant;  // ReadmeModal.tsx:468 的 find(...)||default 提纯
```

- **Abort 归 hook**：hook 持两个 controller（content/candidates），每次 fetch 前 abort 上一个；`useEffect(() => cancel, [])` 兜底 unmount。View 删除自己的两 ref 与卸载/关闭 abort 块，关闭时改调 `cancel()`。
- **shouldBypassBackend 决策随 fetch 入 hook**（routeMode import 从 View 移入 hook）。
- selector：`githubToken, language`（useShallow）。backend 优先→GitHub fallback 两级逻辑与 console.warn 文案逐字搬运（含 candidates 分支"无 token 返回 []"而非抛错）。无 toast/confirm、无 store 写。
- View 的 `readmeCache`、变体 tab 状态、`buildReadmeVariants(candidates, language)`（utils，已存在）留 View；仅 468 行变体选择改用 `pickReadmeCandidate`。

### 2.5 `useReleaseArtifactActions`（新建 `src/hooks/useReleaseArtifactActions.ts`）+ `useRepositoryReleaseSheet` 委托

**规范语义 = ReleaseCard 版本**（迁移对象语义神圣）；`useRepositoryReleaseSheet`（repositories/hooks:119，已实现相同 RPC+AI 逻辑，禁止第三份拷贝——A1）改委托。

```ts
export type ReleaseArtifactSummaryState =
  { status: 'idle' | 'loading' | 'done' | 'error'; content?: string; error?: string };
export interface ReleaseArtifactActions {
  summaries: Record<number, ReleaseArtifactSummaryState>;
  rpcDownloadStates: Record<string, 'idle' | 'sending' | 'sent'>;  // key = computeRpcDownloadKey(link)
  sendRpcDownload: (link: { url: string; name: string; updatedAt?: string }) => Promise<void>;
  generateSummary: (release: Release) => Promise<void>;
  cancelSummaryRequests: () => void;
  reset: () => void;  // 实施补充：清空 summaries/RPC 状态并取消进行中请求（sheet loadReleases 需要，规格遗漏）
}
export const computeRpcDownloadKey = (link: { url: string; updatedAt?: string }): string; // `${url}@${updatedAt ?? ''}`
```

- 零参自建 t；selector（useShallow）：`language, backendApiSecret, aiConfigs, activeAIConfig`。
- `sendRpcDownload(link)`：保序表 #11 逐句。key 由 `computeRpcDownloadKey` 计算；downloading/downloaded 用 `useState` Record 替换原 refs+forceUpdate（渲染等价的实现替换，注释说明）；三参 `sendToRpcDownload(link.url, link.name, backendApiSecret || undefined)`；'RPC service not running' 专属分支保留（原文案）。
- `generateSummary(release)`：保序表 #12 + sheet 兼容前置守卫（existing?.status==='loading' 或 ('done'&&content) 时 return——对 ReleaseCard 是无害 no-op：其展开短路在 View toggle handler）。`summaryAbortRefs: Record<number, AbortController>` 挂 hook；unmount effect abort 全部。无 activeConfig → toast（原文案）不写状态；AbortError 静默。
- **useRepositoryReleaseSheet 委托改造点**（同 commit 完成，避免中间态第三份拷贝）：
  1. 删 sendToRpcDownload/AIService import、summaryAbortRefs、generateSummary(288-329) 与 sendAssetToRpc(231-249) 内联实现；
  2. 内部实例化 `useReleaseArtifactActions()`；generateSummary 直接转发；sendAssetToRpc 变为 `if (!rpcDownloadConfig.enabled) return; await actions.sendRpcDownload(link);`（enabled 守卫留 sheet——ReleaseCard 侧由按钮显隐承担）；
  3. 对外返回的 summaries/downloadStates 改由 hook 供给 + computeRpcDownloadKey 换算（RepositoryReleaseSheet UI 及其测试同步换 key）；
  4. cancelPendingRequests 保留 fetch abort 部分，summary 部分转发 cancelSummaryRequests；
  5. **3 处已接受微差异（写入 PR 描述，行为零变更的唯一例外）**：① dedup key 由 url-only 变 `url@updatedAt`（与卡片一致，修同病灶）；② AI 配置缺失由"静默置 error 态"变"toast 不置态"；③ RPC 失败文案统一为 ReleaseCard 版。若存量测试断言旧文案/旧 key，按新语义更新断言并在 PR 说明（§6.2）。

### 2.6 `useReleaseTimelineActions` 新增 `syncWatchedSources`（B1：方法不存在，为新增）

`src/features/releases/hooks/useReleaseTimelineActions.ts` 现有仅 handleRefresh/handleMarkAllRead/handleUnsubscribeRelease。

```ts
syncWatchedSources: () => Promise<void>;
isSyncingWatchedSources: boolean;
```

逐句搬运保序表 #14。repos 来源：原面板 props `repos = releaseSourceSettings.watchCustomReleaseRepos`（ReleaseSourceSettingsModal.tsx:389）——hook 直接从 `selectReleaseTimelineState` 已含的 `state.releaseSourceSettings.watchCustomReleaseRepos` 读取（**不改共享 selector**）；`setReleaseSourceRepositories` 用独立单值 selector（useCallback 包裹）获取。`repositoryToCustomReleaseRepository`/`WATCH_CUSTOM_RELEASE_SOURCE_ID` 从 utils/releaseSources import（utils 非 banned）。无 token/isSyncing 静默 return（原样，无 toast）；无 confirm、无 forceSync、无 Abort（原样）。

### 2.7 `useBackendAvailability`（新建 `src/features/settings/hooks/useBackendAvailability.ts`）

```ts
export const useBackendAvailability = (): boolean;
// 读取并返回 backend.isAvailable（一次性同步属性，无订阅——与 SettingsPanel 现状逐字等价，勿引入订阅/状态）
```

SettingsPanel 两处 `(isElectron() || backend.isAvailable)`（369/380 行）改 `(isElectron() || backendAvailable)`；删 24 行 import。`isElectron` 属 infra 不动。

### 2.8 `RepositoryEditModal` → 复用 `useCategorySyncActions`

`src/features/repositories/hooks/useCategorySyncActions.ts` 已存在（零参，返回 `{ forceSyncToBackend }`，先例 CategorySidebar.tsx:61）。View 删 12 行 import，加 `const { forceSyncToBackend } = useCategorySyncActions();`，402-404 调用点原样（保序表 #15）。

---

## 3. 纯函数提纯清单

### 3.1 `src/features/repositories/application/discoveryRepoPatches.ts`（唯一新 application 文件）

```ts
import type { DiscoveryRepo } from '../../../types';
export interface DiscoveryAnalysisSuccessInput {
  summary: string | undefined; tags: string[] | undefined; platforms: string[] | undefined;
  analyzedAt: string; analysisFailed: boolean | undefined;
}
export interface DiscoveryAnalysisFailureInput {
  analyzedAt: string; analysisFailed: boolean | undefined; analysisError: string | undefined;
}
export const applyDiscoveryAnalysisSuccess = (repo: DiscoveryRepo, input: DiscoveryAnalysisSuccessInput): DiscoveryRepo;
export const applyDiscoveryAnalysisFailure = (repo: DiscoveryRepo, input: DiscoveryAnalysisFailureInput): DiscoveryRepo;
```

**字段集逐字取自 SubscriptionRepoCard 239-247/260-265**（含 `analysis_failed: result.analysis_failed`、`analysis_error: undefined`），**不含** custom_category/category_locked——与 `repositoryPatches.applyAnalysisSuccess` **不是同一形状，勿复用/勿"对齐"**。输入输出均 DiscoveryRepo（保留 rank/channel/platform）。受 application 纯度门禁约束（§1.5），types 导入合法。同目录 `__tests__/` 加单测（先例 repositoryPatches.test.ts）。

### 3.2 各 hook 文件内导出纯函数（同文件单测覆盖；不下沉新目录——红线）

| 文件 | 纯函数 | 来源（逐字提纯块） |
|---|---|---|
| useSearchActions.ts | `buildSearchPatch(query, vectorResults): Map<string, number>` | SearchBar 446-459：name +0.05 / desc +0.03 / tags +0.02 加分 + scoreMap 构造 |
| useSearchActions.ts | `mergeStarredRepositories(newRepos, storeRepos): Repository[]` | SearchBar 725-750 字段合并（license `?? null` 回填） |
| useSearchActions.ts | `planListCategories(lists, localCategoryNames, makeCategoryId): { toCreate: Category[]; categoryByLowerName: Map<string,string> }` | SearchBar 774-799；`makeCategoryId: (idx) => \`custom-sync-${Date.now()}-${idx}\`` 由 hook 注入保持可测性；过滤 isReservedCategoryName |
| useSearchActions.ts | `applyListsToRepositories(repositories, lists, categoryByLowerName): { repositories: Repository[]; appliedTagsCount: Record<string, number> }` | SearchBar 807-868：preExistingLocked 集 + 打标签/设分类/加锁循环 + last_edited |
| useDiscoveryRepoActions.ts | `discoveryRepoToRepository(repo: DiscoveryRepo, starredAt: string): Repository` | SubscriptionRepoCard 152-160（rank/channel/platform 置 undefined） |
| useGistActions.ts | `applyGistAnalysisSuccess(detail: Gist, summary: string, now: string): Gist` / `applyGistAnalysisFailure(gist: Gist, error: string, now: string): Gist` | GistCard 100-106 / 109-114 patch 字面量 |
| useReleaseArtifactActions.ts | `computeRpcDownloadKey(link)`（§2.5） | ReleaseCard 123 |
| useReadmeFetch.ts | `pickReadmeCandidate(variants, selectedKey, defaultVariant)`（§2.4） | ReadmeModal 468 |

`Category`/`Repository` 等类型从 `types` 导入；lists 元素类型从 `GitHubListsApiService['getUserLists']` 返回推导。

---

## 4. 逐 View 改动清单（行号为当前基线，执行时以符号为准）

### 4.1 `src/components/SearchBar.tsx`（最重，最后一个换）

- **删 import**：L7 AIService、L8 EmbeddingClient/VectorSearchService、L9 GitHubApiService、L10 createGitHubListsApiService、L11 forceSyncToBackend。
- **加**：`import { useSearchActions } from '../features/repositories/hooks/useSearchActions';`
- **删 state/refs**：isSearching/searchPhase 两个 useState（改从 hook 解构）；L189-190 两 ref 声明（改用 hook 暴露）。
- **删 body**：handleAISearch 370-559 → 薄包装（View-UI 三行 + 历史块 + `await aiSearch(searchQuery, applyFilters)`）；handleStarSync 714-926 整删；handleStarAndListSync 941-958 保留 confirm 原文、改调 `syncStars('stars-and-lists')`。
- **留 View**：applyFilters 闭包（~300-368）、过滤 effect 239-277（继续读写 hook 的两 ref，代码不变）、实时搜索/历史/建议/IME、formatLastSync、selector 中纯展示字段（isSyncingStars/releaseSubscriptions/lastSync 等）、1080/1209/1233/1240 调用点对接改名。
- store selector 收缩：删仅被搬走逻辑使用的字段（setRepositories/setLastSync/setSyncingStars/syncMode/user/addCustomCategory 等）。

### 4.2 `src/components/GistCard.tsx`

- **删 import**：L4 createGitHubApiService、L5 AIService。**加**：`import { useGistActions } from '../features/gists/hooks/useGistActions';`（每卡片实例化）。
- 三个 handler → `analyzeOne(gist)` / `unstarGist(gist, onUnstarred)` / `deleteGist(gist, onDeleted)`（View 保留 stopPropagation 前置与 props 回调透传）。`isAnalyzing` 改 `isAnalyzingGist(gist.id)`，`isMutating` 从 hook 取。删本地 isAnalyzingLocal/isMutating state 及 store 直读中不再使用字段（updateGist/deleteGist/setAnalyzingGist/aiConfigs/activeAIConfig 若无他处使用）。

### 4.3 `src/components/GistDetailModal.tsx`

- **删 import**：L9 createGitHubApiService。
- 父组件调 `useGistActions()` 取 fetchGistFileRaw，以 prop `fetchRaw: (rawUrl: string, signal: AbortSignal) => Promise<string>` 传入内部 HighlightedCode；HighlightedCode 删自身 service 调用与 githubToken 读取（L28 若仅服务该 fetch 则删），effect 内改 `await fetchRaw(file.raw_url!, controller.signal)`（无 token 分支交给 hook 抛错，catch 落 rawError 文案不变）。**Abort/retry/局部缓存留 View 不动**；父组件 loadedContents 缓存 + updateGist 回写（View→Store 合法）不动。

### 4.4 `src/components/SubscriptionRepoCard.tsx`

- **删 import**：L6 analyzeRepository/createFailedAnalysisResult、L7 forceSyncToBackend、L8 GitHubApiService。**加**：`import { useDiscoveryRepoActions } from '../features/discovery/hooks/useDiscoveryRepoActions';`
- 取 `{ analyze, star, executeUnstar, isAnalyzing, isStarring, isStarred, optimisticStarred }`。删本地 isStarring/isAnalyzing/optimisticStarred state、abortControllerRef+unmount effect、store 直读中不再使用项（githubToken/aiConfigs/activeAIConfig/updateDiscoveryRepo/addRepository/deleteRepository；repositories 若仅 isStarredComputed 用也删）。
- **留 View**：unstarConfirmOpen/pendingUnstarAction state、自定义 Modal JSX（499-544，文案原样）、确认按钮三行改动（§2.3）、onStar/onAnalyze 透传、stopPropagation 前置。

### 4.5 `src/components/ReleaseCard.tsx`

- **删 import**：L11 sendToRpcDownload、L12 AIService。**加**：`import { useReleaseArtifactActions, computeRpcDownloadKey } from '../hooks/useReleaseArtifactActions';`
- 取 `{ summaries, rpcDownloadStates, sendRpcDownload, generateSummary, cancelSummaryRequests }`。删：SummaryState 类型与 summary state、summaryAbortRef+unmount effect（109-115）、downloadingRef/downloadedRef/forceUpdate（116-118）、handleRpcDownload（120-155）、runSummaryAnalysis（160-206）、selector 中 backendApiSecret/aiConfigs/activeAIConfig（96-101 收缩为 rpcDownloadConfig 若仍需）。
- handleToggleSummary 改读 `summaries[release.id] ?? { status: 'idle' }`，done 短路/收起展开原样；卸载取消由 hook 承担（卡片卸载即 hook 卸载）。

### 4.6 `src/components/ReadmeModal.tsx`

- **删 import**：L8 GitHubApiService、L9 backend、L10 shouldBypassBackend。**加**：`import { useReadmeFetch, pickReadmeCandidate } from '../hooks/useReadmeFetch';`
- 删两个 fetcher useCallback（332-364/366-392）、两个 abortControllerRef 及 abort/cleanup 块。fetchReadmeContent/fetchReadmeVariants（394-466）保留编排（缓存读写、空内容/失败文案、variantsLoading），内部改调 hook 方法；468 行 find||default 改 pickReadmeCandidate(...)。modal 关闭路径原 abort 调用点改 cancel()。readmeCache/TOC/翻译全不动。

### 4.7 `src/components/ReleaseSourceSettingsModal.tsx`

- **删 import**：L9 GitHubApiService。**加**：`import { useReleaseTimelineActions } from '../features/releases/hooks/useReleaseTimelineActions';`
- WatchCustomReleaseSyncPanel.handleSync（221-249）删除，按钮改调 `syncWatchedSources`；isSyncing 改 `isSyncingWatchedSources`。panel 的 repos prop 若回显仍用可留；setReleaseSourceRepositories 直读若仅 sync 用则删。`updateReleaseSourceRepository`（284 行隐藏开关）是 View→Store，**留 View 不动**。

### 4.8 `src/components/RepositoryEditModal.tsx`

删 L12 import；加 useCategorySyncActions（§2.8）。402-404 调用点不变。

### 4.9 `src/components/SettingsPanel.tsx`

删 L24 import；加 `const backendAvailable = useBackendAvailability();`，369/380 两处条件替换（§2.7）。其余不动。

### 4.10 `src/components/GistEditorModal.tsx`

见 §5。

---

## 5. 类型解套：GistEditorModal（第一个 commit，独立可回滚）

L9 `import type { GistCreateInput, GistUpdateInput } from '../services/githubApi';` → 改 `from '../features/gists/hooks/useGistActions'`（该文件 L12 已有 `export type { GistCreateInput, GistUpdateInput }` 重导出）。**规则文件零改动**；eslint 与 check-boundaries 双放行（import type 均匹配 IMPORT_RE，A2 已核验）。

---

## 6. 测试计划

### 6.1 新增测试（同目录 `.test.tsx`，vitest globals+jsdom；mock 骨架统一 `vi.hoisted` → `vi.mock store` → `vi.mock useDialog` → 逐 service；GitHubApiService/EmbeddingClient/VectorSearchService/AIService 用 class 形态，范本 `useRepositoryCardActions.test.tsx:7-55`）

| 文件（新增） | mock 要点 | 关键断言 |
|---|---|---|
| `src/features/repositories/application/__tests__/discoveryRepoPatches.test.ts` | 纯函数无 mock | 成功/失败 patch 字段集（无 custom_category/category_locked）、DiscoveryRepo 字段保留 |
| `src/features/repositories/hooks/useSearchActions.test.tsx` | store mock **必须同时提供 getState**：`useAppStore: Object.assign(vi.fn(sel => sel(state)), { getState: () => state })`；mock vectorSearchService/aiService/githubApi/githubApiFactory/autoSync | ① 向量命中：topK/threshold 默认 30/0.35、加分映射、rerank 失败仅回退不 toast、skipNextTextSearchRef=true；② HyDE 5s race 降级回原 query；③ 向量无结果→keywordSearch AI 失败回退 performBasicTextSearch；④ syncStars('stars-and-lists')：**setRepositories 先于 forceSyncToBackend、再 setLastSync**（保序断言）；list 失败不中断星标结果；token 过期文案分支；⑤ 4 个纯函数 |
| `src/features/gists/hooks/useGistActions.test.tsx`（**全新增**，B4：无存量） | store state 覆盖 selectGistViewState 全字段；githubApiFactory mock 出 getGistForAnalysis/getGistContentPreview/unstarGist/deleteGist/getGistFileRaw；AIService.analyzeGist | analyzeOne：已分析触发 confirm、成功 patch 字段、**不调用 forceSync**；unstarGist/deleteGist：confirm false 中止、onUnstarred/onDeleted 各自原点位；fetchGistFileRaw：无 token 抛原文案、有 token 透传 signal |
| `src/features/discovery/hooks/useDiscoveryRepoActions.test.tsx` | aiAnalysisHelper/autoSync/githubApi/store | analyze 三段校验文案与顺序、abort 短路、成功 patch 无 custom_category、**无 forceSync**；star 乐观→远端→addRepository→onStar→**forceSync**→乐观清→toast 保序；executeUnstar 乐观/回滚、deleteRepository by full_name、**forceSync**、成功无 toast |
| `src/hooks/useReadmeFetch.test.tsx` | backendAdapter/githubApi/routeMode | bypass 或 !isAvailable→直连；backend 成功不走 GitHub；backend 失败非 abort 有 token→fallback+warn；无 token：content 抛/candidates 返回 []；cancel 后再 fetch abort 上一个；pickReadmeCandidate |
| `src/hooks/useReleaseArtifactActions.test.tsx`（B4 更名：非 useReleaseCardActions.test） | rpcDownloadService/AIService/useDialog/store | sendRpcDownload：key=url@updatedAt、sending 短路、重试清 sent、'RPC service not running' 分支、catch 文案；generateSummary：无配置 toast、loading/done 短路、error 态+toast、AbortError 静默、unmount abort；computeRpcDownloadKey |
| `src/features/releases/hooks/useReleaseTimelineActions.test.tsx`（新增，聚焦 syncWatchedSources） | githubApi/store（含 releaseSourceSettings.watchCustomReleaseRepos、setReleaseSourceRepositories） | 无 token/isSyncing 静默；release_hidden 保留合并；setReleaseSourceRepositories 入参；成功/失败 toast；**不调用 forceSync** |
| `src/features/settings/hooks/useBackendAvailability.test.tsx`（小） | backendAdapter | 返回 backend.isAvailable 两态 |

### 6.2 存量回归（`npm run test:run` 必绿）

`src/components/SearchBar.test.tsx`（未 mock service，不触达迁移路径）、`RepositoryEditModal.test.tsx`（已模块级 mock `../services/autoSync`，命中 useCategorySyncActions 内同名 import）、`ReadmeModal.test.tsx`（backendAdapter/githubApi 模块级 mock 命中 useReadmeFetch 内 import；若 hook 读取的 store 字段超出 mock 形状，补 fixture 字段而非改断言）、`ReleaseCard.test.tsx`（rpcDownloadService/aiService mock 命中共享 hook；注意其 mock 走动态 import 形式）、`RepositoryReleaseSheet.test.tsx` + `src/features/repositories/hooks/useRepositoryReleaseSheet.test.tsx`（委托重构后仅当断言 §2.5 三处微差异时按新语义更新断言并 PR 说明）、`useRepositoryCardActions.test.tsx`（不动）、`ReleaseTimeline.test.tsx`、`ForkTimeline.test.tsx`、`settings/BackendPanel.test.tsx`、`src/store/useAppStore.modularization.test.ts`（**必须零改动通过**——Store 未动的证明）。

**vi.mock 原则（B4）**：组件不再 import service 后，既有测试的 `vi.mock('.../services/x')` 经解析路径仍拦截 hook 内同名 import——**不预防性重写任何测试文件，跑通为准**；仅断言与既定微差异冲突时最小修改。

---

## 7. 执行顺序与 commit 切分（单 PR，~17 commits，每 commit 门禁可过）

allowlist 在最后一个 commit 前始终豁免这 10 文件，故中间态两道门禁全绿。

1. `refactor(gists): GistEditorModal 改从 useGistActions 重导出引类型`（§5，一文件）
2. `feat(gists): useGistActions 扩展 analyzeOne/unstarGist/deleteGist/fetchGistFileRaw + gist patch 纯函数 + 单测`
3. `feat(discovery): 新建 useDiscoveryRepoActions + discoveryRepoPatches + 单测`
4. `feat(readme): 新建 src/hooks/useReadmeFetch + pickReadmeCandidate + 单测`
5. `feat(release): 新建 src/hooks/useReleaseArtifactActions + 单测；useRepositoryReleaseSheet 改委托`（同一 commit 完成委托，避免中间态第三份拷贝）
6. `feat(releases): useReleaseTimelineActions 新增 syncWatchedSources + 单测`
7. `feat(settings): 新建 useBackendAvailability`
8. `feat(repositories): 新建 useSearchActions + 纯函数 + 单测`
9. View 切换（每文件一 commit，小→大）：9a GistCard；9b GistDetailModal；9c SettingsPanel；9d RepositoryEditModal；9e ReleaseSourceSettingsModal；9f SubscriptionRepoCard；9g ReleaseCard；9h ReadmeModal；9i SearchBar
10. `chore(boundaries): 删除组件边界 allowlist 机制`（**最后一步**）：
    - `eslint.config.js`：删 COMPONENT_BOUNDARY_ALLOWLIST 常量（52-63 行）+ 43-51 行 JSDoc 中 "Phased allowlist..." 段落；97-101 行 ignores 删 `...COMPONENT_BOUNDARY_ALLOWLIST` 展开（**保留** `'src/components/**/*.test.{ts,tsx}'`）；同步修剪 87-96 行规则块注释中提及 allowlist 的句子。
    - `scripts/check-boundaries.cjs`：删 COMPONENT_ALLOWLIST Set（48-59 行）+ 47 行 `// Mirror of ... Keep in sync.` 注释 + checkComponentFile 内早返（106 行）；同步修剪文件头注释（17-21 行）关于 phased allowlist 的描述。
    - **不是置空数组**——留空数组/残留接线即 review 打回（A5）。

---

## 8. 验收

三条门禁（按序执行，全绿为验收标准；命令均已核实存在于 package.json）：

```sh
npm run lint                        # eslint . —— 全仓，而非仅 src/components
node scripts/check-boundaries.cjs   # 等价 npm run check:boundaries
npm run test:run                    # vitest run（注意：npm test 是 watch 模式，勿用）
```

辅助（不作门禁但必须干净）：

```sh
npm run typecheck                   # tsc -b --noEmit（package.json:14）
# zsh 下务必单引号防 glob 展开：
rg -n 'services/(githubApi|aiService|aiAnalysisHelper|aiAnalysisOptimizer|vectorSearchService|autoSync|webdavService|backendAdapter|rpcDownloadService|githubApiFactory|updateService|translateService)' src/components --glob '*.ts' --glob '*.tsx' --glob '!*.test.*'
# 期望空（rg 递归覆盖全部子目录含 settings/、ui/；*.test.* 豁免；非 ban 的 logger/isElectron/routeMode 等不计）
rg -n 'import\s*\(' src/components --glob '*.ts' --glob '*.tsx' --glob '!*.test.*' | rg 'services/'
# 期望空（动态 import 抽查；check-boundaries.cjs 的 DYNAMIC_IMPORT_RE 已机制化覆盖）
rg -n 'COMPONENT_BOUNDARY_ALLOWLIST|COMPONENT_ALLOWLIST' eslint.config.js scripts/check-boundaries.cjs
# 期望空（机制删净，无死接线）
```

行为自测清单（人工，10 文件）：AI 搜索（向量/关键词/无配置三路）、星标同步三入口（含 list 建分类与锁定语义）、发现页 star/unstar/单卡分析与取消、gist 单卡分析/取消收藏/删除/大文件懒加载重试、Release 卡 RPC 发送与重试、README 多变体切换与后端降级、Watch 仓库同步、仓库编辑保存、设置页 Network/MCP tab 显隐（SPA 隐藏/后端连接显示/Electron 显示）。

---

## 9. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 单 PR 体量大 | 每 commit 一文件/一主题（§7），可按 commit 粒度 revert；hook commit 与 View commit 相互独立 |
| SearchBar 改动面最大 | ref 暴露策略（§2.1）使过滤 effect 零改动；applyFilters 参数传入消除 stale closure；置于最后一个 View commit |
| DiscoveryRepo 类型摩擦 | patch 纯函数收发均 DiscoveryRepo（§3.1）；不改 Store shape；modularization 测试不动 |
| useRepositoryReleaseSheet 委托的 3 处微差异 | §2.5 改造点显式列明 + PR 描述声明；断言同步更新；不满意可单独 revert commit 5（需恢复 sheet 内联实现） |
| 存量测试 mock 失配 | vi.mock 按解析路径拦截（§6.2 原则）；只补 fixture、不预防性重写 |
| 删 allowlist 后冒出新违规 | 最后 commit 前先跑三条门禁；allowlist 删除 commit 本身只动两个门禁文件 |

---

## 10. Follow-up（本 PR 不做）

1. **ADR 勘误**：ban list 10→12 项；§Phased enforcement 尾部 13 项举例名单已过期；补记"allowlist 已清零、机制已删除"。
2. **application DOM/JSX 禁令机制化**（B6：当前门禁只拦 react/react-dom/store/services import）。
3. **新 application 目录评估**：search/gists/releases 提纯函数是否下沉各自 `application/`。
4. `routeMode` 是否文档化为 infra（当前未 banned 未文档化）。
5. `useVectorSearchActions` 补 token/配置校验与 toast（当前无校验；模板在 useRepositoryCardActions.analyze / useGistActions.analyzeVisibleGists——B3）。
6. SearchBar applyFilters 闭包与过滤 effect 后续整体下沉评估。
7. `useRepositoryReleaseSheet` 与 `useReleaseArtifactActions` 的 RPC 状态 key 彻底统一后的 UI 层清理。

---

## 附录一：第一轮审计记录（A1–A8，已修复）

| # | 问题 | 等级 | 修复 |
|---|---|---|---|
| A1 | 原方案新建 useReleaseCardActions，无视已实现相同 RPC+AI 逻辑的 useRepositoryReleaseSheet，将制造第三份拷贝 | 高 | 改抽共享 `src/hooks/useReleaseArtifactActions.ts`，两处委托（§2.5） |
| A2 | GistEditorModal 用 allowTypeImports:true 解套：check-boundaries 的 IMPORT_RE 同样匹配 import type，只改 eslint 则 CI 仍红 | 高 | 改从 useGistActions 重导出引 import type，规则零改动（§5） |
| A3 | 新建顶层 features/search/ + 3 个新 application/ 目录：无 Store/selector 交代，与"7 feature hooks-only"现状冲突 | 高 | Hook 落既有位置（repositories/hooks、src/hooks）；提纯收敛到 repositories/application + hook 内纯函数（§2/§3） |
| A4 | 验收 rg 仅 src/components/*.tsx 口径：漏子目录/动态 import()/export from | 中 | 以两道门禁为源，辅助 rg 改全仓口径（§8） |
| A5 | 验收写"数组置空"：残留常量+ignores 接线+Set 早返留死机制 | 中 | 改整体删除（§7.10）；声明 allowlist 常量为唯一真值（ADR 举例名单已过期） |
| A6 | 未声明 updateService/translateService 在 components 已零违规，执行人会误查旧文件 | 低 | §0 显式声明已迁完、勿追查 |
| A7 | "复用 useRepositoryCardActions 模式"未澄清禁止跨 feature 直引 hook | 高 | 明确抄模式新建 useDiscoveryRepoActions，禁 import 跨 feature hooks（§1.3/§2.3） |
| A8 | useStarSyncActions/useBackendSettingsActions 需 { t } 参数，方案"参照/并入"未提 | 低 | 本版涉及 hook 均为既有零参自建 t 风格或新建零参（§2），不触 { t } 系 |

## 附录二：第二轮审计记录（B1–B8，本版修复）

| # | 问题 | 等级 | 修复 |
|---|---|---|---|
| B1 | useReleaseTimelineActions.syncWatchedSources 不存在（全仓 0 匹配），原表述"并入"错误 | 高 | 改为新增方法并给出设计（§2.6） |
| B2 | §4 数据流 "patch→updateX→forceSyncToBackend→toast" 一刀切错误：analyze 类成功后不 forceSync（useRepositoryCardActions.analyze 存量测试断言不调用） | 高 | 改逐动作保序表 15 条（§1.2），原则"只搬运不改语义" |
| B3 | "校验复用 useVectorSearchActions 模式"错误——该 hook 无 token/AI 校验无 toast | 中 | 校验模板指向 useRepositoryCardActions.analyze 与 useGistActions.analyzeVisibleGists（§2.3；follow-up §10.5） |
| B4 | 测试清单失实：useGistActions 无存量测试；useReleaseCardActions.test 名已失效 | 中 | 测试计划重写（§6）：8 个新增测试 + 存量回归清单 + vi.mock 拦截原则 |
| B5 | 验收命令失实：vitest 是 watch 模式；eslint 只跑 components | 中 | §8 改 npm run lint（全仓）/ check-boundaries / test:run + typecheck + rg（单引号） |
| B6 | "application 禁 DOM（lint+双拦）"失实——两道门禁均无 DOM/JSX 规则 | 低 | §1.5 表述修正；机制化列 follow-up（§10.2） |
| B7 | infra 白名单表述失实——黑名单制，文档化 infra 6 项且无 routeMode | 低 | §1.4 修正；routeMode 定性事实 infra 本次不迁 |
| B8 | SubscriptionRepoCard 的 unstar 确认是自定义 Modal 而非 useDialog.confirm | 中 | 每 hook 显式标注 confirm/toast/Abort 归属（§2）；确认 UI 留 View、hook 暴露动作（§2.3） |
