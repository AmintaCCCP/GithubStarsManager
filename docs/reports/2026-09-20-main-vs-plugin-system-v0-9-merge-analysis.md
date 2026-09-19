# main 与 plugin-system-v0-9 合并分析报告

- 日期：2026-09-20
- 结论：**不能直接用普通 merge**；`main` 内容是本分支的真子集，推荐用 `-s ours` 记录合并后把 `main` 前进到本分支内容
- 状态：**本报告只是分析。没有改动 main、没有创建任何分支或提交、没有推送任何远程。**

## 1. 结论摘要

| 事项 | 结论 |
|---|---|
| 历史关系 | `git merge-base plugin-system-v0-9 upstream/main` **为空** —— 两条线没有共同祖先 |
| 提交数 | main 独有 1084，本分支独有 1132 |
| 内容关系 | main = 本分支 **− 21252 行 / + 647 行**，且 main **没有任何本分支缺少的文件** |
| main 真正的独有内容 | 只有 **2 个文件、共 84 净行**，且都是 ADR 0001 重构**之前**的旧形态 |
| 普通 merge | 222 处冲突（几乎每个同名文件）→ 不可用 |
| `-X theirs` | 冲突为 0，但结果会**新旧路径重复并存**（多出 1032 行、6 个文件）→ **不可用** |
| 推荐做法 | 在本分支上 `git merge -s ours upstream/main` 生成合并提交，再把 main 前进到它 |
| 备选 | force-push main 指向本分支（历史线性，但 main 的 1084 个提交会消失） |

## 2. 取证命令与原始数据

```text
git merge-base plugin-system-v0-9 upstream/main            -> (空)
git rev-list --left-right --count HEAD...upstream/main     -> 1132  1084
git rev-list --count HEAD..upstream/main                   -> 1084   (main 有我没有)
git rev-list --count upstream/main..HEAD                   -> 1132   (我有 main 没有)
git merge-base --is-ancestor dda7305 HEAD                  -> 1 (不是祖先)
git merge-base --is-ancestor 8a915a0 upstream/main         -> 1 (不是祖先)
git diff --stat HEAD upstream/main                         -> 184 files, +647 / -21252
git diff --name-status HEAD upstream/main                  -> M 74 / D 104 / R 6 / A 0
```

`A 0` 是关键：**main 里不存在任何本分支没有的文件**。

## 3. main 独有的内容到底是什麼

逐文件净增行数里只有两项为正：

| 净增 | 文件 |
|---|---|
| +43 | `src/features/releases/hooks/useReleaseTimelineActions.ts` |
| +41 | `src/features/releases/hooks/useReleaseTimelineActions.test.tsx`（由 `useWatchedSourcesSync.test.tsx` 改名而来） |

那 +43 行是 `syncWatchedSources` 的**内联实现**，注释里自己写着「原 ReleaseSourceSettingsModal →
WatchCustomReleaseSyncPanel.handleSync」。本分支已经把这段逻辑抽成
`src/features/releases/hooks/useWatchedSourcesSync.ts`（连带单测），即 PR #352 的 ADR 0001 归位重构。

6 个 rename 对照进一步印证 main 是重构前布局：

| main 的路径 | 本分支的路径 |
|---|---|
| `src/hooks/useAuthSessionGeneration.ts` | `src/features/lifecycle/useAuthSessionGeneration.ts` |
| `src/features/lifecycle/useBackendLifecycle.ts` | `src/features/lifecycle/hooks/useBackendLifecycle.ts` |
| `src/features/lifecycle/useBackendLifecycle.test.tsx` | `src/features/lifecycle/hooks/useBackendLifecycle.test.tsx` |
| `src/features/releases/hooks/useReleaseTimelineActions.test.tsx` | `src/features/releases/hooks/useWatchedSourcesSync.test.tsx` |
| `src/features/repository-chat/repositories/sessionRepository.ts` | `src/services/repositoryChatStorage.ts` |
| `src/features/repository-chat/repositories/sessionRepository.test.ts` | `src/services/repositoryChatStorage.test.ts` |

