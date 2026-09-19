# GithubStarsManager 产品路线提案

状态：Proposal
日期：2026-09-17
范围：Repository Health、软件识别与版本追踪、Discovery、插件生态、插件商城和 Android 适配

## 1. 产品定位

GithubStarsManager 的近期目标不是成为能够静默安装和控制系统软件的通用包管理器，而是逐步发展为：

> 帮助用户发现、理解、整理、追踪并安全获取 GitHub 软件的项目与版本管理中心。

产品继续以 GitHub Repository 为核心实体，在现有 Star 管理、Release 追踪、AI、搜索、MCP 和插件平台之上，逐步增加五类能力：

1. **理解项目**：提供客观的 Repository Health 和软件类型信息。
2. **发现软件**：根据 Trending、当前平台、架构和用户历史改善 Discovery。
3. **整理项目**：支持从文本、JSON 和其他来源批量导入 Repository，并统一去重、预览和管理。
4. **追踪软件**：关联本机软件与 GitHub Repository，检测新版本并由用户确认下载。
5. **个性化体验**：支持按需语言包、主题、布局和界面密度配置，同时保持安全边界和可回滚性。

自动执行安装程序、静默更新、统一卸载和任意系统权限控制不属于近期目标。

## 2. 设计原则

### 2.1 Core 与 Plugin 的边界

Core 负责稳定、客观、可复用的事实和生命周期：

- Repository、Release、Asset 和开发者的事实数据。
- 当前平台和架构。
- 已安装软件与 Repository 的关联。
- 已安装版本和最新版本的比较。
- 搜索、浏览、发现和更新状态。
- 插件所依赖的稳定 Host API。

Plugin 负责主观、可替换或面向特定领域的解释：

- Repository Health 总分和自定义权重。
- “是否值得安装”等主观结论。
- 替代品推荐、AI 分类和领域标签。
- 特定软件生态的 Release 匹配策略。
- 自定义导出、报告和 Dashboard。

基本规则是：

> Core 提供事实，Plugin 解释事实；Core 管理状态，Plugin 返回建议。

### 2.2 检测、下载与执行分离

以下行为必须视为不同风险等级：

```text
识别软件资产
  → 检测新版本
  → 展示变更和风险
  → 用户确认下载
  → 用户自行运行安装程序
```

近期只做到“用户确认下载”。插件和后台任务不得自动执行安装程序。

### 2.3 本地优先和最小权限

- 浏览历史、软件关联和版本记录默认保存在本地。
- 不上传剪贴板内容、安装路径、软件清单和浏览历史。
- GitHub Token、AI Key 和其他凭据只由宿主管理。
- 插件只通过 Capability API 获取完成当前操作所需的数据。
- 后台扫描、联网和通知必须可关闭并说明用途。

### 2.4 小步提交

每个阶段拆成能够独立审查、测试和回滚的 PR。一个 PR 不同时引入数据模型、系统扫描、安装执行、商城后台和 Android 适配。

## 3. 当前基础

当前已经具备的基础能力包括：

- Repository 管理、搜索、分类和 Release 追踪。
- AI、Web Search 和 GitHub 相关宿主能力。
- Plugin API v1：Manifest、权限、生命周期、Repository Actions、Processors 和 Exporters。
- Release Processor、宿主下载和 Smart Release Recommendation 示例。
- sandboxed 插件页面、CSP 和受限消息 Bridge。
- 插件隔离存储、日志和设置入口。

后续路线应复用这些基础，不重复实现另一套下载、权限、搜索或插件生命周期系统。

## 4. Repository Health

### 4.1 Core Health Facts

Core 提供可验证的事实，不直接给出统一总分：

| 分类 | 指标 |
|---|---|
| 状态 | Archived、Disabled、Fork、Template |
| 活跃度 | 最近 push、默认分支最近提交、近期提交数量 |
| Release | 是否存在 Release、最近 Release、Release 频率 |
| 社区 | Stars、Forks、Open/Closed Issues、Contributors |
| 维护 | License、Security Policy、CI、README、文档 |
| 成熟度 | Repository 年龄、Release 数量、最新稳定版本 |

Health Facts 可用于：

- Repository 详情页展示。
- 筛选和排序。
- Discovery。
- AI 和 MCP 查询。
- 插件评分和报告。

### 4.2 Health 展示

建议先提供分组信号：

