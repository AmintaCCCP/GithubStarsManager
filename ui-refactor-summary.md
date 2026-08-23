# GitHubStarsManager 全量前端 UI 迁移说明

## 目标与边界

本次改造将前端呈现层统一迁移到 **shadcn/ui 风格组件 + Radix Primitives**。未改变 store、业务流程、同步流程、AI 分析流程、仓库动作或用户权限逻辑；`src/services/githubListsApi.ts` 仅补充 GraphQL 响应的显式类型、nullable 节点过滤和内部请求签名清理，网络请求语义保持不变。

## 迁移内容

| 层级 | 完成内容 |
| --- | --- |
| 共享基础层 | 新增 `cn` 工具，以及 Button、Badge、Card、Input、Textarea、Label、Separator、Dialog、AlertDialog、DropdownMenu、Tabs、Tooltip、Popover、Checkbox、Switch、Slider、RadioGroup、Select、ScrollArea、Avatar。 |
| 弹层与通知 | Modal、ConfirmDialog、Toast、ReadmeModal、SyncModeChoiceModal、SettingsPanel、SearchShortcutsHelp、UpdateChecker、批量还原/分类/过滤器/Release/Gist/仓库编辑弹层统一使用 Radix 管理的焦点、遮罩、Escape、portal 和状态动画。 |
| 表单控件 | NumberInput、SliderInput、StepperInput、登录页、搜索栏、Discovery、AI、网络、WebDAV、备份、数据管理、分类、同步、MCP、向量搜索、诊断等设置面板统一使用共享 Input/Textarea/Select/Checkbox/Switch/Slider/RadioGroup。 |
| 页面与卡片 | Header、SettingsPanel、RepositoryList、RepositoryCard、ReleaseTimeline、ForkTimeline、SearchBar、DiscoverySidebar、各类 Repository/Release/Gist/Fork/Subscription 卡片、更新提示、批量操作栏及轻量操作按钮全部接入共享 Button/Badge/Tooltip 等原语。 |
| 交互与主题 | 补充 Radix `data-state` 关闭动画 token；保留现有主题令牌、深色模式、中英文切换、响应式布局、键盘行为、禁用态和外部链接语义。 |
| 回归兼容 | ReadmeModal 和 ForkTimeline 已移除不可见的原生 select 兼容层，用户可见选择器完全由 Radix Select 渲染；对应测试已改用可见 combobox/option 交互。DataManagementPanel 的导出选择由 Radix Checkbox 驱动，并将既有 DOM 查询适配到 Radix 的 `data-state=checked`。 |

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| `npm run build` | 通过；Vite 生产构建完成且无 chunk warning。当前 legacy 入口为 2,789.46 kB，独立 checker 实测 2,724.09 KiB，低于 3,000 KiB hard budget；Vite warning threshold 独立为 3,072 KiB。 |
| `npm run test:run` | 本地验证通过；31 个测试文件、332 个测试全部通过，无 React/Radix act、Unhandled 或 Warning 输出。PR-head CI 当前未执行该命令。 |
| ReadmeModal/ForkTimeline 定向回归 | ReadmeModal 与 ForkTimeline 既有回归通过；另完成 ReadmeModal + RepositoryCard Radix 交互定向回归，13/13 通过且无 warning。 |
| `npx tsc -b` | 通过；在依赖完整安装状态下无 TypeScript 诊断。 |
| `git diff --check` | 通过。 |
| 生产预览 | 通过；登录壳层、语言切换、主题切换、token 输入、连接入口和 GitHub 外链正常渲染，控制台无 React/Radix/资源加载错误。 |

说明：早期 release evidence 曾记录 29 个测试文件、326 个测试，这是迁移前基线。当前提交新增的回归测试已纳入最终门禁，因此最终准确总数为 31 个测试文件、332 个测试，后续记录均以此为准。

