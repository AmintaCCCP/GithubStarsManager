/* Repo Info Card — page-only example plugin (V1.4 opensPage modal entry).
 *
 * The host modal sends one `plugin-page:init` message carrying
 * `context = { repository, readme, language, theme }`. Everything else goes
 * through the permission-checked bridge: `ai.generate` for card markup,
 * `clipboard.write` / `clipboard.writeImage` / `downloads.saveFile` for export.
 *
 * Chrome layout: left column = options (card-style tabs mirroring the host's
 * appearance settings), right column = zoomable/draggable preview canvas.
 */
const PLUGIN_ID = 'com.githubstarsmanager.repo-info-card';
const PAGE_ID = 'info-card';

const AI_SYSTEM_LIMIT = 2000;  // bridge hard limit for ai.generate system prompt
// bridge hard limit for ai.generate user prompt — 放宽到 160k 是为了让 README
// 全文原样进入提示词；与 pluginPageBridge 的 user 上限必须保持一致。
// 160k 字符在两道尺寸闸门（渲染端 1 MiB、主进程 1 MiB 字节预算）内都是安全的。
const AI_USER_LIMIT = 160_000;

/* ── bridge plumbing ─────────────────────────────────────────────── */

let token = null;
let nextRequestId = 0;
const pending = new Map();

function request(method, args) {
  if (!token) return Promise.reject(new Error(STR.bridgeNotReady));
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
  else handler.reject(new Error(event.data.error?.message || STR.bridgeFailed));
});

/* ── chrome strings (page UI, not the card) ──────────────────────── */

const STR = {
  zh: {
    bridgeNotReady: '宿主桥尚未就绪',
    bridgeFailed: '宿主请求失败',
    style: '风格', canvas: '画幅', cardLanguage: '卡片语言', followUi: '跟随界面',
    styleTe: 'TE 纸面', styleInk: '暗色仪器', stylePrint: '极简黑白',
    custom: '自定义', width: '宽', height: '高', customHint: '长宽范围 400 – 3000 px',
    notes: '附加说明',
    notesPlaceholder: '选填：对信息卡的附加要求，例如「重点介绍插件系统」「标题更收敛」。重新生成后生效。',
    generate: '生成信息卡', regenerate: '重新生成',
    copyCode: '复制 HTML 代码', copyImage: '复制截图', saveImage: '保存截图',
    previewEmpty: '在左侧完成配置并生成后，画布会出现在这里。',
    panHint: '按住拖拽可移动画布',
    tabPreview: '预览', tabCode: '代码', previewTabs: '预览模式切换',
    codeApplied: '已应用代码修改，预览已更新。',
    codeInvalid: '代码缺少 id="card" 根元素，无法渲染。',
    loadedWithReadme: '已加载仓库信息（含 README）。',
    loadedWithoutReadme: '已加载仓库信息（未取得 README，仅使用元信息）。',
    noRepository: '尚未选择仓库。请从仓库卡片的「插件操作」菜单打开本页面，或在下方搜索选择一个仓库。',
    pickerHint: '此入口没有携带仓库上下文（例如从「设置 → 插件 → 打开页面」进入）。搜索并选择一个已加载的仓库：',
    searching: '搜索中…', searchDone: '找到 {n} 个仓库，点击选择。',
    generating: '正在请求用户配置的 AI 生成卡片（需要在弹窗中确认）…',
    canvasChanged: '画幅已改变，当前卡片仍是旧画幅。重新生成后才能导出截图。',
    copyOk: 'HTML 代码已复制到剪贴板。',
    imageOk: '截图已写入剪贴板。',
    savedOk: '截图已保存：{name}',
    canceled: '已取消。',
    aiFailed: '生成失败：{message}',
    noCard: 'AI 输出缺少 id="card" 根元素，请重试。',
    exportFailed: '导出失败：{message}',
    zoomOut: '缩小', zoomIn: '放大', zoomFit: '适应窗口', zoomActual: '实际大小',
    zoomGroup: '预览缩放',
    previewMeta: '{canvas} · {w}×{h} · 导出 @2x',
    generatedWithReadme: '已生成（基于 README）。可预览、缩放、拖拽画布、复制代码或导出截图（@2x）。',
    generatedMetadataOnly: '已生成（未取得 README，仅使用元信息）。可预览、缩放、拖拽画布、复制代码或导出截图（@2x）。',
    generatedReadmeTruncated: '已生成，但 README 超出提示词上限、已截断。可预览、缩放、拖拽画布、复制代码或导出截图（@2x）。',
    readmeReady: 'README 已就绪，重新生成即可把 README 内容纳入卡片。',
  },
  en: {
    bridgeNotReady: 'Host bridge is not ready',
    bridgeFailed: 'Host request failed',
    style: 'Style', canvas: 'Canvas', cardLanguage: 'Card language', followUi: 'Follow UI',
    styleTe: 'TE Paper', styleInk: 'Dark Instrument', stylePrint: 'Minimal Print',
    custom: 'Custom', width: 'Width', height: 'Height', customHint: 'Between 400 and 3000 px',
    notes: 'Additional notes',
    notesPlaceholder: 'Optional requests for the card, e.g. "highlight the plugin system", "keep the title understated". Applied on regenerate.',
    generate: 'Generate card', regenerate: 'Regenerate',
    copyCode: 'Copy HTML code', copyImage: 'Copy screenshot', saveImage: 'Save screenshot',
    previewEmpty: 'Configure the options on the left and generate — the canvas shows up here.',
    panHint: 'Drag to pan the canvas',
    tabPreview: 'Preview', tabCode: 'Code', previewTabs: 'Preview mode',
    codeApplied: 'Code changes applied to the preview.',
    codeInvalid: 'The code is missing the id="card" root element and cannot be rendered.',
    loadedWithReadme: 'Repository loaded (README included).',
    loadedWithoutReadme: 'Repository loaded (no README; metadata only).',
    noRepository: 'No repository selected. Open this page from a repository card plugin menu, or search below.',
    pickerHint: 'This entry carries no repository context (e.g. opened from Settings → Plugins). Pick a loaded repository:',
    searching: 'Searching…', searchDone: '{n} repositories found; click to select.',
    generating: 'Asking the configured AI to compose the card (confirmation required)…',
    canvasChanged: 'Canvas changed; the current card still uses the previous one. Regenerate before exporting a screenshot.',
    copyOk: 'HTML code copied to the clipboard.',
    imageOk: 'Screenshot copied to the clipboard.',
    savedOk: 'Screenshot saved: {name}',
    canceled: 'Canceled.',
    aiFailed: 'Generation failed: {message}',
    noCard: 'AI output is missing the id="card" root element. Try again.',
    exportFailed: 'Export failed: {message}',
    zoomOut: 'Zoom out', zoomIn: 'Zoom in', zoomFit: 'Fit to view', zoomActual: 'Actual size',
    zoomGroup: 'Preview zoom',
    previewMeta: '{canvas} · {w}×{h} · exports @2x',
    generatedWithReadme: 'Generated from the README. Preview, zoom, drag to pan, copy the code, or export a @2x screenshot.',
    generatedMetadataOnly: 'Generated without a README (metadata only). Preview, zoom, drag to pan, copy the code, or export a @2x screenshot.',
    generatedReadmeTruncated: 'Generated, but the README exceeded the prompt limit and was truncated. Preview, zoom, drag to pan, copy the code, or export a @2x screenshot.',
    readmeReady: 'The README is now available; regenerate to fold it into the card.',
  },
};
let str = STR.zh;
function fmt(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(params?.[key] ?? `{${key}}`));
}
function applyChromeStrings() {
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (str[key]) el.textContent = str[key];
  });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (str[key]) el.setAttribute('title', str[key]);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (str[key]) el.setAttribute('placeholder', str[key]);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria-label');
    if (str[key]) el.setAttribute('aria-label', str[key]);
  });
  generateButton.textContent = state.fragment ? str.regenerate : str.generate;
  copyCodeButton.textContent = str.copyCode;
  copyImageButton.textContent = str.copyImage;
  saveImageButton.textContent = str.saveImage;
}

