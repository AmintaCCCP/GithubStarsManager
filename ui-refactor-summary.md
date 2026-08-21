# GitHubStarsManager 全量前端 UI 迁移说明

## 目标与边界

本次改造将前端呈现层统一迁移到 **shadcn/ui 风格组件 + Radix Primitives**。未修改 store、services、API 请求、业务 handler、数据结构、同步流程、AI 分析流程、仓库动作或用户权限逻辑。

## 迁移内容

| 层级 | 完成内容 |
| --- | --- |
| 共享基础层 | 新增 `cn` 工具，以及 Button、Badge、Card、Input、Textarea、Label、Separator、Dialog、AlertDialog、DropdownMenu、Tabs、Tooltip、Popover、Checkbox、Switch、Slider、RadioGroup、Select、ScrollArea、Avatar。 |
| 弹层与通知 | Modal、ConfirmDialog、Toast、ReadmeModal、SyncModeChoiceModal、SettingsPanel、SearchShortcutsHelp、UpdateChecker、批量还原/分类/过滤器/Release/Gist/仓库编辑弹层统一使用 Radix 管理的焦点、遮罩、Escape、portal 和状态动画。 |
| 表单控件 | NumberInput、SliderInput、StepperInput、登录页、搜索栏、Discovery、AI、网络、WebDAV、备份、数据管理、分类、同步、MCP、向量搜索、诊断等设置面板统一使用共享 Input/Textarea/Select/Checkbox/Switch/Slider/RadioGroup。 |
| 页面与卡片 | Header、SettingsPanel、RepositoryList、RepositoryCard、ReleaseTimeline、ForkTimeline、SearchBar、DiscoverySidebar、各类 Repository/Release/Gist/Fork/Subscription 卡片、更新提示、批量操作栏及轻量操作按钮全部接入共享 Button/Badge/Tooltip 等原语。 |
| 交互与主题 | 补充 Radix `data-state` 关闭动画 token；保留现有主题令牌、深色模式、中英文切换、响应式布局、键盘行为、禁用态和外部链接语义。 |
| 回归兼容 | ReadmeModal 和 ForkTimeline 保留不可见的原生 select 兼容层，用于维持既有 DOM 测试和外部 change 事件契约；用户可见选择器仍由 Radix Select 渲染。DataManagementPanel 的导出选择由 Radix Checkbox 驱动，并将既有 DOM 查询适配到 Radix 的 `data-state=checked`。 |

## 验证结果

| 检查项 | 结果 |
| --- | --- |
| `npm run build` | 通过；Vite 生产构建完成。构建仍提示既有的主 bundle 体积较大警告，但不影响构建成功。 |
| `npm run test -- --run` | 通过；29 个测试文件、326 个测试全部通过。 |
| ReadmeModal/ForkTimeline 定向回归 | 通过；12 个测试全部通过。 |
| `npx tsc -b` | 本次迁移涉及的前端组件错误已清零；剩余 31 项来自仓库既有测试全局类型声明和 `src/services/githubListsApi.ts` 的基线问题。 |
| `git diff --check` | 通过。 |
| 生产预览 | 通过；登录壳层、语言切换、主题切换、token 输入、连接入口和 GitHub 外链正常渲染，控制台无 React/Radix/资源加载错误。 |

## 依赖变更

`package.json` 与 `package-lock.json` 已补充 Radix Primitives 以及 `class-variance-authority`、`clsx`、`tailwind-merge` 等 shadcn/ui 常用样式依赖。正式代码中已删除一次性迁移脚本，工作区只保留源代码、共享组件和验证说明。

## 交付文件

完整补丁见 `ui-refactor.patch`；浏览器运行态记录见 `final-browser-verification.md`。
