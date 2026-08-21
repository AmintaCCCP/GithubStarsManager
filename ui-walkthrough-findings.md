# UI 走查记录

## 仓库页（生产预览）

生产预览已切换到 shadcn 默认语义色体系：页面背景、卡片、工具栏、输入框、侧栏和排序器使用 background/card/muted/accent/border 变量，未选中分类为透明，当前分类保留 secondary active 状态。

首次截图发现 AI 搜索按钮在空查询禁用态因旧 `.ui-button-primary` CSS 覆盖了 shadcn `text-primary-foreground`，出现灰色按钮文字对比度不足。已将 `.ui-button-primary` 和 `.btn-primary` 改为使用 `hsl(var(--primary))` 与 `hsl(var(--primary-foreground))`。修复后按钮文案“AI搜索”可见，仍按空查询逻辑正确禁用，并保持在搜索工具栏内部。

仓库页当前未出现页面横向溢出；分类导航的 active/hover 层级和搜索工具栏控件边界清晰。后续需要继续走查登录页、Discovery、Gist、Release、Fork、设置各面板，以及弹层、下拉菜单、Tooltip、主题切换和键盘交互。

## 设置页与 AI 配置页

通用设置页的侧栏 Tabs、语言 RadioGroup、更新按钮和联系按钮层级清晰，卡片边框与 muted 背景符合 shadcn 结构。AI 配置空状态卡片结构正常，但走查发现“添加 AI 配置”以及多个设置页 primary 操作按钮仍显式组合了 `bg-primary text-white`；在 shadcn 默认 dark 主题中 primary 是浅色，导致文字不可读。已批量替换为 `text-primary-foreground`，destructive 操作替换为 `text-destructive-foreground`，并准备重新构建复查。

重新构建并刷新后，AI 配置页的“添加 AI 配置”按钮文案、图标和背景均可见，确认 `text-primary-foreground` 修复有效。下一步测试新增配置表单中的 Select、Slider、Checkbox、RadioGroup、保存与取消交互。

新增 AI 配置表单的接口格式 Radix Select 已成功打开：弹出层使用 card/popover 背景、border、shadow 和清晰的 checked item，选项列表未溢出表单边界。后续继续验证切换选项、Checkbox 和取消操作。

交互复测：Select 从 OpenAI Chat Completions 切换到 OpenAI Responses 后，接口预览地址同步更新为 `/responses`，说明表单行为保持正常。勾选“使用自定义提示词”后，Radix Checkbox 显示 checked 状态，默认提示词自动填入 Textarea，“恢复默认提示词”按钮出现，Textarea 可见且未出现布局溢出。

Slider 复测显示 Radix Slider aria 值初始为 `1`，范围为 `1–10`；已通过新增 `src/components/ui/SliderInput.test.tsx` 完成真实交互回归。pointer 路径使用 userEvent 在 mock 的 Root 宽度 100、clientX=60 边界点击，`aria-valuenow` 从 `1` 更新为 `6`；keyboard 路径聚焦 thumb 后发送 ArrowRight，`aria-valuenow` 从 `1` 更新为 `2`。两项测试均通过且无 React/Radix warning。

Slider DOM 结构检查确认 Radix Root 为 `relative flex w-full ... flex-1`，track 使用 `h-2 bg-secondary`，thumb 使用 shadcn `h-5 w-5 border-2 border-primary bg-background`；组件结构和 pointer/keyboard 用户路径均已验证。

取消新增 AI 配置后页面回到空状态，未保存内容未残留。WebDAV 空状态页的主按钮、卡片、图标和提示文案均可见，布局未溢出；各设置 Tabs 在切换后保持统一 active 状态。

备份恢复面板走查：WebDAV 未配置时，备份/恢复按钮正确禁用且呈现 muted 状态；“包含密钥” Switch 点击后 thumb 与 track 状态更新正常，卡片和说明区域没有溢出。
