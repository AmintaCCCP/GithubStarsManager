/* Repo Info Card — page-only example plugin (V1.4 opensPage modal entry).
 *
 * The host modal sends one `plugin-page:init` message carrying
 * `context = { repository, readme, language }`. Everything else goes through
 * the permission-checked bridge: `ai.generate` for card markup,
 * `clipboard.write` / `clipboard.writeImage` / `downloads.saveFile` for export.
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
    generate: '生成信息卡', regenerate: '重新生成',
    copyCode: '复制 HTML 代码', copyImage: '复制截图', saveImage: '保存截图',
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
    generatedWithReadme: '已生成（基于 README）。可预览、缩放、复制代码或导出截图（@2x）。',
    generatedMetadataOnly: '已生成（未取得 README，仅使用元信息）。可预览、缩放、复制代码或导出截图（@2x）。',
    generatedReadmeTruncated: '已生成，但 README 超出提示词上限、已截断。可预览、缩放、复制代码或导出截图（@2x）。',
    readmeReady: 'README 已就绪，重新生成即可把 README 内容纳入卡片。',
  },
  en: {
    bridgeNotReady: 'Host bridge is not ready',
    bridgeFailed: 'Host request failed',
    style: 'Style', canvas: 'Canvas', cardLanguage: 'Card language', followUi: 'Follow UI',
    generate: 'Generate card', regenerate: 'Regenerate',
    copyCode: 'Copy HTML code', copyImage: 'Copy screenshot', saveImage: 'Save screenshot',
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
    generatedWithReadme: 'Generated from the README. Preview, zoom, copy the code, or export a @2x screenshot.',
    generatedMetadataOnly: 'Generated without a README (metadata only). Preview, zoom, copy the code, or export a @2x screenshot.',
    generatedReadmeTruncated: 'Generated, but the README exceeded the prompt limit and was truncated. Preview, zoom, copy the code, or export a @2x screenshot.',
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

const CANVASES = {
  '1x1': { w: 1200, h: 1200 },
  '5x2': { w: 1500, h: 600 },
  '3x4': { w: 1200, h: 1600 },
};

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
#card[data-canvas="5x2"] .hero{display:flex;gap:48px;flex:1;align-items:center;min-height:0;}
#card[data-canvas="5x2"] .hero-left{flex:1.6;}
#card[data-canvas="5x2"] .hero-right{flex:1;border-left:1px solid var(--hairline);padding-left:40px;display:flex;flex-direction:column;gap:18px;}
#card[data-canvas="5x2"] .reads{grid-template-columns:repeat(3,1fr);gap:14px;margin-top:0;padding-top:0;border-top:0;}
#card[data-canvas="5x2"] .read .v{font-size:22px;}
#card[data-canvas="3x4"]{--w:1200px;--h:1600px;--title-size:64px;--pad:40px 60px 48px;}
#card[data-canvas="3x4"] .reads{grid-template-columns:repeat(2,1fr);gap:22px;}
#card[data-canvas="3x4"] .spec{grid-template-columns:1fr;}
`;

function cssFor(styleId) {
  const palette = PALETTES[styleId] || PALETTES.te;
  // 变量挂在 #card 而不是 :root：预览用 shadow DOM 渲染，:root 在 shadow tree 里
  // 匹配不到任何元素，卡片会连同调色板一起退化成浏览器默认样式。
  return `#card{${palette}--font:${FONT_SANS};--mono:${FONT_MONO};}\n${CARD_CSS}`;
}

function paletteBackground(styleId) {
  const match = (PALETTES[styleId] || PALETTES.te).match(/--bg:([^;]+);/);
  return match ? match[1] : '#f4f3f0';
}

/* ── prompt builders (plugin owns layout; AI writes the markup) ──── */