最新 CodeRabbit full review 的 9 个 findings 已完成修复：所有受影响的 compact Button controls 均明确使用 ghost/icon sizing；SearchBar sort menu 已迁移到 Radix radio menu semantics；SortAlgorithmTooltip 使用受控 Popover 支持触摸设备；ReleaseTimeline、ReleaseSourceSettingsModal、NetworkPanel、WebDAVPanel、AIConfigPanel、GeneralPanel 和 MenuManagementPanel 的 accessible names、group associations、padding 和变体已补齐；Discovery topic/platform 请求 key、BulkAction live region、semantic color tokens、duplicate utilities 和 Settings tab ref stability 已同步修正。

## 依赖变更

`package.json` 与 `package-lock.json` 已补充 Radix Primitives 以及 `class-variance-authority`、`clsx`、`tailwind-merge` 等 shadcn/ui 常用样式依赖。`tailwindcss-animate` 已注册到 Tailwind 配置；`check:bundle-size` 与 CI 独立 step 对 3,000 KiB hard budget 执行失败保护。正式代码中已删除一次性迁移脚本，测试专用的 jsdom Radix API polyfill 位于 `src/test/setup.ts`，不进入生产代码路径。

## 交付文件

完整补丁见 `ui-refactor.patch`；浏览器运行态记录见 `final-browser-verification.md`。


最新 CodeRabbit full review 的 findings 已完成收尾：ToastPrimitive.Root 恢复 `pointer-events-auto`；RepositoryCard Release 菜单测试直接激活已定位的 `menuitem`；ReleaseTimeline 的视图、显示模式和最新版本三个手写菜单统一迁移到共享 Radix DropdownMenu，自动获得 menuitem、roving focus、Escape 和 outside-dismiss 语义，同时保持原有模式切换、store 更新与分页重置逻辑；ReleaseTimeline 仓库分组与 ReleaseSourceSettingsModal 仓库列表补齐 `aria-expanded`/`aria-controls`；Tailwind `text-quaternary` 与 `brand.hover` 恢复固定透明度。未修改 store、services、API、同步流程或业务动作。

本轮验证再次通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；本轮 legacy 入口 2,787.81 kB，独立 checker 为 2,722.47 KiB，0 vulnerabilities。


8f9a544 后最新 CodeRabbit review 的 9 个 actionable comments、1 个 outside-diff comment 和 2 个 nitpick 已全部完成：AssetFilterManager filter chips 恢复紧凑 Button dimensions；ForkCard、ReleaseCard、CategoryPanel 的 dark/hover 对比度统一到 semantic tokens；ReleaseCard asset row 使用 h-auto 并清除 invalid active utility；RepositoryCard 与 RepositoryList 的编辑/AI controls 使用共享 ghost/icon Button；RepositoryList progress fill 使用 primary、pause/stop 清理重复 dark backgrounds；MenuManagement switch 使用 p-0；StarSyncPanel RadioGroup 关联 heading；SearchResultStats 与 githubListsApi 完成重复 token/type 清理。业务行为与同步链路不变。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,788.32 kB，独立 checker 2,722.97 KiB，0 vulnerabilities。


1a04720 后最新 CodeRabbit review 的所有 comments 已完成修复：ReleaseCard、SubscriptionRepoCard、ReadmeModal 与 CategoryEditModal 的紧凑 controls 覆盖 shared Button 默认尺寸或背景；ReleaseSourceSettingsModal 的 repository-list region 使用 React `useId` 保证多实例唯一；ReleaseTimeline 的 Pre-release 文本、数字分页补齐可交互与 aria 语义；WebDAV RadioGroup、CategoryEdit icon grid 完成 accessible naming；success badge 颜色加深；UpdateChecker 错误布局改为纵向容器。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证再次通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,788.24 kB，独立 checker 2,722.90 KiB，0 vulnerabilities。


