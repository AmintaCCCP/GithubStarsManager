# Repo Insights（仓库洞察）

页面型示例插件：在仓库卡片的「插件操作」菜单点击「仓库洞察」，宿主会把插件页面装进弹窗，
实时拉取该仓库的 GitHub API 指标并渲染成图表看板。

## 数据区块

| 区块 | 内容 | GitHub API 端点 |
|---|---|---|
| 头部 + KPI | 星标 / 复刻 / 开放 Issue / 关注者 / 许可证 / 创建时间（快照 + 实时详情合并） | `/repos/{owner}/{repo}` |
| 仓库健康度 | 综合 0–100 评分与 A–E 等级，由维护活跃（40%）、热度（30%）、质量（30%）三因子在页面本地计算 | （基于上面数据） |
| 仓库体检 | 一句话摘要（维护状态 + 最近提交 / 最新发布）+ 作者与主要贡献者 + 按相关度分组的客观事实（更新情况 / 关注热度 / 仓库特征，未知项沉底），与 Release 侧栏「仓库健康事实」面板同口径；README 有无从社区档案补全，最近一次提交从周统计推导 | （基于上面数据） |
| 提交活动 | 最近 52 周每周提交柱状图；近 4 周提交、较前 4 周增减、活跃周数 | `/repos/{owner}/{repo}/stats/commit_activity` |
| 代码变更 | 每周新增 / 删除行数（绿 / 红双向柱） | `/repos/{owner}/{repo}/stats/code_frequency` |
| 语言分布 | 字节占比环形图（Top 8 + 其他） | `/repos/{owner}/{repo}/languages` |
| 维护者与贡献者 | 所有者资料卡（类型、简介、网站、粉丝、公开仓库、加入时间，`/users/{owner}`）+ 贡献者概要列表（提交数与样本占比）+ 巴士因子分析（样本内累计 50% 提交所需人数） | `/repos/{owner}/{repo}/contributors?per_page=12`、`/users/{owner}` |
| 发布节奏 | 近 1 年发布数、平均间隔、最新发布；月度发布柱状图与最近 5 条列表 | `/repos/{owner}/{repo}/releases?per_page=100` |
| 社区健康 | 社区标准完成度 + 6 项文件信号徽章 | `/repos/{owner}/{repo}/community/profile` |
| 安全公告 | 已发布 GHSA 公告按严重程度计数与列表 | `/repos/{owner}/{repo}/security-advisories?per_page=10` |
| 星标趋势 | 每周新增星标柱状 + 累计曲线（最多 90 周；端点不可用时自动隐藏） | `/repos/{owner}/{repo}/stargazers/history?per_page=30` |
| 健康度雷达 | 总分之外的关键维度分解（维护活跃 / 热度 / 质量 / 发布节奏 / 社区规范 / 安全，未知维度自动省略） | （基于上面数据） |
| AI 近期动态 | 由用户配置的 AI 结合最近合并 PR、Release 更新日志与提交统计生成的要点分析；`ai:invoke` 权限，宿主逐次展示发送内容并请求确认 | `/repos/{owner}/{repo}/pulls?state=closed` + Release 日志 |

## 权限

| 权限 | 用途 |
|---|---|
| `repositories:read` | 无仓库上下文（从设置页进入）时搜索选择已加载的仓库；读取快照元数据。 |
| `network:api.github.com` | 经宿主 `network.request` 桥发起上表端点的只读 GET；宿主用用户的 GitHub Token 认证，页面拿不到 Token。 |
| `ai:invoke` | 仅 AI 近期动态卡使用；每次点击都经宿主展示完整提示词并请求用户确认。 |
| `storage` | 按数据集缓存结果并标记新鲜度（6–72 小时后视为过期），打开弹窗先画缓存（过期缓存也先展示）再后台刷新。 |

## 安装

设置 → 插件 → 安装本地插件，选择本目录（`examples/plugins/repo-insights`），
确认权限后启用。之后在任意仓库卡片 `…` 菜单的「插件操作」里点击「仓库洞察」。

## 实现说明

- 纯静态页面（`ui/index.html` + `index.js` + `style.css`），图表用随插件打包的
  Chart.js UMD（与宿主 BI 看板同款），无 CDN、无内联脚本/样式（页面 CSP 禁止）。
- 每次打开约发起 10–13 个只读请求（并发上限 6）；GitHub 统计端点返回 202 时展示
  「统计生成中」，已有缓存则照常展示缓存。
- `stats/*` 类端点首次访问可能返回 202（GitHub 需要生成缓存），插件按 202 处理。
