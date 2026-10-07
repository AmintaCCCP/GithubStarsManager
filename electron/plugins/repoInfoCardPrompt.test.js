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

function makeElement(id) {
  const classes = new Set();
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
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
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
    setTimeout,
    clearTimeout,
  };
  // 追加的这行把脚本作用域里的常量与函数挂到沙箱全局，供断言取用。
  const expose = '\n;globalThis.__plugin = { state, STR, CARD_LANGUAGES, STRUCTURES, layoutForCanvas, buildSystemPrompt, buildUserPrompt, setBusy, AI_SYSTEM_LIMIT, AI_USER_LIMIT };\n';
  vm.runInNewContext(
    fs.readFileSync(PLUGIN_SCRIPT, 'utf8') + expose,
    sandbox,
    { filename: PLUGIN_SCRIPT }
  );
  return { plugin: sandbox.__plugin, byId };
}

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
  assert.ok(status.classList.contains('is-busy'), 'status line needs the pulse hook');
  assert.equal(generate.textContent, plugin.STR.zh.generatingShort);

  plugin.setBusy(false);
  assert.equal(generate.disabled, false);
  assert.ok(!generate.classList.contains('is-busy'));
  assert.ok(!status.classList.contains('is-busy'));
  assert.equal(generate.textContent, plugin.STR.zh.generate);
});
