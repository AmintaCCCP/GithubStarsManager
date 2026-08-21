# 审计与质量门禁摘要

## 代码与类型审计

本轮改造将前端呈现层统一到 **shadcn/ui 风格组件与 Radix Primitives**，并清理共享原语的 Fast Refresh 非组件导出、未使用 Hook 依赖、测试文件隐式依赖和 GraphQL 响应隐式类型。`src/services/githubListsApi.ts` 的改动仅限于 GraphQL wire 类型、nullable `nodes`/`description` 的安全归一化和内部请求签名清理；网络请求语义、store、同步流程、AI 分析、仓库动作和权限逻辑均保持不变。

CodeRabbit 首轮报告中的共享 Button 变体、粘连 Tailwind token、重复 dark-mode 类、nullable GraphQL nodes、`tailwindcss-animate` 注册、语义色 alpha placeholder、border token、Slider thumb accessible name、Tooltip Portal、Dialog 标题、Select accessible labeling、ConfirmDialog 双触发、RadioGroup accessible name、DropdownMenu 语义 role 以及冗余 outside-click 逻辑均已核对并修复。ReleaseTimeline、RepositoryEditModal、CategoryPanel、WebDAVPanel、DiscoveryView、SearchBar 和全局 legacy CSS 的剩余 findings 也已完成收尾。

## 设计系统与无障碍审计

全局主题使用 shadcn 默认语义变量：`background`、`foreground`、`card`、`popover`、`primary`、`secondary`、`muted`、`accent`、`destructive`、`border`、`input`、`ring` 和 `radius`。主操作使用 `primary/primary-foreground`，中性工具栏和 icon-only 控件使用 `ghost`，次级预设使用 `outline`；空状态刷新按钮、缓存状态和深色模式文本均已检查实际背景下的对比度。

Radix Dialog、AlertDialog、Select、DropdownMenu、Tooltip、Slider、RadioGroup、Checkbox、Switch、Tabs 和 Popover 均使用共享封装。ReadmeModal 与 ForkTimeline 的 native select 仅作为既有 DOM/change 兼容层并从辅助技术树隐藏，用户可见控件由 Radix 渲染；测试已改为验证真实的 combobox/option 用户路径。RepositoryCard 的菜单测试已改用 `menuitem` 语义，并以 userEvent 验证 pointer、keyboard、card whitespace、outside pointer 和 Escape 行为。

## 安全审计

`npm audit --omit=dev --audit-level=high` 报告 `found 0 vulnerabilities`。仓库没有使用 `react-router-dom`，未使用依赖及其传递漏洞来源已移除，没有执行破坏性路由升级。

## UI 与交互走查

生产预览已走查仓库页、设置页、AI 配置页、新增 AI 表单、WebDAV 空状态、备份恢复面板、主题共享控件、导航 active 状态和 AI 搜索空查询 disabled 状态。Radix Select 打开与切换、Checkbox 展开默认提示词、Textarea、Switch checked 状态、取消表单、空状态恢复、仓库操作菜单和 README 语言切换均已回归验证。测试专用的 jsdom Pointer Capture 与 `scrollIntoView` no-op polyfill 只位于 `src/test/setup.ts`，不进入生产代码路径。

## 最终质量门禁

| 检查项 | 结果 |
|---|---|
| `npm run lint` | 通过，0 errors、0 warnings |
| `npx tsc -b` | 通过，无 TypeScript 诊断 |
| `npm run test:run` | 基线套件为 29 个文件/326 个测试；最终提交新增 SliderInput 与 StepperInput 回归后为 31 个文件/329 个测试，全部通过且无 React/Radix act、Unhandled 或 Warning 输出 |
| `npm run build` | 通过；legacy 入口 2,789.46 kB；独立 checker 实测 2,724.09 KiB，低于 3,000 KiB hard budget，无 chunk warning |
| `git diff --check` | 通过 |
| `npm audit --omit=dev --audit-level=high` | `found 0 vulnerabilities` |
| ReadmeModal + RepositoryCard 定向回归 | 通过，13/13；无测试 warning |
| SliderInput + StepperInput 交互回归 | 通过，3/3；pointer 精确命中 Radix Slider.Root 后验证 `1→6`，keyboard 验证 `1→2`，Stepper keyboard-click 亦通过，无 warning |

## 交付与审查状态