main 的第二个独有提交 `8e89787 feat: discover local plugin manifests v0.9.0` 只做了插件系统的**第一步**：
新增 `electron/plugins/pluginManager.js` 的 `list()` 与 `plugins:list` IPC（`main.js` +10 行、
`preload.js` +3 行）。本分支已有完整实现：
`electron/main.js:881 ipcMain.handle('plugins:list', ...)`、`electron/preload.js:31`。
它的 `manifestSchema.js` 也是更简版本（用 `Set` 常量表验证字段/权限），本分支的版本更完整。

## 4. main 缺少的东西（104 个只在本分支的文件）

| 目录 | 文件数 | 内容 |
|---|---|---|
| `electron/plugins` | 25 | 插件平台全部实现与测试（capabilityRouter / pluginCatalog / pluginPage / pluginProtocol / pluginRuntime / pluginStorage / pluginWorker / releaseDownload / webSearch …） |
| `src/components` | 14 | Telegram/XTweet/周刊弹窗、PluginPageViewer、ReleasePluginRecommendations、RepositoryHealthPanel、InstallableAssetRecommendation 等 |
| `src/plugins` | 11 | 渲染侧插件客户端、registry、hooks、快照桥 |
| `src/utils` | 11 | 含本两阶段的 `repositoryHealth.ts` / `installableAssets.ts` / `deviceTarget.ts` / `formatBytes.ts`，以及 telegram/xTweet 工具 |
| `examples/plugins` | 11 | 三个示例插件（含 Smart Release Recommender） |
| `src/services` | 10 | telegramService / xTweetService / xTweetStorage / telegramStorage / 抓取夹具 |
| `src/features` 等 | 5 | 发现频道 probe、生命周期 hook |
| `src/store` | 3 | xTweetAuth 持久化、拖拽 store |
| `server/src` | 3 | `routes/telegram.ts`、`routes/xtweet.ts` 等 |
| 其他 | 9 | `electron/repoHealth.js(.test)`、`electron/xAuthStorage.js(.test)`、docs（插件设计、路线图、v1 开发文档、两份阶段日志） |

概括：main 缺 **PR #352–#356**（分层重构、X 频道、拖拽取消分类、Telegram 频道 + X 鉴权持久化、
v0.8.1）、整套插件平台、以及本次的 Health 事实与可安装资产识别。

## 5. 版本与发布元数据

| | main | plugin-system-v0-9 |
|---|---|---|
| `package.json` version | `0.9.0` | `0.10.0` |
| `versions/version-info.xml` 最高版本 | **`0.8.0`** | **`0.10.0`** |
| 0.9.0 条目 | **不存在** | 存在（Health 事实 + 补记的插件平台） |
| `test:electron:mcp` | `mcpLocalServer + desktopPrefs` | 追加 `xAuthStorage` + `repoHealth` |

好消息：main 的 `version-info.xml` 只到 0.8.0，**不存在重复的 0.9.0 条目**，
合并后不会出现两个 0.9.0。main 的 `package.json` 是 0.9.0 但没有 0.9.0 changelog 条目——
这是它自己那一步的不一致，合并后自然被 0.9.0/0.10.0 两条完整条目覆盖。

## 6. 三种合并方式实测

### 6.1 普通 merge —— 不可用

```text
git merge-tree --write-tree --allow-unrelated-histories upstream/main plugin-system-v0-9
-> exit=1，222 行冲突信息
```

无共同祖先时每个同名文件都是 add/add 冲突。

### 6.2 `-X theirs` —— 干净但有重复模块，不可用

```text
git merge-tree --write-tree --allow-unrelated-histories -X theirs upstream/main plugin-system-v0-9
-> exit=0，结果树 36ab7ab335a6064eb135c7f4e5d531dc16891d05
   本分支树 c09ee616bff66123457950dc6e29937466cd9365
-> 不相等：合并结果多出 1032 行
```