2de4162 后最新 CodeRabbit review 的全部 comments 已完成修复：ReleaseTimeline repository disclosure 仅使用 phrasing spans；Discovery、Fork、Gist、Release、Repository controls 补齐共享 Button variants、compact size 与分页 aria 语义；SortAlgorithmTooltip 修复 Popover focus loop；Select primitives 增加 side-aware offsets、退出动画和长标签裁剪；Readme fragment、githubListsApi 类型、query-string 类型依赖、CI 重复 bundle step 与 Vite warning threshold 完成维护清理；Discovery loading indicator 与 success badge 使用有效且具备对比度的 semantic colors。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,790.01 kB，独立 checker 2,724.63 KiB，0 vulnerabilities。


3544acf 后最新 CodeRabbit review 的所有 comments 已完成修复：Markdown checkbox 使用原生 input；RepositoryCard selection、ReleaseTimeline repository header、MCP/Network switches 覆盖 shared Button 默认布局；RepositoryEdit tag remove、RepositoryList display mode、SearchBar sort order 补齐 accessible names；ScrollArea 与 Separator 使用 semantic theme tokens；DiscoveryView 清理冗余 ternary。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,790.35 kB，独立 checker 2,724.95 KiB，0 vulnerabilities。


ff639df 后最新 CodeRabbit review 的所有 comments 已完成修复：BackupPanel 长内容操作按钮覆盖 shared Button 默认高度；NetworkPanel RPC secret visibility 与 DiagnosticLogsPanel close/tabs 使用明确的 ghost/icon 变体；DiscoveryView topic channel 跳过通用空频道自动请求，由 topic/platform 专用 effect 负责请求去重。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,790.39 kB，独立 checker 2,725.00 KiB，0 vulnerabilities。


1a91b5d 后最新 CodeRabbit review 的所有 comments 已完成修复：DiscoveryView 的 topic/platform 请求去重改为 token-aware，避免未登录初始化时错误记录 applied pair；McpSettingsPanel switch 补 accessible name，refresh、visibility 与 copy actions 使用明确的 ghost/outline variants；RepositoryList AI analysis popup 使用实例唯一 id，并关联 trigger 的 `aria-expanded`/`aria-controls`。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,790.74 kB，独立 checker 2,725.34 KiB，0 vulnerabilities。


57ee771 后最新 CodeRabbit review 的全部 comments 已完成修复：BulkRestore/RepositoryList radio options 补齐 accessible names；DiscoveryView 清理卸载 tab refs；ForkTimeline 底部分页与 DiagnosticLogs/BulkAction controls 统一 shared variants 和 compact sizing；SearchBar 输入高度调整；MenuManagement switch 修正 knob 对齐；VectorSearch、Settings、Backend、DataManagement 长内容按钮增加 h-auto。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,791.81 kB，独立 checker 2,726.38 KiB，0 vulnerabilities。


a5175b9 后最新 CodeRabbit review 的 comments 已处理：FilterModal 保存按钮使用 primary-derived hover surface；ReleaseCard RPC 资产行使用 ghost variant；测试证据说明明确区分迁移前 29/326 历史基线与当前新增回归测试后的最终 31/329 总数。未改变任何业务逻辑、store、services、API 或同步流程。

本轮验证通过：31 个测试文件、329 个测试全部通过，lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,791.76 kB，独立 checker 2,726.34 KiB，0 vulnerabilities。

