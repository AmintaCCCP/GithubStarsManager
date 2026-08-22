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


8f9a544 后最新 CodeRabbit full review 报告 9 个 actionable comments、1 个 outside-diff comment 和 2 个低风险 nitpick，现已全部修复：AssetFilterManager 的 preset/custom filter 主控与 edit/delete icon actions 恢复紧凑 h-auto/h-6/w-6 尺寸；ForkCard workflow 展开态改用可读的 dark primary 文本；ReleaseCard RPC asset rows 增加 h-auto，Release notes actions 清理冲突 dark tokens 并移除无效 active utility；RepositoryCard inline edit 与 RepositoryList AI 分析触发器改为共享 ghost/icon Button；RepositoryList progress fill 改为 primary 并清理 pause/stop 重复 dark backgrounds；CategoryPanel 保存 hover 恢复 primary 对比度；MenuManagement visibility switch 增加 p-0；StarSyncPanel RadioGroup 关联 scope heading；SearchResultStats 清理重复 border token；githubListsApi 提取 UserListNode 命名类型。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：`npm run lint` 通过且 0 errors/0 warnings；`npx tsc -b` 无诊断；31 个测试文件、329 个测试全部通过；`npm run build` 与 bundle budget 通过，legacy 入口 2,788.32 kB，独立 checker 2,722.97 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


1a04720 后最新 CodeRabbit full review 的 7 个 actionable comments、1 个 outside-diff comment 和 2 个 nitpick 已全部完成：ReleaseCard 头部四个紧凑 controls、SubscriptionRepoCard 三个 icon actions 与 ReadmeModal 目录 rows 均覆盖 shared Button 默认尺寸；CategoryEditModal icon grid 补 `variant="ghost"`/`aria-pressed` 并清理重复 dark utilities；ReleaseSourceSettingsModal 使用 `useId` 生成每个 PaginatedRepoList 实例唯一的 `aria-controls`/region id；ReleaseTimeline 两处 Pre-release 文本可点击切换，数字分页补 `type="button"` 与当前页 `aria-current`；WebDAV active-config RadioGroup 补 accessible name；success badge 和 `.pill-success` 改为 emerald-700；UpdateChecker 将错误提示与检查按钮置于单列容器。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,788.24 kB，独立 checker 2,722.90 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


2de4162 后最新 CodeRabbit full review 的 10 个 actionable comments、1 个 outside-diff comment、1 个 duplicate 和 6 个 nitpick 已全部完成：ReleaseTimeline 仓库分组 Button 改为仅含 phrasing spans；DiscoverySidebar channel 补 `aria-pressed`，DiscoveryView refresh 改为 ghost/icon 并修复 `bg-green-6000`；ForkCard/ForkTimeline/GistEditor/ReleaseCard/ReleaseTimeline/RepositoryCard controls 统一补齐 compact size、ghost/outline variant、分页 `aria-current` 与 dark contrast；SortAlgorithmTooltip 阻止 Popover 自动抢焦点；共享 Select 增加 label overflow clamp、按 side 的 popper offset 和 closed animation；ReadmeModal 清理冗余 fragment；WebDAV/StarSync 等既有 accessible naming 保持有效；githubListsApi 复用 `GitHubListSummary`；移除 deprecated `@types/query-string` 及 lockfile 元数据；CI 删除重复 bundle step；Vite warning limit 调整为 3072 kB。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,790.01 kB，独立 checker 2,724.63 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


3544acf 后最新 CodeRabbit full review 的 6 个 actionable comments 与 2 个 nitpick 已全部完成：MarkdownRenderer 的 Markdown checkbox 恢复原生 `input`，非 checkbox 继续使用共享 Input；RepositoryCard selection 与 ReleaseTimeline repository header 覆盖 Button 默认尺寸；RepositoryEditModal tag 删除、RepositoryList display RadioGroup、SearchBar sort order 补齐 accessible names；McpSettingsPanel 与 NetworkPanel 自定义 switch 重置 `justify-start`/`p-0`；ScrollArea thumb 与 Separator 统一 semantic color tokens；DiscoveryView 删除重复 `isDesktopSafeMode` ternary。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,790.35 kB，独立 checker 2,724.95 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


ff639df 后最新 CodeRabbit full review 的 2 个 actionable comments 与 1 个 duplicate 已全部完成：BackupPanel 备份/恢复按钮补 `h-auto`；NetworkPanel RPC secret visibility 与 DiagnosticLogsPanel close/tabs 明确使用 ghost/icon 语义；DiscoveryView channel-switch effect 跳过 topic 自动 fetch，由 topic/platform effect 独立负责首次和组合变更请求，避免重复请求。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,790.39 kB，独立 checker 2,725.00 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


1a91b5d 后最新 CodeRabbit full review 的 3 个 actionable comments 与 1 个 outside-diff comment 已全部完成：DiscoveryView 在 githubToken 缺失时不再记录 topic/platform applied pair，token 初始化后可正常发起一次请求；McpSettingsPanel 的 switch 补 accessible name，refresh、visibility、token/URL/JSON copy actions 明确使用 ghost/outline variants；RepositoryList AI analysis popup 使用 React `useId`，trigger 补 `aria-expanded`/`aria-controls`，popup 补对应 id。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,790.74 kB，独立 checker 2,725.34 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


