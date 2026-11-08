/* Repo Custom Fields — 纯数据与渲染模型。
 *
 * 这份文件同时服务两个运行环境：
 *  - 插件页面（浏览器）：作为普通 <script> 引入，挂在 window.RepoFieldsModel；
 *  - Node 测试：electron/plugins/*.test.js 用 node --test 直接 require。
 * 因此只用无副作用、不碰 DOM 的纯函数，并以 UMD 形式导出。
 *
 * 数据模型（一个仓库一份文档，存于插件 storage 的 `fields:<repository id>` 键）：
 *   { "schema": 1, "fields": [
 *     { "id": "f_xxxx", "type": "text", "name": "备注",   "value": "单行文本" },
 *     { "id": "f_yyyy", "type": "note", "name": "说明",   "value": "## 标题…",
 *       "format": "markdown" | "code" },
 *     { "id": "f_zzzz", "type": "link", "name": "官网",   "value": "https://…" }
 *   ] }
 * 字段顺序即展示顺序，编辑视图的拖拽排序直接落到数组顺序。
 */
(function (root, factory) {
  const api = factory();
  // 仓库 package.json 声明 "type": "module"，Node 会把本文件按 ESM 加载
  // （module 不存在），因此同时挂到 globalThis；浏览器作为普通脚本加载时
  // 走 window.RepoFieldsModel。
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.RepoFieldsModel = api;
})(typeof globalThis !== 'undefined' ? globalThis : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  /* ── 限额：与宿主插件 storage 的 64 KiB/值、1 MiB/插件总配额对齐 ────── */

  const SCHEMA = 1;
  const FIELD_TYPES = ['text', 'note', 'link'];
  const NOTE_FORMATS = ['markdown', 'code'];
  const MAX_FIELDS = 50;
  const MAX_NAME_CHARS = 80;
  // 单字段内容上限：留出 JSON 转义余量，保证单字段不会单独撞上 64 KiB。
  const MAX_VALUE_CHARS = 10000;
  // 整份文档的保存预算：与宿主插件 storage 的 64 KiB 单值上限对齐
  // （docBytes 统计的正是写进 storage 的那段 JSON 字节）。
  const MAX_DOC_BYTES = 64 * 1024;
  const MAX_URL_CHARS = 2048;

  /* ── 工具 ─────────────────────────────────────────────────────────── */

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function clampString(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
  }

  /** 回环、链路本地与 IPv6 唯一本地地址：与宿主 shell.openExternal 白名单一致。 */
  function isLoopbackOrLinkLocalHost(hostname) {
    const host = String(hostname).toLowerCase().replace(/^\[/, '').replace(/\]$/, '').replace(/\.$/, '');
    if (host === 'localhost' || host.endsWith('.localhost')) return true;
    if (host === '::1' || host === '::' || host === '0.0.0.0') return true;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      return a === 127 || a === 0 || (a === 169 && b === 254);
    }

    // IPv4 映射的 IPv6：::ffff:7f00:1 → 127.0.0.1
    const mapped = /^::(?:ffff:)?([0-9a-f]{1,4}):[0-9a-f]{1,4}$/.exec(host);
    if (mapped) {
      const first = Number.parseInt(mapped[1], 16);
      const a = first >>> 8;
      const b = first & 0xff;
      if (a === 127 || a === 0 || (a === 169 && b === 254)) return true;
    }

    // IPv6 链路本地 fe80::/10 与唯一本地 fc00::/7。
    return /^fe[89ab][0-9a-f]{0,2}:/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host);
  }

  /** http/https 绝对 URL（与宿主 shell.openExternal 桥的白名单一致）。 */
  function isExternalUrl(value) {
    if (typeof value !== 'string' || !value || value.length > MAX_URL_CHARS) return false;
    let url;
    try { url = new URL(value); } catch { return false; }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
    if (!url.hostname || isLoopbackOrLinkLocalHost(url.hostname)) return false;
    return true;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  /* ── 文档读取与规整 ────────────────────────────────────────────────── */

  function emptyDoc() {
    return { schema: SCHEMA, fields: [] };
  }

  /**
   * 把 storage 读到的任意 JSON 规整成可信文档：未知类型/结构丢弃、字符串截断、
   * 数量截断、id 缺失时补齐。损坏的数据不会让页面崩溃，最多表现为字段缺失。
   */
  function sanitizeDoc(raw) {
    if (!isPlainObject(raw)) return emptyDoc();
    const fields = Array.isArray(raw.fields) ? raw.fields : [];
    const seen = new Set();
    const clean = [];
    for (const item of fields) {
      if (clean.length >= MAX_FIELDS) break;
      if (!isPlainObject(item) || !FIELD_TYPES.includes(item.type)) continue;
      let id = typeof item.id === 'string' && item.id ? item.id.slice(0, 64) : '';
      while (!id || seen.has(id)) id = `f_${clean.length}_${Math.random().toString(36).slice(2, 8)}`;
      seen.add(id);
      const field = {
        id,
        type: item.type,
        name: clampString(item.name, MAX_NAME_CHARS),
        value: clampString(item.value, MAX_VALUE_CHARS),
      };
      if (field.type === 'note') {
        field.format = NOTE_FORMATS.includes(item.format) ? item.format : 'markdown';
      }
      clean.push(field);
    }
    return { schema: SCHEMA, fields: clean };
  }

  /** 文档 JSON 字节数（UTF-8），即写进 storage 的那段值的真实字节量。 */
  function docBytes(doc) {
    const serialized = JSON.stringify(doc);
    if (typeof Buffer !== 'undefined' && typeof Buffer.byteLength === 'function') {
      return Buffer.byteLength(serialized, 'utf8');
    }
    return new TextEncoder().encode(serialized).length;
  }

  /* ── 编辑草稿校验 ──────────────────────────────────────────────────── */

  /**
   * 把编辑视图的草稿行收敛成可保存文档。
   * @returns {{ ok: true, doc: object } | { ok: false, problems: Array<{ index: number, kind: 'name' | 'value' }> }}
   */
  function draftToDoc(drafts) {
    if (!Array.isArray(drafts)) return { ok: false, problems: [{ index: 0, kind: 'name' }] };
    if (drafts.length > MAX_FIELDS) {
      return { ok: false, problems: [{ index: drafts.length - 1, kind: 'name' }] };
    }
    const fields = [];
    const problems = [];
    drafts.forEach((draft, index) => {
      if (!isPlainObject(draft) || !FIELD_TYPES.includes(draft.type)) {
        problems.push({ index, kind: 'name' });
        return;
      }
      const name = draft.name.trim();
      const value = typeof draft.value === 'string' ? draft.value : '';
      // 链接字段允许不填名称：预览时以 URL 本身作标签（issue #574 的明确要求）。
      const nameOptional = draft.type === 'link';
      if ((!name && !nameOptional) || name.length > MAX_NAME_CHARS) {
        problems.push({ index, kind: 'name' });
        return;
      }
      if (value.length > MAX_VALUE_CHARS) {
        problems.push({ index, kind: 'value' });
        return;
      }
      // 链接值不能为空，且必须是可以交给系统浏览器打开的 http/https URL。
      if (draft.type === 'link' && (!value.trim() || !isExternalUrl(value.trim()))) {
        problems.push({ index, kind: 'value' });
        return;
      }
      const field = {
        id: typeof draft.id === 'string' && draft.id ? draft.id : `f_${index}_${Math.random().toString(36).slice(2, 8)}`,
        type: draft.type,
        name,
        value: draft.type === 'link' ? value.trim() : value,
      };
      if (draft.type === 'note') {
        field.format = NOTE_FORMATS.includes(draft.format) ? draft.format : 'markdown';
      }
      fields.push(field);
    });
    if (problems.length > 0) return { ok: false, problems };
    const doc = { schema: SCHEMA, fields };
    // 整份文档的字节预算：宿主 storage 单值上限 64 KiB，超限在本地先拦下，
    // 给出比宿主报错更可操作的提示。
    if (docBytes(doc) > MAX_DOC_BYTES) {
      return { ok: false, problems: [{ index: -1, kind: 'doc' }] };
    }
    return { ok: true, doc };
  }

  /* ── 轻量 Markdown 渲染（安全优先的白名单子集）─────────────────────── */

  /**
   * 行内标记单遍分词：在**原始**文本上切分标记，再逐段转义输出，避免
   * “先转义后匹配”把 URL 里的 & 等字符破坏掉。
   * 链接只生成 data-url（含合法 http/https URL），由页面统一经外链桥打开。
   */
  const INLINE_TOKEN_RE =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(~~[^~\n]+~~)|(\[[^\]\n]*\]\([^()\s]+\))|(https?:\/\/[^\s<>]+)/g;

  function renderInlineSegment(text) {
    let out = '';
    let cursor = 0;
    INLINE_TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = INLINE_TOKEN_RE.exec(text))) {
      out += escapeHtml(text.slice(cursor, match.index));
      cursor = match.index + match[0].length;
      const token = match[0];
      if (token.startsWith('`')) {
        out += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
      } else if (token.startsWith('**')) {
        out += `<b>${escapeHtml(token.slice(2, -2))}</b>`;
      } else if (token.startsWith('~~')) {
        out += `<s>${escapeHtml(token.slice(2, -2))}</s>`;
      } else if (token.startsWith('*')) {
        out += `<i>${escapeHtml(token.slice(1, -1))}</i>`;
      } else if (token.startsWith('[')) {
        const parsed = /^\[([^\]\n]*)\]\(([^()\s]+)\)$/.exec(token);
        const url = parsed ? parsed[2] : '';
        if (isExternalUrl(url)) {
          out += `<span class="md-link" role="link" tabindex="0" data-url="${escapeHtml(url)}">${escapeHtml(parsed[1] || url)}</span>`;
        } else {
          out += escapeHtml(token);
        }
      } else {
        // 裸 URL：先剥掉紧跟的 CJK 标点（URL 里不会原样出现），主体要求是
        // 可打印 ASCII（避免把中文粘连进链接），再剥掉 ASCII 句读尾巴；
        // 剩余后缀留在普通文本里。
        let candidate = token.replace(/[、。，；：！？）》」』]+$/, '');
        let suffix = token.slice(candidate.length);
        let linked = false;
        if (candidate && /^[\x21-\x7e]+$/.test(candidate)) {
          const core = candidate.replace(/[.,;:!?'")\]{}]+$/, '');
          suffix = token.slice(core.length);
          candidate = core;
          linked = isExternalUrl(candidate);
        }
        if (linked) {
          out += `<span class="md-link" role="link" tabindex="0" data-url="${escapeHtml(candidate)}">${escapeHtml(candidate)}</span>${escapeHtml(suffix)}`;
        } else {
          out += escapeHtml(token);
        }
      }
    }
    out += escapeHtml(text.slice(cursor));
    return out;
  }

  function renderInline(text) {
    return renderInlineSegment(String(text));
  }

  /**
   * 把 Markdown 源渲染成安全 HTML：标题、列表、引用、分隔线、围栏代码块与
   * 行内标记。所有动态文本先转义，生成的标签只来自本函数自身的白名单。
   */
  function renderMarkdown(source) {
    const lines = String(source ?? '').split('\n');
    const out = [];
    let paragraph = [];
    let list = null; // { tag: 'ul' | 'ol' }
    let quote = null;
    let fence = null; // { lang, buffer }

    function flushParagraph() {
      if (paragraph.length) {
        out.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
        paragraph = [];
      }
    }
    function flushList() {
      if (list) { out.push(`</${list.tag}>`); list = null; }
    }
    function flushQuote() {
      if (quote) {
        // 引用块内容此前只被收集、从未输出：必须在这里连同 </blockquote> 一起写回。
        out.push(`<blockquote>${quote.join('<br>')}</blockquote>`);
        quote = null;
      }
    }
    function flushAll() {
      flushParagraph(); flushList(); flushQuote();
    }

    for (const rawLine of lines) {
      if (fence !== null) {
        if (/^\s*```/.test(rawLine)) {
          const code = fence.buffer.join('\n');
          const lang = fence.lang ? ` data-lang="${escapeHtml(fence.lang)}"` : '';
          out.push(`<pre class="md-code"${lang}><code>${highlightCode(code)}</code></pre>`);
          fence = null;
        } else {
          fence.buffer.push(rawLine);
        }
        continue;
      }
      const fenceMatch = /^\s*```(\w*)\s*$/.exec(rawLine);
      if (fenceMatch) {
        flushAll();
        fence = { lang: fenceMatch[1] || '', buffer: [] };
        continue;
      }
      const heading = /^(#{1,6})\s+(.*)$/.exec(rawLine);
      if (heading) {
        flushAll();
        const level = heading[1].length;
        out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }
      if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(rawLine)) {
        flushAll();
        out.push('<hr>');
        continue;
      }
      const bullet = /^\s*[-*]\s+(.*)$/.exec(rawLine);
      if (bullet) {
        flushParagraph(); flushQuote();
        if (!list || list.tag !== 'ul') { flushList(); out.push('<ul>'); list = { tag: 'ul' }; }
        out.push(`<li>${renderInline(bullet[1])}</li>`);
        continue;
      }
      const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(rawLine);
      if (ordered) {
        flushParagraph(); flushQuote();
        if (!list || list.tag !== 'ol') { flushList(); out.push('<ol>'); list = { tag: 'ol' }; }
        out.push(`<li>${renderInline(ordered[1])}</li>`);
        continue;
      }
      const quoted = /^\s*>\s?(.*)$/.exec(rawLine);
      if (quoted) {
        flushParagraph(); flushList();
        if (!quote) quote = [];
        quote.push(renderInline(quoted[1]));
        continue;
      }
      if (rawLine.trim() === '') {
        flushAll();
        continue;
      }
      flushList(); flushQuote();
      paragraph.push(rawLine);
    }
    if (fence !== null) {
      const code = fence.buffer.join('\n');
      const lang = fence.lang ? ` data-lang="${escapeHtml(fence.lang)}"` : '';
      out.push(`<pre class="md-code"${lang}><code>${highlightCode(code)}</code></pre>`);
    }
    flushAll();
    return out.join('');
  }

  /* ── 轻量代码高亮（自包含分词器，页面 CSP 无外部字体/脚本）──────────── */

  const CODE_KEYWORDS = new Set((
    'abstract as async await break case catch class const continue debugger def default defer delete do done ' +
    'elif else end enum except export extends false final finally fn for from func function get global goto if ' +
    'impl implements import in include instanceof interface is it lambda let loop match mod module mut new nil ' +
    'none not null of open operator or override package pass print private protected pub public raise readonly ' +
    'record ref return sealed select self set static struct super switch template then this throw throws trait ' +
    'true try type typeof union unsafe use using val var virtual void when where while with yield'
  ).split(' '));

  /** 通用分词器：字符串、注释、数字、关键字。HTML 转义贯穿始终。 */
  function highlightCode(source) {
    const text = String(source ?? '');
    let out = '';
    let index = 0;
    const push = (cls, value) => { out += `<span class="tok-${cls}">${escapeHtml(value)}</span>`; };
    while (index < text.length) {
      const rest = text.slice(index);
      let match;
      if ((match = /^(\/\/[^\n]*|#[^\n]*|--[^\n]*)/.exec(rest))) {
        push('comment', match[0]); index += match[0].length; continue;
      }
      if ((match = /^\/\*[\s\S]*?(?:\*\/|$)/.exec(rest))) {
        push('comment', match[0]); index += match[0].length; continue;
      }
      if (rest[0] === '"' || rest[0] === "'" || rest[0] === '`') {
        const quote = rest[0];
        let end = 1;
        while (end < rest.length) {
          if (rest[end] === '\\') { end += 2; continue; }
          if (rest[end] === quote) { end += 1; break; }
          if (quote !== '`' && rest[end] === '\n') break;
          end += 1;
        }
        push('string', rest.slice(0, end)); index += end; continue;
      }
      if ((match = /^\d[\d_.a-fx]*/i.exec(rest))) {
        push('number', match[0]); index += match[0].length; continue;
      }
      if ((match = /^[A-Za-z_$][\w$]*/.exec(rest))) {
        push(CODE_KEYWORDS.has(match[0]) ? 'keyword' : 'plain', match[0]); index += match[0].length; continue;
      }
      // 逐字符消费符号，保持转义安全。
      out += escapeHtml(rest[0]); index += 1;
    }
    return out;
  }

  return {
    SCHEMA,
    FIELD_TYPES,
    NOTE_FORMATS,
    MAX_FIELDS,
    MAX_NAME_CHARS,
    MAX_VALUE_CHARS,
    MAX_DOC_BYTES,
    MAX_URL_CHARS,
    isExternalUrl,
    escapeHtml,
    emptyDoc,
    sanitizeDoc,
    docBytes,
    draftToDoc,
    renderMarkdown,
    renderInline,
    highlightCode,
  };
});