多出的是第 3 节那 6 个文件——它们在本分支被**移动**过，而 git 在无共同祖先时无法识别跨分支 rename，
于是新旧两个路径会**同时存在**（例如 `src/services/repositoryChatStorage.ts` 与
`src/features/repository-chat/repositories/sessionRepository.ts` 并存）。这会造成重复模块、
两套实现互不引用，构建与测试都会失真。**必须排除这个方案。**

### 6.3 `-s ours` —— 推荐

```text
# 在本分支上把 main 作为第二父线并入；ours 策略不读对方树，只记录「我们的历史包含对方的历史」
git checkout -b tmp-merge-main plugin-system-v0-9
git merge -s ours --allow-unrelated-histories --no-edit upstream/main
# 验证：必须为空输出
git diff --stat plugin-system-v0-9 tmp-merge-main
# 让 main 前进到合并提交（main 未签出，可直接 -f；或 git checkout main && git merge --ff-only tmp-merge-main）
git branch -f main tmp-merge-main
git push upstream main
git push origin main
```

结果：`main` 的树 **逐字节等于**本分支（含 v0.10.0 的全部内容），main 的 1084 个提交作为第二父线
保留在历史中，不改写历史。代价是 main 那 2 个旧文件被本分支的重构版取代（见 §7）。

`merge-tree` 无法预演这一条（它只跑 ort 策略，不重现 `ours` 策略），所以验证放在创建合并提交
**之后、推送之前**：`git diff --stat plugin-system-v0-9 tmp-merge-main` 必须为空。
本地建分支不产生任何远程影响，你确认后我再执行并推送。

### 6.4 force-push / reset —— 备选

```text
git push upstream plugin-system-v0-9:main --force-with-lease
```

历史线性干净、没有空的合并提交，但 main 现有 1084 个提交会从 main 上消失（后续 gc 回收）。
只有在确认没有任何人/任何开放 PR 基于当前 main 时才考虑。

## 7. 风险与取舍

1. **main 的 2 个旧文件会被取代**：行为等价（本分支是同一逻辑的重构版 + 单测），但文件形态不同。
   若 `-s ours`，这两个路径在 main 的新树里不存在。
2. **历史里会有重复叙事**：main 独有提交的标题（如 `feat: add backend login recovery flow`、
   `Merge pull request #329` 等）在本分支里有内容相同但 SHA 不同的对应提交。合并后 main 的历史里
   两套 SHA 都在，`git log` 看起来会有「同一件事说了两遍」。这是两条独立历史合并的必然结果。
3. **没有内容损失**：内容维度上 main ⊆ 本分支（除 §3 那 2 个旧文件），`-s ours` 后
   `git diff plugin-system-v0-9 main` 为空即可证明。
4. **构建/测试影响**：合并后 main 的 `package.json` 是本分支版本，`test:electron:mcp`
   包含 `repoHealth.test.js`；`node_modules` 无需重装（依赖未变）。
5. **推送目标**：按你的选择，批准后同时推 `upstream`（Khk-NL/GithubStarsManager）与
   `origin`（Khk-NL/GithubStarsManager_PluginSystem）的 main。

## 8. 建议的下一步

推荐 §6.3。若你确认，我会：

1. 建临时分支 + `-s ours` 合并提交（不动 main、不推送）；
2. 用 `git diff --stat plugin-system-v0-9 tmp-merge-main` 证明零内容损失；
3. 在合并结果上跑 `check:boundaries` / `typecheck` / `lint` / `vitest`，
   确认与阶段 2 的基线一致；
4. 通过后再 `git branch -f main` 并推送两个远程，最后删除临时分支。

若你更想要线性历史，就走 §6.4，我会先做一次 `--dry-run` 并把影响范围（会消失的 1084 个提交）再列给你。