57ee771 后最新 CodeRabbit full review 的 6 个 actionable comments 已全部完成：BulkRestoreModal 与 RepositoryList 的 RadioGroupItem 补齐 option text id/aria-labelledby；DiscoveryView tab ref 在卸载时删除 stale entry；ForkTimeline 底部分页与上部分页统一处理 ellipsis、ghost variant、type 和 aria-current；DiagnosticLogsPanel debug/refresh/load-more 使用 ghost；BulkActionToolbar 固定尺寸 actions 使用 ghost/icon size 与 p-0；SearchBar 输入调整为 h-12；MenuManagement switch 加入 justify-start；VectorSearchSettings、SettingsPanel、BackendPanel 和 DataManagementPanel 长内容 Button 加入 h-auto。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,791.81 kB，独立 checker 2,726.38 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。


a5175b9 后最新 CodeRabbit review 的 3 个 comments 已处理：FilterModal 保存按钮 hover 改为 primary-derived surface 并清理冲突的重复 dark utilities；ReleaseCard RPC 资产行明确使用 ghost variant；ui-refactor-summary 补充说明 29/326 为迁移前历史基线，当前新增回归测试后的最终准确总数为 31 个测试文件、329 个测试，未用错误基线覆盖实际结果。业务逻辑、store、services、API 和同步流程保持不变。

本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、329 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,791.76 kB，独立 checker 2,726.34 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。
debbaa4 后本轮 CodeRabbit 遗留问题已处理：SettingsPanel tabpanel 改为直接使用当前 `displayTab` 的本地化 `aria-label`，避免移动端引用 CSS-hidden 的 desktop tab id；DataManagementPanel 导出选项改为受控 React state，导入文件控件改为可见焦点 ring 的 `peer sr-only`；VectorSearchSettings Auto Detect 改用实例 ref，index-mode buttons 支持纵向布局与长文本换行；GistView、DiagnosticLogsPanel、McpSettingsPanel 补齐输入控件 accessible names；ReleaseTimeline 清除按钮与搜索输入完成 compact spacing；SearchBar 新增 history/suggestion dropdown 的 blur/click 交互测试。未改变任何业务逻辑、store、services、API 或同步流程。
本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、331 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,792.90 kB，独立 checker 2,727.45 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。
4e23650 后最新 CodeRabbit full review 的 11 个 actionable comments 与 5 个 nitpick 已全部处理：BilingualMarkdownRenderer、LoginScreen、DiagnosticLogsPanel 的状态按钮补齐 `aria-pressed`；BulkCategorizeModal 建立 heading/group label 关联；ErrorBoundary 详情按钮补 `aria-expanded`；ReleaseSourceSettingsModal 多行 source row 加入 `h-auto`；AIConfigPanel 与 DataManagementPanel 的 Checkbox 使用显式 id/label 关联，中性 controls 使用 ghost；VectorSearchSettings 的模型来源/索引内容建立 group accessible names，clipboard 命令 await 并捕获失败反馈，搜索阈值改用共享 SliderInput；共享 Slider/SliderInput 强制 thumb label；SettingsPanel 仅在 standalone 分支早退；Toast close 使用固定短 label，Provider/Viewport 提升到 DialogProvider 单例并由 Viewport 统一堆叠。未改变任何业务逻辑、store、services、API 或同步流程。
本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、331 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,793.55 kB，独立 checker 2,728.08 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。
cd5f693 后最新 CodeRabbit full review 的 5 个 inline actionable、3 个 outside-diff functional findings 与 7 个 nitpick 已全部处理：DataManagementPanel import types 正确映射 `uiSettings` 组并清理 username focus tokens；GistView/GistDetailModal/SearchDemo 的选择按钮补齐 `aria-pressed`；SearchBar 星标范围通过 NumberInput id 与 htmlFor 建立 label 关联；ReadmeModal 回顶按钮补 label 与 square sizing；ReleaseTimeline 收起内容从 accessibility tree 移除；DiagnosticLogsPanel event-type popup 暴露 `aria-haspopup`/`aria-expanded`/`aria-controls` 与选项状态；GeneralPanel 恢复 React import；McpSettingsPanel、NetworkPanel 使用 semantic tokens 与 shared switch variants；BackendPanel、AIConfigPanel 恢复状态差异色；alert-dialog 补齐 fade/zoom 动画 utilities；Toast warning/info 使用 semantic tokens。未改变任何业务逻辑、store、services、API 或同步流程。
本轮门禁结果：lint 0 errors/0 warnings；TypeScript 无诊断；31 个测试文件、331 个测试全部通过；生产构建与 bundle budget 通过，legacy 入口 2,794.55 kB，独立 checker 2,729.06 KiB，低于 3,000 KiB hard budget；`git diff --check` 通过；`npm audit --omit=dev --audit-level=high` 为 0 vulnerabilities。