```text
Activity
  Latest push       8 days ago
  Latest release    21 days ago

Maintenance
  Not archived
  CI configured
  Security policy available

Community
  Contributors      18
  Open issues        32
```

不得仅依据“最近没有提交”把成熟且稳定的项目标记为不健康。

### 4.3 插件扩展

插件可以基于 Health Facts 提供：

- 不同类型项目的评分模型。
- 自定义风险规则。
- 团队项目审查报告。
- “值得安装 / 仅收藏 / 开发资源”等建议。

主观评分必须展示规则来源，不能伪装成 Core 的客观结论。

## 5. 可安装软件识别

### 5.1 目标

判断一个 Repository 是否发布了适合当前设备的软件资产，并向 Release、Discovery、My Apps 和插件提供统一结果。

首批识别格式：

| 平台 | 格式 |
|---|---|
| Windows | EXE、MSI、ZIP/7z Portable |
| macOS | DMG、PKG、ZIP、Universal App |
| Linux | DEB、RPM、AppImage、tar.gz |
| Android | APK；AAB 仅识别，不直接安装 |

统一数据模型示意：

```ts
interface InstallableAsset {
  assetId: number;
  fileName: string;
  downloadUrl: string;
  size: number;
  platform: 'windows' | 'macos' | 'linux' | 'android';
  architecture?: 'x64' | 'arm64' | 'x86' | 'universal';
  packageType:
    | 'exe'
    | 'msi'
    | 'zip'
    | 'dmg'
    | 'pkg'
    | 'deb'
    | 'rpm'
    | 'appimage'
    | 'apk';
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}
```

### 5.2 识别规则

- 结合文件扩展名、文件名、Release 元数据、平台和架构判断。
- 排除 Source code、checksums、symbols、debug、signature 等非安装资产。
- 明确拒绝包含冲突平台或架构标记的资产。
- 不确定时显示多个候选，不伪装成唯一正确答案。
- 用户始终可以手动选择其他 Release Asset。

### 5.3 非目标

- 不执行下载后的文件。
- 不把 ZIP 一律当作可安装软件。
- 不声称仅凭文件名能够证明软件安全。
- 不自动选择来源不明的第三方镜像。

## 6. My Apps：已安装软件管理

### 6.1 第一版范围

第一版采用用户主动关联：

```text
本机软件
  ↕ 用户确认
GitHub Repository
  ↕ Release 比较
最新版本和下载资产
```

记录字段建议包括：

```ts
interface LinkedApplication {
  id: string;
  repositoryFullName: string;
  displayName: string;
  installedVersion: string | null;
  installPath?: string;
  platform: string;
  architecture?: string;
  linkSource: 'manual' | 'detected';
  confidence: 'confirmed' | 'high' | 'possible';
  includePrereleases: boolean;
  lastCheckedAt?: string;
}
```

用户可以：

- 手动关联 Repository。
- 填写或修正当前版本。
- 查看最新稳定版和更新说明。
- 选择是否包含 prerelease。
- 确认后下载推荐资产。
- 解除关联而不影响已安装软件。

### 6.2 更新检测

更新检测只比较版本并提醒：

```text
Installed    v1.2.0
Latest       v1.3.1
Status       Update available

[View changelog] [Download update]
```

要求：

- 定时检查可以关闭并配置频率。
- 默认不下载、不安装。
- 无法可靠解析版本时显示 `Unknown`，由用户确认。
- GitHub API 失败不能把软件误标为已停止维护。
- 新版本资产不匹配当前平台时只提示 Release，不推荐下载。

### 6.3 历史版本和降级

先实现 Release 历史版本选择和旧版下载，不直接承诺自动降级：

- 显示历史 Release、发布日期和 prerelease 状态。
- 标记当前记录的安装版本。
- 筛选兼容的历史资产。
- 下载旧版本前提示配置和数据可能不兼容。

界面按钮优先使用 `Download this version`，而不是在尚未执行安装时写成 `Downgrade`。

### 6.4 后续本机检测

按平台逐步增加只读检测适配器：

- Windows 卸载注册表。
- Winget 和 Scoop 已安装列表。
- macOS Applications 和包信息。
- Linux dpkg、rpm 和 AppImage 记录。
- Android PackageManager 提供的允许信息。

自动匹配结果必须由用户确认。仅凭软件名称相似不能自动绑定 Repository。