/* ── card design system: palette + structural CSS (plugin-owned) ─── */

const FONT_SANS = `'Helvetica Neue',-apple-system,BlinkMacSystemFont,'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif`;
const FONT_MONO = `ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,'Liberation Mono',monospace`;

const PALETTES = {
  te: '--bg:#f4f3f0;--ink:#111111;--secondary:#6e6e6e;--red:#e6321e;--hairline:#d6d5d1;',
  ink: '--bg:#12161b;--ink:#e9edf2;--secondary:#8a95a1;--red:#ff5d49;--hairline:#28313b;',
  print: '--bg:#ffffff;--ink:#000000;--secondary:#5c5c5c;--red:#c40000;--hairline:#d4d4d0;',
};

const CANVAS_PRESETS = [
  { id: '1x1', w: 1200, h: 1200, label: '1:1' },
  { id: '5x2', w: 1500, h: 600, label: '5:2' },
  { id: '3x4', w: 1200, h: 1600, label: '3:4' },
];
const CUSTOM_CANVAS_ID = 'custom';
const CANVAS_MIN = 400;
const CANVAS_MAX = 3000;

// 与主程序 src/i18n/languages.ts 的 APP_LANGUAGES 保持一致：卡片语言选项
// 覆盖 i18n 包含的全部语言，englishName 直接进入 AI 提示词的语言指令。
const CARD_LANGUAGES = [
  { code: 'zh', nativeName: '中文', englishName: 'Simplified Chinese' },
  { code: 'en', nativeName: 'English', englishName: 'English' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Brazilian Portuguese' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Traditional Chinese' },
  { code: 'fr', nativeName: 'Français', englishName: 'French' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean' },
];

// 版式与画幅解耦：data-canvas 只管尺寸（--w/--h/字号/留白），data-layout
// 决定结构规则。自定义画幅按长宽比落入 square / banner / portrait 之一。
const CARD_CSS = `
#card{width:var(--w);height:var(--h);box-sizing:border-box;overflow:hidden;
background:var(--bg);color:var(--ink);padding:var(--pad,36px 60px 44px);
display:flex;flex-direction:column;justify-content:space-between;
font-family:var(--font);font-weight:400;line-height:1.5;}
#card *{box-sizing:border-box;margin:0;padding:0;}
#card .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}
#card .accent{color:var(--red);}
#card .card-top{display:flex;justify-content:space-between;gap:24px;font-size:13px;color:var(--secondary);padding-bottom:14px;border-bottom:1px solid var(--hairline);}
#card .kicker{font-size:13px;letter-spacing:.18em;color:var(--secondary);display:flex;align-items:center;gap:10px;}
#card .kicker::before{content:"";width:26px;height:2px;background:var(--red);}
#card .title{font-size:var(--title-size);line-height:1.14;font-weight:700;letter-spacing:-.01em;margin-top:18px;}
#card .intro{font-size:16px;color:var(--secondary);line-height:1.7;margin-top:14px;max-width:62ch;}
#card .sub{font-size:17px;color:var(--secondary);margin-top:12px;}
#card .cols{display:grid;grid-template-columns:repeat(3,1fr);margin-top:26px;border-top:1px solid var(--hairline);}
#card .col{padding:16px 20px 0 0;}
#card .col+.col{border-left:1px solid var(--hairline);padding-left:20px;}
#card .no{font-size:13px;color:var(--secondary);}
#card .col h3{font-size:19px;line-height:1.35;margin-top:6px;font-weight:700;}
#card .tag{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;margin-top:10px;}
#card .tag::before{content:"";width:8px;height:8px;background:var(--ink);}
#card .col p{font-size:13.5px;color:var(--secondary);line-height:1.62;margin-top:8px;}
#card .reads{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:24px;padding-top:16px;border-top:1px solid var(--hairline);}
#card .read .k{font-size:12px;letter-spacing:.08em;color:var(--secondary);}
#card .read .v{font-size:26px;font-weight:700;margin-top:4px;}
#card .spec{margin-top:22px;border-top:1px solid var(--hairline);padding-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:2px 44px;}
#card .row{display:flex;justify-content:space-between;gap:16px;font-size:13.5px;padding:7px 0;border-bottom:1px solid var(--hairline);}
#card .row .k{font-size:12px;letter-spacing:.08em;color:var(--secondary);flex:none;}
#card .row span:last-child{color:var(--secondary);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#card .closer{font-size:22px;font-weight:700;line-height:1.45;}
#card .footer{display:flex;justify-content:space-between;gap:24px;font-size:12.5px;color:var(--secondary);border-top:1px solid var(--hairline);padding-top:12px;margin-top:14px;}
#card .pipe{display:flex;flex-wrap:wrap;gap:6px 0;font-size:15px;font-weight:600;}
#card .pipe span:not(:first-child)::before{content:"\\2192";color:var(--red);margin:0 10px;}
#card[data-canvas="1x1"]{--w:1200px;--h:1200px;--title-size:60px;--pad:36px 60px 44px;}
#card[data-canvas="5x2"]{--w:1500px;--h:600px;--title-size:52px;--pad:30px 56px 36px;}
#card[data-canvas="3x4"]{--w:1200px;--h:1600px;--title-size:64px;--pad:40px 60px 48px;}
#card[data-layout="banner"] .hero{display:flex;gap:48px;flex:1;align-items:center;min-height:0;}
#card[data-layout="banner"] .hero-left{flex:1.6;}
#card[data-layout="banner"] .hero-right{flex:1;border-left:1px solid var(--hairline);padding-left:40px;display:flex;flex-direction:column;gap:18px;}
#card[data-layout="banner"] .reads{grid-template-columns:repeat(3,1fr);gap:14px;margin-top:0;padding-top:0;border-top:0;}
#card[data-layout="banner"] .read .v{font-size:22px;}
#card[data-layout="portrait"] .reads{grid-template-columns:repeat(2,1fr);gap:22px;}
#card[data-layout="portrait"] .spec{grid-template-columns:1fr;}
`;

function paletteValue(styleId, key) {
  const match = (PALETTES[styleId] || PALETTES.te).match(new RegExp(`${key}:([^;]+);`));
  return match ? match[1] : '';
}

function paletteBackground(styleId) {
  return paletteValue(styleId, '--bg') || '#f4f3f0';
}

function customCanvasRule(w, h) {
  // 字号与留白按短边相对 1:1 画幅缩放，避免极端长宽比下标题溢出或过小。
  const scale = Math.min(1.2, Math.max(0.5, Math.min(w, h) / 1200));
  const titleSize = Math.round(Math.min(68, Math.max(34, 60 * (Math.min(w, h) / 1200))));
  const pad = `${Math.round(36 * scale)}px ${Math.round(60 * scale)}px ${Math.round(44 * scale)}px`;
  return `#card[data-canvas="custom"]{--w:${w}px;--h:${h}px;--title-size:${titleSize}px;--pad:${pad};}`;
}

function cssFor(styleId, canvas) {
  const palette = PALETTES[styleId] || PALETTES.te;
  // 变量挂在 #card 而不是 :root：预览用 shadow DOM 渲染，:root 在 shadow tree 里
  // 匹配不到任何元素，卡片会连同调色板一起退化成浏览器默认样式。
  const customRule = canvas?.id === CUSTOM_CANVAS_ID ? customCanvasRule(canvas.w, canvas.h) : '';
  return `#card{${palette}--font:${FONT_SANS};--mono:${FONT_MONO};}\n${customRule}\n${CARD_CSS}`;
}

function layoutForCanvas(canvasId, w, h) {
  if (canvasId === '5x2') return 'banner';
  if (canvasId === '3x4') return 'portrait';
  if (canvasId === '1x1') return 'square';
  const ratio = w / h;
  if (ratio >= 1.8) return 'banner';
  if (ratio <= 0.8) return 'portrait';
  return 'square';
}

/* ── prompt builders (plugin owns layout; AI writes the markup) ──── */

const STRUCTURES = {
  square: `<div id="card">
<div class="card-top"><span>{TYPE - DOMAIN}</span><span class="mono">{owner}</span></div>
<h1 class="title">{repo name with 1 <span class="accent">keyword</span>}</h1>
<p class="intro">{1-2 sentences: what it is, why it matters}</p>
<div class="cols">
<div class="col"><div class="no mono">01</div><h3>{judgement, max 16 chars}</h3><div class="tag">{4-8 char label}</div><p>{2-3 short sentences of evidence}</p></div>
<div class="col">same shape, 02</div>
<div class="col">same shape, 03</div>
</div>
<div class="reads">4 x <div class="read"><div class="k mono">STARS|FORKS|LANGUAGE|LICENSE</div><div class="v">{value}</div></div></div>
<div class="spec">4 x <div class="row"><span class="k mono">KEY</span><span>{value}</span></div> for TOPICS, CREATED, LAST PUSH, HOMEPAGE</div>
<p class="closer">{one-sentence takeaway with 1 .accent}</p>
<div class="footer"><span class="mono">{repo url}</span><span>REPO INFO CARD</span></div>
</div>`,
  banner: `<div id="card">
<div class="card-top"><span>{TYPE - DOMAIN}</span><span class="mono">{owner}</span></div>
<div class="hero">
<div class="hero-left">
<div class="kicker mono">{DOMAIN TAG}</div>
<h1 class="title">{title with 1 <span class="accent">keyword</span>}</h1>
<p class="sub">{one-line subtitle}</p>
</div>
<div class="hero-right">
<div class="pipe mono"><span>{word}</span><span>{word}</span><span>{word}</span></div>
<div class="reads">3 x <div class="read"><div class="k mono">KEY</div><div class="v">{value}</div></div></div>
</div>
</div>
<div class="footer"><span class="mono">{repo url}</span><span>REPO INFO CARD</span></div>
</div>`,
  portrait: `<div id="card">
<div class="card-top"><span>{TYPE - DOMAIN}</span><span class="mono">{owner}</span></div>
<div class="kicker mono">{DOMAIN TAG}</div>
<h1 class="title">{title with 1 <span class="accent">keyword</span>}</h1>
<p class="intro">{2 sentences}</p>
<div class="reads">4 x <div class="read"><div class="k mono">KEY</div><div class="v">{value}</div></div></div>
<div class="spec">6 x <div class="row"><span class="k mono">KEY</span><span>{value}</span></div></div>
<p class="closer">{takeaway with 1 .accent}</p>
<div class="footer"><span class="mono">{repo url}</span><span>REPO INFO CARD</span></div>
</div>`,
};

function cardLanguageLabel(option) {
  const code = option === 'auto' ? state.language : option;
  return CARD_LANGUAGES.find((item) => item.code === code)?.englishName ?? 'English';
}

// 卡片实际生效的语言码（跟随界面时即宿主界面语言），用于提示词与导出文档。
function resolvedCardLanguage() {
  return state.languageOption === 'auto' ? state.language : state.languageOption;
}

function buildSystemPrompt(canvas, languageOption) {
  const layout = layoutForCanvas(canvas.id, canvas.w, canvas.h);
  const system = `You are an information designer. Return ONE info card for the repository facts in the user message.

OUTPUT
- Raw HTML only: no markdown, no code fences, no commentary, no <html>/<head>/<body>.
- No <script>, <style>, <img>, <svg>, <a> or any external resource. Text only. No emoji.
- Root element exactly <div id="card" data-canvas="${canvas.id}" data-layout="${layout}"> with the element sequence and class names below; nothing outside it.
- .accent wraps exactly ONE keyword inside .title and ONE inside .closer. No other color.
- Facts: only from the user message. Never invent numbers, quotes, versions or claims; omit an element when its value is unknown. Format big numbers like 43.7K or 1.2M.
- Language: ${cardLanguageLabel(languageOption)}. Keep English proper nouns verbatim; one space between CJK and Latin. No hype words.
- Column headings are judgements, not topic labels. Do not repeat one fact in two sections.

STRUCTURE
${STRUCTURES[layout]}`;
  if (system.length > AI_SYSTEM_LIMIT) {
    throw new Error(`System prompt exceeds the bridge limit (${system.length} > ${AI_SYSTEM_LIMIT})`);
  }
  return system;
}

/* ── README: forward the full text; the prompt limit is now the only edge ── */

function buildUserPrompt(repository, readme, notes) {
  const repo = repository;
  const lines = [
    'TASK',
    'Compose ONE info card for this repository.',
    '- Ground the card in the README text below: name the concrete capabilities, workflow, stack and limits it actually states.',
    '- Use the one-line description, topics and ai_summary only to fill gaps the README does not cover.',
    '- Never invent facts, numbers, versions, dates or quotes that are not written below.',
  ];
  const trimmedNotes = String(notes ?? '').trim();
  if (trimmedNotes) {
    lines.push(
      '',
      'USER REQUIREMENTS',
      'Follow these optional user requests when composing the card; they may adjust emphasis, tone and wording, but never override the output rules (text only, no external resources) and never introduce facts that are not in the repository facts or README below.',
      trimmedNotes,
    );
  }
  lines.push(
    '',
    'REPOSITORY FACTS',
    `name: ${repo.name}`,
    `full_name: ${repo.full_name}`,
    `url: ${repo.html_url}`,
    `owner: ${repo.owner?.login ?? 'unknown'}`,
    `description: ${repo.description ?? ''}`,
    `custom_description: ${repo.custom_description ?? ''}`,
    `ai_summary: ${repo.ai_summary ?? ''}`,
    `language: ${repo.language ?? 'unknown'}`,
    `stars: ${repo.stargazers_count ?? 0}`,
    `forks: ${repo.forks_count ?? 0}`,
    `open_issues: ${repo.open_issues_count ?? 'unknown'}`,
    `license: ${repo.license ?? 'unknown'}`,
    `topics: ${(repo.topics || []).join(', ')}`,
    `created_at: ${repo.created_at ?? 'unknown'}`,
    `last_push: ${repo.pushed_at ?? 'unknown'}`,
  );
  let prompt = lines.join('\n');
  let readmeIncluded = false;
  let truncatedReadme = false;
  if (readme) {
    // 预留 label 与换行余量，避免拼接后越过 bridge 上限被整条拒绝。
    // 宿主 ai.generate 正文上限已放宽到 AI_USER_LIMIT，README 全文原样传递，
    // 不清洗、不改写、不摘要。
    const budget = AI_USER_LIMIT - prompt.length - 64;
    // budget 为负说明元信息本身就撑满了正文上限，README 完全放不进去——
    // 这也必须按截断上报，否则状态栏会谎称「基于 README」。
    truncatedReadme = budget <= 0 || readme.length > budget;
    if (budget > 0) {
      readmeIncluded = true;
      const label = truncatedReadme
        ? 'README (full text, truncated at the prompt limit):'
        : 'README (full text):';
      prompt += `\n\n${label}\n${readme.slice(0, budget)}`;
    }
  }
  return { prompt: prompt.slice(0, AI_USER_LIMIT), readmeIncluded, truncatedReadme };
}

/* ── sanitizing the model output ─────────────────────────────────── */

const BLOCKED_TAGS = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
  'form', 'svg', 'img', 'picture', 'source', 'video', 'audio', 'canvas', 'template'];