debbaa4 后本轮 CodeRabbit 遗留问题已处理：SettingsPanel tabpanel 直接使用当前 `displayTab` 的本地化 `aria-label`，避免移动端引用 CSS-hidden 的 desktop tab id；DataManagementPanel 导出选项改为受控 React state，导入文件控件使用 `peer sr-only` 并保留 focus-visible ring；VectorSearchSettings Auto Detect 改用实例 ref，index-mode buttons 支持纵向布局和长文本换行；GistView、DiagnosticLogsPanel、McpSettingsPanel 补齐输入 accessible names；ReleaseTimeline 清除按钮与搜索输入完成 compact spacing；SearchBar 新增 history/suggestion dropdown blur/click 交互测试。业务逻辑、store、services、API 和同步流程保持不变。
本轮验证通过：31 个测试文件、331 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,792.90 kB，独立 checker 2,727.45 KiB，0 vulnerabilities。
4e23650 后最新 CodeRabbit full review 的 11 个 actionable comments 与 5 个 nitpick 已全部处理：BilingualMarkdownRenderer、LoginScreen、DiagnosticLogsPanel 状态按钮补齐 `aria-pressed`；BulkCategorizeModal 建立 heading/group label 关联；ErrorBoundary 详情按钮补 `aria-expanded`；ReleaseSourceSettingsModal 多行 source row 加入 `h-auto`；AIConfigPanel 与 DataManagementPanel 的 Checkbox 使用显式 id/label 关联，中性 controls 使用 ghost；VectorSearchSettings 模型来源/索引内容建立 group accessible names，clipboard 命令 await 并捕获失败反馈，搜索阈值改用共享 SliderInput；共享 Slider/SliderInput 强制 thumb label；SettingsPanel 仅在 standalone 分支早退；Toast close 使用固定短 label，Provider/Viewport 提升到 DialogProvider 单例并由 Viewport 统一堆叠。业务逻辑、store、services、API 和同步流程保持不变。
本轮验证通过：31 个测试文件、331 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,793.55 kB，独立 checker 2,728.08 KiB，0 vulnerabilities。
cd5f693 后最新 CodeRabbit full review 的 5 个 inline actionable、3 个 outside-diff functional findings 与 7 个 nitpick 已全部处理：DataManagementPanel import types 正确映射 `uiSettings` 组并清理 username focus tokens；GistView/GistDetailModal/SearchDemo 的选择按钮补齐 `aria-pressed`；SearchBar 星标范围通过 NumberInput id 与 htmlFor 建立 label 关联；ReadmeModal 回顶按钮补 label 与 square sizing；ReleaseTimeline 收起内容从 accessibility tree 移除；DiagnosticLogsPanel event-type popup 暴露 `aria-haspopup`/`aria-expanded`/`aria-controls` 与选项状态；GeneralPanel 恢复 React import；McpSettingsPanel、NetworkPanel 使用 semantic tokens 与 shared switch variants；BackendPanel、AIConfigPanel 恢复状态差异色；alert-dialog 补齐 fade/zoom 动画 utilities；Toast warning/info 使用 semantic tokens。业务逻辑、store、services、API 和同步流程保持不变。
本轮验证通过：31 个测试文件、331 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,794.55 kB，独立 checker 2,729.06 KiB，0 vulnerabilities。
4926cde 后最新 CodeRabbit full review 的 6 个 inline actionable、1 个 outside-diff functional finding 与 5 个 nitpick 已全部处理：SearchBar 主搜索框补持久化本地化 aria-label；CategorySidebar 两个 desktop 分类按钮补 aria-pressed；BulkCategorizeModal 错误块使用 destructive tokens；DiscoveryView topic refresh 增加 request version 与当前 topic/platform guard，阻止 stale response 更新仓库、分页、刷新时间和 loading；FilterModal 关键词删除按钮改为 compact icon；DiagnosticLogsPanel 改为带 label 的 toggle-button group；VectorSearchSettings deploy guide 将 heading 移出 Button 并补 expanded/controls 语义；StepperInput 支持本地化 labels 和 Pointer Events 长按处理；CategoryEditModal/CategoryPanel 共享 validateCategoryName；CategoryPanel、ListsPushIndicator、Toast、MCP、Network 等剩余 raw palette 统一为 semantic tokens；Toast exit animation 改为 controlled open state 并延迟卸载；alert-dialog 动画和前轮修复保持有效。业务逻辑、store、services、API 和同步流程保持不变。
本轮验证通过：31 个测试文件、331 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,794.70 kB，独立 checker 2,729.20 KiB，0 vulnerabilities。
b2c21c9 后最终 CodeRabbit full review 的 6 个 actionable 与 4 个 nitpick 已全部处理：DataManagementPanel confirmation content 增加 `confirmation.type` guard；NetworkPanel 两个手写开关迁移到共享 Radix Switch；VectorSearchSettings 剩余 gray border/text/focus/surface utilities 统一为 semantic tokens；MarkdownRenderer code-copy 与 zoom overlay controls 明确 Button type/variant/size/compact dimensions；GistCard/GistView 修正 dark primary text；BackendPanel status icons 继承 pill 状态色；SubscriptionRepoCard GitHub 外链阻止父卡片点击冒泡；SliderInput 让 slider 与 marks 共用 flex-1 轨道列；StepperInput 使用 Pointer Events 并限制主鼠标键、支持本地化 labels；ui-refactor-summary.md 的 Vite warning threshold 修正为 3,072 KiB。业务逻辑、store、services、API 和同步流程保持不变。
最终验证通过：31 个测试文件、331 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,793.88 kB，独立 checker 2,728.40 KiB，0 vulnerabilities。
38302c1 后 round-19 CodeRabbit full review 的 6 个 actionable、3 个 outside-diff、2 个 duplicate 与 9 个 nitpick 已全部处理：RepositoryList AI action popup 迁移到共享 DropdownMenu；RepositoryCard 以 ref 记录卡片内 outside-dismiss pointerdown 并新增 pointerdown→click 回归测试；StepperInput 使用 render-time latest value ref、主鼠标键过滤和 unmount cleanup；SearchShortcutsHelp 使用 DialogTrigger 与内置 close；DiscoveryView 在无 token 时不记录 applied topic；MCP port 使用 MCP_DEFAULT_PORT 并校验 1–65535；DataManagementPanel 导入类型过滤 bookkeeping keys、取消按钮使用 outline、confirmation content 增加 type guard；BulkRestore 三组 RadioGroup 关联 section headings；SettingsPanel inactive tabs 移除无效 aria-controls；RepositoryEditModal 拒绝真实 `none` 分类、使用 onKeyDown 并清理冲突 dark borders；CategoryPanel RadioGroup 标题使用 label/htmlFor；SyncModeChoiceModal 抽取共享 option class；共享 alert-dialog/dialog 复用 buttonVariants 并补齐 fade/zoom；MarkdownRenderer 控件统一 ghost/icon compact API；GistCard/GistView、BackendPanel、SubscriptionRepoCard、SliderInput 与 UI 走查证据同步修正。业务逻辑、store、services、API 和同步流程保持不变。
最终验证通过：31 个测试文件、332 个测试全部通过；lint、TypeScript、生产构建、3,000 KiB bundle budget、diff check 和生产依赖安全审计均通过；legacy 入口 2,794.15 kB，独立 checker 2,728.67 KiB，0 vulnerabilities。