### 6.5 软件权限管理边界

桌面软件没有统一的跨平台权限系统。近期只管理和展示：

- 来源 Repository 和 Release。
- 发布者、版本、下载时间和 SHA-256。
- 安装路径和检测来源。
- 是否启用更新检测。
- 跳转到操作系统的应用权限、启动项、防火墙或卸载设置。

不承诺通用地授予或撤销其他软件的文件、网络、摄像头或系统权限。

## 7. 平台感知 Discovery

在现有 Discovery 中逐步增加：

```text
Discover
├─ Trending
├─ Hot Releases
├─ Popular
├─ Apps for Windows/macOS/Linux/Android
├─ Recently Viewed
└─ Developers
```
### 7.1 Trending Sync

现有 Trending 不只作为即时榜单展示，而是作为 Repository Discovery 数据源进行周期性同步。

保存独立 Trending Snapshot，不直接污染 Repository 主实体：

interface TrendingSnapshot {
  repositoryFullName: string;
  source: 'github-trending';
  period: 'daily' | 'weekly' | 'monthly';
  language?: string;
  rank: number;
  starsInPeriod?: number;
  capturedAt: string;
}
支持：
- Daily / Weekly / Monthly Trending。
- 按语言筛选。
- 显示当前排名。
- 显示上次排名和排名变化。
- 首次上榜时间。
- 连续上榜天数。
- 当前周期新增 Stars。
- 历史榜单快照。
Trending Repository 使用统一 Repository 详情数据，不维护独立详情模型：
Trending
  ↓
Repository Metadata
  ├─ Health Facts
  ├─ Latest Release
  ├─ Installable Assets
  ├─ Star / Subscription State
  ├─ My Apps State
  └─ Recently Viewed
Trending 支持以下筛选：
- 当前平台存在兼容资产。
- Installable only。
- Not starred。
- Not seen。
- Active only。
- Language。
- Repository 类型。
支持将一个或多个 Trending Repository 发送到 Batch Repository Intake，统一预览和执行批量操作。

### 7.2 平台筛选

- 当前平台和架构默认作为推荐信号，而不是不可取消的硬过滤。
- 用户可以查看其他平台的软件。
- 优先展示存在兼容 Release Asset 的 Repository。
- 清楚区分“有兼容资产”和“仅从主题/描述推测支持”。

### 7.3 Recently Viewed

- 本地记录最近打开的 Repository。
- 提供清空和关闭历史记录选项。
- 设置数量或时间上限。
- 不将浏览历史发送给插件或远端服务，除非用户明确触发相关能力。

### 7.4 Hide Seen Repositories

- Discovery 提供“隐藏已看过”开关。
- 支持临时显示全部结果。
- 清空浏览历史后同步解除隐藏。
- 收藏、安装关联和用户主动固定的 Repository 不应被永久隐藏。

### 7.5 Search History 与 Suggestions

- 现有 Repository Search 已具备搜索历史和 Suggestions；后续在保留现有行为的基础上扩展为全局搜索历史。
- 全局搜索历史默认本地保存并可关闭、单条删除或全部清空。
- Suggestions 可以来自本地历史、已有 Star、热门主题和 GitHub 搜索建议。
- 本地历史不应自动发送给 AI 或第三方搜索服务。

### 7.6 Developer Profile

开发者页面可逐步展示：

- GitHub 公开资料。
- 公开 Repository 和常用语言。
- 用户已收藏或关联的软件。
- Release 活跃度和相关项目。

不要基于贡献量给开发者生成未经解释的信誉或安全分数。

### 7.7 Omni Search

Omni Search 是 Core 提供的全局统一搜索和导航入口，不复制另一套 Repository 搜索实现。第一版通过 `Ctrl+K` 等快捷键打开搜索面板，聚合现有搜索能力：

```text
Search GithubStarsManager…

Repositories
  Obsidian
  facebook/react

Releases
  Magpie v0.12.0

Installed Apps
  Deskflow — update available

Developers
  rustdesk

Plugins
  Repository Health

Actions
  Sync repositories
  Open settings
```

第一版搜索范围：

- Repository 名称、`full_name`、描述、语言、Topic、分类、标签和本地备注。
- Release 名称、Tag 和标题。
- Gist 名称和描述。
- Developer Login 和公开名称。
- My Apps 名称、当前版本和关联 Repository。
- 已安装插件名称。
- 设置页面和常用宿主操作。

