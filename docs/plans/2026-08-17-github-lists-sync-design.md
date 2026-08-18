# GitHub Lists（星标列表）双向同步设计

日期：2026-08-17
状态：设计中

## 目标

在保留现有 REST 星标同步的基础上，为 GitHub 原生 Lists（星标列表）增加双向同步：

1. **拉取（Pull）**：新增「同步星标仓库及 list」选项，通过 GraphQL 拉取用户的 Lists 及其包含的仓库，与本地数据合并。
2. **锁定**：从 list 拉取到的仓库，默认锁定分类，AI 分析不会重置。
3. **回写（Push）**：设置 → 备份恢复中新增「同步仓库分类到 GitHub list」，将本地分类写回 GitHub Lists（同名 list 覆盖）。
4. **首次登录**：在首次拉取仓库前询问用户选择同步范围（仅星标 / 星标+list），并保存为可在设置中切换的配置。

## 关键决策（DEC-*，已获用户确认）

1. **DEC-删除策略 = 只增不删**：同步（含 list 拉取）只做新增/更新，绝不删除本地已有仓库；list 上取消星标不会导致本地仓库消失（保持现状）。
2. **DEC-多 list 归属 = 标签映射，非单分类覆盖**：仓库页应用分类本来就是「跟着标签走、同一仓库可属多个分类」。因此 list 拉取采用**标签（tag）映射**：list 名作为自定义标签写入仓库 `custom_tags`，仓库可同时属于多个 list（多个标签），避免"单分类覆盖"冲突。
3. **DEC-回写同名 list = 覆盖**：将本地分类写回 GitHub list 时，同名 list 直接覆盖其成员。
4. **DEC-锁定语义 = 只判定锁定状态**：同步时只判断 `category_locked`。已锁定的仓库不改分类；未锁定的仓库应用 list 分类并加锁。手动改分类会再次上锁（现状，除非用户手动解锁）→ 用户手动解锁过的仓库，再次同步时若未锁定，list 分类会重新应用并加锁。
5. **DEC-首次登录选择 = 存为配置，可切换**：首次登录的选择保存为持久化设置项，可在设置中随时切换。

## 架构

### 数据流

```text
Pull: GitHub Lists (GraphQL) → 仓库 + list 名标签 → 合并进 store → forceSyncToBackend
Push: 本地分类 → 计算每个分类的成员仓库 → GitHub Lists (GraphQL) 覆盖写入
```

### 新增持久化设置

- `syncMode`：`'stars' | 'stars-and-lists'`，默认 `'stars'`。加入 useAppStore 持久化键白名单。
  - 首次登录若从未设置过，弹选择框；设置后写入 `syncMode`。
  - 设置面板提供切换开关。

### 新增服务：GitHub Lists GraphQL 客户端

新建 `src/services/githubListsApi.ts`：

- 底层 HTTP 走 REST 同样的模式：有后端时 `backend.postProxy` / 无后端时 `fetch('https://api.github.com/graphql')`，带 `Authorization: Bearer <token>`。复用 `githubApi.ts` 现有请求封装思路。
- 查询：`getUserLists()` 分两阶段分页：先读取 `user(login).lists` 摘要（`first:100` 分页拉全），再通过 `node(id:)` 分页读取每个 `UserList.items`（每页 `first:100`）。两阶段均带 `after` 游标与 `pageInfo`，避免单次内联 items 的巨型响应导致 GitHub 侧超时（502/504）。
- 覆盖写入：先查现有 lists → 同名 list 存在则 `updateUserListsForItem` 或删除重建；不存在则 `createUserList` + `updateUserListsForItem`。
- 权限校验：GraphQL 需要 `user` scope（经典 PAT）或含 star lists 权限的 fine-grained token；权限不足时返回友好错误，提示 `gh auth refresh -h github.com -s user`。

### Pull 合并逻辑（复用 `handleStarSync` 模式）

- 拉取星标仓库（REST，现状）后，若 `syncMode === 'stars-and-lists'`，再拉取 lists。
- 对每个 list：仓库加入 `custom_tags` 的该 list 名（去重）；并按 DEC-4 决定分类：
  - 仓库 `category_locked === true` → 不改分类（跳过）。
  - 仓库未锁定 → 设 `custom_category = list 名`（若该 list 名对应某分类）并 `category_locked = true`。
  - 若 list 名没有对应分类，仅加标签（标签本身即可让仓库出现在匹配的分类）。
- 合并仍遵循只增不删：`existingRepoMap` 合并，保留本地已有字段。

### Push 回写逻辑（StarSyncPanel）

- 设置 → 星标同步中新增「同步仓库分类到 GitHub list」按钮 + 确认对话框（警告：同名 list 将被覆盖）。
- 实现：对每个分类（默认分类或自定义分类）计算 `matchesCategory` 命中的仓库 → 映射为 GitHub list 名（分类名）→ 同名 list 覆盖成员，无则创建。
- 前置校验 token 存在；GraphQL 失败给出可操作错误提示。

### 首次登录（SyncModeChoiceModal）

- `SyncModeChoiceModal` 由 `App.tsx` 挂载：登录完成后，若 `syncModeConfigured === false`，弹选择框：「仅同步星标仓库」/「同步星标仓库及 list」。选择后写 `syncMode` 与 `syncModeConfigured`。
- 之后进入主界面，同步按钮行为按 `syncMode` 执行。

### 同步按钮（SearchBar）

- 按钮主体：直接点击执行「按 syncMode 同步」（默认仅星标）。
- 下拉新增第二项「同步星标仓库及 list」：提示 + 确认对话框（警告 list 拉取会给未锁定仓库应用 list 分类并加锁），确认后调用含 list 的同步。
- 参考现有 `handleStarSync`（src/components/SearchBar.tsx:739）复用合并逻辑。

## 约束

- 老用户不强制更新 token；token 权限不足时给出加权限引导，而非崩溃。
- 不改数据结构、不要求重索引向量（`vector_indexed_at` 保留）。
- 平滑升级/降级：新配置项缺省时行为与现状一致（仅星标）。
- 全程中文交互（含错误提示）。

## 风险 / 待验证

- fine-grained PAT 操作 star lists 的具体权限点未最终确认（blocker）。
- GraphQL 分页拉取大 list 的性能（items 每页 100）。
- 同一仓库在多个 list 时 `custom_category` 只取一个，但多标签保证多分类显示（决策 2）。

## 验收

1. 仅星标同步行为与现状完全一致。
2. list 拉取后：仓库出现在对应分类、默认锁定、AI 分析不重置。
3. 回写同名 list 被覆盖；无同名 list 则新建。
4. 首次登录可选择并持久化；设置可切换。
