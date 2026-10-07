const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

// 示例插件「仓库信息卡」的提示词与生成反馈回归测试。页面脚本不是模块，
// 这里在最小 DOM 桩上执行整份脚本，再取用它暴露的内部函数。
const PLUGIN_SCRIPT = path.resolve(__dirname, '../../examples/plugins/repo-info-card/ui/index.js');
const CANVASES = [
  { id: '1x1', w: 1200, h: 1200 },
  { id: '5x2', w: 1500, h: 600 },
  { id: '3x4', w: 1200, h: 1600 },
  { id: 'custom', w: 640, h: 2400 },
];

/**
 * 构造测试沙箱所需的轻量级虚拟 DOM 元素桩对象。
 *
 * @param {string} id 元素 ID
 * @returns {Record<string, any>} 具有基础 DOM 操作接口的虚拟节点
 */
function makeElement(id) {
  const classes = new Set();
  const attributes = new Map();
  return {
    id,
    textContent: '',
    value: '',
    innerHTML: '',
    className: '',
    type: '',
    disabled: false,
    hidden: false,
    tabIndex: 0,
    dataset: {},
    style: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !classes.has(name) : Boolean(force);
        if (on) classes.add(name);
        else classes.delete(name);
        return on;
      },
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    removeAttribute(name) { attributes.delete(name); },
    append() {},
    replaceChildren() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    removeEventListener() {},
    setPointerCapture() {},
    hasPointerCapture() { return false; },
    releasePointerCapture() {},
    attachShadow() { return makeElement(`${id}-shadow`); },
  };
}

/**
 * 在隔离的 vm 沙箱环境中加载并执行仓库信息卡 UI 脚本，并暴露内部对象。
 *
 * @returns {{ plugin: Record<string, any>, byId: (id: string) => Record<string, any> }} 沙箱中运行的插件上下文与元素检索器
 */
function loadPlugin() {
  const elements = new Map();
  const byId = (id) => {
    if (!elements.has(id)) elements.set(id, makeElement(id));
    return elements.get(id);
  };
  const sandbox = {
    document: {
      documentElement: makeElement('html'),
      getElementById: byId,
      querySelector: (selector) => byId(selector),
      querySelectorAll: () => [],
      createElement: (tag) => makeElement(tag),
      addEventListener() {},
      removeEventListener() {},
    },
    window: { addEventListener() {}, matchMedia: () => ({ matches: false }) },
    DOMParser: class {
      parseFromString(html) {
        const root = makeElement('parsed-doc');
        if (html.includes('id="card"')) {
          const card = makeElement('card');
          card.outerHTML = '<div id="card"></div>';
          root.getElementById = (id) => (id === 'card' ? card : null);
        } else {
          root.getElementById = () => null;
        }
        return root;
      }
    },
    setTimeout,
    clearTimeout,
  };
  // 追加的这行把脚本作用域里的常量与函数挂到沙箱全局，供断言取用。
  const expose = '\n;globalThis.__plugin = { state, STR, CARD_LANGUAGES, STRUCTURES, layoutForCanvas, buildSystemPrompt, buildUserPrompt, setBusy, setStatus, handleInit, canvasMatchesSnapshot, sanitizeFragment, AI_SYSTEM_LIMIT, AI_USER_LIMIT };\n';
  vm.runInNewContext(
    fs.readFileSync(PLUGIN_SCRIPT, 'utf8') + expose,
    sandbox,
    { filename: PLUGIN_SCRIPT }
  );
  return { plugin: sandbox.__plugin, byId };
}

/**
 * 生成单元测试使用的标准样例仓库元数据。
 *
 * @returns {Record<string, any>} 包含基本属性的仓库数据桩
 */
function repository() {
  return {
    name: 'project',
    full_name: 'owner/project',
    html_url: 'https://github.com/owner/project',
    owner: { login: 'owner' },
    description: 'Example repository',
    language: 'TypeScript',
    stargazers_count: 42,
    forks_count: 3,
    open_issues_count: 1,
    license: 'MIT',
    topics: ['desktop'],
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: '2026-01-03T00:00:00Z',
  };
}

const LABEL_PLACEHOLDERS = {
  K_STARS: 'stars',
  K_FORKS: 'forks',
  K_LANGUAGE: 'language',
  K_LICENSE: 'license',
  K_KEY: 'key',
  K_FOOTER: 'footer',
};

