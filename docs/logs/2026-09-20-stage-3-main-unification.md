# 阶段日志 3：main 统一（合并全量功能、删除其余分支、单一工作副本）

- 日期：2026-09-20
- 性质：仓库治理操作，**不是**功能阶段；对应「将更全的功能覆盖到 main，删去其他分支，以后统一在 main 上开发」
- 依据：[`docs/reports/2026-09-20-main-vs-plugin-system-v0-9-merge-analysis.md`](../reports/2026-09-20-main-vs-plugin-system-v0-9-merge-analysis.md)
- 合并提交：`721eb31`（父：`8fab039` 本分支线 + `b08532a` 旧 main）
- 代码量：**0 行源代码变更**（合并结果树与阶段 2 已验证的 v0.10.0 逐字节一致，仅新增分析报告与日志），因此**不提升版本号**，版本仍为 `0.10.0`

> 编号说明：这是第 3 个阶段日志。下一个功能阶段（批量 Repository 导入的提取与归一化）
> 记为阶段 4，避免编号冲突。

## 1. 为什么这步需要单独决策

`merge-base main plugin-system-v0-9` **为空**——两条线没有共同祖先：main 独有 1084 个提交、
本分支独有 1132 个。但内容上 main 是本分支的**真子集**（`git diff --diff-filter=A` = 0 个文件；
main 的独有内容只有 2 个文件 84 净行，且都是 ADR 0001 重构**之前**的旧形态）。
所以「合并」在这里不是常规操作，必须先把风险量出来。

## 2. 实测三种合并方式

| 方式 | 命令 | 结果 | 结论 |
|---|---|---|---|
| 普通 merge | `merge-tree --allow-unrelated-histories upstream/main plugin-system-v0-9` | exit=1，222 行冲突 | 不可用 |
| `-X theirs` | 同上追加 `-X theirs` | exit=0，但结果树 `36ab7ab` ≠ 本分支树 | **不可用** |
| `-s ours` | 在本分支上 `git merge -s ours --allow-unrelated-histories upstream/main` | 结果树与本分支逐字节一致 | 采用 |

`-X theirs` 的陷阱值得记下来：它零冲突、看起来最干净，但 6 个在本分支被**移动过**的文件
（`src/hooks/useAuthSessionGeneration.ts`、`useBackendLifecycle.*`、`sessionRepository.*`、
`useWatchedSourcesSync.test.tsx`）在无共同祖先时无法被识别为 rename，于是**新旧两个路径同时存在**，
多出 1032 行重复模块（两套 `sessionRepository` / 两套 lifecycle hook 并存）。这种"合并成功"
会直接破坏构建与测试，比冲突更危险。

## 3. 执行序列与验证点

```text
git checkout -b tmp-unify plugin-system-v0-9
git merge -s ours --allow-unrelated-histories upstream/main
# 验证点 1：内容零损失（必须为空）
git diff --stat plugin-system-v0-9 tmp-unify              -> 空
# 验证点 2：两条线都成为祖先 → 推送是快进，不需要 force
git merge-base --is-ancestor plugin-system-v0-9 tmp-unify  -> 0
git merge-base --is-ancestor upstream/main tmp-unify       -> 0
# 验证点 3：在合并结果上跑门禁
check-boundaries / typecheck / lint / vitest               -> 通过，16 个失败与基线同一集合
git branch -f main tmp-unify
git push upstream main                                     -> b08532a..721eb31（快进）
```

合并提交的默认信息被改写成带理由的说明（为什么用 `-s ours`、为什么不需要 force、
两条历史的可达性），避免以后看到这个"无共同祖先的合并"时一头雾水。

## 4. 一个差点毁掉依赖的操作

`GithubStarsManager_PluginSystem_latest_pr/node_modules` 是指向主克隆的 **Junction**：

```text
LinkType: Junction
Target  : D:\Code\GithubStarsManager\GithubStarsManager_PluginSystem\node_modules
```

`git worktree remove` 的递归删除会**穿透 junction 删掉主克隆的依赖**。因此先只删除链接本身
（`cmd /c rmdir` 不跟随重解析点），核对主克隆 `node_modules` 仍为 613 项、`.bin/vitest` 存在，
才继续移除 worktree。**Windows 上 git worktree + junction 是危险组合**，以后遇到同类目录先查
`LinkType`。

## 5. 删除范围与历史保全

删除前逐一验证可达性，确保删分支不等于丢内容：

| 分支 | tip | 删除后是否仍可从 main 到达 |
|---|---|---|
| `plugin-system-v0-9` | `8fab039` | **是**（合并提交的第一父） |
| `plugin-manifest-discovery` | `8e89787` | **是**（在 `b08532a` 历史内） |
| `plugin-system` | `a453427` | **否** —— 按决定不留 tag |

`plugin-system` 上只有 4 个提交不在任何保留历史里：`001f050`、`6803f46`、`10f850a`、`a453427`。
核对后确认：**内容一个文件都不缺**（`git diff --diff-filter=A plugin-system-v0-9 a453427` = 0），
失去的只是这 4 个提交的历史叙事。当前它们作为对象仍存在于本地（`git cat-file -e` 为真），
但已不可从 `main` 到达，会在 gc 后被回收。

同时发现：**`origin` 与 `upstream` 是同一个仓库**——两个 URL 的 `ls-remote` 返回完全相同的 refs
（含 `refs/pull/1/head`），说明 `Khk-NL/GithubStarsManager_PluginSystem` 是该仓库的旧名，
GitHub 做了重定向。因此"推两个远程"实际只需推一次，删远程分支同理。

## 6. 最终状态

| 项 | 结果 |
|---|---|
| 本地分支 | 只有 `main`（`721eb31`，tracking `upstream/main`） |
| 远程 refs | 只有 `refs/heads/main` + GitHub 的 `refs/pull/1/head` |
| worktree | 只有一个：`D:\Code\GithubStarsManager\GithubStarsManager`，在 `main` |
| 版本 | `0.10.0` |
| 工作区 | 干净 |
| 门禁 | boundaries / typecheck / lint 通过；vitest 与基线同一集合（16 个既有 jsdom 超时） |

`main` 现在包含：PR #352–#356、完整插件平台、Repository Health 事实（v0.9.0）、
可安装资产识别（v0.10.0）。

## 7. 遗留物（未处理，等你决定）

1. `origin` 与 `upstream` 同指一个仓库，建议只留一个并改名为 `origin`：
   `git remote remove origin && git remote rename upstream origin`
2. 远程仍有 `refs/pull/1/head`（PR #1，来自已删除的 `plugin-manifest-discovery`）。
   分支已删、内容已并入 main，不再需要时可在 GitHub 关闭该 PR。
3. 工作区根目录 `D:\Code\GithubStarsManager\` 下还有一个**没有任何提交的空仓库 `.git`**
   和 `.codex/`。前者建议确认后删除，否则在该目录里执行 git 命令会作用到它而不是真正的仓库。

## 8. 下一阶段

阶段 4：`feat: add batch repository URL extraction`（开发守则 §6 前半）——
Paste → Extract → Normalize → Deduplicate，把文本 / Markdown / JSON 里的
`owner/repo` 与 GitHub URL 归一化为候选并去重。联网校验与预览界面按守则的 PR 拆分留到后续阶段。
