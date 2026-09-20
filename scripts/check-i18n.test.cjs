const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, 'check-i18n.cjs');
const gate = require('./check-i18n.cjs');

const LANGUAGES = gate.APP_LANGUAGES;
const NAMESPACES = gate.I18N_NAMESPACES;

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function seedLocales(root, extra = {}) {
  const sample = extra.sample || { hello: 'Hello world' };
  for (const language of LANGUAGES) {
    for (const ns of NAMESPACES) {
      const value =
        extra.values?.[language]?.[ns] ||
        (language === 'zh' || language === 'zh-TW'
          ? { hello: '你好世界' }
          : language === 'en'
            ? sample
            : { hello: `${language} hello world` });
      writeJson(path.join(root, 'src', 'locales', language, `${ns}.json`), value);
    }
  }
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Gate Test',
      GIT_AUTHOR_EMAIL: 'gate@example.com',
      GIT_COMMITTER_NAME: 'Gate Test',
      GIT_COMMITTER_EMAIL: 'gate@example.com',
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-i18n-gate-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'gate@example.com']);
  git(root, ['config', 'user.name', 'Gate Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  seedLocales(root);
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'Hello.tsx'),
    "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('app');\n  return <span>{t('hello')}</span>;\n};\n",
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function runScript(root, extraArgs = []) {
  const result = spawnSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], {
    encoding: 'utf8',
    env: { ...process.env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withRepo(callback) {
  const root = createRepo();
  return Promise.resolve()
    .then(() => callback(root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('APP_LANGUAGES and namespaces stay in sync with the TypeScript source', () => {
  const languagesTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'languages.ts'), 'utf8');
  const indexTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'index.ts'), 'utf8');
  const codes = [...languagesTs.matchAll(/code: '([^']+)'/g)].map((match) => match[1]);
  const namespaceBlock = indexTs.match(/export const I18N_NAMESPACES = \[([\s\S]*?)\];/)[1];
  const namespaces = [...namespaceBlock.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(codes, LANGUAGES);
  assert.deepEqual(namespaces, NAMESPACES);
});

test('looksHardcodedCopy flags JSX and UI props, and honors the allow comment', () => {
  assert.equal(Boolean(gate.looksHardcodedCopy('      <p>保存失败</p>')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      <p>こんにちは</p>')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      <p>안녕하세요</p>')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      <p>Save failed now</p>')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      <p>保存失败</p> // i18n-allow-literal')), false);
  assert.equal(Boolean(gate.looksHardcodedCopy('      placeholder="Search"')), false);
  assert.equal(Boolean(gate.looksHardcodedCopy('      placeholder="Enter your GitHub token"')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      const tPair = useTPair();')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy('      const tPair = useTPair(); // i18n-allow-literal')), true);
  assert.equal(Boolean(gate.looksHardcodedCopy("      return <span>{t('hello')}</span>;")), false);
});

test('isPhraseLike ignores brand tokens and interpolation-only strings', () => {
  assert.equal(gate.isPhraseLike('GitHub Token'), false);
  assert.equal(gate.isPhraseLike('{{count}}'), false);
  assert.equal(gate.isPhraseLike('Refresh completed!'), true);
  assert.equal(gate.isPhraseLike('取消 Star'), true);
});

test('full-tree parity passes on a complete fixture', () =>
  withRepo((root) => {
    const result = runScript(root);
    assert.equal(result.code, 0, result.stderr);
  }));

test('missing locale keys fail the full-tree gate', () =>
  withRepo((root) => {
    writeJson(path.join(root, 'src', 'locales', 'ja', 'app.json'), {});
    const result = runScript(root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /ja: missing/);
  }));

test('unknown t() keys fail the full-tree gate', () =>
  withRepo((root) => {
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('app');\n  return <span>{t('missing-key')}</span>;\n};\n",
    );
    const result = runScript(root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing-key/);
  }));

test('prop-drilled t() still resolves keys from any namespace', () =>
  withRepo((root) => {
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Child.tsx'),
      "export const Child = ({ t }) => <span>{t('hello')}</span>;\n",
    );
    const result = runScript(root);
    assert.equal(result.code, 0, result.stderr);
  }));

test('bound useT namespace does not fall back to another namespace', () =>
  withRepo((root) => {
    for (const language of LANGUAGES) {
      writeJson(path.join(root, 'src', 'locales', language, 'app.json'), { other: `${language} other` });
      writeJson(path.join(root, 'src', 'locales', language, 'common.json'), {
        hello: language === 'zh' || language === 'zh-TW' ? '你好世界' : `${language} hello world`,
      });
    }
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('app');\n  return <span>{t('hello')}</span>;\n};\n",
    );
    const result = runScript(root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /missing from zh locales/);
  }));