test('repo info card: every language fits the system-prompt bridge limit with localized labels', () => {
  const { plugin } = loadPlugin();
  assert.equal(plugin.CARD_LANGUAGES.length, 10);
  for (const language of plugin.CARD_LANGUAGES) {
    for (const field of Object.values(LABEL_PLACEHOLDERS)) {
      assert.equal(typeof language.labels?.[field], 'string', `${language.code}.${field} must be a string`);
      assert.ok(language.labels[field].length > 0, `${language.code}.${field} must not be empty`);
    }
    for (const canvas of CANVASES) {
      // 'auto'（跟随界面）在页面里就是取宿主界面语言 state.language。
      plugin.state.language = language.code;
      const system = plugin.buildSystemPrompt(canvas, 'auto');
      const where = `${language.code}/${canvas.id}`;
      assert.ok(system.length <= plugin.AI_SYSTEM_LIMIT,
        `${where}: system prompt ${system.length} exceeds ${plugin.AI_SYSTEM_LIMIT}`);
      assert.ok(!system.includes('{K_'), `${where}: left an unlocalized {K_*} placeholder`);
      assert.ok(system.includes(`Language: ${language.englishName}`),
        `${where}: missing the language directive for ${language.englishName}`);
      // 只断言该版式模板实际用到的标签，且必须换成对应语言的文案。
      const template = plugin.STRUCTURES[plugin.layoutForCanvas(canvas.id, canvas.w, canvas.h)];
      for (const [placeholder, field] of Object.entries(LABEL_PLACEHOLDERS)) {
        if (!template.includes(`{${placeholder}}`)) continue;
        assert.ok(system.includes(language.labels[field]),
          `${where}: ${placeholder} not localized to ${language.code}`);
      }
    }
  }
});

test('repo info card: an explicit language option overrides the UI language in both prompts', () => {
  const { plugin } = loadPlugin();
  plugin.state.language = 'zh';
  const system = plugin.buildSystemPrompt({ id: '1x1', w: 1200, h: 1200 }, 'ja');
  assert.ok(system.includes('Language: Japanese'));
  assert.ok(system.includes('スター'));

  const { prompt, readmeIncluded, truncatedReadme } = plugin.buildUserPrompt(repository(), 'readme body', '', 'ja');
  assert.ok(prompt.includes('Write EVERY visible string in Japanese'),
    'user prompt must restate the target language');
  assert.ok(prompt.includes('readme body'));
  assert.equal(readmeIncluded, true);
  assert.equal(truncatedReadme, false);
  assert.ok(prompt.length <= plugin.AI_USER_LIMIT);
});

test('repo info card: prompt builders default to state.languageOption when omitted', () => {
  const { plugin } = loadPlugin();
  plugin.state.language = 'zh';
  plugin.state.languageOption = 'auto';
  const system = plugin.buildSystemPrompt({ id: '1x1', w: 1200, h: 1200 });
  assert.ok(system.includes('Language: Simplified Chinese'));
  const { prompt } = plugin.buildUserPrompt(repository(), 'readme body', '');
  assert.ok(prompt.includes('Write EVERY visible string in Simplified Chinese'));
});

test('repo info card: an oversized README is truncated instead of being silently dropped', () => {
  const { plugin } = loadPlugin();
  const huge = 'x'.repeat(plugin.AI_USER_LIMIT + 1000);
  const { prompt, readmeIncluded, truncatedReadme } = plugin.buildUserPrompt(repository(), huge, '', 'zh');
  assert.equal(truncatedReadme, true);
  assert.equal(readmeIncluded, true);
  assert.ok(prompt.length <= plugin.AI_USER_LIMIT);
  assert.ok(prompt.includes('truncated at the prompt limit'));
});

test('repo info card: generating toggles a visible busy state on the button and status line', () => {
  const { plugin, byId } = loadPlugin();
  const generate = byId('generate');
  const status = byId('status');
  assert.equal(generate.disabled, false);

  plugin.setBusy(true);
  assert.equal(generate.disabled, true, 'generate button must be disabled while waiting');
  assert.ok(generate.classList.contains('is-busy'), 'button needs the spinner hook');
  assert.equal(generate.getAttribute('aria-busy'), 'true');
  assert.ok(status.classList.contains('is-busy'), 'status line needs the pulse hook');
  assert.equal(status.getAttribute('aria-busy'), 'true');
  assert.equal(generate.textContent, plugin.STR.zh.generatingShort);

  plugin.setBusy(false);
  assert.equal(generate.disabled, false);
  assert.ok(!generate.classList.contains('is-busy'));
  assert.equal(generate.getAttribute('aria-busy'), 'false');
  assert.ok(!status.classList.contains('is-busy'));
  assert.equal(status.getAttribute('aria-busy'), 'false');
  assert.equal(generate.textContent, plugin.STR.zh.generate);
});