function sanitizeFragment(raw, canvas) {
  let html = String(raw).trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/, '');
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) html = bodyMatch[1];
  html = html.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll(BLOCKED_TAGS.join(',')).forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      // style 能携带 background-image 等外链资源。复制出去的单文件 HTML 没有
      // 预览 iframe 的 CSP，打开时浏览器会请求这些地址，所以一律去掉。
      else if (name === 'style') el.removeAttribute(attr.name);
      else if (name === 'href' || name === 'src' || name === 'xlink:href') {
        // DOMParser 会把 &#x0A; 解码成换行，浏览器执行 URL 前又会去掉这些空白，
        // 所以 `java&#x0A;script:` 能绕过直接的 startsWith('javascript:') 检查。
        // 复制出去的单文件 HTML 不受预览 iframe CSP 保护，必须在这里拦截。
        const normalizedUrl = attr.value.replace(/[\t\n\r]/g, '').trim().toLowerCase();
        if (normalizedUrl.startsWith('javascript:')) el.removeAttribute(attr.name);
      }
    }
  });
  const card = doc.getElementById('card');
  if (!card) throw new Error(str.noCard);
  card.setAttribute('data-canvas', canvas.id);
  card.setAttribute('data-layout', layoutForCanvas(canvas.id, canvas.w, canvas.h));
  // 只保留卡片根元素。模型常在 #card 前后夹带说明或额外节点，
  // 整段 body 会把它们带进预览和导出的单文件 HTML。
  return card.outerHTML;
}