点击结果后导航到对应页面、详情或经过确认的宿主操作。

统一结果类型示意：

```ts
type OmniSearchResult = {
  type:
    | 'repository'
    | 'release'
    | 'gist'
    | 'developer'
    | 'installed-app'
    | 'plugin'
    | 'action';
  id: string;
  title: string;
  subtitle?: string;
  score: number;
};
```

第一版不建立大型全文索引。由不同搜索源复用现有数据和搜索函数，再统一评分、分组和限制结果数量：

```text
用户输入
  ├─ Repository Search
  ├─ Release Search
  ├─ Gist Search
  ├─ Developer Search
  ├─ My Apps Search
  └─ Plugin / Action Search
        ↓
统一排序和分组
        ↓
Omni Search Dialog
```

结果排序优先级：

1. Repository `owner/name`、Release Tag、Developer Login 等精确匹配。
2. 名称前缀和完整名称匹配。
3. 描述、Topic、分类、标签和备注的关键词匹配。
4. 可选语义搜索结果。

关键词结果应立即显示。语义搜索只在用户停止输入后执行，必须允许降级，服务不可用时不能阻塞普通搜索。语义结果需要明确标记，查询内容不得默认发送给外部 AI Provider。

第二阶段可建立本地全文索引，逐步纳入：

- README。
- Release Notes。
- 用户备注。
- 已缓存的 Repository 摘要和文档。

全文索引默认不包含 AI 对话、Token、配置、日志、安装路径、插件隔离存储和私有 Repository 内容。私有内容若未来支持，必须由用户明确启用并仅保存在本地。

插件可以在后续提供结构化 Search Provider，但必须遵守：

- 不能读取全部搜索历史或持续监听用户键盘输入。
- 只在用户选择对应搜索源或满足最小输入条件后调用。
- 只能返回经过 schema 校验的结构化结果，不能直接渲染宿主 UI。
- 联网搜索继续经过 Host Capability、权限检查和用户配置的服务。
- 单个插件搜索失败不能阻塞其他搜索源。

Omni Search MVP 的验收标准：

- 快捷键可以从主要页面打开和关闭搜索面板。
- 键盘能够选择并打开结果。
- 已有 Repository Search 行为不被改变。
- 各类型结果正确分组，重复结果得到合并。
- 空查询可以显示最近访问和常用操作，但不触发外部请求。
- 普通关键词搜索完全可以离线工作。
- 搜索历史可删除、可关闭且不会自动发送给插件或远端服务。

### 7.8 Batch Repository Intake

用于从任意文本、Markdown 或 JSON 中批量识别 GitHub Repository，并统一解析、去重和预览。

支持输入：

- GitHub Repository URL。
- 指向 Release、Issue、Pull Request、Tree、Blob 等页面的 GitHub URL，并统一归一为所属 Repository。
- `owner/repo` 简写。
- 包含多个 GitHub URL 的普通文本、聊天记录和 Markdown。
- JSON 数组、对象以及嵌套结构中的 Repository URL 或 `owner/repo` 字符串。

第一版不要求用户提供固定 JSON Schema。系统递归扫描 JSON 中的字符串值，识别合法 GitHub Repository 引用。

处理流程：

用户粘贴文本或 JSON
  ↓
提取 GitHub Repository
  ↓
URL 归一化
  ↓
批次内部去重
  ↓
与本地 Repository 去重
  ↓
获取 GitHub Metadata
  ↓
统一 Import Preview

统一候选数据模型示意：
interface ImportedRepositoryCandidate {
  repositoryFullName: string;
  source: 'text' | 'json' | 'clipboard' | 'file';
  originalValue: string;
  status:
    | 'pending'
    | 'resolved'
    | 'duplicate'
    | 'invalid'
    | 'unavailable';

  alreadyStarred?: boolean;
}
Import Preview 至少展示：
- Repository 名称和描述。
- Stars、Forks、Language、Topics。
- 是否已经收藏。
- 是否已存在于当前导入批次。
- Latest Release。
- Repository Health 摘要。
- 是否存在当前平台可安装的 Release Asset。
- 是否已经关联到 My Apps。
批量操作可以逐步支持：
- Star / Unstar。
- 加入分类或标签。
- 订阅 Release。
- 加入 My Apps 关联流程。
- 导出。
- 执行插件 Repository Action。
失败项必须明确区分：
- URL 无效。
- Repository 不存在。
- Repository 已转移或重命名。
- Private / inaccessible。
- GitHub API rate limit。
- 批次重复。
- 已存在于本地。
Repository 重命名或转移时显示原地址和当前地址，不静默替换。
第一版仅支持粘贴文本和 JSON。CSV、文件导入、浏览器书签和第三方收藏格式后续再扩展。



