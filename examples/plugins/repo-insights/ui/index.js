/* Repo Insights — 仓库洞察插件页面（V1.4 opensPage 弹窗 + V1.5 network.request）。
 *
 * 宿主弹窗通过 `plugin-page:init` 下发 `context = { repository, readme, language, theme }`；
 * 其余数据一律走受权限约束的桥：
 *  - `network.request`：宿主代理的 GitHub API 只读 GET（`network:api.github.com` 权限，
 *    宿主用用户自己的 Token 附加认证，页面拿不到 Token 本身）；
 *  - `storage.get/set`：按数据集缓存指标结果（TTL 6–72 小时），先画缓存再后台刷新；
 *  - `repositories.search`：从「设置 → 插件 → 打开页面」进入时选择仓库。
 * 图表使用随插件打包的 Chart.js（本地文件，页面 CSP 禁止 CDN）。
 */
(() => {
  'use strict';

  const PLUGIN_ID = 'com.githubstarsmanager.repo-insights';
  const PAGE_ID = 'insights';

  const HOUR = 3600_000;
  // storage 桥单个值上限 64 KiB：releases / 周级统计都已裁剪到最小字段。
  const CACHE_SCHEMA = 'v1';

  /* ── 文案 ─────────────────────────────────────────────────────────── */

  const STR = {
    zh: {
      bridgeNotReady: '宿主桥尚未就绪',
      bridgeFailed: '宿主请求失败',
      noRepository: '尚未选择仓库。请从仓库卡片的「插件操作」菜单打开本页面，或在下方搜索选择一个仓库。',
      pickerHint: '此入口没有携带仓库上下文（例如从「设置 → 插件 → 打开页面」进入）。搜索并选择一个已加载的仓库：',
      search: '搜索',
      searching: '搜索中…',
      searchDone: '找到 {n} 个仓库，点击选择。',
      searchEmpty: '没有匹配的仓库。',
      loading: '正在通过宿主代理获取 GitHub API 数据…',
      loadFailed: '数据获取失败：{message}',
      httpError: 'GitHub API 返回 {status}',
      rateLimited: '请求过于频繁，请稍后重试。',
      statsPending: 'GitHub 正在生成该仓库的统计数据（通常几分钟内可用），已展示缓存或稍后重试。',
      statsTooLarge: '该仓库提交数超过 GitHub 统计接口的上限（10,000 次），此区块不可用。',
      fromCache: '缓存数据',
      cached: '缓存 · {age}前更新',
      justNow: '刚刚',
      minutes: '{n} 分钟',
      hours: '{n} 小时',
      days: '{n} 天',
      // 头部与 KPI
      stars: '星标', forks: '复刻', issues: '开放 Issue', watchers: '关注者',
      license: '许可证', created: '创建于', archived: '已归档',
      healthLabel: '仓库健康度',
      healthFromLocal: '由提交、发布与元数据估算',
      // 提交活动
      commitsTitle: '提交活动',
      commitsHint: '最近 52 周每周提交数（默认分支）',
      commitsLast4: '近 4 周提交',
      commitsDelta: '较前 4 周',
      commitsActiveWeeks: '活跃周',
      commitsOf8: '{n} / 8',
      // 代码变更
      churnTitle: '代码变更',
      churnHint: '每周新增 / 删除行数（绿=新增，红=删除）',
      churnAdditions: '新增行',
      churnDeletions: '删除行',
      // 语言
      languagesTitle: '语言分布',
      languagesHint: '按代码字节数',
      languagesOther: '其他',
      languagesCount: '{n} 种语言',
      // 贡献者
      contributorsTitle: '主要贡献者',
      contributorsHint: '历史提交数前 12 名',
      contributorsTop1: 'Top 1 占比',
      contributorsTop3: 'Top 3 占比',
      contributorsSample: '占比按前 12 名样本内计算',
      contributorsCommits: '{n} 次提交',
      // 发布
      releasesTitle: '发布节奏',
      releasesHint: '基于最近发布的 Release 统计',
      releasesYear: '近 1 年发布',
      releasesInterval: '平均间隔',
      releasesDays: '{n} 天',
      releasesLatest: '最新发布',
      releasesNone: '该仓库没有已发布的 Release。',
      releasesPerMonth: '月度发布数',
      prerelease: '预发布',
      // 社区健康
      communityTitle: '社区健康',
      communityHint: 'GitHub 社区标准档案',
      communityScore: '社区标准完成度',
      sigReadme: 'README', sigLicense: '许可证', sigContributing: '贡献指南',
      sigConduct: '行为准则', sigIssue: 'Issue 模板', sigPr: 'PR 模板',
      sigOn: '已提供', sigOff: '未提供',
      communityUnavailable: '无法获取社区档案。',
      // 安全公告
      advisoriesTitle: '安全公告',
      advisoriesHint: '已发布的 GHSA 安全公告',
      advisoriesNone: '没有已发布的安全公告。',
      advisoriesTotal: '公告总数',
      factsTitle: '仓库体检',
      factsHint: '一眼看清这个仓库还在不在维护、热度如何',
      factsGroupUpdates: '更新情况', factsGroupAttention: '关注热度', factsGroupTraits: '仓库特征',
      heroActive: '维护活跃', heroUpdating: '近期仍在更新', heroSlowing: '更新放缓', heroDormant: '已一年以上没有推送',
      heroArchived: '仓库已归档，不再维护', heroDisabled: '仓库已停用', heroUnknown: '维护状态未知',
      heroLastCommit: '最近提交', heroLastRelease: '最新发布',
      authorLabel: '作者', authorSince: '创建于', authorAge: '已持续',
      contribLine: '主要贡献者', contribSample: '按提交数 · 前 12 名样本',
      relToday: '今天', relYesterday: '昨天', relDays: '{n} 天前', relWeeks: '{n} 周前', relMonths: '{n} 个月前', relYears: '{n} 年前',
      durDays: '{n} 天', durMonths: '{n} 个月', durYears: '{n} 年',
      factPushedAt: '上次推送', factLatestCommitAt: '最近一次提交', factHasReleases: '有发布', factLatestReleaseAt: '最新发布时间',
      factArchived: '已归档', factDisabled: '已停用', factFork: 'Fork', factTemplate: '模板仓库', factLicense: '许可证',
      factSecurityPolicy: '安全策略', factCI: 'CI（GitHub Actions）', factReadme: 'README', factDocs: '文档',
      factStars: '星标', factForks: '复刻', factOpenIssues: '开放 Issue', factClosedIssues: '已关闭 Issue', factContributors: '贡献者',
      factCreatedAt: '创建于', factAge: '仓库年龄', factReleaseCount: '发布总数', factReleasesPerYear: '发布频率', factLatestStable: '最新稳定版',
      valYes: '是', valNo: '否', valNone: '无', valUnknown: '未知',
      valPerYear: '{n} / 年', valAge: '{n} 天（约 {y} 年）', valCountCapped: '{n}+',
      sigArchived: '已归档', sigDisabled: '已停用', sigNoReleases: '没有发布', sigNoRecentActivity: '12 个月以上无推送',
      factsDisclaimer: '以上为客观事实，不含主观评分；「未知」表示该事实所需的数据不可用。',
      radarTitle: '健康度雷达', radarHint: '关键维度 · 0–100',
      axisMaintenance: '维护活跃', axisPopularity: '热度', axisQuality: '质量',
      axisRelease: '发布节奏', axisCommunity: '社区规范', axisSecurity: '安全',
      maintainersTitle: '维护者与贡献者', maintainersHint: '所有者资料、主要贡献者与巴士因子',
      ownerPanelTitle: '所有者', contribPanelTitle: '贡献者概览',
      contribFootnote: '共 12 名样本：按历史提交数排序，进度条为相对第一名提交量的占比。',
      typeUser: '个人', typeOrg: '组织',
      ownerFollowers: '粉丝', ownerRepos: '公开仓库', ownerJoined: '加入于',
      ownerLocation: '所在地', ownerCompany: '公司', ownerBlog: '网站',
      ownerUnavailable: '所有者资料不可用。',
      contribShare: '样本占比',
      bfTitle: '巴士因子',
      bfRisk: '单点依赖', bfConcentrated: '较集中', bfModerate: '中等', bfHealthy: '较分散',
      bfDetail: '前 {k} 名贡献者承担了样本内 {share}% 的提交',
      bfNames: '关键人：{names}',
      bfSampleNote: '按前 12 名贡献者样本估算',
      aiTitle: 'AI 近期动态', aiHint: '由你配置的 AI 结合合并 PR、Release 日志与提交统计生成',
      aiGenerate: '生成动态分析', aiRegenerate: '重新生成',
      aiNote: '点击后宿主会展示将要发送的内容并请你逐次确认',
      aiWaiting: '等待你在宿主弹窗中确认…',
      aiDone: '分析完成（由 AI 生成，仅供参考）。',
      aiCancelled: '已取消。',
      aiNotConfigured: '未配置 AI Provider（设置 → AI），无法生成分析。',
      aiFailed: 'AI 请求失败：{message}',
      // 星标历史
      starsTitle: '星标趋势',
      starsHint: '每周新增星标与累计曲线',
      starsLast4: '近 4 周新增',
      starsLast12: '近 12 周新增',
      starsRange: '统计范围：最近 {n} 周',
      starsUnavailable: '该仓库暂不支持星标历史查询。',
      weeklyNew: '周新增',
      cumulative: '累计',
      // 图表与脚注
      footer: '数据来源：GitHub REST API（经宿主代理的只读请求，认证使用你的 GitHub Token，页面本身无法读取）· 结果缓存在本地插件存储，6–72 小时后标记过期并后台刷新。',
      week: '{m}-{d} 周',
    },
    en: {
      bridgeNotReady: 'Host bridge is not ready',
      bridgeFailed: 'Host request failed',
      noRepository: 'No repository selected. Open this page from a repository card plugin menu, or search below.',
      pickerHint: 'This entry carries no repository context (e.g. opened from Settings → Plugins). Pick a loaded repository:',
      search: 'Search',
      searching: 'Searching…',
      searchDone: '{n} repositories found; click to select.',
      searchEmpty: 'No matching repositories.',
      loading: 'Fetching GitHub API data through the host proxy…',
      loadFailed: 'Failed to load data: {message}',
      httpError: 'GitHub API returned {status}',
      rateLimited: 'Too many requests; please retry later.',
      statsPending: 'GitHub is still computing statistics for this repository (usually ready within minutes). Showing cache if available.',
      statsTooLarge: 'This repository exceeds the GitHub statistics limit (10,000 commits); this section is unavailable.',
      fromCache: 'cached data',
      cached: 'cached · updated {age} ago',
      justNow: 'just now',
      minutes: '{n} min',
      hours: '{n} h',
      days: '{n} d',
      stars: 'Stars', forks: 'Forks', issues: 'Open issues', watchers: 'Watchers',
      license: 'License', created: 'Created', archived: 'Archived',
      healthLabel: 'Repo health',
      healthFromLocal: 'estimated from commits, releases and metadata',
      commitsTitle: 'Commit activity',
      commitsHint: 'Commits per week over the last 52 weeks (default branch)',
      commitsLast4: 'Last 4 weeks',
      commitsDelta: 'vs prior 4 weeks',
      commitsActiveWeeks: 'Active weeks',
      commitsOf8: '{n} / 8',
      churnTitle: 'Code churn',
      churnHint: 'Weekly additions / deletions (green = added, red = removed)',
      churnAdditions: 'Additions',
      churnDeletions: 'Deletions',
      languagesTitle: 'Languages',
      languagesHint: 'By bytes of code',
      languagesOther: 'Other',
      languagesCount: '{n} languages',
      contributorsTitle: 'Top contributors',
      contributorsHint: 'Top 12 by all-time commits',
      contributorsTop1: 'Top 1 share',
      contributorsTop3: 'Top 3 share',
      contributorsSample: 'Shares are computed within the top-12 sample',
      contributorsCommits: '{n} commits',
      releasesTitle: 'Release cadence',
      releasesHint: 'Based on the most recent published releases',
      releasesYear: 'Last 1 year',
      releasesInterval: 'Avg interval',
      releasesDays: '{n} d',
      releasesLatest: 'Latest release',
      releasesNone: 'This repository has no published releases.',
      releasesPerMonth: 'Releases per month',
      prerelease: 'pre-release',
      communityTitle: 'Community health',
      communityHint: 'GitHub community standards profile',
      communityScore: 'Standards completion',
      sigReadme: 'README', sigLicense: 'License', sigContributing: 'Contributing',
      sigConduct: 'Code of conduct', sigIssue: 'Issue templates', sigPr: 'PR template',
      sigOn: 'provided', sigOff: 'missing',
      communityUnavailable: 'Community profile unavailable.',
      advisoriesTitle: 'Security advisories',
      advisoriesHint: 'Published GHSA advisories',
      advisoriesNone: 'No published security advisories.',
      advisoriesTotal: 'Total advisories',
      factsTitle: 'Repository checkup',
      factsHint: 'See at a glance whether this repo is still maintained and how active it is',
      factsGroupUpdates: 'Updates', factsGroupAttention: 'Attention', factsGroupTraits: 'Traits',
      heroActive: 'Actively maintained', heroUpdating: 'Recently updated', heroSlowing: 'Slowing down', heroDormant: 'No pushes in over a year',
      heroArchived: 'Archived — no longer maintained', heroDisabled: 'Disabled', heroUnknown: 'Maintenance status unknown',
      heroLastCommit: 'Last commit', heroLastRelease: 'Latest release',
      authorLabel: 'Author', authorSince: 'Created', authorAge: 'age',
      contribLine: 'Top contributors', contribSample: 'by commits · top-12 sample',
      relToday: 'today', relYesterday: 'yesterday', relDays: '{n}d ago', relWeeks: '{n}w ago', relMonths: '{n}mo ago', relYears: '{n}y ago',
      durDays: '{n}d', durMonths: '{n}mo', durYears: '{n}y',
      factPushedAt: 'Last push', factLatestCommitAt: 'Latest commit', factHasReleases: 'Has releases', factLatestReleaseAt: 'Latest release',
      factArchived: 'Archived', factDisabled: 'Disabled', factFork: 'Fork', factTemplate: 'Template', factLicense: 'License',
      factSecurityPolicy: 'Security policy', factCI: 'CI (GitHub Actions)', factReadme: 'README', factDocs: 'Docs',
      factStars: 'Stars', factForks: 'Forks', factOpenIssues: 'Open issues', factClosedIssues: 'Closed issues', factContributors: 'Contributors',
      factCreatedAt: 'Created', factAge: 'Repository age', factReleaseCount: 'Releases', factReleasesPerYear: 'Release frequency', factLatestStable: 'Latest stable',
      valYes: 'Yes', valNo: 'No', valNone: 'None', valUnknown: 'Unknown',
      valPerYear: '{n} / yr', valAge: '{n} days (≈ {y} yr)', valCountCapped: '{n}+',
      sigArchived: 'Archived', sigDisabled: 'Disabled', sigNoReleases: 'No releases', sigNoRecentActivity: 'No pushes in the last 12 months',
      factsDisclaimer: 'Objective facts only — no overall score. “Unknown” means the underlying data is unavailable.',
      radarTitle: 'Health radar', radarHint: 'Key dimensions · 0–100',
      axisMaintenance: 'Maintenance', axisPopularity: 'Popularity', axisQuality: 'Quality',
      axisRelease: 'Releases', axisCommunity: 'Community', axisSecurity: 'Security',
      maintainersTitle: 'Maintainers & contributors', maintainersHint: 'Owner profile, top contributors and the bus factor',
      ownerPanelTitle: 'Owner', contribPanelTitle: 'Contributors',
      contribFootnote: '12-person sample, sorted by commits; bars show share relative to the top contributor.',
      typeUser: 'User', typeOrg: 'Organization',
      ownerFollowers: 'Followers', ownerRepos: 'Public repos', ownerJoined: 'Joined',
      ownerLocation: 'Location', ownerCompany: 'Company', ownerBlog: 'Website',
      ownerUnavailable: 'Owner profile unavailable.',
      contribShare: 'Sample share',
      bfTitle: 'Bus factor',
      bfRisk: 'single point of failure', bfConcentrated: 'concentrated', bfModerate: 'moderate', bfHealthy: 'well distributed',
      bfDetail: 'Top {k} contributors account for {share}% of sample commits',
      bfNames: 'Key people: {names}',
      bfSampleNote: 'Estimated from the top-12 contributor sample',
      aiTitle: 'AI activity briefing', aiHint: 'Generated by your configured AI from merged PRs, release notes and commit stats',
      aiGenerate: 'Generate briefing', aiRegenerate: 'Regenerate',
      aiNote: 'The host will show the exact content and ask for confirmation each time',
      aiWaiting: 'Waiting for your confirmation in the host dialog…',
      aiDone: 'Done (AI generated, for reference only).',
      aiCancelled: 'Cancelled.',
      aiNotConfigured: 'No AI provider configured (Settings → AI).',
      aiFailed: 'AI request failed: {message}',
      starsTitle: 'Star trend',
      starsHint: 'Weekly new stars and cumulative curve',
      starsLast4: 'Last 4 weeks',
      starsLast12: 'Last 12 weeks',
      starsRange: 'Coverage: last {n} weeks',
      starsUnavailable: 'Star history is not available for this repository.',
      weeklyNew: 'New per week',
      cumulative: 'Cumulative',
      footer: 'Source: GitHub REST API (read-only requests proxied by the host; authenticated with your GitHub token, which this page cannot read). Results are cached in plugin-local storage and refreshed in the background after 6–72h freshness windows.',
      week: 'week of {m}-{d}',
    },
  };
  let str = STR.zh;
  const fmt = (template, params) => template.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`));
  const applyChromeStrings = () => {
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (str[key]) el.textContent = str[key];
    });
  };

  /* ── 桥 ───────────────────────────────────────────────────────────── */

  let token = null;
  let nextRequestId = 0;
  const pending = new Map();

  function request(method, args) {
    if (!token) return Promise.reject(new Error(str.bridgeNotReady));
    const requestId = String(++nextRequestId);
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      window.parent.postMessage({
        type: 'plugin-page:request', pluginId: PLUGIN_ID, pageId: PAGE_ID,
        requestId, token, method, args, origin: window.location.origin,
      }, '*');
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data ||
      event.data.pluginId !== PLUGIN_ID || event.data.pageId !== PAGE_ID) return;
    if (event.data.type === 'plugin-page:init' && typeof event.data.token === 'string') {
      token = event.data.token;
      handleInit(event.data.context || {});
      return;
    }
    if (event.data.type !== 'plugin-page:response' || event.data.token !== token) return;
    const handler = pending.get(event.data.requestId);
    if (!handler) return;
    pending.delete(event.data.requestId);
    if (event.data.success) handler.resolve(event.data.value);
    else handler.reject(Object.assign(new Error(event.data.error?.message || str.bridgeFailed), { code: event.data.error?.code }));
  });

  /* ── 工具 ─────────────────────────────────────────────────────────── */

  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
  /** 整数千分位格式化；非有限值显示为占位符。 */
  const int = (value) => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString() : '–');
  const $ = (id) => document.getElementById(id);

  /** 把缓存时间戳格式化为“N 分钟/小时/天前”的人类可读文案。 */
  function ageText(fetchedAt) {
    const minutes = Math.max(0, Math.round((Date.now() - fetchedAt) / 60000));
    if (minutes < 1) return str.justNow;
    if (minutes < 60) return fmt(str.minutes, { n: minutes });
    if (minutes < 60 * 24) return fmt(str.hours, { n: Math.round(minutes / 60) });
    return fmt(str.days, { n: Math.round(minutes / (60 * 24)) });
  }

  /** 相对时间文案：天/周/月/年自动进位。 */
  function relativeDays(days) {
    if (days <= 0) return str.relToday;
    if (days === 1) return str.relYesterday;
    if (days < 45) return fmt(str.relDays, { n: days });
    if (days < 365) return fmt(str.relMonths, { n: Math.round(days / 30) });
    return fmt(str.relYears, { n: (Math.round((days / 365.25) * 10) / 10) });
  }

  /** 时长文案（不带“前”）：仓库年龄等。 */
  function durationDays(days) {
    if (days < 45) return fmt(str.durDays, { n: days });
    if (days < 365) return fmt(str.durMonths, { n: Math.round(days / 30) });
    return fmt(str.durYears, { n: Math.round((days / 365.25) * 10) / 10 });
  }

  /** ISO 时间字符串 → YYYY-MM-DD；不可解析时显示占位符。 */
  function shortDate(iso) {
    const time = Date.parse(iso);
    return Number.isFinite(time)
      ? new Date(time).toISOString().slice(0, 10)
      : '–';
  }

  /* ── 仓库健康事实：镜像宿主 repositoryHealth 的推导口径 ─────────────── */

  const PRERELEASE_TOKENS = new Set([
    'alpha', 'beta', 'rc', 'pre', 'prerelease', 'preview', 'dev', 'devel',
    'next', 'canary', 'snapshot', 'nightly', 'insider', 'unstable',
  ]);

  /** 与宿主一致：先信 GitHub 的 prerelease 标记，再按 tag 词元兜底。 */
  function isPrereleaseRelease(release) {
    if (release.prerelease === true) return true;
    const tag = (release.tag_name ?? '').toLowerCase();
    if (!tag) return false;
    return tag.split(/[^a-z0-9]+/).filter(Boolean).some((token) => PRERELEASE_TOKENS.has(token.replace(/\d+$/, '')));
  }

  /** 把可能缺失/非数的计数收敛为非负整数（缺省 0）。 */
  const toCountValue = (value) => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  };
  /** 把时间字符串解析为 epoch 毫秒；缺失或不可解析返回 null。 */
  const toTimestampValue = (value) => {
    const timestamp = Date.parse(value ?? '');
    return Number.isFinite(timestamp) ? timestamp : null;
  };

  /* ── Chart.js 主题 ────────────────────────────────────────────────── */

  const charts = new Map();
  let chartSeq = 0;

  /** 从当前 CSS 变量读取 Chart.js 主题色（跟随深浅主题）。 */
  function chartTheme() {
    const style = getComputedStyle(document.body);
    return {
      tx2: style.getPropertyValue('--tx2').trim() || '#8a93a8',
      grid: style.getPropertyValue('--track').trim() || '#1d2434',
      tooltipBg: document.body.dataset.theme === 'dark' ? '#1c2333' : '#ffffff',
    };
  }

  /** 按 canvasId 重建 Chart.js 实例（先销毁旧实例，避免泄漏），并注入统一主题。 */
  function drawChart(canvasId, config) {
    if (typeof Chart === 'undefined') return;
    const theme = chartTheme();
    Chart.defaults.color = theme.tx2;
    Chart.defaults.borderColor = theme.grid;
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    charts.get(canvasId)?.destroy();
    charts.set(canvasId, new Chart($(canvasId), {
      ...config,
      options: {
        maintainAspectRatio: false,
        responsive: true,
        interaction: { mode: 'index', intersect: false },
        ...config.options,
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: theme.tooltipBg, titleColor: theme.tx2, bodyColor: theme.tx2 },
          ...(config.options?.plugins ?? {}),
        },
      },
    }));
  }

  /* ── 指标缓存与并发队列 ───────────────────────────────────────────── */

  // pluginStorage 单键上限 128 字符；owner/repo 全长可达 ~140，故对 repoKey 取
  // FNV-1a 32 位哈希（base36）作键。仅作缓存命名空间，不承载安全语义。
  /** FNV-1a 32 位哈希的 base36 形式，用作缓存键的仓库命名空间。 */
  const hash36 = (value) => {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
  };
  /** 缓存键：账号隔离由条目内 acct 字段承担，键内含仓库哈希与数据集 id。 */
  const cacheKey = (repoKey, metricId) => `ins:${CACHE_SCHEMA}:${hash36(repoKey)}:${metricId}`;

  /** 读缓存；账号标签不一致的条目视为脏数据并删除（切账号不留存旧数据）。 */
  async function readCache(repoKey, metricId) {
    try {
      const entry = await request('storage.get', { key: cacheKey(repoKey, metricId) });
      if (!entry || typeof entry !== 'object' || !Number.isFinite(entry.fetchedAt)) return null;
      // 账号已知且不匹配：脏缓存（可能来自另一个 GitHub 账号），删除并忽略。
      if (state.acct && entry.acct && entry.acct !== state.acct) {
        void request('storage.delete', { key: cacheKey(repoKey, metricId) }).catch(() => {});
        return null;
      }
      return entry;
    } catch { /* 缓存读取失败按无缓存处理 */ }
    return null;
  }

  /** 写缓存；私有仓库与账号未知时绝不落盘，超限/配额失败静默放弃。 */
  function writeCache(repoKey, metricId, payload, ttl) {
    if (state.privateRepo || !state.acct) return;
    const entry = { fetchedAt: Date.now(), ttl, acct: state.acct, payload };
    // 单值上限 64 KiB，写入失败（超限/配额）静默放弃缓存。
    request('storage.set', { key: cacheKey(repoKey, metricId), value: entry }).catch(() => {});
  }

  const CACHED_METRIC_IDS = ['repo', 'commitActivity', 'codeFrequency', 'contributors', 'languages',
    'releases', 'pulls', 'ownerProfile', 'community', 'advisories', 'starHistory'];

  /** 清空该仓库的全部缓存条目（私有仓库标记或账号切换时用）。 */
  function purgeRepoCache(repoKey) {
    for (const metricId of CACHED_METRIC_IDS) {
      void request('storage.delete', { key: cacheKey(repoKey, metricId) }).catch(() => {});
    }
  }

  /** 创建定并发任务队列：FIFO、上限内立即执行、异常不阻塞后续任务。 */
  function createQueue(limit) {
    const waiting = [];
    let active = 0;
    const next = () => {
      if (active >= limit || waiting.length === 0) return;
      active += 1;
      const { task, settle } = waiting.shift();
      task().then(
        (value) => { active -= 1; settle.resolve(value); next(); },
        (error) => { active -= 1; settle.reject(error); next(); },
      );
    };
    return (task) => new Promise((resolve, reject) => {
      waiting.push({ task, settle: { resolve, reject } });
      next();
    });
  }

  /** 经 network.request 桥取一个端点；202/204 返回 { status, body: null }。
   *  absolute 为 true 时 pathSuffix 本身就是完整路径（如 /users/{login}）。 */
  async function fetchMetric(owner, repo, pathSuffix, query, absolute = false) {
    const value = await request('network.request', {
      host: 'api.github.com',
      path: absolute ? pathSuffix : `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${pathSuffix}`,
      query: query ?? {},
    });
    // 记录宿主下发的账号标签（Token 的 SHA-256 截断），供缓存按账号隔离。
    if (value && typeof value === 'object' && typeof value.acct === 'string') {
      if (state.acct && state.acct !== value.acct) purgeRepoCache(state.repoKey);
      state.acct = value.acct;
    }
    // 宿主把 403/404 等归一为 success:false；202/204 是 success:true + body:null。
    return value;
  }

  /* ── 状态 ─────────────────────────────────────────────────────────── */

  const state = {
    repository: null,
    owner: null,
    repo: null,
    repoKey: null,
    data: new Map(),      // metricId → payload
    meta: new Map(),      // metricId → { stale: boolean }
    runSeq: 0,
    queue: createQueue(6),
    // GitHub 身份标签（宿主随响应下发，页面拿不到 Token）；缓存按账号隔离。
    acct: null,
    // 私有仓库（或身份未知时）不写缓存：避免本地缓存跨 GitHub 账号留存
    // 非公开数据。宿主能力桥按账号隔离由渲染端 acct 保证，这里是第二道闸。
    privateRepo: false,
  };

  /* ── 渲染：头部与 KPI ─────────────────────────────────────────────── */

  function renderHeader() {
    const r = state.repository;
    if (!r) return;
    const [owner, name] = String(r.full_name ?? '').split('/');
    $('repo-link').innerHTML = `<span class="owner">${esc(owner)}</span>/<wbr>${esc(name)}`;
    const htmlUrl = typeof r.html_url === 'string' && r.html_url.startsWith('https://') ? r.html_url : `https://github.com/${owner}/${name}`;
    $('repo-link').href = htmlUrl;
    $('repo-desc').textContent = r.custom_description || r.description || '';
    $('head').hidden = false;
  }

  /** 渲染 KPI 行：星标/复刻/开放 Issue/关注者/许可证/创建时间（快照与实时详情合并）。 */
  function renderKpis() {
    const r = state.repository;
    const live = state.data.get('repo') || {};
    const stars = live.stargazers_count ?? r.stargazers_count;
    const forks = live.forks_count ?? r.forks_count;
    const issues = live.open_issues_count ?? r.open_issues_count;
    const watchers = live.subscribers_count ?? null;
    const license = (live.license?.spdx_id ?? r.license?.spdx_id) || null;
    const archived = Boolean(live.archived ?? r.archived);
    const items = [
      { v: int(stars), l: str.stars, d: '', c: 'neu' },
      { v: int(forks), l: str.forks, d: '', c: 'neu' },
      { v: int(issues), l: str.issues, d: '', c: 'neu' },
    ];
    if (watchers != null) items.push({ v: int(watchers), l: str.watchers, d: '', c: 'neu' });
    items.push({ v: license && license !== 'NOASSERTION' ? license : '–', l: str.license, d: '', c: 'neu' });
    items.push({ v: shortDate(live.created_at ?? r.created_at), l: str.created, d: archived ? str.archived : '', c: archived ? 'down' : 'neu' });
    $('kpis').innerHTML = items.map((k) => `<div class="kpi"><div class="v">${esc(k.v)}</div><div class="l">${esc(k.l)}</div><div class="d ${k.c}">${esc(k.d)}</div></div>`).join('');
    $('kpis').hidden = false;
  }

  /* ── 健康分 ───────────────────────────────────────────────────────── */

  const RING_CIRCUMFERENCE = 2 * Math.PI * 34;

  /** 仓库健康度 0–100 评分：维护活跃 40% + 热度 30% + 质量 30%，附各子分数供雷达使用。 */
  function computeHealthScore() {
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const releases = state.data.get('releases');
    const commits = state.data.get('commitActivity');
    const clamp = (v) => Math.max(0, Math.min(100, v));
    const now = Date.now();

    // 维护活跃度（40%）
    let maintenance = 50;
    if (r.archived) maintenance -= 45;
    const pushedDays = r.pushed_at ? (now - Date.parse(r.pushed_at)) / 86400000 : Infinity;
    if (pushedDays < 30) maintenance += 30;
    else if (pushedDays < 180) maintenance += 15;
    else if (pushedDays < 365) maintenance -= 5;
    else maintenance -= 20;
    const published = Array.isArray(releases)
      ? releases.filter((x) => !x.draft && x.published_at).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
      : [];
    if (published[0]) {
      const releaseDays = (now - Date.parse(published[0].published_at)) / 86400000;
      if (releaseDays < 180) maintenance += 15;
      else if (releaseDays > 365) maintenance -= 10;
    } else if (Array.isArray(releases)) maintenance -= 5;
    if (Array.isArray(commits) && commits.length >= 8) {
      const last8 = commits.slice(-8).reduce((sum, w) => sum + (w.total || 0), 0);
      if (last8 > 0) maintenance += 10;
    }

    // 热度（30%）
    const log = (v) => Math.log10(Math.max(1, v));
    const stars = r.stargazers_count ?? 0;
    const forks = r.forks_count ?? 0;
    const watchers = r.subscribers_count ?? 0;
    const popularity = Math.min(60, log(stars) * 15) + Math.min(25, log(forks) * 8) + Math.min(15, log(watchers) * 5);

    // 质量（30%）
    let quality = 35;
    if (r.license) quality += 15;
    if (Array.isArray(r.topics) && r.topics.length > 0) quality += 15;
    if (r.homepage) quality += 10;
    const issues = r.open_issues_count;
    if (typeof issues === 'number') quality += issues <= 20 ? 10 : issues > 500 ? -10 : 0;

    const parts = {
      maintenance: Math.round(clamp(maintenance)),
      popularity: Math.round(clamp(popularity)),
      quality: Math.round(clamp(quality)),
    };
    const overall = Math.round(parts.maintenance * 0.4 + parts.popularity * 0.3 + parts.quality * 0.3);
    const grade = overall >= 90 ? 'A' : overall >= 80 ? 'B' : overall >= 70 ? 'C' : overall >= 60 ? 'D' : 'E';
    return { overall, grade, parts };
  }

  /** 渲染健康分圆环与等级，并联动健康度雷达。 */
  function renderHealth() {
    const { overall, grade } = computeHealthScore();
    $('ring-value').setAttribute('stroke-dasharray', `${(overall / 100) * RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`);
    $('ring-value').setAttribute('class', `ring-value grade-${grade.toLowerCase()}`);
    $('health-score').textContent = String(overall);
    const gradeEl = $('health-grade');
    gradeEl.textContent = grade;
    gradeEl.className = `health-grade grade-${grade.toLowerCase()}`;
    $('health-label').textContent = str.healthLabel;
    $('health-box').hidden = false;
    renderRadar();
  }

  /* ── 区块渲染 ─────────────────────────────────────────────────────── */

  function setState(cardId, message, kind) {
    const stateEl = $(cardId).querySelector('.state');
    stateEl.textContent = message || '';
    stateEl.className = `state${kind ? ` ${kind}` : ''}`;
  }

  /** 显示/隐藏卡片内的图表画布区。 */
  function showChart(cardId, visible) {
    $(cardId).querySelector('.ch').hidden = !visible;
  }

  /** 填充或清空卡片的 chips 行。 */
  function showChips(cardId, chipsHtml) {
    const chips = $(cardId).querySelector('.chips');
    if (!chips) return;
    chips.innerHTML = chipsHtml || '';
    chips.hidden = !chipsHtml;
  }

  /** 把 commit_activity 的周时间戳格式化为图表横轴标签。 */
  function weekLabel(tsSeconds) {
    const date = new Date(tsSeconds * 1000);
    return fmt(str.week, { m: date.getUTCMonth() + 1, d: date.getUTCDate() });
  }

  /** 渲染 52 周提交柱状图与近 4 周/活跃周摘要 chips。 */
  function renderCommits(payload, meta) {
    if (!Array.isArray(payload) || payload.length === 0) return false;
    state.data.set('commitActivity', payload);
    const weeks = payload.slice(-52);
    const sum = (list) => list.reduce((acc, w) => acc + (w.total || 0), 0);
    const last4 = sum(weeks.slice(-4));
    const prev4 = sum(weeks.slice(-8, -4));
    const delta = prev4 > 0 ? Math.round(((last4 - prev4) / prev4) * 100) : last4 > 0 ? 100 : 0;
    const activeWeeks = weeks.slice(-8).filter((w) => (w.total || 0) > 0).length;
    showChips('card-commits', `
      <span class="chip">${esc(str.commitsLast4)}<b>${int(last4)}</b></span>
      <span class="chip">${esc(str.commitsDelta)}<b class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${delta}%</b></span>
      <span class="chip">${esc(str.commitsActiveWeeks)}<b>${fmt(str.commitsOf8, { n: activeWeeks })}</b></span>`);
    drawChart('card-commits-canvas', {
      type: 'bar',
      data: {
        labels: weeks.map((w) => weekLabel(w.week)),
        datasets: [{
          data: weeks.map((w) => w.total || 0),
          backgroundColor: 'rgba(79, 143, 247, .55)',
          borderRadius: 2,
        }],
      },
      options: { scales: { x: { ticks: { maxTicksLimit: 12, maxRotation: 0 } }, y: { beginAtZero: true } } },
    });
    showChart('card-commits', true);
    setState('card-commits', meta?.stale ? `${str.fromCache} · ${esc(ageText(meta.fetchedAt))}` : '');
    renderHealth();
    renderFacts();
    return true;
  }

  /** 渲染每周新增/删除行数的双向柱状图（GitHub 的 deletions 为负数，直接画在零线下方）。 */
  function renderChurn(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return false;
    state.data.set('codeFrequency', payload);
    const weeks = payload.slice(-52);
    drawChart('card-churn-canvas', {
      type: 'bar',
      data: {
        labels: weeks.map((w) => weekLabel(w[0])),
        datasets: [
          { label: str.churnAdditions, data: weeks.map((w) => w[1] || 0), backgroundColor: 'rgba(47, 191, 127, .6)', borderRadius: 2 },
          // GitHub 的 deletions 本身是负数，柱子直接画在零线下方。
          { label: str.churnDeletions, data: weeks.map((w) => w[2] || 0), backgroundColor: 'rgba(255, 93, 115, .6)', borderRadius: 2 },
        ],
      },
      options: {
        scales: {
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 } },
          y: { ticks: { callback: (v) => Math.abs(v) } },
        },
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10 } } },
      },
    });
    showChart('card-churn', true);
    setState('card-churn', '');
    return true;
  }

  const LANGUAGE_PALETTE = ['#4f8ff7', '#9a6bff', '#2fbf7f', '#ffb454', '#ff5d73', '#5ec8ff', '#c084fc', '#86efac', '#8a93a8'];

  /** 渲染语言分布环形图（Top 8 + 其他），并标注语言种数。 */
  function renderLanguages(payload) {
    if (!payload || typeof payload !== 'object') return false;
    const entries = Object.entries(payload).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0) return false;
    state.data.set('languages', payload);
    const top = entries.slice(0, 8);
    const restBytes = entries.slice(8).reduce((sum, [, bytes]) => sum + bytes, 0);
    if (restBytes > 0) top.push([str.languagesOther, restBytes]);
    const total = entries.reduce((sum, [, bytes]) => sum + bytes, 0);
    drawChart('card-languages-canvas', {
      type: 'doughnut',
      data: {
        labels: top.map(([name]) => name),
        datasets: [{
          data: top.map(([, bytes]) => bytes),
          backgroundColor: LANGUAGE_PALETTE.slice(0, top.length),
          borderColor: getComputedStyle(document.body).getPropertyValue('--panel').trim() || '#12161f',
          borderWidth: 2,
        }],
      },
      options: {
        cutout: '62%',
        plugins: {
          legend: { display: true, position: 'right', labels: { boxWidth: 10, font: { size: 11 } } },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${total > 0 ? ((c.parsed / total) * 100).toFixed(1) : '0'}%` } },
        },
      },
    });
    showChart('card-languages', true);
    setState('card-languages', fmt(str.languagesCount, { n: entries.length }));
    return true;
  }

  /** 仅存储贡献者样本并触发维护者容器渲染（贡献者不再有独立图表卡）。 */
  function renderContributors(payload) {
    if (!Array.isArray(payload) || payload.length === 0) return false;
    const top = payload.slice(0, 12).filter((c) => c.login);
    if (top.length === 0) return false;
    state.data.set('contributors', top);
    renderMaintainers();
    return true;
  }

  /** 裁剪并存储所有者资料，触发维护者容器渲染。 */
  function paintOwnerProfile(payload) {
    if (!payload || typeof payload !== 'object' || !payload.login) return false;
    state.data.set('ownerProfile', {
      login: payload.login,
      type: payload.type,
      name: payload.name ?? null,
      bio: payload.bio ?? null,
      company: payload.company ?? null,
      location: payload.location ?? null,
      blog: payload.blog ?? null,
      followers: payload.followers,
      public_repos: payload.public_repos,
      created_at: payload.created_at,
    });
    renderMaintainers();
    return true;
  }

  /** 裁剪已合并 PR（按合并时间降序取前 15）供 AI 提示词使用。 */
  function paintPulls(payload) {
    if (!Array.isArray(payload)) return false;
    const merged = payload
      .filter((pr) => pr.merged_at)
      .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
      .slice(0, 15)
      .map((pr) => ({ number: pr.number, title: pr.title, user: pr.user?.login ?? null, merged_at: pr.merged_at }));
    state.data.set('pulls', merged);
    return true;
  }


  /** 渲染发布节奏：摘要 chips、月度发布柱状图与最近 5 条列表；保留最近 15 条截断日志供 AI 使用。 */
  function renderReleases(payload) {
    if (!Array.isArray(payload)) return false;
    const published = payload
      .filter((r) => !r.draft && r.published_at)
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    state.data.set('releases', published.map((r, index) => ({
      tag_name: r.tag_name, name: r.name, published_at: r.published_at, prerelease: Boolean(r.prerelease),
      // 最近 15 条保留截断后的更新日志，供 AI 动态分析使用（缓存单值 64 KiB 上限内）。
      ...(index < 15 ? { body: String(r.body ?? '').slice(0, 1200) } : {}),
    })));
    if (published.length === 0) {
      showChart('card-releases', false);
      showChips('card-releases', '');
      $('card-releases').querySelector('.rows').innerHTML = '';
      setState('card-releases', str.releasesNone);
      renderHealth();
      renderFacts();
      return true;
    }
    const now = Date.now();
    const inYear = published.filter((r) => now - Date.parse(r.published_at) < 365 * 86400000);
    // per_page=100 封顶时，取到的样本不足以给出精确计数，展示 100+。
    const releasesCapped = published.length >= 100;
    const recent = published.slice(0, 12);
    const avgDays = recent.length >= 2
      ? Math.round((Date.parse(recent[0].published_at) - Date.parse(recent[recent.length - 1].published_at)) / 86400000 / (recent.length - 1))
      : null;
    showChips('card-releases', `
      <span class="chip">${esc(str.releasesYear)}<b>${releasesCapped ? fmt(str.valCountCapped, { n: int(inYear.length) }) : int(inYear.length)}</b></span>
      ${avgDays != null ? `<span class="chip">${esc(str.releasesInterval)}<b>${fmt(str.releasesDays, { n: avgDays })}</b></span>` : ''}
      <span class="chip">${esc(str.releasesLatest)}<b>${esc(published[0].tag_name)}</b></span>`);
    // 月度发布数（近 12 个月）
    const months = [];
    const cursor = new Date();
    cursor.setUTCDate(1);
    for (let i = 0; i < 12; i += 1) {
      months.unshift(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() - 1);
    }
    const perMonth = new Map(months.map((m) => [m, 0]));
    for (const release of published) {
      const key = release.published_at.slice(0, 7);
      if (perMonth.has(key)) perMonth.set(key, perMonth.get(key) + 1);
    }
    drawChart('card-releases-canvas', {
      type: 'bar',
      data: {
        labels: months.map((m) => m.slice(2)),
        datasets: [{ data: months.map((m) => perMonth.get(m)), backgroundColor: 'rgba(47, 191, 127, .6)', borderRadius: 3 }],
      },
      options: { scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 12, maxRotation: 0 } } } },
    });
    showChart('card-releases', true);
    $('card-releases').querySelector('.rows').innerHTML = published.slice(0, 5).map((r) => `
      <li>
        <span class="tag-name">${esc(r.tag_name)}</span>
        ${r.prerelease ? `<span class="badge prerelease">${esc(str.prerelease)}</span>` : ''}
        <span class="muted">${esc(r.name || '')}</span>
        <span class="row-date">${esc(shortDate(r.published_at))}</span>
      </li>`).join('');
    setState('card-releases', '');
    renderHealth();
    renderFacts();
    return true;
  }

  const COMMUNITY_SIGNALS = [
    ['readme', 'sigReadme'], ['license', 'sigLicense'], ['contributing', 'sigContributing'],
    ['code_of_conduct', 'sigConduct'], ['issue_template', 'sigIssue'], ['pull_request_template', 'sigPr'],
  ];

  /** 渲染社区健康百分比与六项标准文件信号徽章。 */
  function renderCommunity(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.health_percentage !== 'number') return false;
    state.data.set('community', payload);
    const files = payload.files ?? {};
    $('community-pct').textContent = `${payload.health_percentage}%`;
    $('community-pct-label').textContent = str.communityScore;
    $('community-signals').innerHTML = COMMUNITY_SIGNALS.map(([key, labelKey]) => {
      const present = Boolean(files[key]);
      return `<li><span class="badge ${present ? 'sig-on' : 'sig-off'}">${present ? esc(str.sigOn) : esc(str.sigOff)}</span>${esc(str[labelKey])}</li>`;
    }).join('');
    setState('card-community', '');
    renderFacts();
    renderRadar();
    return true;
  }

  /** 渲染已发布安全公告：仅保留有 published_at 的条目，按严重程度计数并列出最近 8 条。 */
  function renderAdvisories(payload) {
    if (!Array.isArray(payload)) return false;
    // 只展示已发布的公告：非发布态（草稿/triage）条目没有 published_at。
    const publishedAdvisories = payload
      .filter((a) => typeof a.published_at === 'string')
      .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    state.data.set('advisories', publishedAdvisories.slice(0, 10).map((a) => ({
      ghsa_id: a.ghsa_id ?? null,
      cve_id: a.cve_id ?? null,
      severity: a.severity ?? null,
      summary: a.summary ?? null,
      published_at: a.published_at,
    })));
    const count = (severity) => publishedAdvisories.filter((a) => a.severity === severity).length;
    const chips = [];
    if (count('critical')) chips.push(`<span class="chip">Critical<b class="down">${count('critical')}</b></span>`);
    if (count('high')) chips.push(`<span class="chip">High<b class="down">${count('high')}</b></span>`);
    chips.push(`<span class="chip">${esc(str.advisoriesTotal)}<b>${publishedAdvisories.length}</b></span>`);
    showChips('card-advisories', chips.join(''));
    $('advisory-rows').innerHTML = publishedAdvisories.slice(0, 8).map((a) => `
      <li>
        <span class="badge sev-${esc(a.severity || 'low')}">${esc((a.severity || 'low').toUpperCase())}</span>
        <span class="tag-name">${esc(a.ghsa_id || a.cve_id || '')}</span>
        <span class="muted">${esc(a.summary || '')}</span>
        <span class="row-date">${esc(shortDate(a.published_at))}</span>
      </li>`).join('');
    setState('card-advisories', publishedAdvisories.length === 0 ? str.advisoriesNone : '');
    renderRadar();
    renderFacts();
    return true;
  }


  /* ── 健康度雷达：总分之外的维度分解（未知维度自动省略） ── */

  function deriveRadarAxes() {
    const health = computeHealthScore();
    const releases = state.data.get('releases');
    const community = state.data.get('community');
    const advisories = state.data.get('advisories');
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const axes = [
      { label: str.axisMaintenance, value: health.parts.maintenance },
      { label: str.axisPopularity, value: health.parts.popularity },
      { label: str.axisQuality, value: health.parts.quality },
    ];
    // 发布节奏：最新发布新鲜度（60%）与发布频率（40%）合成。
    const releasesKnown = Array.isArray(releases);
    if (releasesKnown) {
      const now = Date.now();
      const days = releases[0] ? (now - Date.parse(releases[0].published_at)) / MS_PER_DAY : Infinity;
      const recency = days < 90 ? 100 : days < 180 ? 80 : days < 365 ? 55 : days < 730 ? 30 : 10;
      const createdTs = Date.parse(r.created_at ?? '');
      const ageDays = Number.isFinite(createdTs) ? Math.max(30, (now - createdTs) / MS_PER_DAY) : null;
      const perYear = ageDays !== null ? releases.length / (ageDays / 365.25) : null;
      const frequency = perYear !== null && Number.isFinite(perYear)
        ? Math.min(100, (perYear / 24) * 100)
        : recency;
      axes.push({ label: str.axisRelease, value: Math.round(0.6 * recency + 0.4 * frequency) });
    }
    if (community && typeof community.health_percentage === 'number') {
      axes.push({ label: str.axisCommunity, value: Math.round(community.health_percentage) });
    }
    if (Array.isArray(advisories)) {
      const count = (severity) => advisories.filter((a) => a.severity === severity).length;
      axes.push({ label: str.axisSecurity, value: Math.max(0, 100 - 30 * count('critical') - 15 * count('high') - 5 * count('medium')) });
    }
    return axes;
  }

  /** 渲染健康度雷达图（维度随可用数据动态增减）。 */
  function renderRadar() {
    const axes = deriveRadarAxes();
    const theme = chartTheme();
    drawChart('card-radar-canvas', {
      type: 'radar',
      data: {
        labels: axes.map((a) => a.label),
        datasets: [{
          data: axes.map((a) => a.value),
          backgroundColor: 'rgba(79, 143, 247, .22)',
          borderColor: '#4f8ff7',
          borderWidth: 2,
          pointBackgroundColor: '#4f8ff7',
          pointRadius: 3,
        }],
      },
      options: {
        scales: {
          r: {
            min: 0, max: 100,
            ticks: { display: false, stepSize: 25 },
            grid: { color: theme.grid },
            angleLines: { color: theme.grid },
            pointLabels: { color: theme.tx2, font: { size: 11 } },
          },
        },
      },
    });
    showChart('card-radar', true);
    setState('card-radar', '');
    $('card-radar').hidden = false;
  }

  /* ── 维护者与贡献者容器 + 巴士因子 ── */

  /** 巴士因子：样本内累计提交达到 50% 所需的最少贡献者人数。 */
  function computeBusFactor(contribs) {
    if (!Array.isArray(contribs) || contribs.length === 0) return null;
    const total = contribs.reduce((sum, c) => sum + (c.contributions || 0), 0);
    if (total <= 0) return null;
    let cumulative = 0;
    let k = 0;
    for (const c of contribs) {
      cumulative += c.contributions || 0;
      k += 1;
      if (cumulative / total >= 0.5) break;
    }
    return {
      k,
      share: Math.round((cumulative / total) * 100),
      names: contribs.slice(0, k).map((c) => c.login),
    };
  }

  /** 把占比量化到 5% 步长，映射到静态宽度类（CSP 禁内联样式）。 */
  function quantizeShare(percent) {
    return Math.max(5, Math.round(percent / 5) * 5);
  }

  /** 渲染维护者容器：左栏所有者资料与巴士因子，右栏贡献者概要列表。 */
  function renderMaintainers() {
    const card = $('card-maintainers');
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const owner = String(r.full_name ?? '').split('/')[0] ?? '';
    const profile = state.data.get('ownerProfile');

    // 左子面板：所有者资料
    $('maint-owner-title').textContent = str.ownerPanelTitle;
    if (owner) {
      let hash = 0;
      for (const ch of owner) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
      const avatar = $('owner-avatar');
      avatar.textContent = owner.charAt(0).toUpperCase();
      avatar.className = `avatar avatar-lg h${hash % 8}`;
      avatar.hidden = false;
      $('owner-login').textContent = owner;
      const typeLabel = profile?.type === 'Organization' ? str.typeOrg : profile ? str.typeUser : '';
      const name = typeof profile?.name === 'string' && profile.name ? profile.name : '';
      $('owner-tagline').textContent = [typeLabel, name].filter(Boolean).join(' · ');
      $('owner-bio').textContent = typeof profile?.bio === 'string' ? profile.bio : '';
      const facts = [];
      if (profile?.blog) facts.push(['ownerBlog', esc(profile.blog)]);
      if (profile?.location) facts.push(['ownerLocation', esc(profile.location)]);
      if (profile?.company) facts.push(['ownerCompany', esc(profile.company)]);
      if (Number.isFinite(profile?.followers)) facts.push(['ownerFollowers', int(profile.followers)]);
      if (Number.isFinite(profile?.public_repos)) facts.push(['ownerRepos', int(profile.public_repos)]);
      if (profile?.created_at) facts.push(['ownerJoined', esc(shortDate(profile.created_at))]);
      $('owner-facts').innerHTML = facts.length > 0
        ? facts.map(([key, value]) => `<div class="fact-row"><dt>${esc(str[key])}</dt><dd>${value}</dd></div>`).join('')
        : `<div class="fact-row"><dd class="unknown">${esc(str.ownerUnavailable)}</dd></div>`;
      // 巴士因子与所有者同栏：回答「谁在维护、维护集中度如何」。
      const contribs = state.data.get('contributors');
      const box = $('busfactor-box');
      const bus = computeBusFactor(contribs);
      if (bus) {
        const tier = bus.k === 1 ? 'risk' : bus.k <= 2 ? 'warn' : bus.k <= 3 ? 'moderate' : 'ok';
        const tierKey = bus.k === 1 ? 'bfRisk' : bus.k <= 2 ? 'bfConcentrated' : bus.k <= 3 ? 'bfModerate' : 'bfHealthy';
        box.className = `busfactor ${tier}`;
        const shown = bus.k > contribs.length ? `${contribs.length}+` : String(bus.k);
        box.innerHTML = `<div class="bf-num"><b>${shown}</b><span>${esc(str.bfTitle)}</span></div>` +
          `<div class="bf-body"><span class="bf-title">${esc(str[tierKey])}</span>` +
          `<div class="bf-detail">${esc(fmt(str.bfDetail, { k: bus.k, share: bus.share }))}` +
          (bus.k <= 3 ? ` · ${esc(fmt(str.bfNames, { names: bus.names.join(', ') }))}` : '') +
          `<br>${esc(str.bfSampleNote)}</div></div>`;
      } else {
        box.className = 'busfactor';
        box.innerHTML = `<div class="bf-num"><b>–</b><span>${esc(str.bfTitle)}</span></div>` +
          `<div class="bf-body"><span class="bf-detail">${esc(str.ownerUnavailable)}</span></div>`;
      }
    }

    // 右子面板：贡献者概要列表（全部 12 名样本）
    $('maint-contrib-title').textContent = str.contribPanelTitle;
    const contribs = state.data.get('contributors');
    const list = $('contrib-list');
    const maxCommits = contribs?.[0]?.contributions || 1;
    const sampleTotal = (contribs ?? []).reduce((sum, c) => sum + (c.contributions || 0), 0) || 1;
    list.innerHTML = (contribs ?? []).slice(0, 12).map((c) => {
      let hash = 0;
      for (const ch of c.login) hash = (hash * 31 + ch.codePointAt(0)) >>> 0;
      const barShare = quantizeShare(Math.round(((c.contributions || 0) / maxCommits) * 100));
      const sampleShare = Math.round(((c.contributions || 0) / sampleTotal) * 100);
      return `<li>
        <span class="avatar h${hash % 8}" aria-hidden="true">${esc(c.login.charAt(0).toUpperCase())}</span>
        <span class="contrib-login">${esc(c.login)}</span>
        <span class="contrib-bar"><span class="contrib-bar-fill b${barShare}"></span></span>
        <span class="contrib-stat"><b>${int(c.contributions)}</b> · ${sampleShare}%</span>
      </li>`;
    }).join('');
    $('contrib-note').textContent = contribs ? str.contribFootnote : '';
    if (!contribs) setState('card-maintainers', str.loading);
    else setState('card-maintainers', '');
    card.hidden = false;
  }

  /* ── AI 近期动态分析 ── */

  function buildAiPrompt() {
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const releases = (state.data.get('releases') ?? []).slice(0, 12);
    const pulls = (state.data.get('pulls') ?? []).slice(0, 20);
    const advisories = (state.data.get('advisories') ?? []).slice(0, 8);
    const contribs = state.data.get('contributors');
    const bus = computeBusFactor(contribs);
    const commits = state.data.get('commitActivity');
    const weeks = Array.isArray(commits) ? commits.slice(-8) : [];
    const last4 = weeks.slice(-4).reduce((sum, w) => sum + (w.total || 0), 0);
    const prev4 = weeks.slice(0, 4).reduce((sum, w) => sum + (w.total || 0), 0);
    const lines = [];
    lines.push(`# Repository: ${r.full_name}`);
    lines.push(`language=${r.language ?? 'unknown'} license=${r.license?.spdx_id ?? 'none'} stars=${r.stargazers_count ?? '?'}`);
    if (weeks.length >= 8) lines.push(`commits: last4weeks=${last4} prior4weeks=${prev4}`);
    if (releases.length > 0) {
      lines.push(`latest release: ${releases[0].tag_name} (${releases[0].published_at?.slice(0, 10) ?? 'n/a'})`);
      const withBody = releases.filter((x) => x.body).length;
      lines.push(`recent releases fetched: ${releases.length} (release notes included for ${withBody})`);
    }
    if (bus) lines.push(`bus factor: ${bus.k} (top contributors: ${contribs.slice(0, 3).map((c) => c.login).join(', ')})`);
    if (advisories.length > 0) {
      lines.push('published security advisories (most recent first):');
      for (const a of advisories) {
        lines.push(`- [${a.severity}] ${a.ghsa_id} (${a.published_at?.slice(0, 10) ?? ''}): ${String(a.summary ?? '').slice(0, 140)}`);
      }
    }
    if (pulls.length > 0) {
      lines.push('recently merged PRs:');
      for (const pr of pulls) lines.push(`- #${pr.number} ${String(pr.title ?? '').slice(0, 160)} — @${pr.user} — ${pr.merged_at?.slice(0, 10) ?? ''}`);
    }
    if (releases.length > 0) {
      lines.push('recent release notes (truncated):');
      for (const release of releases) {
        if (release.body) lines.push(`## ${release.tag_name} (${release.published_at?.slice(0, 10) ?? ''})
${release.body}`);
      }
    }
    return lines.join('\n').slice(0, 100_000);
  }

  /** 请求 AI 生成分节要点分析；经宿主逐次确认，未配置 Provider/用户取消均有对应文案。 */
  async function generateAiBriefing() {
    if (!token) return;
    const button = $('ai-generate');
    button.disabled = true;
    setState('card-ai', str.aiWaiting);
    $('ai-result').hidden = true;
    try {
      const isZh = str === STR.zh;
      const system = isZh
        ? '你是开源仓库分析助手。基于用户提供的仓库元数据、合并 PR、Release 更新日志与提交统计，用简体中文分四节输出：\n1) 新增功能——从 feat PR 与 changelog 的 Features 条目归纳近期交付了哪些新能力；\n2) 修复的问题——从 fix PR 与 changelog 的 Bug Fixes 条目归纳修了哪些问题、影响哪些模块；\n3) 发布与风险——发布节奏、破坏性变更、安全公告与升级建议；\n4) 总评——一句话。\n每节 1-3 条要点，总长度不超过 400 字，直接输出，不要客套。'
        : 'You are an open-source repository analyst. Based on the repository metadata, merged PRs, release notes and commit stats provided, output four sections in English:\n1) New features — summarize recently shipped capabilities from feat PRs and changelog Features entries;\n2) Fixed issues — summarize what was fixed and which modules were affected, from fix PRs and changelog Bug Fixes entries;\n3) Releases & risks — release cadence, breaking changes, security advisories, upgrade advice;\n4) Verdict — one sentence.\n1-3 bullets per section, under 300 words total, no pleasantries.';
      const text = await request('ai.generate', { system, user: buildAiPrompt(), maxTokens: 1200 });
      $('ai-result').textContent = text;
      $('ai-result').hidden = false;
      setState('card-ai', str.aiDone);
      button.textContent = str.aiRegenerate;
    } catch (error) {
      const code = error?.code;
      if (code === 'PLUGIN_AI_CANCELLED') setState('card-ai', str.aiCancelled);
      else if (code === 'PLUGIN_AI_NOT_CONFIGURED') setState('card-ai', str.aiNotConfigured, 'error');
      else setState('card-ai', fmt(str.aiFailed, { message: error?.message || str.bridgeFailed }), 'error');
    } finally {
      button.disabled = false;
    }
  }

  function renderStarHistory(buckets, meta) {
    if (!Array.isArray(buckets) || buckets.length === 0) return false;
    const sorted = [...buckets].sort((a, b) => a.week - b.week);
    const weekly = sorted.map((b) => b.total || 0);
    const cumulative = [];
    let running = 0;
    for (const value of weekly) { running += value; cumulative.push(running); }
    const last4 = weekly.slice(-4).reduce((a, b) => a + b, 0);
    const last12 = weekly.slice(-12).reduce((a, b) => a + b, 0);
    showChips('card-stars', `
      <span class="chip">${esc(str.starsLast4)}<b class="up">+${int(last4)}</b></span>
      <span class="chip">${esc(str.starsLast12)}<b class="up">+${int(last12)}</b></span>
      <span class="chip">${fmt(str.starsRange, { n: sorted.length })}</span>`);
    drawChart('card-stars-canvas', {
      data: {
        labels: sorted.map((b) => weekLabel(b.week)),
        datasets: [
          { type: 'bar', label: str.weeklyNew, data: weekly, backgroundColor: 'rgba(79, 143, 247, .5)', borderRadius: 2, yAxisID: 'y' },
          { type: 'line', label: str.cumulative, data: cumulative, borderColor: '#ffb454', tension: .3, pointRadius: 0, borderWidth: 2, yAxisID: 'y1' },
        ],
      },
      options: {
        scales: {
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0 } },
          y: { beginAtZero: true },
          y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } },
        },
        plugins: { legend: { display: true, position: 'top', align: 'end', labels: { boxWidth: 10, font: { size: 11 } } } },
      },
    });
    showChart('card-stars', true);
    setState('card-stars', meta?.stale ? `${str.fromCache} · ${esc(ageText(meta.fetchedAt))}` : '');
    return true;
  }

  /* ── 仓库健康事实卡片（口径对齐宿主 Release 侧栏面板） ─────────────── */

  const FACT_LABEL_KEYS = {
    pushedAt: 'factPushedAt', latestCommitAt: 'factLatestCommitAt', hasReleases: 'factHasReleases',
    latestReleaseAt: 'factLatestReleaseAt', archived: 'factArchived', disabled: 'factDisabled',
    fork: 'factFork', template: 'factTemplate', license: 'factLicense', securityPolicy: 'factSecurityPolicy',
    ci: 'factCI', readme: 'factReadme', docs: 'factDocs', stars: 'factStars', forks: 'factForks',
    openIssues: 'factOpenIssues', closedIssues: 'factClosedIssues', contributors: 'factContributors',
    createdAt: 'factCreatedAt', age: 'factAge', releaseCount: 'factReleaseCount',
    releasesPerYear: 'factReleasesPerYear', latestStable: 'factLatestStable',
  };

  // 按阅读优先级分组：先「更新情况」（最相关），再「关注热度」，最后「仓库特征」。
  const FACT_GROUPS = [
    { key: 'factsGroupUpdates', facts: ['latestCommitAt', 'pushedAt', 'latestReleaseAt', 'latestStable', 'releaseCount', 'releasesPerYear'] },
    { key: 'factsGroupAttention', facts: ['stars', 'forks', 'openIssues', 'closedIssues'] },
    { key: 'factsGroupTraits', facts: ['license', 'readme', 'securityPolicy', 'ci', 'docs', 'archived', 'disabled', 'fork', 'template'] },
  ];

  const MS_PER_DAY = 86_400_000;

  /** commit_activity 最后一个非零日 ≈ 最近一次提交（stats 有分钟级缓存时滞）。 */
  function latestCommitFromWeeks(commits) {
    if (!Array.isArray(commits) || commits.length === 0) return undefined;
    for (let i = commits.length - 1; i >= 0; i -= 1) {
      const week = commits[i];
      if (!Array.isArray(week?.days) || !Number.isFinite(week.week)) continue;
      for (let day = week.days.length - 1; day >= 0; day -= 1) {
        if ((week.days[day] || 0) > 0) return new Date((week.week + day * 86_400) * 1000).toISOString();
      }
    }
    return null; // 数据已知：52 周窗口内没有提交
  }

  /** 推导“仓库体检”事实快照：三态事实 + 保守信号 + 摘要所需的时间量。 */
  function deriveHealthFacts() {
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const releases = state.data.get('releases'); // 已过滤 draft、按发布时间降序
    const community = state.data.get('community');
    const commits = state.data.get('commitActivity');
    const contributors = state.data.get('contributors');
    const now = Date.now();
    const createdTs = toTimestampValue(r.created_at);
    const pushedTs = toTimestampValue(r.pushed_at) ?? toTimestampValue(r.updated_at);
    const ageDays = createdTs === null ? undefined : Math.max(0, Math.floor((now - createdTs) / MS_PER_DAY));
    const daysSincePush = pushedTs === null ? undefined : Math.max(0, Math.floor((now - pushedTs) / MS_PER_DAY));
    const latestCommitTs = (() => {
      const iso = latestCommitFromWeeks(commits);
      if (!iso) return null;
      const ts = Date.parse(iso);
      return Number.isFinite(ts) ? ts : null;
    })();
    const daysSinceCommit = latestCommitTs === null ? undefined : Math.max(0, Math.floor((now - latestCommitTs) / MS_PER_DAY));
    const releasesKnown = Array.isArray(releases);
    const releaseCount = releasesKnown ? releases.length : undefined;
    // 三态：undefined = 未知，null = 已知且为空；与宿主 readFactValue 的语义一致。
    const facts = {
      pushedAt: { kind: 'date', value: pushedTs === null ? undefined : new Date(pushedTs).toISOString() },
      latestCommitAt: { kind: 'date', value: latestCommitFromWeeks(commits) },
      hasReleases: { kind: 'boolean', value: !releasesKnown ? undefined : releaseCount > 0 },
      latestReleaseAt: { kind: 'date', value: releasesKnown ? (releases[0]?.published_at ?? null) : undefined },
      archived: { kind: 'boolean', value: typeof r.archived === 'boolean' ? r.archived : undefined },
      disabled: { kind: 'boolean', value: typeof r.disabled === 'boolean' ? r.disabled : undefined },
      fork: { kind: 'boolean', value: typeof r.fork === 'boolean' ? r.fork : undefined },
      template: { kind: 'boolean', value: typeof r.is_template === 'boolean' ? r.is_template : undefined },
      license: { kind: 'text', value: r.license === undefined ? undefined : (r.license?.spdx_id || null) },
      securityPolicy: { kind: 'boolean', value: undefined },
      ci: { kind: 'boolean', value: undefined },
      readme: { kind: 'boolean', value: community ? Boolean(community.files?.readme) : undefined },
      docs: { kind: 'boolean', value: undefined },
      stars: { kind: 'count', value: toCountValue(r.stargazers_count) },
      forks: { kind: 'count', value: toCountValue(r.forks_count) },
      openIssues: { kind: 'count', value: typeof r.open_issues_count === 'number' ? toCountValue(r.open_issues_count) : undefined },
      closedIssues: { kind: 'count', value: undefined },
      contributors: { kind: 'count', value: undefined },
      createdAt: { kind: 'date', value: createdTs === null ? undefined : new Date(createdTs).toISOString() },
      age: { kind: 'duration', value: ageDays },
      releaseCount: { kind: 'count', capped: releasesKnown && releaseCount >= 100, value: releasesKnown ? releaseCount : undefined },
      releasesPerYear: {
        kind: 'perYear',
        value: ageDays === undefined || !releasesKnown
          ? undefined
          : Math.round((releaseCount / (Math.max(ageDays, 30) / 365.25)) * 10) / 10,
      },
      latestStable: { kind: 'text', value: !releasesKnown ? undefined : (releases.find((x) => !isPrereleaseRelease(x))?.tag_name ?? null) },
    };
    // 保守观测，顺序固定（archived → disabled → no-releases → no-recent-activity）。
    const signals = [];
    if (facts.archived.value === true) signals.push('sigArchived');
    if (facts.disabled.value === true) signals.push('sigDisabled');
    if (releasesKnown && releaseCount === 0) signals.push('sigNoReleases');
    if (daysSincePush !== undefined && daysSincePush >= 365) signals.push('sigNoRecentActivity');
    return { facts, signals, ageDays, daysSincePush, daysSinceCommit, contributors };
  }

  /** 事实值的三态格式化：未知/无/是/否/计数/时长/日期。 */
  function formatFactValue(fact) {
    if (fact.value === undefined) return { text: str.valUnknown, unknown: true };
    if (fact.value === null) return { text: str.valNone, unknown: true };
    switch (fact.kind) {
      case 'boolean':
        return { text: fact.value ? str.valYes : str.valNo, unknown: !fact.value };
      case 'count':
        return { text: fact.capped ? fmt(str.valCountCapped, { n: int(fact.value) }) : int(fact.value) };
      case 'perYear':
        return { text: fmt(str.valPerYear, { n: fact.value }) };
      case 'duration':
        return { text: fmt(str.valAge, { n: int(fact.value), y: Math.round((fact.value / 365.25) * 10) / 10 }) };
      case 'date':
        return { text: shortDate(fact.value) };
      default:
        return { text: String(fact.value) };
    }
  }

  /** 渲染仓库体检卡：一句话摘要、事实分组（未知沉底）与保守信号徽章。 */
  function renderFacts() {
    const { facts, signals, daysSinceCommit } = deriveHealthFacts();
    $('facts-signals').innerHTML = signals.map((key) => `<span class="badge signal">${esc(str[key])}</span>`).join('');

    // ── 一句话摘要：维护状态 + 最近提交 / 最新发布 / 仓库历史 ──
    const r = { ...state.repository, ...(state.data.get('repo') || {}) };
    const archived = facts.archived.value === true;
    const disabled = facts.disabled.value === true;
    const daysSincePush = facts.pushedAt.value ? Math.floor((Date.now() - Date.parse(facts.pushedAt.value)) / MS_PER_DAY) : undefined;
    let statusKey;
    let dot;
    if (archived) { statusKey = 'heroArchived'; dot = 'off'; }
    else if (disabled) { statusKey = 'heroDisabled'; dot = 'off'; }
    else if (daysSincePush === undefined) { statusKey = 'heroUnknown'; dot = 'mute'; }
    else if (daysSincePush < 30) { statusKey = 'heroActive'; dot = 'ok'; }
    else if (daysSincePush < 180) { statusKey = 'heroUpdating'; dot = 'ok'; }
    else if (daysSincePush < 365) { statusKey = 'heroSlowing'; dot = 'mid'; }
    else { statusKey = 'heroDormant'; dot = 'off'; }
    const heroParts = [];
    if (daysSinceCommit !== undefined) heroParts.push(`${str.heroLastCommit} ${relativeDays(daysSinceCommit)}`);
    const latestStable = state.data.get('releases')?.[0];
    if (latestStable) heroParts.push(`${str.heroLastRelease} ${latestStable.tag_name}`);
    const heroDim = heroParts.length > 0
      ? ` <span class="hero-dim">· ${heroParts.map((part) => esc(part)).join(' · ')}</span>`
      : '';
    $('facts-hero').innerHTML = `<span class="dot ${dot}"></span>${esc(str[statusKey])}${heroDim}`;

    // ── 事实分组：已知在前（保持语义顺序），未知沉底弱化 ──
    $('facts-grid').innerHTML = FACT_GROUPS.map(({ key, facts: ids }) => {
      const rows = ids
        .map((id) => ({ id, formatted: formatFactValue(facts[id]) }))
        .sort((a, b) => Number(a.formatted.unknown) - Number(b.formatted.unknown));
      return `<div class="fact-group">
        <h4>${esc(str[key])}</h4>
        <dl>${rows.map(({ id, formatted }) =>
          `<div class="fact-row"><dt>${esc(str[FACT_LABEL_KEYS[id]])}</dt>` +
          `<dd class="${formatted.unknown ? 'unknown' : ''}">${esc(formatted.text)}</dd></div>`).join('')}</dl>
      </div>`;
    }).join('');
    $('card-facts').querySelector('.disclaimer').textContent = str.factsDisclaimer;
    setState('card-facts', '');
    $('card-facts').hidden = false;
  }

  /* ── 区块加载 ─────────────────────────────────────────────────────── */

  function markSectionError(cardId, error, unavailableMessage) {
    const message = error?.code === 'PLUGIN_PAGE_RATE_LIMITED'
      ? str.rateLimited
      : /10000 commits/.test(error?.message || '') ||
          (/\b422\b/.test(error?.message || '') && /commit/i.test(error?.message || ''))
        ? str.statsTooLarge
        : unavailableMessage && error?.code === 'PLUGIN_NETWORK_HTTP_ERROR' && / 40[34]/.test(error.message || '')
          ? unavailableMessage
          : fmt(str.loadFailed, { message: error?.message || str.bridgeFailed });
    setState(cardId, message, 'error');
  }

  /**
   * 加载一个数据集：先画缓存（stale-while-refresh），再经队列发起网络刷新。
   * paint(payload, meta) 返回 false 表示数据不可用（区块保留空态）。
   * 返回 null（成功）或 error（供必需指标上抛为全局错误）。
   */
  async function loadMetric({ id, cardId, pathSuffix, query, optional, stats, ttl = 24 * HOUR, absolute = false, paint }) {
    const { owner, repo, repoKey, queue } = state;
    const runSeq = state.runSeq;
    const stale = () => runSeq !== state.runSeq; // 仓库已切换，本 Metric 的后续动作全部作废
    let cacheEntry = null;
    try {
      cacheEntry = await readCache(repoKey, id);
    } catch { /* 缓存读取失败按无缓存处理 */ }
    if (cacheEntry) {
      const isStale = Date.now() - cacheEntry.fetchedAt > cacheEntry.ttl;
      try {
        const painted = paint(cacheEntry.payload, { stale: isStale, fetchedAt: cacheEntry.fetchedAt });
        if (painted && cardId) $(cardId).hidden = false;
      } catch { // 缓存载荷形状异常：降级为无缓存，不让异常逃逸成未处理 rejection
        cacheEntry = null;
        if (cardId) setState(cardId, str.loading);
      }
    }
    if (stale()) return null;
    if (cardId && !optional && !cacheEntry) setState(cardId, str.loading);
    try {
      const result = await queue(() => (stale()
        ? Promise.resolve({ status: 0, body: null })
        : fetchMetric(owner, repo, pathSuffix, query, absolute)));
      if (stale()) return null;
      const pendingStats = stats && result.status === 202 && result.body == null;
      if (pendingStats) {
        if (cardId && !cacheEntry) setState(cardId, str.statsPending);
        return null;
      }
      const painted = paint(result.body, { stale: false });
      if (stale()) return null;
      if (painted && cardId) $(cardId).hidden = false;
      if (result.body != null) writeCache(repoKey, id, result.body, ttl);
      return null;
    } catch (error) {
      if (!stale() && cardId && !cacheEntry) markSectionError(cardId, error);
      return error;
    }
  }

  /* 星标历史：串行翻页（每页 30 周，最多 3 页），仍走并发队列占位。 */
  async function loadStarHistory() {
    const { owner, repo, repoKey, queue } = state;
    const cardId = 'card-stars';
    const runSeq = state.runSeq;
    const stale = () => runSeq !== state.runSeq;
    let cacheEntry = null;
    try {
      cacheEntry = await readCache(repoKey, 'starHistory');
    } catch { /* 无缓存 */ }
    if (cacheEntry) {
      const isStale = Date.now() - cacheEntry.fetchedAt > cacheEntry.ttl;
      try {
        if (renderStarHistory(cacheEntry.payload, { stale: isStale, fetchedAt: cacheEntry.fetchedAt })) {
          $('card-stars').hidden = false;
        }
      } catch { // 形状异常的缓存按无缓存处理
        cacheEntry = null;
        setState(cardId, str.loading);
      }
    }
    if (stale()) return;
    if (!cacheEntry) setState(cardId, str.loading);
    try {
      const buckets = [];
      const seenWeeks = new Set();
      for (let page = 1; page <= 3; page += 1) {
        const result = await queue(() => (stale()
          ? Promise.resolve({ status: 0, body: null })
          : fetchMetric(owner, repo, '/stargazers/history', { per_page: 30, page })));
        if (stale()) return;
        if (result.status !== 200 || !Array.isArray(result.body) || result.body.length === 0) break;
        for (const raw of result.body) {
          const bucket = Array.isArray(raw?.days) && raw.days.length === 7
            ? { week: Number(raw.week), total: Number(raw.total ?? raw.days.reduce((a, b) => a + b, 0)) }
            : null;
          if (bucket && Number.isFinite(bucket.week) && Number.isFinite(bucket.total) && !seenWeeks.has(bucket.week)) {
            seenWeeks.add(bucket.week);
            buckets.push(bucket);
          }
        }
        if (result.body.length < 30) break;
      }
      if (stale()) return;
      if (buckets.length === 0) {
        if (!cacheEntry) setState(cardId, str.starsUnavailable);
        return;
      }
      renderStarHistory(buckets, { stale: false });
      $('card-stars').hidden = false;
      writeCache(repoKey, 'starHistory', buckets, 24 * HOUR);
    } catch (error) {
      if (!stale() && !cacheEntry) markSectionError(cardId, error, str.starsUnavailable);
    }
  }

  /* ── 装配 ─────────────────────────────────────────────────────────── */

  function applyTheme(theme) {
    document.body.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  /** 应用宿主下发的语言并刷新静态文案。 */
  function applyLanguage(language) {
    str = String(language).toLowerCase().startsWith('zh') ? STR.zh : STR.en;
    document.documentElement.lang = String(language).toLowerCase().startsWith('zh') ? 'zh' : 'en';
    applyChromeStrings();
  }

  const CARD_TITLES = [
    ['card-facts', 'factsTitle', 'factsHint'],
    ['card-commits', 'commitsTitle', 'commitsHint'],
    ['card-radar', 'radarTitle', 'radarHint'],
    ['card-churn', 'churnTitle', 'churnHint'],
    ['card-languages', 'languagesTitle', 'languagesHint'],
    ['card-releases', 'releasesTitle', 'releasesHint'],
    ['card-community', 'communityTitle', 'communityHint'],
    ['card-maintainers', 'maintainersTitle', 'maintainersHint'],
    ['card-ai', 'aiTitle', 'aiHint'],
    ['card-stars', 'starsTitle', 'starsHint'],
    ['card-advisories', 'advisoriesTitle', 'advisoriesHint'],
  ];

  /** 清空并重置全部卡片的标题、图表与状态，进入新一轮加载。 */
  function resetSections() {
    state.data.clear();
    state.meta.clear();
    for (const [cardId, titleKey, hintKey] of CARD_TITLES) {
      const card = $(cardId);
      card.querySelector('h3').textContent = str[titleKey];
      card.querySelector('.hint').textContent = str[hintKey];
    }
    for (const cardId of ['card-commits', 'card-radar', 'card-churn', 'card-languages', 'card-releases', 'card-stars']) {
      showChart(cardId, false);
      showChips(cardId, '');
      setState(cardId, '');
    }
    $('card-maintainers').hidden = true;
    $('owner-facts').innerHTML = '';
    $('owner-bio').textContent = '';
    $('owner-tagline').textContent = '';
    $('busfactor-box').innerHTML = '';
    $('contrib-list').innerHTML = '';
    $('contrib-note').textContent = '';
    $('ai-result').hidden = true;
    $('ai-result').textContent = '';
    $('ai-generate').textContent = str.aiGenerate;
    $('ai-note').textContent = str.aiNote;
    setState('card-ai', '');
    setState('card-facts', str.loading);
    $('facts-signals').innerHTML = '';
    $('facts-hero').innerHTML = '';
    $('facts-grid').innerHTML = '';
    setState('card-community', str.loading);
    $('community-signals').innerHTML = '';
    $('community-pct').textContent = '–';
    $('advisory-rows').innerHTML = '';
    showChips('card-advisories', '');
    setState('card-advisories', str.loading);
    $('card-stars').querySelector('.rows')?.replaceChildren();
    $('health-box').hidden = true;
    $('cards').hidden = false;
    $('kpis').hidden = true;
  }

  function paintAllFromCache() {
    // 缓存先行渲染在各 loadMetric 内完成；这里只是把 KPI 与头部先画出来。
    renderKpis();
  }

  /** 拉取全部指标并渲染：并行 10 个数据集 + 星标历史翻页，全局错误只在必需指标失败时提示。 */
  async function loadAll() {
    const runSeq = ++state.runSeq;
    resetSections();
    paintAllFromCache();
    $('status').textContent = str.loading;

    const metrics = [
      {
        // repo 详情：只进 KPI 与健康分，不驱动卡片状态（cardId 为空）。
        id: 'repo', cardId: null, pathSuffix: '', ttl: 6 * HOUR, optional: false,
        paint: (payload) => {
          state.data.set('repo', payload);
          // /repos/{o}/{r} 携带 Token 时会返回私有仓库详情：私有数据绝不进缓存，
          // 并清掉此前可能已落盘的同仓库条目。
          const isPrivate = payload?.private === true;
          if (isPrivate && !state.privateRepo) purgeRepoCache(state.repoKey);
          state.privateRepo = isPrivate;
          renderKpis();
          renderHealth();
          renderFacts();
          return true;
        },
      },
      {
        id: 'commitActivity', cardId: 'card-commits', pathSuffix: '/stats/commit_activity',
        optional: false, stats: true, paint: renderCommits,
      },
      {
        id: 'codeFrequency', cardId: 'card-churn', pathSuffix: '/stats/code_frequency', ttl: 24 * HOUR,
        optional: true, stats: true, paint: renderChurn,
      },
      {
        // 贡献者数据只进「维护者与贡献者」容器与 AI 提示词，无独立图表卡。
        id: 'contributors', cardId: null, pathSuffix: '/contributors',
        query: { per_page: 12 }, ttl: 24 * HOUR, optional: true, paint: renderContributors,
      },
      {
        id: 'ownerProfile', cardId: null, absolute: true, pathSuffix: `/users/${state.owner}`, ttl: 72 * HOUR,
        optional: true, paint: paintOwnerProfile,
      },
      {
        // 最近关闭的 PR：AI 动态分析用（合并 PR = merged_at 非空）。
        id: 'pulls', cardId: null, pathSuffix: '/pulls',
        query: { state: 'closed', per_page: 30 }, ttl: 6 * HOUR, optional: true, paint: paintPulls,
      },
      {
        id: 'languages', cardId: 'card-languages', pathSuffix: '/languages', ttl: 24 * HOUR,
        optional: true, paint: renderLanguages,
      },
      {
        id: 'releases', cardId: 'card-releases', pathSuffix: '/releases',
        query: { per_page: 100 }, ttl: 6 * HOUR, optional: true, paint: renderReleases,
      },
      {
        id: 'community', cardId: 'card-community', pathSuffix: '/community/profile', ttl: 72 * HOUR,
        optional: true, paint: renderCommunity,
      },
      {
        id: 'advisories', cardId: 'card-advisories', pathSuffix: '/security-advisories',
        query: { per_page: 10 }, ttl: 6 * HOUR, optional: true, paint: renderAdvisories,
      },
    ];

    const results = await Promise.all(metrics.map((metric) => loadMetric(metric)));
    if (runSeq !== state.runSeq) return;
    // repo 详情失败时给出全局错误（头部/KPI 仍用快照元数据展示）。
    if (results[0]) {
      $('status').textContent = fmt(str.loadFailed, { message: results[0]?.message || str.bridgeFailed });
      // repo 详情失败时，事实卡退化为纯快照元数据（多数事实仍可给出）。
      renderFacts();
    } else {
      $('status').textContent = '';
    }

    await loadStarHistory();
    $('foot').textContent = str.footer;
  }

  /* ── 入口与仓库选择器 ─────────────────────────────────────────────── */

  let lastRepoKey = null;

  /** 设定当前仓库并启动数据加载。 */
  function start(repository) {
    const [owner, name] = String(repository.full_name ?? '').split('/');
    if (!owner || !name) {
      $('status').textContent = str.noRepository;
      return;
    }
    state.repository = repository;
    state.owner = owner;
    state.repo = name;
    state.repoKey = `${owner}/${name}`.toLowerCase();
    $('picker').hidden = true;
    renderHeader();
    void loadAll();
  }

  /** 处理宿主 init：主题/语言跟随；同仓库重复 init 幂等，换仓库重新加载。 */
  async function handleInit(context) {
    if (context.theme) applyTheme(context.theme);
    if (context.language) applyLanguage(context.language);
    if (!context.repository) {
      $('status').textContent = str.noRepository;
      $('picker').hidden = false;
      return;
    }
    const repository = context.repository;
    const repoKey = String(repository.full_name ?? '').toLowerCase();
    if (repoKey === lastRepoKey && state.repository) {
      // 同仓库的上下文补发（如 README 异步到位）：只更新主题/文案，不重新拉数据。
      state.repository = repository;
      renderHeader();
      renderKpis();
      return;
    }
    lastRepoKey = repoKey;
    start(repository);
  }

  /** 经桥搜索宿主已加载的仓库（设置页入口的仓库选择器用）。 */
  async function searchRepositories(query) {
    const value = await request('repositories.search', { query, limit: 10 });
    return Array.isArray(value) ? value : value?.repositories ?? [];
  }

  $('ai-generate')?.addEventListener('click', () => { void generateAiBriefing(); });

  $('picker-search')?.addEventListener('click', async () => {
    const query = $('picker-query').value.trim();
    if (!query || !token) return;
    $('picker-results').innerHTML = `<li class="muted">${esc(str.searching)}</li>`;
    try {
      const results = await searchRepositories(query);
      if (results.length === 0) {
        $('picker-results').innerHTML = `<li class="muted">${esc(str.searchEmpty)}</li>`;
        return;
      }
      $('picker-results').innerHTML = '';
      for (const item of results) {
        const li = document.createElement('li');
        li.innerHTML = `${esc(item.full_name)}<span class="muted">★ ${int(item.stargazers_count)} · ${esc(item.description || '')}</span>`;
        li.addEventListener('click', () => {
          lastRepoKey = String(item.full_name ?? '').toLowerCase();
          start(item);
        });
        $('picker-results').appendChild(li);
      }
    } catch (error) {
      $('picker-results').innerHTML = `<li class="muted">${esc(fmt(str.loadFailed, { message: error.message }))}</li>`;
    }
  });
})();