function escapeXmlText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function escapeHtmlText(text) {
  return String(text).replace(/[&<>"]/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
  }[char]));
}

/* ── code editor syntax highlighting (self-contained; the page CSP has no
      external script/font sources, so a tiny HTML tokenizer lives here) ── */

function highlightAttrs(raw) {
  let out = '';
  // 末尾的 `[\s\S]` 兜底：match(/g) 会静默跳过无法匹配的字符，导致透明
  // textarea 里的文字在高亮层消失（如属性里手打的孤立 `=`）。
  for (const token of raw.match(/\s+|[^\s=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?|[\s\S]/g) || []) {
    const attr = token.match(/^([^\s=]+)(\s*=\s*("[^"]*"|'[^']*'|[^\s"'>]+))?$/);
    if (!attr) { out += escapeHtmlText(token); continue; }
    out += `<span class="tok-attr">${escapeHtmlText(attr[1])}</span>`;
    if (attr[2]) {
      const eq = attr[2].match(/^(\s*=\s*)([\s\S]*)$/);
      out += `<span class="tok-punc">${escapeHtmlText(eq[1])}</span>` +
        `<span class="tok-str">${escapeHtmlText(eq[2])}</span>`;
    }
  }
  return out;
}

function highlightTag(raw) {
  const match = raw.match(/^(<\/?)([a-zA-Z][\w:.-]*)([\s\S]*?)(\/?>?)$/);
  if (!match) return escapeHtmlText(raw);
  const [, open, name, attrs, close] = match;
  return `<span class="tok-punc">${escapeHtmlText(open)}</span>` +
    `<span class="tok-tag">${escapeHtmlText(name)}</span>` +
    highlightAttrs(attrs) +
    `<span class="tok-punc">${escapeHtmlText(close)}</span>`;
}

// 输出只含转义文本与插件自己的 span，注入安全：先分词、后逐段转义。
function highlightHtml(source) {
  let out = '';
  for (const part of String(source).split(/(<!--[\s\S]*?-->|<![^>]*>|<[^>]*>)/g)) {
    if (!part) continue;
    if (part.startsWith('<!')) out += `<span class="tok-comment">${escapeHtmlText(part)}</span>`;
    else if (part.startsWith('<')) out += highlightTag(part);
    else out += escapeHtmlText(part);
  }
  return out;
}

function assembleDocument(css, fragment, title, background) {
  // <html lang> 描述的是「已生成卡片」的语言：用生成时快照，切换语言选项
  // 不影响已导出文档（与 fragmentCanvas 同一原则）；未生成时退回当前选项。
  const lang = state.fragmentLanguage ?? resolvedCardLanguage();
  return `<!doctype html>
<html lang="${escapeHtmlText(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtmlText(title)}</title>
<style>html,body{margin:0;background:${background};}</style>
<style>${css}</style>
</head>
<body>
${fragment}
</body>
</html>`;
}

/* ── PNG export via SVG foreignObject rasterization ──────────────── */

async function exportPngBase64() {
  const { w, h } = canvasMetrics(state.fragmentCanvas);
  const doc = new DOMParser().parseFromString(state.fragment, 'text/html');
  const card = doc.getElementById('card');
  const inner = new XMLSerializer().serializeToString(card);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<style>${escapeXmlText(state.css)}</style>` +
    `<foreignObject x="0" y="0" width="${w}" height="${h}">${inner}</foreignObject></svg>`;
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.onload = resolve;
    image.onerror = () => reject(new Error('SVG rasterization failed'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = w * 2;
  canvas.height = h * 2;
  const context = canvas.getContext('2d');
  context.scale(2, 2);
  context.drawImage(image, 0, 0, w, h);
  const dataUrl = canvas.toDataURL('image/png');
  return { dataBase64: dataUrl.slice(dataUrl.indexOf(',') + 1), w, h };
}

/* ── canvas model: presets + custom size ─────────────────────────── */

function canvasMetrics(canvas) {
  if (!canvas) return CANVAS_PRESETS[0];
  if (canvas.id === CUSTOM_CANVAS_ID) return { w: canvas.w, h: canvas.h };
  return CANVAS_PRESETS.find((preset) => preset.id === canvas.id) || CANVAS_PRESETS[0];
}

function selectedCanvas() {
  return { id: state.canvasId, ...canvasMetrics({ id: state.canvasId, w: state.customWidth, h: state.customHeight }) };
}

function canvasLabel(canvasId) {
  return canvasId === CUSTOM_CANVAS_ID ? str.custom : canvasId;
}

function clampCanvasDimension(value) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, parsed));
}

/* ── app state + UI wiring ───────────────────────────────────────── */

const ZOOM_MIN = 0.2;   // 相对「适应窗口」的最小倍率
const ZOOM_MAX = 6;     // 相对「适应窗口」的最大倍率
const ZOOM_STEP = 1.25;

const state = {
  repository: null,
  readme: null,
  language: 'zh',
  theme: null,
  styleId: 'te',
  canvasId: '1x1',
  customWidth: 1200,
  customHeight: 1500,
  languageOption: 'auto',
  notes: '',
  fragment: null,
  fragmentCanvas: null,       // 生成时的画幅快照 { id, w, h }；切画幅后旧卡片仍按它渲染
  fragmentLanguage: null,     // 生成时的卡片语言快照；导出文档的 <html lang> 跟随它
  css: null,
  docHtml: null,
  zoom: 1,        // 相对自适应比例的倍率；1 表示「适应窗口」
  fitScale: 1,    // 最近一次自适应算出的缩放比例
  usedReadme: false,
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const generateButton = $('generate');
const copyCodeButton = $('copy-code');
const copyImageButton = $('copy-image');
const saveImageButton = $('save-image');
const previewEmpty = $('preview-empty');
const previewWrap = $('preview-wrap');
const previewScroll = $('preview-scroll');
const previewHost = $('preview-host');
const previewMeta = $('preview-meta');
const zoomLevelButton = $('zoom-level');
const zoomGroup = document.querySelector('.zoom');
const tabPreview = $('tab-preview');
const tabCode = $('tab-code');
const codeWrap = $('code-editor-wrap');
const codeEditor = $('code-editor');
const codeHighlight = $('code-highlight');
const styleGrid = $('opt-style');
const canvasGrid = $('opt-canvas');
const langGrid = $('opt-language');
const customWrap = $('custom-canvas');
const customWInput = $('custom-w');
const customHInput = $('custom-h');
const notesInput = $('opt-notes');

function setStatus(message) { statusEl.textContent = message; }

function applyChromeTheme(theme) {
  // 弹窗入口随 init context 带宿主主题；面板入口没有 theme 时退回系统偏好。
  const dark = theme === 'dark'
    || (theme !== 'light' && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.chrome = dark ? 'dark' : 'light';
}

function handleInit(context) {
  state.repository = context.repository || null;
  state.readme = typeof context.readme === 'string' && context.readme ? context.readme : null;
  const lang = String(context.language || 'zh');
  // 卡片语言用完整的 i18n 语言码（10 种）；chrome 文案仍只有中英两套。
  state.language = CARD_LANGUAGES.some((item) => item.code === lang) ? lang : 'en';
  state.theme = context.theme === 'dark' || context.theme === 'light' ? context.theme : null;
  str = STR[lang.startsWith('zh') ? 'zh' : 'en'];
  document.documentElement.lang = state.language;
  applyChromeTheme(state.theme);
  applyChromeStrings();
  buildOptionCards();
  customWInput.value = String(state.customWidth);
  customHInput.value = String(state.customHeight);

  // README 由宿主异步补发。卡片已经生成后只刷新数据，保留当前状态提示，
  // 避免把「已生成」覆盖成「已加载」。
  if (state.fragment) {
    // 卡片可能在 README 到位之前就已生成，此时提示可以重新生成以纳入 README。
    // 另外语言可能在这里变化，画幅读数与缩放按钮的朗读文本要跟着刷新。
    const { w, h } = canvasMetrics(state.fragmentCanvas);
    previewMeta.textContent = fmt(str.previewMeta, { canvas: canvasLabel(state.fragmentCanvas.id), w, h });
    updateZoomLabel();
    if (state.readme && !state.usedReadme) setStatus(str.readmeReady);
    return;
  }

  if (state.repository) {
    $('repo-name').textContent = state.repository.full_name;
    $('repo-desc').textContent = state.repository.description || state.repository.html_url || '';
    setStatus(state.readme ? str.loadedWithReadme : str.loadedWithoutReadme);
  } else {
    $('repo-name').textContent = 'Repo Info Card';
    $('repo-desc').textContent = '';
    setStatus(str.noRepository);
    $('picker').hidden = false;
  }
}

/* ── card-option tabs (same interaction language as the host's
      appearance settings: card grid + primary ring + check badge) ──── */

const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';

const STYLE_OPTIONS = [
  { id: 'te', strKey: 'styleTe' },
  { id: 'ink', strKey: 'styleInk' },
  { id: 'print', strKey: 'stylePrint' },
];

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function buildOptionButton({ id, selected, label, sub, swatch, wide, onSelect }) {
  const button = el('button', 'opt-card');
  button.type = 'button';
  button.setAttribute('role', 'radio');
  button.dataset.optionId = id;
  button.setAttribute('aria-checked', String(selected));
  button.tabIndex = selected ? 0 : -1;
  if (wide) button.classList.add('is-wide');
  if (swatch) button.append(swatch);
  const text = el('span', 'opt-text');
  const labelEl = el('span', 'opt-label');
  labelEl.textContent = label;
  text.append(labelEl);
  if (sub) {
    const subEl = el('span', 'opt-sub');
    subEl.textContent = sub;
    text.append(subEl);
  }
  button.append(text);
  const check = el('span', 'check');
  check.setAttribute('aria-hidden', 'true');
  check.innerHTML = CHECK_SVG;
  button.append(check);
  button.addEventListener('click', () => onSelect(id));
  return button;
}

function syncRadioState(grid, selectedId) {
  for (const button of grid.querySelectorAll('[role="radio"]')) {
    const isActive = button.dataset.optionId === selectedId;
    button.setAttribute('aria-checked', String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  }
}

// Roving tabindex：方向键在卡片间移动并同步选中（与主程序主题预设网格一致）。
function cardGridKeydown(event) {
  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const buttons = Array.from(event.currentTarget.querySelectorAll('[role="radio"]'));
  if (buttons.length === 0) return;
  const currentIndex = buttons.findIndex((button) => button === document.activeElement);
  let nextIndex;
  if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = buttons.length - 1;
  } else {
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    nextIndex = currentIndex === -1
      ? 0
      : (currentIndex + (forward ? 1 : -1) + buttons.length) % buttons.length;
  }
  event.preventDefault();
  buttons[nextIndex]?.focus();
  buttons[nextIndex]?.click();
}

function buildStyleSwatch(styleId) {
  const swatch = el('span', 'swatch swatch-style');
  swatch.setAttribute('aria-hidden', 'true');
  swatch.style.background = paletteValue(styleId, '--bg');
  const accent = el('span', 'swatch-accent');
  accent.style.background = paletteValue(styleId, '--red');
  const titleBar = el('span', 'swatch-line');
  titleBar.style.background = paletteValue(styleId, '--ink');
  const softBar = el('span', 'swatch-line swatch-line-soft');
  softBar.style.background = paletteValue(styleId, '--secondary');
  swatch.append(accent, titleBar, softBar);
  return swatch;
}

function buildCanvasSwatch(w, h, dashed) {
  const swatch = el('span', 'swatch-canvas');
  swatch.setAttribute('aria-hidden', 'true');
  const frame = el('span', `swatch-frame${dashed ? ' is-dashed' : ''}`);
  // 在 44×30 的盒子里按真实长宽比画出画布轮廓。
  const innerW = 44;
  const innerH = 30;
  let frameW = innerH * (w / h);
  let frameH = innerH;
  if (frameW > innerW) {
    frameW = innerW;
    frameH = innerW / (w / h);
  }
  frame.style.width = `${Math.max(6, Math.round(frameW))}px`;
  frame.style.height = `${Math.max(6, Math.round(frameH))}px`;
  swatch.append(frame);
  return swatch;
}

let customSubLabel = null;

function renderStyleCards() {
  styleGrid.replaceChildren();
  for (const option of STYLE_OPTIONS) {
    styleGrid.append(buildOptionButton({
      id: option.id,
      selected: state.styleId === option.id,
      label: str[option.strKey],
      swatch: buildStyleSwatch(option.id),
      onSelect: selectStyle,
    }));
  }
}

function renderCanvasCards() {
  canvasGrid.replaceChildren();
  customSubLabel = null;
  for (const preset of CANVAS_PRESETS) {
    canvasGrid.append(buildOptionButton({
      id: preset.id,
      selected: state.canvasId === preset.id,
      label: preset.label,
      sub: `${preset.w}×${preset.h}`,
      swatch: buildCanvasSwatch(preset.w, preset.h, false),
      onSelect: selectCanvas,
    }));
  }
  const customButton = buildOptionButton({
    id: CUSTOM_CANVAS_ID,
    selected: state.canvasId === CUSTOM_CANVAS_ID,
    label: str.custom,
    sub: `${state.customWidth}×${state.customHeight}`,
    swatch: buildCanvasSwatch(state.customWidth, state.customHeight, true),
    wide: true,
    onSelect: selectCanvas,
  });
  customSubLabel = customButton.querySelector('.opt-sub');
  canvasGrid.append(customButton);
}

function renderLanguageCards() {
  langGrid.replaceChildren();
  langGrid.append(buildOptionButton({
    id: 'auto',
    selected: state.languageOption === 'auto',
    label: str.followUi,
    onSelect: selectLanguage,
  }));
  for (const language of CARD_LANGUAGES) {
    langGrid.append(buildOptionButton({
      id: language.code,
      selected: state.languageOption === language.code,
      label: language.nativeName,
      onSelect: selectLanguage,
    }));
  }
}

function buildOptionCards() {
  renderStyleCards();
  renderCanvasCards();
  renderLanguageCards();
}

function selectStyle(id) {
  if (state.styleId === id) return;
  state.styleId = id;
  syncRadioState(styleGrid, id);
  if (state.fragment) {
    // Style only changes the plugin-owned CSS: re-skin without a new AI call.
    // CSS 按「生成时」的画幅快照构建，避免与旧卡片的 data-canvas 脱节。
    state.css = cssFor(state.styleId, state.fragmentCanvas);
    state.docHtml = assembleDocument(state.css, state.fragment,
      `${state.repository?.full_name || 'repository'} · info card`,
      paletteBackground(state.styleId));
    if (previewMode === 'preview') renderPreview();
  }
}

function selectCanvas(id) {
  if (state.canvasId === id) return;
  state.canvasId = id;
  customWrap.hidden = id !== CUSTOM_CANVAS_ID;
  syncRadioState(canvasGrid, id);
  // 已生成的卡片尺寸固定在生成时的画幅上。导出按快照取宽高，直接导出会
  // 把旧卡片裁进新画布，所以切换后禁用截图导出，直到重新生成。
  if (state.fragment) {
    copyImageButton.disabled = true;
    saveImageButton.disabled = true;
    setStatus(str.canvasChanged);
  }
}

function selectLanguage(id) {
  state.languageOption = id;
  syncRadioState(langGrid, id);
}

function handleCustomDimensionInput(input, dimension) {
  const clamped = clampCanvasDimension(input.value);
  if (clamped === null) {
    input.value = String(state[dimension]);
    return;
  }
  input.value = String(clamped);
  state[dimension] = clamped;
  if (customSubLabel) customSubLabel.textContent = `${state.customWidth}×${state.customHeight}`;
  // 已按旧自定义尺寸生成的卡片同样不能直接导出。
  if (state.canvasId === CUSTOM_CANVAS_ID && state.fragment) {
    copyImageButton.disabled = true;
    saveImageButton.disabled = true;
    setStatus(str.canvasChanged);
  }
}

/* ── preview rendering, zoom and drag-pan ────────────────────────── */

let cardSheet = null;

function applyCardStyles(root, css) {
  if (typeof CSSStyleSheet === 'function' && 'adoptedStyleSheets' in root) {
    try {
      if (!cardSheet) cardSheet = new CSSStyleSheet();
      cardSheet.replaceSync(css);
      root.adoptedStyleSheets = [cardSheet];
      for (const stale of root.querySelectorAll('style[data-card-css]')) stale.remove();
      return;
    } catch { /* 不可用则退回 <style>（放行内联样式的环境下仍可用） */ }
  }
  let style = root.querySelector('style[data-card-css]');
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('data-card-css', '');
    root.append(style);
  }
  style.textContent = css;
}

function updateZoomLabel() {
  const percent = Math.round(state.fitScale * state.zoom * 100);
  zoomLevelButton.textContent = `${percent}%`;
  // 数字对读屏只是个读数，补上它实际执行的动作。
  zoomLevelButton.setAttribute('aria-label', `${percent}% · ${str.zoomFit}`);
}

function setZoom(value) {
  state.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  if (state.fragment) renderPreview();
}

function updatePanState() {
  // 内容溢出时才允许拖拽平移；光标与提示随之切换。
  const pannable = previewScroll.scrollWidth > previewScroll.clientWidth + 1
    || previewScroll.scrollHeight > previewScroll.clientHeight + 1;
  previewScroll.classList.toggle('is-pannable', pannable);
  if (pannable) previewScroll.setAttribute('title', str.panHint);
  else previewScroll.removeAttribute('title');
}

function renderPreview() {
  // 先取消隐藏再量尺寸：preview-wrap 处于 hidden 时 clientWidth 为 0，
  // 会让自适应比例算成最小值。
  previewWrap.hidden = false;
  previewEmpty.hidden = true;
  const { w, h } = canvasMetrics(state.fragmentCanvas);
  // 自适应比例只依赖容器尺寸，不依赖卡片，所以在 card 判空之前就算好并刷新读数，
  // 这样即便 AI 输出缺根元素，画幅与缩放信息也不会留旧值。
  const availableWidth = Math.max(240, previewScroll.clientWidth - 28);
  const availableHeight = Math.max(240, previewScroll.clientHeight - 28);
  state.fitScale = Math.min(availableWidth / w, availableHeight / h, 1);
  previewMeta.textContent = fmt(str.previewMeta, { canvas: canvasLabel(state.fragmentCanvas.id), w, h });
  updateZoomLabel();
  const root = previewHost.shadowRoot || previewHost.attachShadow({ mode: 'open' });
  // 只写卡片标记；样式走 adoptedStyleSheets，不会被 CSP 拦掉。
  root.innerHTML = state.fragment;
  applyCardStyles(root, state.css);
  const card = root.getElementById('card');
  if (!card) return;
  const scale = state.fitScale * state.zoom;
  card.style.transformOrigin = '0 0';
  card.style.transform = `scale(${scale})`;
  previewHost.style.overflow = 'hidden';
  previewHost.style.width = `${Math.round(w * scale)}px`;
  previewHost.style.height = `${Math.round(h * scale)}px`;
  updatePanState();
}

/* 拖拽画布平移：仅鼠标（触摸设备保留原生滚动），内容溢出时生效。 */
let panState = null;

previewScroll.addEventListener('pointerdown', (event) => {
  if (event.pointerType !== 'mouse' || event.button !== 0) return;
  if (!state.fragment || !previewScroll.classList.contains('is-pannable')) return;
  panState = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    left: previewScroll.scrollLeft,
    top: previewScroll.scrollTop,
  };
  previewScroll.classList.add('is-dragging');
  previewScroll.setPointerCapture(event.pointerId);
});

previewScroll.addEventListener('pointermove', (event) => {
  if (!panState || event.pointerId !== panState.pointerId) return;
  previewScroll.scrollLeft = panState.left - (event.clientX - panState.x);
  previewScroll.scrollTop = panState.top - (event.clientY - panState.y);
});

function endPan(event) {
  if (!panState || event.pointerId !== panState.pointerId) return;
  panState = null;
  previewScroll.classList.remove('is-dragging');
  if (previewScroll.hasPointerCapture(event.pointerId)) {
    previewScroll.releasePointerCapture(event.pointerId);
  }
}

previewScroll.addEventListener('pointerup', endPan);
previewScroll.addEventListener('pointercancel', endPan);

/* ── preview / code tabs ─────────────────────────────────────────── */

let previewMode = 'preview';  // 'preview' | 'code'

function refreshCodeHighlight() {
  // 末尾补一个换行，保证高亮层与 textarea 的滚动高度一致。
  codeHighlight.innerHTML = `${highlightHtml(codeEditor.value)}\n`;
  codeHighlight.scrollTop = codeEditor.scrollTop;
  codeHighlight.scrollLeft = codeEditor.scrollLeft;
}

function syncCodeEditor() {
  codeEditor.value = state.fragment ?? '';
  refreshCodeHighlight();
}

function syncPreviewMode() {
  const isPreview = previewMode === 'preview';
  tabPreview.setAttribute('aria-selected', String(isPreview));
  tabCode.setAttribute('aria-selected', String(!isPreview));
  previewScroll.hidden = !isPreview;
  codeWrap.hidden = isPreview;
  zoomGroup.hidden = !isPreview;   // 缩放只对渲染画布有意义
  if (!isPreview) syncCodeEditor();
}

// 把代码页的编辑内容净化后应用回状态；失败（缺根元素等）向上抛，
// 由调用方决定留在代码页。只在内容真的变化时刷新编辑器与文档。
function applyCodeEdits() {
  let next;
  try {
    next = sanitizeFragment(codeEditor.value, state.fragmentCanvas);
  } catch (error) {
    // 手工编辑缺根元素时，不要复用「AI 输出缺少…」的文案。
    if (error instanceof Error && error.message === str.noCard) throw new Error(str.codeInvalid);
    throw error;
  }
  if (next === state.fragment) return false;
  state.fragment = next;
  state.css = cssFor(state.styleId, state.fragmentCanvas);
  state.docHtml = assembleDocument(state.css, state.fragment,
    `${state.repository?.full_name || 'repository'} · info card`,
    paletteBackground(state.styleId));
  syncCodeEditor();
  return true;
}

function selectPreviewTab(mode) {
  if (mode === previewMode || !state.fragment) return;
  if (mode === 'preview') {
    let changed;
    try {
      changed = applyCodeEdits();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : str.codeInvalid);
      return;  // 代码无效：留在代码页并提示
    }
    if (changed) setStatus(str.codeApplied);
  }
  previewMode = mode;
  syncPreviewMode();
  if (mode === 'preview') renderPreview();  // 量尺寸前必须已取消隐藏
}

tabPreview.addEventListener('click', () => selectPreviewTab('preview'));
tabCode.addEventListener('click', () => selectPreviewTab('code'));
codeEditor.addEventListener('input', refreshCodeHighlight);
codeEditor.addEventListener('scroll', () => {
  codeHighlight.scrollTop = codeEditor.scrollTop;
  codeHighlight.scrollLeft = codeEditor.scrollLeft;
});

async function generate() {
  if (!state.repository) { setStatus(str.noRepository); return; }
  generateButton.disabled = true;
  try {
    setStatus(str.generating);
    const canvas = selectedCanvas();
    const system = buildSystemPrompt(canvas, state.languageOption);
    const { prompt: user, readmeIncluded, truncatedReadme } =
      buildUserPrompt(state.repository, state.readme, state.notes);
    const text = await request('ai.generate', { system, user, maxTokens: 4000 });
    state.usedReadme = readmeIncluded;
    state.fragmentCanvas = canvas;
    state.fragmentLanguage = resolvedCardLanguage();
    state.fragment = sanitizeFragment(text, canvas);
    state.css = cssFor(state.styleId, canvas);
    state.docHtml = assembleDocument(state.css, state.fragment,
      `${state.repository.full_name} · info card`,
      paletteBackground(state.styleId));
    previewWrap.hidden = false;
    previewEmpty.hidden = true;
    if (previewMode === 'code') {
      // 代码页激活时不能量隐藏容器的尺寸；切回预览页会重新计算自适应比例。
      syncCodeEditor();
      const { w, h } = canvasMetrics(state.fragmentCanvas);
      previewMeta.textContent = fmt(str.previewMeta, { canvas: canvasLabel(state.fragmentCanvas.id), w, h });
    } else {
      renderPreview();
    }
    copyCodeButton.disabled = false;
    copyImageButton.disabled = false;
    saveImageButton.disabled = false;
    setStatus(truncatedReadme ? str.generatedReadmeTruncated
      : readmeIncluded ? str.generatedWithReadme : str.generatedMetadataOnly);
  } catch (error) {
    const message = error instanceof Error ? error.message : str.bridgeFailed;
    setStatus(fmt(message.includes('id="card"') ? str.noCard : str.aiFailed, { message }));
  } finally {
    generateButton.disabled = false;
  }
}

async function copyCode() {
  try {
    await request('clipboard.write', { text: state.docHtml });
    setStatus(str.copyOk);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : str.bridgeFailed);
  }
}

async function copyImage() {
  try {
    setStatus('…');
    const { dataBase64 } = await exportPngBase64();
    await request('clipboard.writeImage', { dataBase64 });
    setStatus(str.imageOk);
  } catch (error) {
    setStatus(fmt(str.exportFailed, { message: error instanceof Error ? error.message : str.bridgeFailed }));
  }
}

async function saveImage() {
  try {
    setStatus('…');
    const { dataBase64 } = await exportPngBase64();
    const snapshot = state.fragmentCanvas || selectedCanvas();
    const canvasSuffix = snapshot.id === CUSTOM_CANVAS_ID
      ? `${snapshot.id}-${snapshot.w}x${snapshot.h}`
      : snapshot.id;
    const safeName = String(state.repository?.name || 'repository').replace(/[^\w.-]+/g, '-');
    const result = await request('downloads.saveFile', {
      fileName: `${safeName}-info-card-${canvasSuffix}.png`,
      dataBase64,
    });
    setStatus(result?.canceled ? str.canceled : fmt(str.savedOk, { name: result?.fileName || '' }));
  } catch (error) {
    setStatus(fmt(str.exportFailed, { message: error instanceof Error ? error.message : str.bridgeFailed }));
  }
}

/* Fallback entry (no repository context): pick one via repositories.search. */

async function searchRepositories() {
  try {
    setStatus(str.searching);
    const results = await request('repositories.search', {
      query: $('picker-query').value.trim() || 'a', limit: 10,
    });
    const list = $('picker-results');
    list.replaceChildren();
    for (const repository of results) {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = repository.full_name;
      const meta = document.createElement('span');
      meta.className = 'muted';
      meta.textContent = `★ ${repository.stargazers_count}`;
      item.append(name, meta);
      item.addEventListener('click', () => void selectPickedRepository(repository.id));
      list.append(item);
    }
    setStatus(fmt(str.searchDone, { n: results.length }));
  } catch (error) {
    setStatus(error instanceof Error ? error.message : str.bridgeFailed);
  }
}

async function selectPickedRepository(repositoryId) {
  try {
    const repository = await request('repositories.get', { repositoryId });
    if (!repository) { setStatus(str.noRepository); return; }
    state.repository = repository;
    state.readme = null;
    $('repo-name').textContent = repository.full_name;
    $('repo-desc').textContent = repository.description || repository.html_url || '';
    setStatus(str.loadedWithoutReadme);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : str.bridgeFailed);
  }
}

generateButton.addEventListener('click', () => void generate());
copyCodeButton.addEventListener('click', () => void copyCode());
copyImageButton.addEventListener('click', () => void copyImage());
saveImageButton.addEventListener('click', () => void saveImage());
$('picker-search').addEventListener('click', () => void searchRepositories());
$('picker-query').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void searchRepositories();
});
customWInput.addEventListener('change', () => handleCustomDimensionInput(customWInput, 'customWidth'));
customHInput.addEventListener('change', () => handleCustomDimensionInput(customHInput, 'customHeight'));
notesInput.addEventListener('input', () => { state.notes = notesInput.value; });
styleGrid.addEventListener('keydown', cardGridKeydown);
canvasGrid.addEventListener('keydown', cardGridKeydown);
langGrid.addEventListener('keydown', cardGridKeydown);
window.addEventListener('resize', () => {
  if (state.fragment && previewMode === 'preview') renderPreview();
});

/* Preview zoom: buttons, percentage and Ctrl/⌘ + wheel. */
$('zoom-in').addEventListener('click', () => setZoom(state.zoom * ZOOM_STEP));
$('zoom-out').addEventListener('click', () => setZoom(state.zoom / ZOOM_STEP));
$('zoom-fit').addEventListener('click', () => setZoom(1));
$('zoom-level').addEventListener('click', () => setZoom(1));
$('zoom-actual').addEventListener('click', () => setZoom(1 / (state.fitScale || 1)));
previewScroll.addEventListener('wheel', (event) => {
  if (!state.fragment || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  setZoom(state.zoom * (event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
}, { passive: false });

/* Initial paint: card tabs + system-preferred chrome until init arrives. */
applyChromeTheme(null);
buildOptionCards();
customWInput.value = String(state.customWidth);
customHInput.value = String(state.customHeight);
