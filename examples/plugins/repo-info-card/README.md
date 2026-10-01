# Repo Info Card example (V1.4 弹窗动作)

通过宿主当前配置的 AI Provider,把单个仓库的元信息与 README 整理成一张可分享的
单文件 HTML 信息卡,并提供预览、复制代码、复制/保存 PNG 截图。

## 安装与入口

1. **设置 → 插件 → 安装本地插件**,选择本目录,确认权限后启用。
2. 在任意仓库卡片的 `…` 菜单 → **插件操作** → **生成仓库信息卡**。宿主会在弹窗中
   打开本插件的页面(Manifest 中 `repositoryActions[].opensPage` 指向的页面),并随
   `plugin-page:init` 一次性下发所点击仓库的元数据与 README 正文。
3. 本页面也可以从 **设置 → 插件 → 打开页面** 进入;该入口没有仓库上下文,页面会
   提供一个搜索框,通过 `repositories.search` / `repositories.get` 选择仓库(此时
   没有 README,只用元信息)。

## 弹窗内可用选项

- **风格**:TE 纸面 / 暗色仪器 / 极简黑白。风格只影响插件自带的 CSS 调色板,
  切换风格不需要重新调用 AI。
- **画幅**:1:1(1200×1200)、5:2(1500×600)、3:4(1200×1600),导出 PNG 为 @2x。
- **卡片语言**:跟随界面 / 中文 / English。

## 工作方式

- 插件持有版式 CSS 与系统提示词(≤2000 字符,受 `ai.generate` 参数上限约束);
  AI 只输出卡片的 body 标记。插件会对 AI 输出做净化(移除 script/style/图片、
  `on*` 事件属性与 `javascript:` URL),并校验 `id="card"` 根元素。
- 预览渲染在 shadow DOM 中,与页面自身样式隔离。
- 截图通过 SVG `foreignObject` + `<canvas>` 光栅化为 @2x PNG(纯文本卡片,不依赖
  外部资源),随后:
  - `clipboard.writeImage`(权限 `clipboard:write`)复制到剪贴板;
  - `downloads.saveFile`(权限 `downloads:create`)弹出宿主原生保存对话框。
- 复制代码通过 `clipboard.write` 输出完整的单文件 HTML(可直接在浏览器打开)。

本插件无 `worker.js`:它是「页面 + 弹窗动作」的纯页面型插件,不启动 Node Worker。