## Round-20 CodeRabbit remediation

基于 `8520fc1` 后于 2026-08-22 06:29:03Z 完成的 full review，本轮已完成 5 个 actionable comments 及相关 nitpick 的最小范围收尾：DialogContent 支持本地化 `closeLabel` 与长内容滚动；ReadmeModal 持续挂载以交由 Radix 管理 close/focus restore；McpSettingsPanel 使用共享 Radix Switch，端口编辑仅在合法范围内更新并在 blur 时回退默认值；VectorSearchSettings deploy guide 常驻 hidden region，dimensions、README max chars 与 Top K 仅在 blur 时校验；DataManagement import types 正确识别 UI settings，导出与删除按钮使用 shared Button variants；Discovery refresh/stop actions 使用 ghost/icon compact controls；RepositoryCard 和 StepperInput 的 pointer/lifecycle handling 分别补齐 stale dismissal reset 与 `useLayoutEffect` latest-value 同步。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮定向回归为 6 个测试文件/21 个测试全部通过；完整质量门禁为 31 个测试文件/332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,793.82 kB，独立 checker 2,728.35 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本记录对应的代码修复尚待提交推送及后续 CodeRabbit full review；只有 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-21 CodeRabbit remediation status

2026-08-22 07:19:18Z 的 subsequent CodeRabbit full review 报告 6 条 inline findings，均已完成最小范围修复：GistView sort trigger 增加 `aria-expanded`；RepositoryEditModal 将 legacy `custom_category="none"` 归一化为空分类；DiagnosticLogsPanel 详情视图按钮补充 `aria-pressed`；VectorSearchSettings 切换 embedding source 时同步 displayed dimensions draft；DropdownMenuContent/SubContent 使用 `bg-popover` 与 `text-popover-foreground`；发布状态记录修正为与实际 commit 和 review 状态一致。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮定向回归为 6 个测试文件/21 个测试全部通过；全量质量门禁为 31 个测试文件/332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,793.84 kB，独立 checker 2,728.36 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-22 CodeRabbit remediation status