const STRUCTURES = {
  '1x1': `<div id="card" data-canvas="1x1">
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
  '5x2': `<div id="card" data-canvas="5x2">
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
  '3x4': `<div id="card" data-canvas="3x4">
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
  if (option === 'zh') return 'Simplified Chinese (简体中文)';
  if (option === 'en') return 'English';
  return str === STR.zh ? 'Simplified Chinese (简体中文)' : 'English';
}

function buildSystemPrompt(canvasId, languageOption) {
  const system = `You are an information designer. Return ONE info card for the repository facts in the user message.

OUTPUT
- Raw HTML only: no markdown, no code fences, no commentary, no <html>/<head>/<body>.
- No <script>, <style>, <img>, <svg>, <a> or any external resource. Text only. No emoji.
- Root element exactly <div id="card" data-canvas="${canvasId}"> with the element sequence and class names below; nothing outside it.
- .accent wraps exactly ONE keyword inside .title and ONE inside .closer. No other color.
- Facts: only from the user message. Never invent numbers, quotes, versions or claims; omit an element when its value is unknown. Format big numbers like 43.7K or 1.2M.
- Language: ${cardLanguageLabel(languageOption)}. Keep English proper nouns verbatim; one space between CJK and Latin. No hype words.
- Column headings are judgements, not topic labels. Do not repeat one fact in two sections.

STRUCTURE
${STRUCTURES[canvasId]}`;
  if (system.length > AI_SYSTEM_LIMIT) {
    throw new Error(`System prompt exceeds the bridge limit (${system.length} > ${AI_SYSTEM_LIMIT})`);
  }
  return system;
}

/* ── README: forward the full text; the prompt limit is now the only edge ── */

function buildUserPrompt(repository, readme) {
  const repo = repository;
  const lines = [
    'TASK',
    'Compose ONE info card for this repository.',
    '- Ground the card in the README text below: name the concrete capabilities, workflow, stack and limits it actually states.',
    '- Use the one-line description, topics and ai_summary only to fill gaps the README does not cover.',
    '- Never invent facts, numbers, versions, dates or quotes that are not written below.',
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
  ];
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

function sanitizeFragment(raw, canvasId) {
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
  card.setAttribute('data-canvas', canvasId);
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

function assembleDocument(css, fragment, title, background) {
  return `<!doctype html>
<html lang="zh">
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
  const { w, h } = CANVASES[state.canvasId];
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

/* ── app state + UI wiring ───────────────────────────────────────── */

const ZOOM_MIN = 0.2;   // 相对「适应窗口」的最小倍率
const ZOOM_MAX = 6;     // 相对「适应窗口」的最大倍率
const ZOOM_STEP = 1.25;

const state = {
  repository: null,
  readme: null,
  language: 'zh',
  styleId: 'te',
  canvasId: '1x1',
  languageOption: 'auto',
  fragment: null,
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
const previewWrap = $('preview-wrap');
const previewScroll = $('preview-scroll');
const previewHost = $('preview-host');
const previewMeta = $('preview-meta');
const zoomLevelButton = $('zoom-level');

function setStatus(message) { statusEl.textContent = message; }

function currentCardLanguage() {
  if (state.languageOption !== 'auto') return state.languageOption;
  return state.language === 'zh' ? 'zh' : 'en';
}

function handleInit(context) {
  state.repository = context.repository || null;
  state.readme = typeof context.readme === 'string' && context.readme ? context.readme : null;
  const lang = String(context.language || 'zh');
  state.language = lang.startsWith('zh') ? 'zh' : 'en';
  str = STR[state.language];
  document.documentElement.lang = state.language;
  applyChromeStrings();

  // README 由宿主异步补发。卡片已经生成后只刷新数据，保留当前状态提示，
  // 避免把「已生成」覆盖成「已加载」。
  if (state.fragment) {
    // 卡片可能在 README 到位之前就已生成，此时提示可以重新生成以纳入 README。
    // 另外语言可能在这里变化，画幅读数与缩放按钮的朗读文本要跟着刷新。
    const { w, h } = CANVASES[state.canvasId];
    previewMeta.textContent = fmt(str.previewMeta, { canvas: state.canvasId, w, h });
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

// 页面 CSP 是 style-src plugin-page://<id>（不含 'unsafe-inline'），动态插入的
// <style> 元素会被拦截，卡片因此退化成浏览器默认样式。Constructable Stylesheet
// 不归 style-src 管，adopt 到 shadow root 后可在同样的 CSP 下正常生效。
// sheet 复用同一实例：缩放/重绘会频繁调用本函数，避免每次 new 一份。
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

function renderPreview() {
  // 先取消隐藏再量尺寸：preview-wrap 处于 hidden 时 clientWidth 为 0，
  // 会让自适应比例算成最小值。
  previewWrap.hidden = false;
  const { w, h } = CANVASES[state.canvasId];
  // 自适应比例只依赖容器尺寸，不依赖卡片，所以在 card 判空之前就算好并刷新读数，
  // 这样即便 AI 输出缺根元素，画幅与缩放信息也不会留旧值。
  const availableWidth = Math.max(240, previewScroll.clientWidth - 28);
  const availableHeight = Math.max(240, window.innerHeight * 0.52);
  state.fitScale = Math.min(availableWidth / w, availableHeight / h, 1);
  previewMeta.textContent = fmt(str.previewMeta, { canvas: state.canvasId, w, h });
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
}

async function generate() {
  if (!state.repository) { setStatus(str.noRepository); return; }
  generateButton.disabled = true;
  try {
    setStatus(str.generating);
    const system = buildSystemPrompt(state.canvasId, state.languageOption);
    const { prompt: user, readmeIncluded, truncatedReadme } =
      buildUserPrompt(state.repository, state.readme);
    const text = await request('ai.generate', { system, user, maxTokens: 4000 });
    state.usedReadme = readmeIncluded;
    state.fragment = sanitizeFragment(text, state.canvasId);
    state.css = cssFor(state.styleId);
    state.docHtml = assembleDocument(state.css, state.fragment,
      `${state.repository.full_name} · info card`, paletteBackground(state.styleId));
    renderPreview();
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
    const safeName = String(state.repository?.name || 'repository').replace(/[^\w.-]+/g, '-');
    const result = await request('downloads.saveFile', {
      fileName: `${safeName}-info-card-${state.canvasId}.png`,
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
$('opt-style').addEventListener('change', (event) => {
  state.styleId = event.target.value;
  if (state.fragment) {
    // Style only changes the plugin-owned CSS: re-skin without a new AI call.
    state.css = cssFor(state.styleId);
    state.docHtml = assembleDocument(state.css, state.fragment,
      `${state.repository?.full_name || 'repository'} · info card`, paletteBackground(state.styleId));
    renderPreview();
  }
});
$('opt-canvas').addEventListener('change', (event) => {
  state.canvasId = event.target.value;
  // 已生成的卡片尺寸固定在生成时的画幅上。导出按当前画幅取宽高，直接导出会
  // 把旧卡片裁进新画布，所以切换后禁用截图导出，直到重新生成。
  if (state.fragment) {
    copyImageButton.disabled = true;
    saveImageButton.disabled = true;
    setStatus(str.canvasChanged);
  }
});
$('opt-language').addEventListener('change', (event) => { state.languageOption = event.target.value; });
window.addEventListener('resize', () => { if (state.fragment) renderPreview(); });

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