## 8. 系统集成

### 8.1 Clipboard GitHub URL Detection

用于识别用户复制的 GitHub Repository、Release 或用户链接。

隐私要求：

- 默认关闭或首次启用时明确说明。
- 优先仅在应用前台或用户触发粘贴时读取。
- 本地解析，不上传原始剪贴板内容。
- 非 GitHub 内容立即丢弃，不写入日志和历史。
- 提供关闭提示和清空记录入口。

### 8.2 Deep Link

建议逐步支持：

```text
githubstarsmanager://repo/owner/name
githubstarsmanager://release/owner/name/tag
githubstarsmanager://developer/login
githubstarsmanager://plugins/plugin-id
```

要求：

- 所有参数重新校验，不能把 Deep Link 当作可信输入。
- 不允许通过链接直接安装插件、执行下载或调用高风险操作。
- 具有副作用的操作必须再次由用户确认。

## 9. Localization 与界面个性化

### 9.1 可扩展多语言架构

当前中英文界面应逐步重构为统一 i18n 架构，不继续在组件内大量使用：

```ts
language === 'zh' ? '中文' : 'English'
```

改为统一键值访问：

```ts
t('settings.plugins.title')
```

建议目录：

```text
locales/
├─ built-in/
│  ├─ zh-CN.json
│  └─ en-US.json
└─ downloaded/
   ├─ ja-JP/
   ├─ zh-TW/
   └─ ko-KR/
```

Core 默认只内置少量基础语言：

- `zh-CN`
- `en-US`

其他语言采用按需下载。JSON 语言包通常不大；这样做的主要价值是避免主安装包随几十种语言和社区翻译一起膨胀，并允许社区翻译独立更新。

语言包至少包含：

- locale 标识。
- 语言显示名。
- 版本号。
- 兼容的 App/i18n API 版本。
- 翻译文件。
- 作者和来源。
- 完整性哈希。
- 可选字体或排版提示，但默认不打包字体文件。

语言包示例：

```json
{
  "manifestVersion": 1,
  "locale": "ja-JP",
  "name": "日本語",
  "version": "1.0.0",
  "appVersion": ">=0.10.0",
  "i18nVersion": "1",
  "author": "Example",
  "entry": "messages.json"
}
```

语言包安装流程：

```text
语言设置
  ↓
浏览可用语言
  ↓
下载语言包
  ↓
校验版本和 SHA-256
  ↓
本地安装
  ↓
即时切换
```

要求：

- 用户可删除非内置语言包。
- 语言包更新前显示版本变化。
- 下载失败不能影响当前语言。
- 缺失翻译键自动回退到默认语言。
- 语言包不能执行 JavaScript、Node.js 或任意代码。
- 语言包不得拥有网络、文件系统或插件权限。
- 翻译包应是纯数据格式，例如 JSON。
- 不允许语言包覆盖安全提示、权限名称等关键语义而造成误导。

建议回退链：

```text
ja-JP
  ↓ missing key
en-US
  ↓ missing key
internal fallback key
```

未来可增加：

- 社区语言包索引。
- 翻译完成度。
- 缺失键检测。
- CI 校验。
- 社区 PR 翻译。
- RTL 语言支持。

### 9.2 GUI 个性化

界面个性化优先采用声明式配置，而不是允许用户直接修改 React、DOM 或任意注入 JavaScript。

第一阶段支持：

- Accent Color。
- Light / Dark / System。
- Theme Preset。
- 字体大小。
- UI Density。
- 圆角大小。
- 动画强度。
- 卡片间距。
- Repository 卡片显示字段。
- Sidebar 宽度和折叠状态。
- 列表 / Grid 默认布局。
- 首页模块显示和排序。

统一主题 Token 示例：

```ts
interface ThemeTokens {
  colorAccent: string;
  radius: 'none' | 'small' | 'medium' | 'large';
  density: 'compact' | 'comfortable' | 'spacious';
  fontScale: number;
  animation: 'reduced' | 'normal' | 'enhanced';
}
```