test('bound useT does not resolve dotted keys from another namespace', () =>
  withRepo((root) => {
    for (const language of LANGUAGES) {
      writeJson(path.join(root, 'src', 'locales', language, 'app.json'), {
        'panel.hello': language === 'zh' || language === 'zh-TW' ? '你好世界' : `${language} hello world`,
      });
    }
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('discovery');\n  return <span>{t('panel.hello')}</span>;\n};\n",
    );
    const blocked = runScript(root);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /missing from zh locales/);

    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('discovery');\n  return <span>{t('app:panel.hello')}</span>;\n};\n",
    );
    const allowed = runScript(root);
    assert.equal(allowed.code, 0, allowed.stderr);
  }));

test('i18next plural suffixes satisfy a base t() key', () =>
  withRepo((root) => {
    for (const language of LANGUAGES) {
      writeJson(path.join(root, 'src', 'locales', language, 'app.json'), {
        hello_one: language === 'en' ? 'One hello' : `${language} one`,
        hello_other: language === 'en' ? 'Many hellos' : `${language} many`,
      });
    }
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('app');\n  return <span>{t('hello', { count: 2 })}</span>;\n};\n",
    );
    const result = runScript(root);
    assert.equal(result.code, 0, result.stderr);
  }));

test('PR added hardcoded copy fails, allow-literal does not', () =>
  withRepo((root) => {
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "export const Hello = () => <button>Save this now</button>;\n",
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'hardcoded']);
    const blocked = runScript(root, ['--base', 'HEAD~1', '--head', 'HEAD']);
    assert.equal(blocked.code, 1, blocked.stderr);
    assert.match(blocked.stderr, /hardcoded JSX text/);

    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "export const Hello = () => <button>Save this now</button>; // i18n-allow-literal\n",
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'allowed']);
    const allowed = runScript(root, ['--base', 'HEAD~2', '--head', 'HEAD']);
    assert.equal(allowed.code, 0, allowed.stderr);
  }));

test('multiline JSX and same-line t() plus hardcoded copy both fail', () =>
  withRepo((root) => {
    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "import { useT } from '../i18n/useT';\nexport const Hello = () => {\n  const t = useT('app');\n  return (\n    <>\n      <span>{t('hello')}</span>\n      <button>Save this now</button>\n    </>\n  );\n};\n",
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'same line']);
    const sameLine = runScript(root, ['--base', 'HEAD~1', '--head', 'HEAD']);
    assert.equal(sameLine.code, 1, sameLine.stderr);
    assert.match(sameLine.stderr, /hardcoded JSX text/);

    fs.writeFileSync(
      path.join(root, 'src', 'components', 'Hello.tsx'),
      "export const Hello = () => (\n  <button>\n    Save this now\n  </button>\n);\n",
    );
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'multiline']);
    const multiline = runScript(root, ['--base', 'HEAD~1', '--head', 'HEAD']);
    assert.equal(multiline.code, 1, multiline.stderr);
    assert.match(multiline.stderr, /hardcoded JSX text/);
  }));

test('new locale values that copy English fail; translated values pass', () =>
  withRepo((root) => {
    writeJson(path.join(root, 'src', 'locales', 'ja', 'app.json'), { hello: 'Hello world' });
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'copy en']);
    const blocked = runScript(root, ['--base', 'HEAD~1', '--head', 'HEAD']);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /copies the English source/);

    writeJson(path.join(root, 'src', 'locales', 'ja', 'app.json'), { hello: 'こんにちは世界' });
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'translate']);
    const allowed = runScript(root, ['--base', 'HEAD~2', '--head', 'HEAD']);
    assert.equal(allowed.code, 0, allowed.stderr);
  }));

test('zh-TW values that copy Simplified Chinese fail on new phrases', () =>
  withRepo((root) => {
    writeJson(path.join(root, 'src', 'locales', 'zh', 'app.json'), { hello: '刷新完成' });
    writeJson(path.join(root, 'src', 'locales', 'zh-TW', 'app.json'), { hello: '刷新完成' });
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'copy zh']);
    const blocked = runScript(root, ['--base', 'HEAD~1', '--head', 'HEAD']);
    assert.equal(blocked.code, 1);
    assert.match(blocked.stderr, /Simplified Chinese/);
  }));
