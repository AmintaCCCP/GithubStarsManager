const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT = path.join(__dirname, 'check-pr-release-files.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function git(root, args, extra = {}) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Gate Test',
      GIT_AUTHOR_EMAIL: 'gate@example.com',
      GIT_COMMITTER_NAME: 'Gate Test',
      GIT_COMMITTER_EMAIL: 'gate@example.com',
      ...extra.env,
    },
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function createRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-release-gate-'));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'gate@example.com']);
  git(root, ['config', 'user.name', 'Gate Test']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeJson(path.join(root, 'package.json'), { name: 'app', version: '0.8.1' });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'app',
    version: '0.8.1',
    lockfileVersion: 3,
    packages: {
      '': { name: 'app', version: '0.8.1' },
      'node_modules/left-pad': { version: '1.0.0' },
    },
  });
  writeJson(path.join(root, 'server', 'package.json'), { name: 'server', version: '0.8.1' });
  writeJson(path.join(root, 'server', 'package-lock.json'), {
    name: 'server',
    version: '0.8.1',
    lockfileVersion: 3,
    packages: { '': { name: 'server', version: '0.8.1' } },
  });
  fs.mkdirSync(path.join(root, 'versions'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'versions', 'version-info.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<versions>\n  <version><number>0.8.1</number></version>\n</versions>\n',
  );
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'base']);
  return root;
}

function runScript(root, extraArgs = [], env = {}) {
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--root', root, '--base', 'HEAD~1', '--head', 'HEAD', ...extraArgs],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env },
    },
  );
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function withRepo(callback) {
  const root = createRepo();
  return Promise.resolve()
    .then(() => callback(root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

test('skips when no pull-request range is provided', () => {
  const result = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: 'push' },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /skip/);
});

test('blocks package.json version bumps', () =>
  withRepo((root) => {
    writeJson(path.join(root, 'package.json'), { name: 'app', version: '0.8.2' });
    git(root, ['add', 'package.json']);
    git(root, ['commit', '-m', 'bump']);
    const result = runScript(root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /package\.json: version changed/);
  }));

test('blocks lockfile root version bumps but allows dependency edits', () =>
  withRepo((root) => {
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.packages['node_modules/left-pad'].version = '1.0.1';
    writeJson(lockPath, lock);
    git(root, ['add', 'package-lock.json']);
    git(root, ['commit', '-m', 'deps']);
    const allowed = runScript(root);
    assert.equal(allowed.code, 0, allowed.stderr);

    lock.version = '0.8.2';
    lock.packages[''].version = '0.8.2';
    writeJson(lockPath, lock);
    git(root, ['add', 'package-lock.json']);
    git(root, ['commit', '-m', 'lock version']);
    const blocked = spawnSync(
      process.execPath,
      [SCRIPT, '--root', root, '--base', 'HEAD~2', '--head', 'HEAD'],
      { encoding: 'utf8' },
    );
    assert.equal(blocked.status, 1);
    assert.match(blocked.stderr, /package-lock\.json: root version changed/);
  }));

test('blocks version-info.xml edits', () =>
  withRepo((root) => {
    fs.appendFileSync(path.join(root, 'versions', 'version-info.xml'), '<!-- bump -->\n');
    git(root, ['add', 'versions/version-info.xml']);
    git(root, ['commit', '-m', 'feed']);
    const result = runScript(root);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /version-info\.xml/);
  }));

test('allows unrelated file changes', () =>
  withRepo((root) => {
    fs.writeFileSync(path.join(root, 'README.md'), 'hello\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-m', 'docs']);
    const result = runScript(root);
    assert.equal(result.code, 0, result.stderr);
  }));

test('split history uses merge-base, not current main, for before versions', () =>
  withRepo((root) => {
    git(root, ['checkout', '-b', 'contributor']);
    const lockPath = path.join(root, 'package-lock.json');
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.packages['node_modules/left-pad'].version = '1.0.1';
    writeJson(lockPath, lock);
    git(root, ['add', 'package-lock.json']);
    git(root, ['commit', '-m', 'deps only']);

    git(root, ['checkout', 'main']);
    writeJson(path.join(root, 'package.json'), { name: 'app', version: '0.8.2' });
    lock.version = '0.8.2';
    lock.packages[''].version = '0.8.2';
    writeJson(lockPath, lock);
    git(root, ['add', 'package.json', 'package-lock.json']);
    git(root, ['commit', '-m', 'owner bump']);

    const falsePositive = spawnSync(
      process.execPath,
      [SCRIPT, '--root', root, '--base', 'main', '--head', 'contributor'],
      { encoding: 'utf8' },
    );
    assert.equal(falsePositive.status, 0, falsePositive.stderr);

    git(root, ['checkout', 'contributor']);
    writeJson(path.join(root, 'package.json'), { name: 'app', version: '0.8.2' });
    const contributorLock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    contributorLock.version = '0.8.2';
    contributorLock.packages[''].version = '0.8.2';
    writeJson(lockPath, contributorLock);
    git(root, ['add', 'package.json', 'package-lock.json']);
    git(root, ['commit', '-m', 'copy current main version']);

    const bypass = spawnSync(
      process.execPath,
      [SCRIPT, '--root', root, '--base', 'main', '--head', 'contributor'],
      { encoding: 'utf8' },
    );
    assert.equal(bypass.status, 1, bypass.stderr);
    assert.match(bypass.stderr, /package\.json: version changed/);
  }));

test('missing git objects fail with a fetch diagnostic, not a false pass', () =>
  withRepo((root) => {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        '--root',
        root,
        '--base',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '--head',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Invalid symmetric difference|unknown revision|failed/);
  }));