首轮 CodeRabbit findings 已全部修复并通过上述质量门禁。第二次 `@coderabbitai full review` 报告的 2 个 outside-diff findings 已修复：SubscriptionRepoCard 的确认取消 Star 按钮已使用 destructive 语义色，ForkTimeline 的 page-size 与 target-branch SelectTrigger 已关联可见 label。最终 full review 又发现 SubscriptionRepoCard 卡片容器仍使用 `bg-white`，现已改为 `bg-card` 并清理重复 dark token。最后一轮 lint、tsc、326 个测试、build、diff check 与安全审计均通过。最终 full review 随后报告 11 个 actionable comments：CategoryEditModal/GistEditorModal 表单标注、GistView 清除按钮、Modal/DialogDescription 策略、ReadmeModal 关闭按钮、RepositoryEditModal 保留名校验、RepositoryList/SearchDemo ghost 变体、AIConfig/Backend/AlertDialog/StepperInput 无障碍或键盘行为，以及 ui-walkthrough Slider 证据和 vite bundle budget nitpick；此前 11 个 findings 已全部修复并完成针对性回归。Modal/SettingsPanel/ReadmeModal 使用明确的 Dialog description policy，表单和 Radix 控件均补齐 label/id，`none` sentinel 已受保护，StepperInput 已支持 keyboard click，Slider pointer/keyboard 证据已记录，bundle hard budget 已由独立 checker 和 CI step 执行。最新 full review 的 10 个 findings 已全部修复：CategoryPanel 新增/inline edit 字段已补齐 accessible names，新增/编辑均保护 `none`；AssetFilterManager、ReleaseSourceSettingsModal、ReleaseTimeline 和 SearchDemo 的非主操作统一到语义 Button variants；BulkActionToolbar icon-only actions 已本地化命名；ReadmeModal 标题恢复 Radix 自动关联；AIConfigPanel 与 NetworkPanel 表单字段已完成 label/id/aria-labelledby 绑定；RepositoryCard 测试恢复 store fixture；StepperInput 测试改为真实 userEvent Enter keyboard activation。新一轮 review 还指出 SearchBar 同步菜单仍使用手写 role/outside-click/keydown；将用已存在的 DropdownMenu primitives 替换，仅移除 menu state/ref/effect，不改变三种同步模式及确认流程。最新 review 另指出 BulkRestoreModal 三组 standalone Checkbox 缺少 heading association，DiscoveryView 清空 topic 时 refresh effect 被 truthiness guard 跳过，GistEditorModal public Checkbox 缺少 accessible name，SearchDemo 示例卡片需要恢复垂直布局类；这 4 项现已完成最小范围修复，SearchBar 也已迁移到 DropdownMenu primitives。当前提交已通过最终 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 和安全审计，准备触发下一轮 full review。最新 full review 的 7 个 findings 也已全部完成最小范围修复：ReleaseTimeline 两个 Pre-release switch 命名、NetworkPanel Proxy Type RadioGroup 关联、VectorSearchSettings 三个 toggle 迁移到共享 Switch、Dialog calc 空格、DropdownMenu 子菜单 Portal、Slider 单值类型契约、Slider pointer 测试命中实际 Radix Root，以及 RepositoryEditModal/CategoryEditModal 四个表单控件的本地化 accessible names。修复后 31 个测试文件/329 个测试再次通过，lint、tsc、build、bundle budget、diff check 和安全审计均通过，当前提交待下一轮 full review。最新 full review 的 4 个 findings 也已全部完成最小范围修复：BulkActionToolbar/BulkCategorizeModal/SearchBar/GistView 中性操作统一显式使用 ghost variant，ForkCard 中文来源标签改为“派生自”，CategoryPanel RadioGroup 关联仓库归类 heading，AlertDialog calc width 使用合法 Tailwind 表达式；VectorSearchSettings 的 API/Worker/README 控件也已补齐 label/id 和 visibility Button accessible names。当前 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 与安全审计均再次通过，准备推送并触发下一轮 full review。最新 full review 的 3 个 findings 也已完成最小范围修复：PopoverContent 改用 bg-popover/text-popover-foreground semantic tokens，BulkCategorizeModal 分类按钮补充 aria-pressed，RepositoryEditModal add-tag icon-only Button 补充本地化 aria-label；VectorSearchSettings 的 API/Auth visibility controls 已使用 ghost 与显式 icon dimensions，index-mode buttons 使用 outline，deploy guide trigger 使用 ghost 与 h-auto。当前 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 和安全审计均再次通过，准备提交并触发下一轮 full review。最新 full review 的 8 个 findings 也已完成最小范围修复：MarkdownRenderer 行号正向测试断言具体 1/4 文本；DataManagementPanel 的删除确认与导入预览迁移到共享 AlertDialog/Dialog，并关联 GitHub username label/id；SearchBar 高级过滤 chips 补充 aria-pressed；SubscriptionRepoCard 清理重复 class 分支与 dark background；ForkTimeline/ReadmeModal 删除重复 hidden native select 并改用 Radix Select API；CategoryEditModal 对 emoji source 去重、memoize icon grid 并清理重复 dark utilities；DiscoveryView topic refresh 使用 applied value guard；GistCard 操作按钮显式使用 ghost；ReadmeModal 移除重复 Escape/overflow/focus lifecycle 并统一 retry primary tokens；VectorSearchSettings option groups 补充 aria-pressed；SettingsPanel mobile tab ids 使用独立前缀；SyncModeChoiceModal 明确首个 action 的初始 focus。当前 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 和安全审计均再次通过，准备提交并触发下一轮 full review。最新 full review 的 6 个 findings 也已完成最小范围修复：SearchBar filter toggle 关联 advanced panel 并暴露 aria-expanded；ForkTimeline 底部分页补齐本地化 aria-label；MarkdownRenderer/ReleaseTimeline 中性操作统一 ghost，ReleaseTimeline 省略号改为非交互文本；RepositoryCard、RepositoryEditModal、ForkCard、BilingualMarkdownRenderer、ReadmeModal 和 RepositoryList 补齐 ghost、compact square dimensions 与多行布局覆盖；CategoryPanel、WebDAVPanel 和 ReadmeModal icon-only 操作补齐本地化 aria-label；ui-refactor-summary 与实际移除 hidden native select 的代码一致。当前 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 和安全审计均再次通过，准备提交并触发下一轮 full review。最新 full review 的 9 个 findings 也已完成最小范围修复：NetworkPanel compact switch/auth/visibility controls 统一 ghost 与紧凑尺寸；SearchBar filter controls 补齐 ghost，sort menu 迁移到 DropdownMenuRadioGroup/RadioItem；ReleaseTimeline 和 ReleaseSourceSettingsModal 的中性 controls 统一 ghost，Pre-release switches 清除默认 padding，items-per-page SelectTrigger 补齐 accessible name；SortAlgorithmTooltip 改用受控 Popover 保留触摸设备说明；BulkRestore 使用 semantic primary tokens；SettingsPanel 清理卸载 tab ref；BulkCategorize/CategoryEdit 清理重复 utilities 并修正保存 hover 对比度；AssetFilter destructive action 清理冲突 dark tokens；BulkAction confirmation tooltip 添加 live region；Discovery request key 同时追踪 topic/platform；ReleaseSource/WebDAV/AIConfig/General 补齐 label/id/aria-labelledby；MenuManagement reorder controls 使用 compact ghost icon buttons。当前 31 个测试文件/329 个测试、lint、tsc、build、bundle budget、diff check 和安全审计均再次通过，准备提交并触发下一轮 full review。


最新 22:03Z full review 的 inline findings 与 review body 中的 duplicate/nitpick 已全部完成最小范围修复：ToastPrimitive.Root 增加 `pointer-events-auto`；RepositoryCard Release 菜单测试直接 focus 已定位的 `menuitem` 再 Enter；ReleaseTimeline 的视图、显示模式和最新版本三组手写 overlay 菜单迁移到共享 Radix DropdownMenu，保留原有 store 更新与分页重置；仓库分组及 ReleaseSourceSettingsModal 仓库列表补齐 `aria-expanded`/`aria-controls`；Tailwind `text-quaternary` 与 `brand.hover` 恢复 0.7/0.9 固定 alpha。其余业务逻辑、store、services、API 和同步流程未改变。

本轮门禁结果：31 个测试文件、329 个测试全部通过；`npm run lint`、`npx tsc -b`、`npm run build`、`npm run check:bundle-size`、`git diff --check` 与 `npm audit --omit=dev --audit-level=high` 均通过。最新 build 的 legacy 入口为 2,787.81 kB，独立 checker 实测 2,722.47 KiB，低于 3,000 KiB hard budget；安全审计为 0 vulnerabilities。