test('repo info card: async init while busy does not overwrite the generating status line', () => {
  const { plugin, byId } = loadPlugin();
  const status = byId('status');
  plugin.handleInit({ repository: repository(), readme: null, language: 'zh' });
  assert.equal(status.textContent, plugin.STR.zh.loadedWithoutReadme);

  // 用户点击生成，进入 busy 状态（首次生成，无已有卡片）
  plugin.setBusy(true);
  plugin.setStatus(plugin.STR.zh.generating);
  assert.equal(status.textContent, plugin.STR.zh.generating);

  // 宿主异步补发带 README 的 init
  plugin.handleInit({ repository: repository(), readme: '# Project README', language: 'zh' });
  assert.equal(plugin.state.readme, '# Project README');
  assert.equal(status.textContent, plugin.STR.zh.generating,
    'status line must remain on generating while busy (first generation)');

  plugin.setBusy(false);

  // 重新生成场景（已有卡片状态）：正在 busy 生成时收到 README 更新也不冲掉 generating 提示
  plugin.state.fragment = '<div id="card">existing card</div>';
  plugin.state.fragmentCanvas = { id: '1x1', w: 1200, h: 1200 };
  plugin.state.usedReadme = false;
  plugin.setBusy(true);
  plugin.setStatus(plugin.STR.zh.generating);

  plugin.handleInit({ repository: repository(), readme: '# New README', language: 'zh' });
  assert.equal(plugin.state.readme, '# New README');
  assert.equal(status.textContent, plugin.STR.zh.generating,
    'status line must remain on generating while regenerating existing card');

  plugin.setBusy(false);

  // 非 busy 状态下已有卡片收到新 README 时，应正常提示 readmeReady
  plugin.handleInit({ repository: repository(), readme: '# Updated README', language: 'zh' });
  assert.equal(status.textContent, plugin.STR.zh.readmeReady,
    'status line should prompt readmeReady when not busy');
});

test('repo info card: busy state disables export buttons and restores them on finish', () => {
  const { plugin, byId } = loadPlugin();
  const copyCode = byId('copy-code');
  const copyImage = byId('copy-image');
  const saveImage = byId('save-image');

  plugin.state.fragment = '<div id="card">ok</div>';
  plugin.state.fragmentCanvas = { id: '1x1', w: 1200, h: 1200 };
  plugin.state.canvasId = '1x1';
  copyCode.disabled = false;
  copyImage.disabled = false;
  saveImage.disabled = false;

  plugin.setBusy(true);
  assert.equal(copyCode.disabled, true);
  assert.equal(copyImage.disabled, true);
  assert.equal(saveImage.disabled, true);

  plugin.setBusy(false);
  assert.equal(copyCode.disabled, false);
  assert.equal(copyImage.disabled, false);
  assert.equal(saveImage.disabled, false);

  // 自定义画幅尺寸不匹配时，恢复忙碌状态后截图按钮仍应保持禁用
  plugin.state.canvasId = 'custom';
  plugin.state.fragmentCanvas = { id: 'custom', w: 800, h: 1000 };
  plugin.state.customWidth = 900; // 尺寸已改动
  plugin.state.customHeight = 1000;

  plugin.setBusy(true);
  plugin.setBusy(false);
  assert.equal(copyCode.disabled, false);
  assert.equal(copyImage.disabled, true, 'screenshot button must stay disabled when custom width differs');
  assert.equal(saveImage.disabled, true, 'save image button must stay disabled when custom width differs');

  // 自定义画幅尺寸调回一致时，截图按钮恢复可用
  plugin.state.customWidth = 800;
  plugin.setBusy(true);
  plugin.setBusy(false);
  assert.equal(copyImage.disabled, false, 'screenshot button should be enabled when custom dimensions match');
  assert.equal(saveImage.disabled, false, 'save image button should be enabled when custom dimensions match');
});

test('repo info card: sanitization failure preserves existing fragment and snapshot state', () => {
  const { plugin } = loadPlugin();
  const initialCanvas = { id: '1x1', w: 1200, h: 1200 };
  plugin.state.fragment = '<div id="card">original</div>';
  plugin.state.fragmentCanvas = initialCanvas;
  plugin.state.fragmentLanguage = 'zh';
  plugin.state.usedReadme = true;

  // 模拟非法响应（缺少 id="card" 根元素）
  assert.throws(() => {
    plugin.sanitizeFragment('<div>no card root</div>', { id: '5x2', w: 1500, h: 600 });
  }, /card/i);

  // 原有卡片状态与快照保持原样
  assert.equal(plugin.state.fragment, '<div id="card">original</div>');
  assert.equal(plugin.state.fragmentCanvas, initialCanvas);
  assert.equal(plugin.state.fragmentLanguage, 'zh');
  assert.equal(plugin.state.usedReadme, true);
});