2026-08-22 07:36:40Z 的 subsequent CodeRabbit full review 报告 4 条 inline findings，均已完成最小范围修复：BilingualMarkdownRenderer display controls 使用 `size="sm"` 与紧凑高度；ReadmeModal 目录和字体 icon controls 使用 `size="icon"` 与方形尺寸；DiscoveryView 的时间范围、主题和编程语言 SelectTrigger 补充本地化 accessible names；StarSyncPanel 显式导入 React namespace 以支持 `React.FC` 类型引用。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮定向回归为 6 个测试文件/21 个测试全部通过；完整质量门禁为 31 个测试文件/332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.04 kB，独立 checker 2,728.56 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-23 CodeRabbit remediation status

2026-08-22 07:49:32Z 的 subsequent CodeRabbit full review 报告 1 条 inline accessibility finding：BulkCategorizeModal 的分类失败提示已增加 `role="alert"`，确保 `onCategorize` rejection 能被屏幕阅读器播报。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮定向及全量测试均通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.05 kB，独立 checker 2,728.57 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-24 CodeRabbit remediation status

2026-08-22 08:06:26Z 的 subsequent CodeRabbit full review 报告 2 条 inline findings，均已完成最小范围修复：DiscoveryView 对 stale topic load-more 请求始终清除该请求建立的 `discoveryIsLoadingMore` 标志，同时保留 current-request guard 保护 stale data writes；SearchBar AI search Button 增加本地化 `aria-label`，确保窄屏隐藏文字时仍有 accessible name。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮完整门禁通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.13 kB，独立 checker 2,728.65 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-25 CodeRabbit remediation status

2026-08-22 08:21:18Z 的 subsequent CodeRabbit full review 报告 3 条 inline findings，均已完成最小范围修复：ReleaseSourceSettingsModal visibility toggle 补充 `aria-pressed`；DiagnosticLogsPanel event-type options 使用 neutral `ghost` variant 与 `justify-start`；VectorSearchSettings 的 dimensions、README max chars 和 Top K blur handlers 只接受整数，同时保留原有 fallback 与范围 clamp。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮完整门禁通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.18 kB，独立 checker 2,728.70 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-26 CodeRabbit remediation status

2026-08-22 08:36:42Z 的 subsequent CodeRabbit full review 报告 2 条 inline findings，均已完成最小范围修复：bundle checker 现在检查所有 `-legacy-*.js` 资源而非只匹配 `index-legacy-*`；Header 桌面导航补充 `aria-pressed`，移动菜单项补充 `aria-current="page"`。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮完整门禁通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.24 kB，独立 checker 2,728.75 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-27 CodeRabbit remediation status

2026-08-22 08:49:06Z 的 subsequent CodeRabbit full review 报告 1 条 inline finding：RepositoryList 的 pause/stop/grid/list controls 已补齐明确紧凑高度，icon-only controls 使用 `size="icon"` 与 `p-0`，保留原有 handlers、labels、variants 和 responsive behavior。未改变 store、services、API、同步流程、AI 行为或数据流。

