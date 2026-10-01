/* Repo Info Card — page-only example plugin (V1.4 opensPage modal entry).
 *
 * The host modal sends one `plugin-page:init` message carrying
 * `context = { repository, readme, language }`. Everything else goes through
 * the permission-checked bridge: `ai.generate` for card markup,
 * `clipboard.write` / `clipboard.writeImage` / `downloads.saveFile` for export.
 */
const PLUGIN_ID = 'com.githubstarsmanager.repo-info-card';
const PAGE_ID = 'info-card';

const AI_SYSTEM_LIMIT = 2000; // bridge hard limit for ai.generate system prompt
const AI_USER_LIMIT = 8000;   // bridge hard limit for ai.generate user prompt

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
      requestId, token, method, args,
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
    generated: '已生成。可预览、复制代码或导出截图（@2x）。',
    copyOk: 'HTML 代码已复制到剪贴板。',
    imageOk: '截图已写入剪贴板。',
    savedOk: '截图已保存：{name}',
    canceled: '已取消。',
    aiFailed: '生成失败：{message}',
    noCard: 'AI 输出缺少 id="card" 根元素，请重试。',
    exportFailed: '导出失败：{message}',
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
    generated: 'Generated. Preview it, copy the code, or export a @2x screenshot.',
    copyOk: 'HTML code copied to the clipboard.',
    imageOk: 'Screenshot copied to the clipboard.',
    savedOk: 'Screenshot saved: {name}',
    canceled: 'Canceled.',
    aiFailed: 'Generation failed: {message}',
    noCard: 'AI output is missing the id="card" root element. Try again.',
    exportFailed: 'Export failed: {message}',
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
  return `:root{${palette}--font:${FONT_SANS};--mono:${FONT_MONO};}\n${CARD_CSS}`;
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

function buildUserPrompt(repository, readme) {
  const repo = repository;
  const lines = [
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
  if (readme) {
    const budget = AI_USER_LIMIT - prompt.length - '\n\nREADME (verbatim excerpt, may be truncated):\n'.length;
    if (budget > 200) {
      prompt += `\n\nREADME (verbatim excerpt, may be truncated):\n${readme.slice(0, budget)}`;
    }
  }
  return prompt.slice(0, AI_USER_LIMIT);
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
      else if ((name === 'href' || name === 'src' || name === 'xlink:href') &&
        attr.value.trim().toLowerCase().startsWith('javascript:')) el.removeAttribute(attr.name);
    }
  });
  const card = doc.getElementById('card');
  if (!card) throw new Error(str.noCard);
  card.setAttribute('data-canvas', canvasId);
  return doc.body.innerHTML;
}

function escapeXmlText(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function assembleDocument(css, fragment, title) {
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>body{margin:0;background:#f4f3f0;}</style>
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

function renderPreview() {
  const root = previewHost.shadowRoot || previewHost.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${state.css}</style>${state.fragment}`;
  const card = root.getElementById('card');
  const { w, h } = CANVASES[state.canvasId];
  const availableWidth = Math.max(240, previewScroll.clientWidth - 28);
  const availableHeight = Math.max(240, window.innerHeight * 0.52);
  const scale = Math.min(availableWidth / w, availableHeight / h, 1);
  card.style.transformOrigin = '0 0';
  card.style.transform = `scale(${scale})`;
  previewHost.style.overflow = 'hidden';
  previewHost.style.width = `${Math.round(w * scale)}px`;
  previewHost.style.height = `${Math.round(h * scale)}px`;
  previewWrap.hidden = false;
}

async function generate() {
  if (!state.repository) { setStatus(str.noRepository); return; }
  generateButton.disabled = true;
  try {
    setStatus(str.generating);
    const system = buildSystemPrompt(state.canvasId, state.languageOption);
    const user = buildUserPrompt(state.repository, state.readme);
    const text = await request('ai.generate', { system, user, maxTokens: 4000 });
    state.fragment = sanitizeFragment(text, state.canvasId);
    state.css = cssFor(state.styleId);
    state.docHtml = assembleDocument(state.css, state.fragment,
      `${state.repository.full_name} · info card`);
    renderPreview();
    copyCodeButton.disabled = false;
    copyImageButton.disabled = false;
    saveImageButton.disabled = false;
    setStatus(str.generated);
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
      `${state.repository?.full_name || 'repository'} · info card`);
    renderPreview();
  }
});
$('opt-canvas').addEventListener('change', (event) => { state.canvasId = event.target.value; });
$('opt-language').addEventListener('change', (event) => { state.languageOption = event.target.value; });
window.addEventListener('resize', () => { if (state.fragment) renderPreview(); });