不要让主题直接依赖组件内部 className 或 DOM selector。优先使用语义化变量：

```css
--color-background
--color-surface
--color-primary
--color-muted
--radius-card
--spacing-density
```

而不是：

```css
.repository-card > div:nth-child(2) { ... }
```

这样组件重构时主题不容易失效。

### 9.3 布局个性化

第二阶段可以提供有限的 Dashboard Layout Configuration：

```text
Home
├─ Trending
├─ Recently Viewed
├─ Update Available
├─ Starred Repositories
├─ My Apps
└─ Plugin Widgets
```

用户可以：

- 显示 / 隐藏模块。
- 调整模块顺序。
- 调整部分卡片尺寸。
- 选择默认首页。
- 保存多个布局预设。

布局配置只保存：

```json
{
  "home": [
    "updates",
    "trending",
    "recently-viewed"
  ]
}
```

不保存任意 HTML、JS 或 React Component。

### 9.4 Community Themes

未来可以支持独立主题包，但主题包只允许包含：

- `manifest.json`。
- CSS Variables。
- Token 配置。
- 可选静态图片资源。

例如：

```text
theme/
├─ manifest.json
├─ theme.css
└─ assets/
```

主题包不得：

- 执行 JavaScript。
- 访问 Electron IPC。
- 读取 Token。
- 读取 Repository 数据。
- 发起网络请求。
- 修改插件权限。

主题包与功能插件分离：

```text
Language Pack
→ 只负责文本

Theme Pack
→ 只负责视觉 Token

Plugin
→ 负责功能扩展
```

三者不能互相继承权限。

### 9.5 前端高级定制边界

近期不支持：

- 任意 React Component 注入。
- 任意 DOM 修改脚本。
- 用户 JavaScript。
- Theme 包访问 Store。
- Theme 包访问 Node.js。
- Theme 包执行网络请求。

如果未来确实需要高级 UI 扩展，继续通过现有 sandboxed Plugin Page 提供，而不是扩大 Theme 权限。

基本原则：

> Theme changes appearance, Plugin changes behavior.

## 10. 插件生态与商城

### 10.1 近期插件生态

先完善现有 Plugin API v1：

- 稳定 Manifest、生命周期、权限和 Host Capability。
- 保持同一 major API 内向后兼容。
- 提供开发文档、类型、示例和调试工具。
- 收集真实插件开发中的缺口，再增加扩展点。
- 不允许插件直接访问 Token、Zustand、原始 IPC、Shell 或任意文件系统。

### 10.2 轻量商城起点

第一版商城参考“静态索引 + GitHub Release”模式，不立即建设复杂后台：

```text
插件作者仓库和 GitHub Release
  → 向插件索引仓库提交 PR
  → CI 自动检查
  → 维护者人工 Review
  → 合并至 community-plugins.json
  → 客户端展示并安装固定版本
```

建议索引：

```text
community-plugins.json
removed-plugins.json
schemas/manifest.schema.json
```

每个插件版本至少记录：

- Plugin ID 和版本。
- API 兼容范围。
- 源码和 Release URL。
- 包 SHA-256。
- 权限、网络目标和数据用途。
- 审核状态、审核时间和对应 Commit。
- 撤销状态和建议安全版本。

### 10.3 自动扫描

提交和每次更新至少检查：

- Manifest、API 版本和插件 ID。
- 包大小、文件数量、路径穿越和符号链接。
- 依赖锁文件和已知高危漏洞。
- Token、Key、私钥和其他秘密信息。
- `eval`、动态代码、Shell、进程执行和安装脚本。
- 未声明网络目标、遥测和自更新逻辑。
- 混淆代码及源码与构建产物的对应关系。
- 插件页面 CSP、远程资源和消息 Bridge。

自动扫描只负责发现风险，不替代人工审核和运行时权限边界。

### 10.4 人工审核

审核者确认：

- 描述与行为一致。
- 每项权限都有必要理由。
- 联网域名和数据用途明确。
- 不上传私有 Repository、浏览历史或其他非必要数据。
- 停用和卸载后没有遗留后台任务。
- UI 不冒充宿主或系统提示。
- 许可证、名称、图标和源码来源合规。

每个新版本重新检查；权限增加、域名扩大和数据用途改变必须重新人工审核。