本轮完整门禁通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记。lint 通过且 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过，legacy 入口 2,794.18 kB，独立 checker 2,728.70 KiB；`git diff --check` 通过；生产依赖审计为 0 vulnerabilities。

本节为已完成本地验证、待提交推送并触发下一次 CodeRabbit full review 的 draft 记录；只有后续 review 明确报告 `Actionable comments posted: 0` 后，才能宣称审查收尾完成。

## Round-30 audit findings and visual unification

本轮处理 PR review 的 4 个审计问题并完成两处视觉统一：SyncModeChoiceModal 显式导入 React namespace 以支持 `React.FC` 类型引用；确认 `.linear-card`/`.linear-panel`/`.input-base`/`.btn-ghost`/`.btn-primary` 的重复未分层定义已在 `12b8f13` 清理，仅保留 `@layer components` 单一定义；light/dark 两套主题的 `--accent` 与 `--secondary`/`--muted` 区分（light `210 40% 92%`、dark `217.2 32.6% 21%`），使 chip/filter/release-action 等 hover 与 active 状态产生可见变化；ReleaseCard 展开后的"下载文件"资产列表容器改为浅色内嵌表面（light `bg-background/70`、dark `bg-foreground/[0.06]`）；GistCard 列表项标题从 `text-lg` 对齐全站卡片标题规范 `text-base`；DataManagementPanel 危险区域改用共享 Card/Button 规范（默认 card 表面 + destructive 边框着色、标准标题与正文层级、shared destructive 按钮 size），移除双重内边距。业务逻辑、store、services、API 和同步流程保持不变。

本轮完整门禁通过：31 个测试文件、332 个测试全部通过，测试日志无 React/Radix `Warning`、`act` 或 `Unhandled` 标记；lint 通过；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过（legacy 入口 checker 2,718.26 KiB）；`git diff --check` 通过；生产依赖审计 0 vulnerabilities。

## Round-29 shadcn visual parity remediation

本轮根据实际生产预览与官方 shadcn/ui 基线完成视觉收尾：全局 helper 改用 semantic tokens；入口、App shell、登录页、Header、CategorySidebar、SearchBar、RepositoryCard、SettingsPanel、GistView 和 settings panels 统一标准字体层级、控件密度、`rounded-md`/`rounded-xl`、薄边框、popover/card surface、focus ring 和 light/dark 对比度。共享 Button 对齐官方 h-9/h-8/h-10/icon 尺寸与状态，Card 对齐官方 flex/gap/py/title/content 视觉结构；专用图片查看器 overlay 颜色保持不变。所有修改均为 presentation/accessibility 层，业务 stores、services、API、同步流程、AI 行为和数据流保持不变。

实际生产预览验证了 light/dark 登录页面可以正常挂载并呈现，定向回归 17 tests passed；本地完整门禁为 31 test files / 332 tests passed（本地 `npm run test:run`，不是 PR-head CI 测试证据），ESLint 和 TypeScript 通过，生产 build 与 3,000 KiB bundle hard budget 通过（legacy 2,791.81 kB；checker 2,726.38 KiB），`git diff --check` 通过，生产依赖审计 0 vulnerabilities，测试日志无 React/Radix warnings、act 或 unhandled markers。

该记录对应待提交和推送的本地 round-29 draft。CodeRabbit 的 actionable zero 仍须由下一次针对最终 commit 的 completed full review 明确验证。

