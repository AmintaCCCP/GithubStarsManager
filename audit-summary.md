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
| `npm run build` | 通过；legacy 入口 2,783.25 kB；独立 checker 实测 2,718.02 KiB，低于 3,000 KiB hard budget，无 chunk warning |
| `git diff --check` | 通过 |
| `npm audit --omit=dev --audit-level=high` | `found 0 vulnerabilities` |
| ReadmeModal + RepositoryCard 定向回归 | 通过，13/13；无测试 warning |
| SliderInput + StepperInput 交互回归 | 通过，3/3；pointer/keyboard 与 keyboard-click 语义均验证，无 warning |

## 交付与审查状态

首轮 CodeRabbit findings 已全部修复并通过上述质量门禁。第二次 `@coderabbitai full review` 报告的 2 个 outside-diff findings 已修复：SubscriptionRepoCard 的确认取消 Star 按钮已使用 destructive 语义色，ForkTimeline 的 page-size 与 target-branch SelectTrigger 已关联可见 label。最终 full review 又发现 SubscriptionRepoCard 卡片容器仍使用 `bg-white`，现已改为 `bg-card` 并清理重复 dark token。最后一轮 lint、tsc、326 个测试、build、diff check 与安全审计均通过。最终 full review 随后报告 11 个 actionable comments：CategoryEditModal/GistEditorModal 表单标注、GistView 清除按钮、Modal/DialogDescription 策略、ReadmeModal 关闭按钮、RepositoryEditModal 保留名校验、RepositoryList/SearchDemo ghost 变体、AIConfig/Backend/AlertDialog/StepperInput 无障碍或键盘行为，以及 ui-walkthrough Slider 证据和 vite bundle budget nitpick；此前 11 个 findings 已全部修复并完成针对性回归。Modal/SettingsPanel/ReadmeModal 使用明确的 Dialog description policy，表单和 Radix 控件均补齐 label/id，`none` sentinel 已受保护，StepperInput 已支持 keyboard click，Slider pointer/keyboard 证据已记录，bundle hard budget 已由独立 checker 和 CI step 执行。最新 full review 的 10 个 findings 已全部修复：CategoryPanel 新增/inline edit 字段已补齐 accessible names，新增/编辑均保护 `none`；AssetFilterManager、ReleaseSourceSettingsModal、ReleaseTimeline 和 SearchDemo 的非主操作统一到语义 Button variants；BulkActionToolbar icon-only actions 已本地化命名；ReadmeModal 标题恢复 Radix 自动关联；AIConfigPanel 与 NetworkPanel 表单字段已完成 label/id/aria-labelledby 绑定；RepositoryCard 测试恢复 store fixture；StepperInput 测试改为真实 userEvent Enter keyboard activation。
