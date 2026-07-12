# 仓库页「查找相似仓库」特性设计

日期：2026-07-12
状态：已实现

## 目标

在仓库页（Repositories 视图）新增一个基于向量语义搜索的「查找相似仓库」交互：

- 设置中开启向量搜索开关且向量索引可用时，悬停仓库卡片，左下角「最近提交」时间变为高亮文字按钮「查找相似仓库」。
- 点击后利用向量检索匹配语义相似仓库，并**完全替换**当前仓库列表为相似仓库结果（进入「相似仓库视图」）。
- 支持链式查找：相似结果中的卡片同样可悬停点击，进一步深入。
- 列表顶部以横幅提示当前状态，并提供「重置」按钮，**一键直接回到查找相似之前的最初列表**。
- 交互清晰、无歧义：相似视图下点击分类侧栏即离开相似视图并切换到该分类。

## 关键决策（来自澄清问答）

1. 点击后列表**完全替换**为相似仓库结果（非叠加 / 非过滤）。
2. 相似仓库视图内**支持连续链式查找**（在结果上再查相似）。
3. 重置按钮**直接回到初始列表**，忽略中间层级（无需多层栈）。
4. 状态提示与重置入口放在**列表顶部横幅**。
5. 按钮显示条件基于**实际可用性**（开关开启 + Worker 已连接 + 有向量数 + Embedding 配置完整），而非仅看开关，避免无效点击。

## 架构

### 状态（`useAppStore`）

```ts
similarView: SimilarViewState | null;

interface SimilarViewState {
  active: boolean;
  anchorRepoFullName: string;
  anchorRepoName: string;
  similarResults: Repository[];        // 当前相似结果（渲染用）
  originalSearchResults: Repository[]; // 进入前的 searchResults 快照，重置恢复用
}
```

- `enterSimilarView(repos, anchor)`：保存当前 `searchResults` 到 `originalSearchResults`，写入 `similarResults` 与锚点信息。
- `resetSimilarView()`：恢复 `searchResults = originalSearchResults`，清空 `similarView`。
- 不持久化（重载即回到正常视图，避免状态歧义）。

### 向量检索（`vectorSearchService.findSimilarRepositories`）

`buildEmbeddingText(sourceRepo)` → `EmbeddingClient.embed([text], 'query')` 生成查询向量 → `VectorSearchService.query(vector, { topK: topK+1, threshold })` → 从全量仓库按 id 映射并**过滤源仓库自身** → 返回 `Repository[]`。

### 渲染接入（`App.tsx` RepositoriesView）

- `similarView?.active` 时，列表数据源切换为 `similarView.similarResults`，并强制 `selectedCategory='all'`（忽略分类过滤，完整展示相似结果）。
- 否则沿用原逻辑：`hasActiveSearchFilters(searchFilters) ? searchResults : repositories`。
- `handleCategorySelect`：相似视图激活时点击分类先 `resetSimilarView()` 再切换分类，保证「点分类 = 离开相似视图」。

### 卡片按钮（`RepositoryCard`）

- `vectorSearchAvailable` 派生标志：开关开启 + `vectorSearchStatus.connected` + `vectorCount > 0` + Embedding 配置完整 + Worker URL/Token 非空。
- 「最近提交」行改造：默认显示时间文本；`group-hover` 时时间淡出、绝对定位覆盖显示高亮 `<button>「🔍 查找相似仓库」`。按钮 `pointer-events-none group-hover:pointer-events-auto`，避免遮盖非悬停时的卡片点击。
- 按钮是 `<button>`，卡片 `handleCardClick` 已通过 `closest('button')` 排除，不会误开 README modal。
- `handleFindSimilar`：创建 EmbeddingClient + VectorSearchService → `findSimilarRepositories` → `enterSimilarView`；过程显示 loading（卡片内 spinner），失败 `toast` 报错并保留原视图；空结果也进入视图并由横幅显示。

### 顶部横幅（`SimilarViewBanner`）

- 条件渲染于 `RepositoryList` 顶部（controls bar 之前）。
- 左侧「正在查看 **{anchorRepoName}** 的相似仓库」，右侧醒目「← 重置」按钮。

## 边界与歧义消除

- 相似结果为空：横幅仍显示，列表空状态提示，重置可用。
- 加载中：按钮显示 spinner，禁止重复点击。
- 非仓库页（gists / releases / forks / settings / subscription）不显示该功能。
- 重启应用后 `vectorSearchStatus` 不持久化（初始 `connected:false`），按钮不显示直到重新建立连接，符合「要求索引可用」。

## 修改文件清单

- `src/types/index.ts` — 新增 `SimilarViewState` 类型与 `AppState.similarView` 字段。
- `src/store/useAppStore.ts` — 新增 `similarView` 状态、`enterSimilarView` / `resetSimilarView` actions、初始值。
- `src/services/vectorSearchService.ts` — 新增 `findSimilarRepositories`。
- `src/components/RepositoryCard.tsx` — 悬停按钮 + `handleFindSimilar`。
- `src/components/SimilarViewBanner.tsx` — 新组件（横幅）。
- `src/components/RepositoryList.tsx` — 渲染横幅。
- `src/App.tsx` — `RepositoriesView` 接入相似结果渲染；`handleCategorySelect` 退出逻辑。

## 测试建议

- 单测 `findSimilarRepositories`（mock EmbeddingClient / VectorSearchService）。
- 单测 store actions 快照恢复。
- 手动验证：开启开关 + 配置 → 卡片 hover 显按钮 → 点击进相似视图 → 横幅出现 → 再次 hover 链式查找 → 重置回初始 → 相似视图下点分类离开视图。