References: [shadcn/ui component documentation](https://ui.shadcn.com/docs/components)；[official Button/Card source](https://raw.githubusercontent.com/shadcn-ui/ui/main/apps/v4/registry/new-york-v4/ui/button.tsx)。

## Round-31 unread snapshot fix, expanded-card tone swap and full PR audit

本轮完成三项工作。其一是 Release 展开态色调互换：展开的 release 卡片容器改用柔和表面（light `hsl(var(--muted))`、dark `--card` 叠加 16% foreground 提亮），"下载文件"资产列表容器成为更浅的内嵌层（light `bg-background` 接近白色、dark `bg-foreground/[0.08]`），层级为 卡片 < 展开容器 < 资产列表，两套主题均符合规范。

其二是修复"仅显示未读"下展开带"资产已更新"标识的 Release 会立即消失的缺陷：根因是 `markReleaseAsRead` 清空 `updated_asset_ids` 时生成新的 `releases` 数组，触发未读快照 effect 以 `releases` 身份变化为信号整体重建，把刚标记的条目从快照剔除。修复将重建信号改为可见 release 的 ID 集合签名（`subscribedReleaseKey`），badge 清除不改变 ID 集合故不再触发重建；真实的数据增删或来源变更仍会正常刷新快照。新增 `ReleaseTimeline.test.tsx` 回归测试复刻真实 store 行为（标记已读并清空 badge 产生新数组），断言展开后条目保留且资产行可见；该测试对修复前代码失败（经 `git stash` 验证）。

其三是对整个 PR diff（116 个文件）做完整自审：store/services、共享 UI 原语与构建配置、应用组件三个切片并行审计，加上本轮改动文件的逐一复核。已修复的发现：仓库分组折叠容器改用 `.collapse-hidden`（延迟 visibility 过渡）替代此前引入的 `hidden` 属性——后者以 display:none 打断了 grid-rows 折叠/展开动画，新方案在保留动画的同时维持折叠内容不可聚焦、不进入无障碍树的可达性目标；`AlertDialogContent` 对齐 `DialogContent` 补齐 `max-h-[85vh] overflow-y-auto` 滚动保护；RepositoryCard 描述 Tooltip 的 `<p>` 触发器补回 `tabIndex={0}`，恢复键盘可达性；DiscoveryView 频道切换恢复 `role="tablist"`/`role="tab"` 与 `aria-selected` 语义；`vite.config.ts` 的 `chunkSizeWarningLimit` 从 3072 降至 2900，使 Vite 告警真正先于 3,000 KiB 硬预算触发；移除 PR 中失去唯一引用的孤儿字体资产 `public/fonts/`（Inter woff2/css 共约 135 KB）；`tailwindcss-animate` 从 dependencies 移至 devDependencies（仅构建期使用）。审计确认为本 PR 早前评审轮次有意设计、保持不变的项：DataManagementPanel 导入由整体替换改为按键合并与 id 去重（03ef497，响应 follow-up review）、分类名 `none` 保留名策略（round-19 及后续 review 轮次）、NetworkPanel 代理/RPC 开关同步后端设置并支持回滚。其余切片经核查未发现 P0-P2 缺陷：services 层为纯空值加固与死参数清理，Radix 接线、cva 组合、Fast Refresh、Toast 生命周期、ConfirmDialog 单次决议均验证无误。

本轮完整门禁通过：32 个测试文件、333 个测试全部通过（含新增回归测试）；lint 通过 0 errors/0 warnings；TypeScript 无诊断；生产构建与 3,000 KiB bundle budget 通过（legacy 入口 checker 2,718.57 KiB）；`git diff --check` 通过；生产依赖审计 0 vulnerabilities。业务逻辑、store、services、API 和同步流程除上述已记录的早前轮次设计外保持不变。

Round-31 补充（响应后续 CodeRabbit inline findings）：AIConfigPanel 表单通知容器按通知类型补齐 `role="alert"`/`role="status"` 活动区域；GistCard 外链锚点补 `inline-flex items-center justify-center` 使 h-8/w-8 方形命中区生效；DebugModeIndicator 与 ErrorBoundary 的共享 Button 显式声明 `variant="secondary"`，使 className 中的自定义背景/前景完全压过 variant 默认值且无 dark:/hover: 残留覆盖。未改变业务逻辑、store、services、API 和同步流程。