### 10.5 签名、撤销和更新

- 同一版本号只能对应一个不可变哈希。
- 客户端安装前验证索引签名和插件包 SHA-256。
- 签名私钥不能存放在源码仓库或普通日志中。
- 维护签名撤销列表，记录原因、公告和建议回退版本。
- 被撤销版本停止新安装，并提醒已安装用户。
- 更新前展示版本、发布者、Changelog 和权限变化。
- 新增权限时暂停更新并重新征得用户同意。
- 第一阶段只提供更新提醒和手动确认；自动更新放在签名、撤销和回滚稳定之后。

### 10.6 商城治理边界

商城托管、审核责任、签名密钥、紧急撤销和申诉流程必须先得到维护者确认。商城审核通过不意味着插件获得更高运行权限。

## 11. Android 路线

Android 不是桌面 UI 的简单移植，应在共享领域模型之上实现独立平台适配器。

可共享：

- Repository、Release 和 Asset 数据。
- 软件资产识别和版本比较。
- My Apps 关联记录。
- Discovery 和搜索逻辑。
- Plugin Manifest 的只读展示；是否支持执行需另行设计。

Android 专属：

- PackageManager 软件清单。
- APK 安装确认流程。
- 系统权限页跳转。
- 后台任务和通知限制。
- 存储访问框架和下载目录。
- Android 生命周期和网络策略。

普通应用不得声称可以随意替其他应用授予权限、静默安装、静默卸载或降级。Shizuku、ADB、Root 和设备管理能力若未来支持，必须作为明确的高级模式单独设计，不作为默认路径。

建议先验证 Web/响应式浏览体验，再提交 Android 客户端架构 Proposal；不要在桌面路线尚未稳定时复制全部状态和插件运行时。

## 12. 推荐实施阶段

### 阶段 A：稳定基础平台

- 完成现有插件平台合并后的回归和文档。
- 冻结 Plugin API v1 的核心契约。
- 确认 Repository、Release 和 Asset 的共享数据边界。

验收：现有功能无回归，示例插件可稳定安装、启停和卸载。

### 阶段 B：Repository Health Facts

- 获取和规范化客观 Health 数据。
- Repository 详情页展示。
- 增加基础筛选和排序。
- 向插件暴露稳定只读数据。

验收：不使用主观总分，也不会把成熟但低频更新的项目自动判定为不健康。

### 阶段 C：Installable Asset Detection

- 建立统一资产模型。
- 支持 Windows、macOS、Linux 和 Android 常见格式识别。
- 复用 Smart Release 的平台与架构规则。
- 提供可解释的匹配原因和候选项。

验收：兼容资产可稳定识别，冲突平台和架构不会被推荐。

### 阶段 D：My Apps MVP

- 手动关联软件和 Repository。
- 手动记录和修正安装版本。
- 比较最新 Release。
- 用户确认后下载更新。

验收：完成“关联 → 检查 → 查看 Changelog → 下载”的闭环，不执行安装程序。

### 阶段 E：Discovery、Trending 与批量导入

- Trending Snapshot 同步和榜单历史。
- Trending Repository 使用统一 Repository 详情。
- 平台感知的软件发现。
- Recently Viewed 和 Hide Seen。
- Batch Repository Intake：文本 / JSON URL 提取、去重和 Preview。
- 将现有 Repository Search History 和 Suggestions 扩展为全局历史。
- Omni Search MVP：统一搜索和导航现有本地数据。
- Developer Profile。

验收：

- Trending 榜单同步不会复制 Repository 主数据。
- 能从混合文本和 JSON 中正确识别、归一化和去重 Repository。
- Import Preview 不会因单个 Repository 获取失败而导致整批失败。
- 所有历史记录可关闭和删除。
- 跨平台结果不会被错误隐藏。
- 关键词全局搜索可以离线工作。

### 阶段 F：历史版本和系统集成

- Release Version Picker。
- 旧版资产下载和风险提示。
- README、Release Notes 和备注的本地全文索引。
- 可选语义搜索结果。
- Deep Link。
- 可选 Clipboard GitHub URL Detection。
- 可配置的后台更新检查和通知。

验收：所有外部输入经过校验，下载和副作用操作需要用户确认。

### 阶段 G：Localization 与个性化

