const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { docsOnly, isDocsPath } = require('./ci-scope.cjs');

const SCRIPT = path.join(__dirname, 'ci-scope.cjs');

/** Run a git command in a fixture and fail with useful diagnostics. */
function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

/** Create a temporary repository with a local commit identity. */
function createRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'ci-scope@example.com']);
  git(root, ['config', 'user.name', 'CI Scope Test']);
  return root;
}

/** Commit all fixture changes and return the commit SHA. */
function commit(root, message) {
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

/** Invoke the scope script and return its GITHUB_OUTPUT value. */
function runScope(base, head, root) {
  const output = path.join(root, 'github-output.txt');
  fs.writeFileSync(output, '');
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: path.dirname(SCRIPT),
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: 'pull_request',
      PR_BASE_SHA: base,
      PR_HEAD_SHA: head,
      CI_SCOPE_ROOT: root,
      GITHUB_OUTPUT: output,
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return fs.readFileSync(output, 'utf8');
}

test('docs-only classification covers Markdown and docs tree', () => {
  assert.equal(isDocsPath('README.md'), true);
  assert.equal(isDocsPath('README_zh.md'), true);
  assert.equal(isDocsPath('docs/adr/0001.md'), true);
  assert.equal(isDocsPath('docs/diagram.png'), true);
  assert.equal(isDocsPath('src/App.tsx'), false);
});

test('docs-only requires at least one file and no code paths', () => {
  assert.equal(docsOnly([]), false);
  assert.equal(docsOnly(['README.md', 'docs/changes.txt']), true);
  assert.equal(docsOnly(['README.md', 'src/App.tsx']), false);
});

test('writes run=false for a docs-only pull request', (t) => {
  const root = createRepo(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const value = 1;\n');
  const base = commit(root, 'base');
  fs.writeFileSync(path.join(root, 'README.md'), '# Updated docs\n');
  const head = commit(root, 'docs');

  assert.match(runScope(base, head, root), /^run=false$/m);
});

test('ignores code added to the base branch after a docs-only PR diverges', (t) => {
  const root = createRepo(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const value = 1;\n');
  commit(root, 'base');

  git(root, ['checkout', '-qb', 'feature']);
  fs.writeFileSync(path.join(root, 'README.md'), '# Updated docs\n');
  const docsHead = commit(root, 'docs');

  git(root, ['checkout', '-q', 'main']);
  fs.writeFileSync(path.join(root, 'src/main-only.ts'), 'export const mainOnly = true;\n');
  const mainHead = commit(root, 'main moves on');

  assert.match(runScope(mainHead, docsHead, root), /^run=false$/m);
});

test('writes run=true for code and code-to-docs rename changes', (t) => {
  const root = createRepo(t);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const value = 1;\n');
  const base = commit(root, 'base');

  fs.writeFileSync(path.join(root, 'src/changed.ts'), 'export const changed = true;\n');
  const codeHead = commit(root, 'code');
  assert.match(runScope(base, codeHead, root), /^run=true$/m);

  fs.mkdirSync(path.join(root, 'docs'));
  git(root, ['mv', 'src/App.tsx', 'docs/App.md']);
  const renameHead = commit(root, 'rename');
  assert.match(runScope(codeHead, renameHead, root), /^run=true$/m);
});
