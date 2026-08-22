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
| `npm run build` | 通过；Vite 生产构建完成且无 chunk warning。当前 legacy 入口为 2,789.46 kB，独立 checker 实测 2,724.09 KiB，低于 3,000 KiB hard budget；Vite warning threshold 独立为 3,500 KiB。 |
| `npm run test:run` | 通过；31 个测试文件、329 个测试全部通过，无 React/Radix act、Unhandled 或 Warning 输出。 |
| ReadmeModal/ForkTimeline 定向回归 | ReadmeModal 与 ForkTimeline 既有回归通过；另完成 ReadmeModal + RepositoryCard Radix 交互定向回归，13/13 通过且无 warning。 |
| `npx tsc -b` | 通过；在依赖完整安装状态下无 TypeScript 诊断。 |
| `git diff --check` | 通过。 |
| 生产预览 | 通过；登录壳层、语言切换、主题切换、token 输入、连接入口和 GitHub 外链正常渲染，控制台无 React/Radix/资源加载错误。 |

说明：早期 release evidence 曾记录 29 个测试文件、326 个测试，这是迁移前基线。当前提交新增的回归测试已纳入最终门禁，因此最终准确总数为 31 个测试文件、329 个测试，后续记录均以此为准。

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