- 重构现有中英文逻辑为统一 i18n key。
- 保留 `zh-CN` / `en-US` 内置语言。
- 支持本地安装和删除语言包。
- 提供缺失翻译回退和版本兼容检查。
- 建立 Theme Token 系统。
- 支持颜色、密度、字体缩放和布局预设。
- 支持安全的社区 Theme Pack。

验收：

- 缺失或损坏语言包不会导致应用无法启动。
- 删除语言包后自动回退到内置语言。
- 主题不需要依赖 DOM selector。
- Theme 和 Language Pack 均不能执行代码或访问敏感数据。

### 阶段 H：插件公共生态

- 静态插件索引。
- PR 提交和自动扫描。
- 人工审核清单。
- 哈希、签名、撤销、回滚和更新提醒。

验收：商城安装只接受固定版本和匹配哈希；权限增加时重新确认。

### 阶段 I：Android 验证

- 共享数据层和平台适配器设计。
- Repository 浏览、Release 和 My Apps 只读体验。
- APK 下载与系统安装确认。
- 系统权限页跳转和更新通知。

验收：不依赖 Root/Shizuku 也能完成基础闭环，高权限模式不进入默认实现。

## 13. 建议 PR 顺序

每项尽量保持为独立 PR，每一次PR完成后停下，等待后续指令：

1. `feat: add repository health facts`
2. `feat: detect installable release assets`
3. `feat: refactor bilingual UI into scalable i18n`
4. `feat: add downloadable language packs`
5. `feat: add theme token customization`
6. `feat: add configurable home layout`
7. `feat: add safe community theme packs`
8. `feat: add batch repository URL extraction`
9. `feat: add batch repository import preview`
10. `feat: add trending snapshots`
11. `feat: add trending history and filters`
12. `feat: add recently viewed repositories`
13. `feat: add global omni search`
14. `feat: expand repository search history to global history`
15. `feat: add manual repository-app linking`
16. `feat: detect updates for linked applications`
17. `feat: add platform-aware software discovery`
18. `feat: add release version picker`
19. `feat: add indexed content search`
20. `feat: add repository deep links`
21. `feat: detect GitHub URLs from clipboard`
22. `docs: propose community plugin registry`
23. `feat: add signed community plugin index`
Android 应先提交独立设计 Proposal，不和上述桌面 PR 混合。

## 14. 暂不支持

- 自动或静默执行 EXE、MSI、PKG、DEB、RPM、AppImage 或 APK。
- 通用自动卸载和自动降级。
- 插件调用 Shell、任意 Node、任意文件系统或任意网络。
- 后台持续读取完整剪贴板。
- 无用户确认地扫描、上传或关联全部本机软件。
- 用单一规则为所有 Repository 生成官方 Health 总分。
- 未经签名和撤销体系保护的插件自动更新。
- 默认依赖 Root、ADB、Shizuku 或系统管理员权限。

## 15. 需要维护者确认

1. Repository Health Facts 是否符合产品核心定位？
2. 项目是否接受 My Apps 的“手动关联优先”路线？
3. 第一版是否明确只下载更新、不执行安装？
4. 浏览历史、搜索历史和软件关联数据应如何持久化与同步？
5. 是否接受静态 GitHub 插件索引作为商城起点？
6. 谁负责商城托管、审核、签名密钥和紧急撤销？
7. Android 是响应式/Web 包装、独立客户端，还是暂不进入近期路线？
8. 哪些平台适配器和包格式应作为首批正式支持范围？

## 16. 成功标准

近期成功不以功能数量衡量，而以以下闭环衡量：

1. 用户能够理解一个 Repository 当前是否仍被维护。
2. 用户能够判断它是否包含适合当前设备的软件。
3. 用户能够把已安装软件关联到正确的 Repository。
4. 用户能够知道是否存在新版本并安全下载。
5. 插件能够在不接触凭据和宿主内部状态的前提下扩展分析能力。
6. 每项历史、扫描、联网和通知能力都可解释、可关闭、可删除。
7. 用户能够一次粘贴包含多个 GitHub 链接的文本或 JSON，并统一识别、去重、查看和处理这些 Repository。
8. 用户能够查看 Trending Repository 的完整详情、历史榜单状态和与本地收藏、Release、My Apps 的关联。

完成这些闭环后，再根据真实用户反馈决定是否扩大到自动安装、完整商城后台或更高权限的平台集成。
