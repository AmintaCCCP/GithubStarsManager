# 阶段日志 4：Batch Repository URL Extraction（v0.11.0）

- 日期：2026-09-20
- 分支：`main`
- 依据：[`开发守则.md`](../../../开发守则.md) §6 与 [`docs/plans/2026-09-17-product-roadmap.md`](../plans/2026-09-17-product-roadmap.md) §6
- 提交：`feat: add batch repository URL extraction`
- 代码量：4 个文件、+约 900 行（含 70 个用例）→ minor 提升至 `0.11.0`

> 编号说明：阶段 3 是 main 统一（仓库治理，无源码变更）。本阶段是第 4 个阶段日志。

## 1. 范围：只做流程的前四步

守则 §6 把批量导入拆成两件事，本次只做前一件：

```text
Paste → Extract → Normalize → Deduplicate │ Resolve GitHub metadata
                                          │ Enrich with local/Core data
                                          │ Review → Batch actions
        ← 本阶段（纯函数、无 IO）→          ← 后续阶段（联网 + 预览界面）
```

守则的推荐 PR 列表里 `feat: add batch repository URL extraction` 与
`feat: add batch repository import preview` 本来就是两条，因此这里不碰 UI 与网络。

## 2. 模型

[`src/types/repositoryImport.ts`](../../src/types/repositoryImport.ts) 按守则的
`ImportedRepositoryCandidate` 落地，并把 `status` 与 `reason` 的取值域**一次定义完整**，
避免下一阶段再改模型：

| 字段 | 说明 |
|---|---|
| `status` | `pending` / `resolved` / `duplicate` / `invalid` / `unavailable` |
| `reason` | Extract 阶段产出 `not-a-repository-url`、`malformed-slug`；Resolve 阶段产出 `not-found`、`private-or-inaccessible`、`renamed`、`rate-limited`；Enrich 阶段产出 `already-exists` |
| `originalValue` | 始终保留原始片段，批量导入的每一步都要可回溯 |
| `previousFullName` | 守则要求仓库转移时显示 `old → new` 且**不得静默修改**，旧名字单独留在这里 |

三处附加字段（守则模型之外，已在注释里标明）：`matchedBy`（`github-url` / `bare-slug`）、
`confidence`（`high` / `low`）、`alreadyStarred`（守则本就有，这里在调用方提供本地集合时即填充）。

## 3. 归一化规则

URL 形态覆盖：scheme 可省、`www.` 可省、尾斜杠、`.git` 后缀、`#fragment`、`?query`、
Markdown 链接与尖括号包裹、句末标点。子路径一律丢弃——`/releases/tag/v1.2.0`、
`/releases/download/v1/app.exe`、`/issues/12`、`/pull/34`、`/tree/main/src`、`/blob/main/a.ts`、
`/actions`、`/wiki`、`/discussions/5`、`/commit/abc`、`/compare/a...b`、`/stargazers`、
`/graphs/commit-activity`、`/security/advisories`、`/packages/1` 全部归一到所属仓库。

站点功能路径**不静默丢弃**，而是标成 `invalid` 并给出原因，让用户看得见：
`github.com/orgs/…`、`/topics/…`、`/settings/…`、`/features/…`、`/sponsors/…`、
`/marketplace/…`、`/apps/…`、`/trending`、以及只有一段的 `github.com/<owner>`。

## 4. 裸 `owner/repo`：不假装有把握

散文里 `A/B` 与仓库 slug 天然同形，词表不可能穷尽。这里的做法是**三层抑制 + 一律降级**：

1. 常见代码目录名：`src/utils`、`docs/plans`、`lib/core`……
   （本仓库自己的文档里就充满这类片段，不排除会大量误报）
2. 常见文件扩展名：`src/utils.ts`、`docs/guide.md`……
3. 常见词组与单字符段：`and/or`、`TCP/IP`、`read/write`、`24/7`、`i/o`……

被接受的裸写法一律标 `confidence: 'low'`，由预览阶段的用户确认。另外先扫 URL 并把匹配区间
**等长屏蔽**，再扫裸写法，否则 `…/releases/tag/v1.2.0` 里的 `releases/tag`、`tag/v1.2.0`
会被当成两个仓库。

## 5. JSON

递归扫描**所有字符串值**（不扫键名——键名是字段名，扫了只会产生噪声）。
两层上限：`maxValues`（默认 20000）、`maxDepth`（默认 32）。错误码区分致命与截断：

- 致命：`json-parse-failed`、`input-too-large` → `candidates` 为空；
- 截断：`too-many-values`、`depth-limit-exceeded` → **保留已扫描到的结果**并附上提示。

最后一条是刻意选择：输入很大时把已经识别出来的仓库全丢掉，对用户毫无帮助。

## 6. 去重

键为仓库名（大小写不敏感），首次出现的保留原大小写并记 `pending`，其后每次追加一条
`duplicate`（各自带自己的 `originalValue`）。`invalid` 片段同样按原始片段去重，
避免同一段坏 URL 刷屏。

## 7. 写测试时抓到的两个真实缺陷

1. **`owner/..` 被当成句子标点**：尾部标点清洗（为了 `…/repo.` 这种句末句号）会把 `..` 整段吃掉，
   变成"段数不足 → not-a-repository-url"。改成先按去标点解析，**仅当段数因此不足两段时**
   才用未去标点的原串重试，于是 `owner/repo.` 与 `owner/..` 各自得到正确结果。
2. **候选顺序不反映输入顺序**：最初先扫完全部 URL 再扫裸写法，于是第 3 行的 `owner/repo`
   被排到第 4 行的 URL 后面。改为两类匹配各带 `index` 合并排序后再去重——
   预览列表的顺序必须与用户粘贴的顺序一致，否则很难核对。

## 8. 验证

| 关卡 | 结果 |
|---|---|
| `node scripts/check-boundaries.cjs` | 通过 |
| `npm run typecheck` | 通过 |
| `npm run lint` | 通过 |
| `npx vitest run` | 106 文件 / 1132 用例，16 失败 —— 与基线**同一集合**（4 个重型 jsdom 组件测试的 5s 超时） |
| 本阶段新增用例 | [`repositoryImport.test.ts`](../../src/utils/repositoryImport.test.ts) 70 例全通过 |

用例覆盖：21 种 URL 子路径形态、11 种不可用路径（含原因码）、Markdown/尖括号/代码块包裹、
句末标点、10 类裸写法误报的拒绝、URL 屏蔽、大小写不敏感去重、重复 invalid 去重、
JSON 递归/非字符串/键名/解析失败/值上限/深度上限、空输入、超长输入、`alreadyStarred`、
以及守则里那段示例的端到端结果。

## 9. 刻意未做

- 不联网：不校验仓库是否存在、不获取元数据、不判断私有/改名/限流（Resolve 阶段）。
- 不做预览界面与批量操作（Star / 分类 / Tag / 订阅 Release / 导出 / 发送到插件 / 进入 My Apps）。
- 不实现 `clipboard` 与 `file` 来源（类型里已预留，复用同一套提取逻辑）。
- 不读 store：`toLocalRepositoryNameSet` 只做纯函数转换，本地数据由调用方传入。

## 10. 下一阶段

阶段 5：`feat: add batch repository import preview` —— 预览工作台，
在提取结果之上做 Resolve（GitHub 元数据 + 失败项区分 + 改名/转移展示）与 Enrich
（已 Star / 已在 My Apps），再提供批量操作。
