/* Repo Custom Fields — 仓库自定义信息插件页面（V1.6 opensPage + display:popup）。
 *
 * 宿主弹窗通过 `plugin-page:init` 下发 `context = { repository, readme, language, theme }`；
 * 数据与外链一律走受权限约束的桥：
 *  - `storage.get/set`：每个仓库一份字段文档，键为 `fields:<repository id>`；
 *  - `shell.openExternal`：URL 字段与 Markdown 链接交给宿主用系统浏览器打开
 *    （沙箱 iframe 里普通 <a> 导航与弹窗都被宿主拦下，这是页面打开外链的唯一通道）；
 *  - `repositories.search`：从「设置 → 插件 → 打开页面」进入时选择仓库。
 *
 * 交互采用 1Password 的“预览 ⇄ 编辑”两态：点编辑图标进入编辑视图（增删改、
 * 拖拽排序），点保存图标写回并回到预览。所有数据存本地插件 storage。
 */
(() => {
  'use strict';

  const PLUGIN_ID = 'com.githubstarsmanager.repo-custom-fields';
  const PAGE_ID = 'fields';
  const M = window.RepoFieldsModel;

  /* ── 文案 ─────────────────────────────────────────────────────────── */

  const STR = {
    zh: {
      bridgeNotReady: '宿主桥尚未就绪',
      bridgeFailed: '宿主请求失败',
      loadFailed: '读取失败：{message}',
      saveFailed: '保存失败：{message}',
      saved: '已保存',
      pickerHint: '此入口没有携带仓库上下文（例如从「设置 → 插件 → 打开页面」进入）。搜索并选择一个已加载的仓库：',
      search: '搜索',
      searching: '搜索中…',
      searchDone: '找到 {n} 个仓库，点击选择。',
      searchEmpty: '没有匹配的仓库。',
      searchFailed: '搜索失败：{message}',
      subtitleFields: '{n} 个字段 · 保存在本地',
      subtitleEmpty: '还没有自定义字段 · 保存在本地',
      viewEmpty: '这个仓库还没有自定义字段。点击右上角的编辑图标，添加文本、说明或链接。',
      editEmpty: '还没有字段。用下方按钮添加第一项：',
      editLimit: '最多 {n} 个字段，已达上限。',
      typeText: '文本', typeNote: '说明', typeLink: '链接',
      editTitle: '编辑字段',
      saveTitle: '保存',
      cancelTitle: '放弃修改（Esc）',
      dragTitle: '拖动排序',
      removeTitle: '删除字段',
      namePlaceholder: '字段名称（必填）',
      valuePlaceholderText: '内容',
      valuePlaceholderNote: '支持 Markdown 或代码（按下方格式渲染）',
      valuePlaceholderLink: 'https://example.com',
      formatMarkdown: 'Markdown',
      formatCode: '代码',
      errorNameRequired: '请填写字段名称',
      errorLinkInvalid: '链接需为 http(s) 地址',
      errorValueTooLong: '内容过长（上限 {n} 字符）',
      errorDocTooLarge: '字段总量超过 {n} KiB 的本地存储上限，请精简内容',
      addText: '单行文本', addNote: '多行文本', addLink: '链接',
      moveUp: '上移（Alt+↑）', moveDown: '下移（Alt+↓）',
      openLinkTitle: '在浏览器中打开',
    },
    en: {
      bridgeNotReady: 'Host bridge is not ready',
      bridgeFailed: 'Host request failed',
      loadFailed: 'Failed to load: {message}',
      saveFailed: 'Failed to save: {message}',
      saved: 'Saved',
      pickerHint: 'This entry carries no repository context (for example opened from Settings → Plugins → Open page). Search and pick a loaded repository:',
      search: 'Search',
      searching: 'Searching…',
      searchDone: '{n} repositories found. Click to pick one.',
      searchEmpty: 'No matching repositories.',
      searchFailed: 'Search failed: {message}',
      subtitleFields: '{n} fields · stored locally',
      subtitleEmpty: 'No custom fields yet · stored locally',
      viewEmpty: 'This repository has no custom fields yet. Click the edit icon in the top right to add text, notes or links.',
      editEmpty: 'No fields yet. Use the buttons below to add the first one:',
      editLimit: 'At most {n} fields; the limit is reached.',
      typeText: 'Text', typeNote: 'Note', typeLink: 'Link',
      editTitle: 'Edit fields',
      saveTitle: 'Save',
      cancelTitle: 'Discard changes (Esc)',
      dragTitle: 'Drag to reorder',
      removeTitle: 'Remove field',
      namePlaceholder: 'Field name (required)',
      valuePlaceholderText: 'Content',
      valuePlaceholderNote: 'Markdown or code, rendered with the format below',
      valuePlaceholderLink: 'https://example.com',
      formatMarkdown: 'Markdown',
      formatCode: 'Code',
      errorNameRequired: 'Field name is required',
      errorLinkInvalid: 'Link must be an http(s) URL',
      errorValueTooLong: 'Content is too long (max {n} characters)',
      errorDocTooLarge: 'Fields exceed the {n} KiB local storage budget; trim the content',
      addText: 'Single-line text', addNote: 'Multi-line text', addLink: 'Link',
      moveUp: 'Move up (Alt+↑)', moveDown: 'Move down (Alt+↓)',
      openLinkTitle: 'Open in browser',
    },
  };

  const fmt = (template, params) => String(template).replace(/\{(\w+)\}/g, (m, key) => (
    Object.prototype.hasOwnProperty.call(params || {}, key) ? String(params[key]) : m
  ));

  /* ── 桥 ───────────────────────────────────────────────────────────── */

  let token = null;
  const pending = new Map();
  let nextRequestId = 0;

  function request(method, args) {
    if (!token) return Promise.reject(new Error(str().bridgeNotReady));
    const requestId = String(++nextRequestId);
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      window.parent.postMessage({
        type: 'plugin-page:request', pluginId: PLUGIN_ID, pageId: PAGE_ID,
        requestId, token, method, args, origin: window.location.origin,
      }, '*');
    });
  }

  const $ = (id) => document.getElementById(id);
  const esc = (value) => M.escapeHtml(value);

  /* ── 状态 ─────────────────────────────────────────────────────────── */

  const state = {
    language: 'zh',
    repository: null,
    repoKey: null,
    doc: M.emptyDoc(),
    drafts: [],
    mode: 'view', // 'view' | 'edit'
    searchSeq: 0,
  };

  function str() { return state.language === 'zh' ? STR.zh : STR.en; }

  function setStatus(message, isError = false) {
    const node = $('status');
    node.textContent = message || '';
    node.classList.toggle('error', isError);
  }

  /* ── 图标 ─────────────────────────────────────────────────────────── */

  const ICONS = {
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
    save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>',
    cancel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    drag: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>',
    remove: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    external: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  };

  /* ── 初始化 ───────────────────────────────────────────────────────── */

  function applyLanguage(language) {
    state.language = String(language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
    document.documentElement.lang = state.language === 'zh' ? 'zh' : 'en';
  }

  function handleInit(context) {
    applyLanguage(context.language);
    document.body.dataset.theme = context.theme === 'light' ? 'light' : 'dark';
    const repository = context.repository;
    const nextRepository = repository && typeof repository.full_name === 'string' && Number.isSafeInteger(repository.id)
      ? repository
      : null;
    // 宿主会在 README 异步到位后用同一 token 补发 init：编辑途中收到的同仓库
    // re-init 不重置页面，避免丢弃用户正在编辑的草稿。
    if (state.mode === 'edit' && nextRepository && state.repository &&
      nextRepository.id === state.repository.id) {
      return;
    }
    // 换仓库时立即清掉上一仓库的字段文档，避免旧数据在读取完成前闪现。
    if (state.repository && (!nextRepository || nextRepository.id !== state.repository.id)) {
      state.doc = M.emptyDoc();
    }
    state.repository = nextRepository;
    state.repoKey = nextRepository ? `fields:${nextRepository.id}` : null;
    if (state.repository) {
      $('picker').hidden = true;
      $('head').hidden = false;
      renderHead();
      // 先渲染空态再异步读 storage：读取失败时错误状态不会被随后的渲染覆盖，
      // 用户看到的是带错误提示的空态，而不是静默的"没有字段"。
      enterView();
      void loadDoc();
    } else {
      $('head').hidden = true;
      $('view').hidden = true;
      $('edit').hidden = true;
      $('picker').hidden = false;
      $('picker-hint').textContent = str().pickerHint;
      $('picker-search').textContent = str().search;
      $('picker-query').placeholder = 'owner/repo…';
    }
  }

  function renderHead() {
    const [owner, name = ''] = String(state.repository.full_name).split('/');
    $('repo-owner').textContent = owner ? `${owner}/` : '';
    $('repo-name').textContent = name;
    renderSubtitle();
    $('btn-edit').innerHTML = ICONS.edit;
    $('btn-edit').title = str().editTitle;
    $('btn-edit').setAttribute('aria-label', str().editTitle);
    $('btn-save').innerHTML = ICONS.save;
    $('btn-save').title = str().saveTitle;
    $('btn-save').setAttribute('aria-label', str().saveTitle);
    $('btn-cancel').innerHTML = ICONS.cancel;
    $('btn-cancel').title = str().cancelTitle;
    $('btn-cancel').setAttribute('aria-label', str().cancelTitle);
  }

  function renderSubtitle() {
    const count = state.doc.fields.length;
    $('repo-subtitle').textContent = count > 0
      ? fmt(str().subtitleFields, { n: count })
      : str().subtitleEmpty;
  }

  async function loadDoc() {
    // 在选择器里快速换仓库时，旧请求可能后到：用发起时的键比对，过期响应丢弃。
    const key = state.repoKey;
    try {
      const raw = await request('storage.get', { key });
      if (key !== state.repoKey) return;
      state.doc = M.sanitizeDoc(raw);
      // 读取成功后按文档内容刷新当前视图；预览态直接重渲染。
      if (state.mode === 'view') renderView();
    } catch (error) {
      if (key !== state.repoKey) return;
      state.doc = M.emptyDoc();
      setStatus(fmt(str().loadFailed, { message: error.message || error.code || 'unknown' }), true);
      if (state.mode === 'view') renderView();
    }
  }

  /* ── 预览视图 ─────────────────────────────────────────────────────── */

  function enterView() {
    state.mode = 'view';
    state.drafts = [];
    $('edit').hidden = true;
    $('view').hidden = false;
    $('btn-edit').hidden = false;
    $('btn-save').hidden = true;
    $('btn-cancel').hidden = true;
    setStatus('');
    renderView();
  }

  function renderView() {
    renderSubtitle();
    const list = $('field-list');
    list.textContent = '';
    const fields = state.doc.fields;
    $('view-empty').hidden = fields.length > 0;
    $('view-empty').textContent = str().viewEmpty;
    fields.forEach((field) => {
      const li = document.createElement('li');
      li.className = 'field';

      const label = document.createElement('div');
      label.className = 'label';
      const name = document.createElement('span');
      name.textContent = field.name || str().typeText;
      const badge = document.createElement('span');
      badge.className = 'type-badge';
      badge.textContent = field.type === 'note'
        ? (field.format === 'code' ? str().formatCode : str().formatMarkdown)
        : str()[`type${field.type.charAt(0).toUpperCase()}${field.type.slice(1)}`];
      label.append(name, badge);
      li.append(label);

      const value = document.createElement('div');
      value.className = 'value';
      if (field.type === 'link') {
        value.classList.add('link-value');
        if (M.isExternalUrl(field.value)) {
          value.setAttribute('role', 'link');
          value.tabIndex = 0;
          value.dataset.url = field.value;
          value.title = `${field.value} · ${str().openLinkTitle}`;
          value.innerHTML = `${ICONS.external}<span></span>`;
          value.lastElementChild.textContent = field.value;
        } else {
          // 历史数据里的坏链接：降级为纯文本，不给可点击外观。
          value.textContent = field.value;
        }
      } else if (field.type === 'note') {
        value.classList.add('md-body');
        value.innerHTML = field.format === 'code'
          ? `<pre class="md-code"><code>${M.highlightCode(field.value)}</code></pre>`
          : M.renderMarkdown(field.value);
      } else {
        value.textContent = field.value;
      }
      li.append(value);
      list.append(li);
    });
  }

  /* ── 编辑视图 ─────────────────────────────────────────────────────── */

  function newDraft(type) {
    const draft = { id: `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, type, name: '', value: '' };
    if (type === 'note') draft.format = 'markdown';
    return draft;
  }

  function enterEdit() {
    state.mode = 'edit';
    state.drafts = state.doc.fields.map((field) => ({ ...field }));
    $('view').hidden = true;
    $('edit').hidden = false;
    $('btn-edit').hidden = true;
    $('btn-save').hidden = false;
    $('btn-cancel').hidden = false;
    setStatus('');
    renderEdit();
  }

  function renderEdit() {
    const list = $('edit-list');
    list.textContent = '';
    $('edit-limit').hidden = state.drafts.length < M.MAX_FIELDS;
    $('edit-limit').textContent = fmt(str().editLimit, { n: M.MAX_FIELDS });
    const addButtons = document.querySelectorAll('.add-btn');
    addButtons.forEach((button) => { button.disabled = state.drafts.length >= M.MAX_FIELDS; });
    // 空列表时也要显示添加按钮：空态提示指向它。
    $('add-row').hidden = false;

    if (state.drafts.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = str().editEmpty;
      list.append(empty);
    }

    state.drafts.forEach((draft, index) => {
      const li = document.createElement('li');
      li.className = 'edit-row';
      li.dataset.index = String(index);

      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'drag-handle';
      handle.title = str().dragTitle;
      handle.setAttribute('aria-label', `${str().dragTitle} · ${str().moveUp} / ${str().moveDown}`);
      handle.innerHTML = ICONS.drag;
      if (state.drafts.length > 1) {
        // 拖拽把手兼任键盘排序入口：Alt+↑/↓ 在行内移动，屏幕键盘用户可达。
        handle.addEventListener('keydown', (event) => {
          if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
            event.preventDefault();
            moveRow(index, event.key === 'ArrowUp' ? index - 1 : index + 1);
          }
        });
      } else {
        handle.setAttribute('disabled', '');
      }
      li.append(handle);

      const body = document.createElement('div');
      body.className = 'row-body';

      const headRow = document.createElement('div');
      headRow.className = 'row-head';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'name-input';
      nameInput.maxLength = M.MAX_NAME_CHARS;
      nameInput.placeholder = str().namePlaceholder;
      nameInput.value = draft.name;
      nameInput.dataset.role = 'name';
      nameInput.addEventListener('input', () => { draft.name = nameInput.value; });
      headRow.append(nameInput);
      if (draft.type === 'note') headRow.append(buildFormatSwitch(draft));
      body.append(headRow);

      body.append(buildValueEditor(draft));
      li.append(body);

      const actions = document.createElement('div');
      actions.className = 'row-actions';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'row-remove';
      remove.title = str().removeTitle;
      remove.setAttribute('aria-label', str().removeTitle);
      remove.innerHTML = ICONS.remove;
      remove.addEventListener('click', () => {
        state.drafts.splice(index, 1);
        renderEdit();
      });
      actions.append(remove);
      li.append(actions);

      list.append(li);
    });
  }

  function buildFormatSwitch(draft) {
    const wrap = document.createElement('div');
    wrap.className = 'format-switch';
    wrap.setAttribute('role', 'group');
    [['markdown', str().formatMarkdown], ['code', str().formatCode]].forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-pressed', String(draft.format === value));
      button.addEventListener('click', () => {
        draft.format = value;
        renderEdit();
      });
      wrap.append(button);
    });
    return wrap;
  }

  function buildValueEditor(draft) {
    const editor = draft.type === 'note'
      ? document.createElement('textarea')
      : document.createElement('input');
    if (draft.type !== 'note') editor.type = draft.type === 'link' ? 'url' : 'text';
    editor.className = 'value-input';
    editor.maxLength = M.MAX_VALUE_CHARS;
    editor.placeholder = draft.type === 'link' ? str().valuePlaceholderLink
      : draft.type === 'note' ? str().valuePlaceholderNote : str().valuePlaceholderText;
    editor.value = draft.value;
    editor.dataset.role = 'value';
    editor.addEventListener('input', () => { draft.value = editor.value; });
    return editor;
  }

  /* ── 拖拽排序（HTML5 DnD：按住把手才进入拖拽，避免干扰输入框）──────── */

  let dragIndex = -1;
  /** pointerdown 委托会在同一行上重复触发，用标记避免重复绑定拖拽事件。 */
  const dragBound = new WeakSet();

  /** 把 from 行移动到 to 位置（越界忽略），并按键盘焦点恢复焦点位置。 */
  function moveRow(from, to) {
    if (to < 0 || to >= state.drafts.length || from === to) return;
    const [moved] = state.drafts.splice(from, 1);
    state.drafts.splice(to, 0, moved);
    renderEdit();
    const rows = $('edit-list').querySelectorAll('.edit-row');
    rows[to]?.querySelector('.drag-handle')?.focus();
  }

  function bindDragHandlers(row, index) {
    if (dragBound.has(row)) return;
    const handle = row.querySelector('.drag-handle');
    if (!handle || handle.hasAttribute('disabled')) return;
    dragBound.add(row);
    handle.addEventListener('pointerdown', () => { row.draggable = true; });
    handle.addEventListener('pointerup', () => { row.draggable = false; });
    handle.addEventListener('pointerleave', () => { row.draggable = false; });
    row.addEventListener('dragstart', (event) => {
      dragIndex = index;
      row.classList.add('dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    });
    row.addEventListener('dragend', () => {
      dragIndex = -1;
      row.classList.remove('dragging');
      row.draggable = false;
      // drop 成功后列表已重渲染，源行可能已被摘除：按存在与否清理残留样式。
      if (row.parentElement) {
        row.parentElement.querySelectorAll('.drop-target').forEach((node) => node.classList.remove('drop-target'));
      }
    });
    row.addEventListener('dragover', (event) => {
      if (dragIndex < 0 || dragIndex === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('drop-target');
      if (dragIndex < 0 || dragIndex === index) return;
      const from = dragIndex;
      const bounds = row.getBoundingClientRect();
      const after = event.clientY > bounds.top + bounds.height / 2;
      const to = from < index ? (after ? index : index - 1) : (after ? index + 1 : index);
      dragIndex = -1;
      moveRow(from, to);
    });
  }

  /* ── 保存 ─────────────────────────────────────────────────────────── */

  async function saveEdits() {
    const result = M.draftToDoc(state.drafts);
    if (!result.ok) {
      markProblems(result.problems);
      return;
    }
    try {
      await request('storage.set', { key: state.repoKey, value: result.doc });
      state.doc = result.doc;
      enterView();
      setStatus(str().saved);
    } catch (error) {
      setStatus(fmt(str().saveFailed, { message: error.message || error.code || 'unknown' }), true);
    }
  }

  function markProblems(problems) {
    // 连续保存校验失败时先清掉上一轮的错误标记，避免消息重复或残留在别的行上。
    $('edit-list').querySelectorAll('.edit-row.invalid').forEach((row) => {
      row.classList.remove('invalid');
      row.querySelectorAll('.row-error').forEach((node) => node.remove());
    });
    problems.forEach((problem) => {
      if (problem.index < 0) {
        // 文档总量超限没有对应行：放进状态栏。
        setStatus(fmt(str().errorDocTooLarge, { n: Math.round(M.MAX_DOC_BYTES / 1024) }), true);
        return;
      }
      const row = $('edit-list').querySelectorAll('.edit-row')[problem.index];
      if (!row) return;
      row.classList.add('invalid');
      const note = document.createElement('p');
      note.className = 'row-error';
      note.textContent = problem.kind === 'name' ? str().errorNameRequired
        : problem.kind === 'value' && state.drafts[problem.index]?.type === 'link' ? str().errorLinkInvalid
          : fmt(str().errorValueTooLong, { n: M.MAX_VALUE_CHARS });
      row.append(note);
    });
  }

  /* ── 外链：统一经 shell.openExternal 桥打开 ───────────────────────── */

  async function openExternal(url) {
    if (!M.isExternalUrl(url)) return;
    try {
      await request('shell.openExternal', { url });
    } catch (error) {
      setStatus(fmt(str().bridgeFailed, { message: error.message || error.code || 'unknown' }), true);
    }
  }

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.md-link, .link-value') : null;
    if (target && typeof target.dataset.url === 'string') void openExternal(target.dataset.url);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.target instanceof Element && event.target.matches('.md-link, .link-value')) {
      const url = event.target.dataset.url;
      if (typeof url === 'string') void openExternal(url);
      return;
    }
    if (event.key === 'Escape' && state.mode === 'edit') enterView();
  });

  /* ── 仓库选择器（无上下文入口）────────────────────────────────────── */

  async function runPickerSearch() {
    const query = $('picker-query').value.trim();
    const results = $('picker-results');
    const seq = ++state.searchSeq;
    if (!query) { results.textContent = ''; setStatus(''); return; }
    $('picker-search').textContent = str().searching;
    try {
      const found = await request('repositories.search', { query, limit: 20 });
      if (seq !== state.searchSeq) return;
      results.textContent = '';
      setStatus(fmt(str().searchDone, { n: found.length }));
      for (const repository of found) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        const title = document.createElement('div');
        title.textContent = repository.full_name;
        const desc = document.createElement('div');
        desc.className = 'desc';
        desc.textContent = repository.description || '';
        button.append(title, desc);
        button.addEventListener('click', () => {
          // 只交给 handleInit 设置仓库状态：它负责换仓库时清空上一份文档。
          handleInit({
            language: state.language,
            theme: document.body.dataset.theme,
            repository,
          });
        });
        li.append(button);
        results.append(li);
      }
      if (found.length === 0) {
        const li = document.createElement('li');
        li.className = 'muted small';
        li.textContent = str().searchEmpty;
        results.append(li);
      }
    } catch (error) {
      if (seq !== state.searchSeq) return;
      setStatus(fmt(str().searchFailed, { message: error.message || error.code || 'unknown' }), true);
    } finally {
      if (seq === state.searchSeq) $('picker-search').textContent = str().search;
    }
  }

  /* ── 事件绑定与启动 ───────────────────────────────────────────────── */

  function bindEvents() {
    $('btn-edit').addEventListener('click', enterEdit);
    $('btn-save').addEventListener('click', () => void saveEdits());
    $('btn-cancel').addEventListener('click', enterView);
    $('picker-search').addEventListener('click', () => void runPickerSearch());
    $('picker-query').addEventListener('keydown', (event) => {
      if (event.key === 'Enter') void runPickerSearch();
    });
    document.querySelectorAll('.add-btn').forEach((button) => {
      const labelNode = document.createElement('span');
      button.innerHTML = ICONS.plus;
      button.append(labelNode);
      button.addEventListener('click', () => {
        if (state.drafts.length >= M.MAX_FIELDS) return;
        state.drafts.push(newDraft(button.dataset.add));
        renderEdit();
        const rows = $('edit-list').querySelectorAll('.edit-row');
        rows[rows.length - 1]?.querySelector('.name-input')?.focus();
      });
    });
    $('edit-list').addEventListener('pointerdown', (event) => {
      const row = event.target instanceof Element ? event.target.closest('.edit-row') : null;
      if (row) bindDragHandlers(row, Number(row.dataset.index));
    });
  }

  function applyAddButtonLabels() {
    const labels = { text: str().addText, note: str().addNote, link: str().addLink };
    document.querySelectorAll('.add-btn').forEach((button) => {
      const label = labels[button.dataset.add] || '';
      const span = button.querySelector('span');
      if (span) span.textContent = label;
    });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || !event.data ||
      event.data.pluginId !== PLUGIN_ID || event.data.pageId !== PAGE_ID) return;
    if (event.data.type === 'plugin-page:init' && typeof event.data.token === 'string') {
      token = event.data.token;
      applyAddButtonLabels();
      handleInit(event.data.context || {});
      return;
    }
    if (event.data.type !== 'plugin-page:response' || event.data.token !== token) return;
    const handler = pending.get(event.data.requestId);
    if (!handler) return;
    pending.delete(event.data.requestId);
    if (event.data.success) handler.resolve(event.data.value);
    else handler.reject(Object.assign(new Error(event.data.error?.message || str().bridgeFailed), { code: event.data.error?.code }));
  });

  bindEvents();
  applyAddButtonLabels();
})();
