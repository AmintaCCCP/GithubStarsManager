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

## 预览缩放

预览区上方是缩放条:

- `−` / `+` 按 1.25 倍逐级缩放,比例限制在「适应窗口」的 0.2× ~ 6×;
- 百分比按钮与 **适应窗口** 回到自适应比例;
- **实际大小** 切到 100%(卡片按导出像素显示);
- 在预览区按住 `Ctrl` / `⌘` 滚动滚轮也可缩放;放大后预览区出现滚动条。

预览只改变显示比例,导出的 PNG 始终按画幅的 @2x 尺寸生成。

## 工作方式

- 插件持有版式 CSS 与系统提示词(≤2000 字符,受 `ai.generate` 参数上限约束);
  AI 只输出卡片的 body 标记。插件会对 AI 输出做净化(移除 script/style/图片、
  `on*` 事件属性与 `javascript:` URL),并校验 `id="card"` 根元素。
- **提示词携带 README 全文**:宿主 `ai.generate` 正文上限放宽到 160000 字符后,
  README 原样(不清洗、不改写、不摘要)以 `README (full text):` 放进提示词;
  只有超过该上限的极少数 README 才会被截断,此时标注
  `README (full text, truncated at the prompt limit):`,状态栏也会提示已截断。
  提示词同时要求 AI 以 README 为准,一行描述与 topics 只用来补缺。
- 预览渲染在 shadow DOM 中,与页面自身样式隔离。**卡片样式通过
  Constructable Stylesheet(`adoptedStyleSheets`)注入**,因为页面 CSP 是
  `style-src plugin-page://<id>`(不含 `unsafe-inline`),动态插入 `<style>`
  元素会被拦截、卡片会退化成浏览器默认样式;同时调色板变量挂在 `#card` 上,
  而不是 `:root`(后者在 shadow tree 中匹配不到任何元素)。
- 截图通过 SVG `foreignObject` + `<canvas>` 光栅化为 @2x PNG(纯文本卡片,不依赖
  外部资源),随后:
  - `clipboard.writeImage`(权限 `clipboard:write`)复制到剪贴板;
  - `downloads.saveFile`(权限 `downloads:create`)弹出宿主原生保存对话框。
- 复制代码通过 `clipboard.write` 输出完整的单文件 HTML(可直接在浏览器打开)。

本插件无 `worker.js`:它是「页面 + 弹窗动作」的纯页面型插件,不启动 Node Worker。
