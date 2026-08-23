# 最终浏览器验证

验证时间：2026-08-22 UTC（用户时区为 2026-08-23）；构建预览地址：`http://127.0.0.1:4174/`；视口：`1440 × 1000`；浏览器使用隔离 profile 与本地 visual-review fixture，不使用真实凭据，也不写入真实业务数据。此次 fixture 至少包含 1 个仓库、1 个 Release（6 个资产行）、1 个 Gist、1 个 Fork 以及 20 个自定义分类，走查通过应用现有同步、订阅、刷新和卡片点击流程加载数据。

## 关键几何与交互证据

| 验证项 | 实测结果 | 截图/报告 |
|---|---|---|
| README 弹窗 | dialog `x=150, y=75, width=1130, height=850, right=1280, bottom=925`；相对于 client width 1430 和 viewport height 1000 居中，未超出 viewport 安全边界 | `readme-dialog.png`; `metrics.json` 的 `readmeDialog` |
| Release 资产面板 | 展开成功；面板 `x=65, y=511, width=1300, right=1365`，在深色主题中相对页面背景使用明显更浅的语义 surface，6 行资产完整可见 | `release-assets.png`; `metrics.json` 的 `releaseAfterAsset` |
| Fork 每页控件 | 搜索 frame、ForkCard 与 page-size trigger 的右边界均为 `1382`；page-size trigger `x=1302, width=80, right=1382` | `fork-layout.png`; `metrics.json` 的 `forkLayout` |
| Gist 左右容器 | 侧栏 `y=85, right=288`，右侧搜索 toolbar `y=85, right=1398`；顶部基线相同 | `gist-layout.png`; `metrics.json` 的 `gistLayout` |
| Gist hover 可读性 | 真实指针 hover 后条目和计数均为 `rgb(248, 250, 252)`，hover 背景为 `rgba(30, 41, 59, 0.5)` | `round42_dropdown_hover_check.py` 输出 |
| Select 横向稳定 | Release、Gist、Fork 三个下拉在 closed/open/closed 三态中 body 与 root 均保持 `x=0, width=1430, right=1430`，`margin-right=0px`；打开时仅出现 `data-scroll-locked=1` | `round42_dropdown_hover_check.py` 输出 |
| 分类滚动条 | 滚动条元素右边界保持 `x=287`，侧栏卡片右边界 `x=288`；idle/停止后 thumb 透明，滚动态 thumb 为 `rgba(75, 85, 99, 0.8)`，宽度不变化 | `category-idle.png`, `category-scrolling.png`, `category-after-stop.png`; `metrics.json` |

README、Release、Gist 与 Fork 截图均为 populated state，而不是空状态占位图。Fork 截图包含 `magpie-fork` 卡片；Release 截图包含 `magpie` 的 `Visual Release` 和 6 个资产行；Gist 截图包含真实 fixture 卡片及侧栏计数。分类截图包含 populated repository card；分类滚动 fixture 的 CSS 状态则由同一页面的 idle、scrolling、after-stop 三次截图和 computed style 结果共同验证。

## 产物

本轮截图和几何报告保存在 `ui-screenshots-round42/`，包括 `readme-dialog.png`、`release-assets.png`、`gist-layout.png`、`gist-dialog.png`、`fork-layout.png`、`category-idle.png`、`category-scrolling.png`、`category-after-stop.png` 与 `metrics.json`。这些文件仅作为本地验证证据，不纳入提交；本记录文件本身为 tracked verification record。

## 代码门禁状态

本轮最终完整门禁已通过：`npm run lint`、`npx tsc -b`、`npm run test:run`、`npm run build`、`git diff --check` 与 `npm audit --omit=dev --audit-level=high` 全部成功。测试结果为 31 个测试文件、332 个测试全部通过；legacy entry 为 `2713.22 KiB`，低于 `3000 KiB` 限制；生产依赖审计结果为 `0 vulnerabilities`。
