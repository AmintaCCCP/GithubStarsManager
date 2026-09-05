const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { test } = require('node:test');

const SCRIPT_SOURCE = path.join(__dirname, 'update-version.cjs');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createFixture({ version = '1.2.3', derivedVersion = '0.1.0' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-update-version-'));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'server'));
  fs.mkdirSync(path.join(root, 'versions'));
  fs.copyFileSync(SCRIPT_SOURCE, path.join(root, 'scripts', 'update-version.cjs'));

  writeJson(path.join(root, 'package.json'), {
    name: 'github-stars-manager-fixture',
    version,
  });
  writeJson(path.join(root, 'package-lock.json'), {
    name: 'github-stars-manager-fixture',
    version: derivedVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'github-stars-manager-fixture',
        version: derivedVersion,
      },
    },
  });
  writeJson(path.join(root, 'server', 'package.json'), {
    name: 'github-stars-manager-server-fixture',
    version: derivedVersion,
    private: true,
  });
  writeJson(path.join(root, 'server', 'package-lock.json'), {
    name: 'github-stars-manager-server-fixture',
    version: derivedVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'github-stars-manager-server-fixture',
        version: derivedVersion,
      },
    },
  });
  fs.writeFileSync(
    path.join(root, 'versions', 'version-info.xml'),
    '<?xml version="1.0" encoding="UTF-8"?>\n<versions>\n</versions>\n'
  );

  return fs.realpathSync(root);
}

function targetPaths(root) {
  return [
    path.join(root, 'package-lock.json'),
    path.join(root, 'server', 'package.json'),
    path.join(root, 'server', 'package-lock.json'),
  ];
}

function transactionPaths(root) {
  return {
    journal: path.join(root, '.package-sync.transaction.json'),
    backupDir: path.join(root, '.package-sync-backups'),
    lock: path.join(root, '.release-version.lock'),
  };
}

function readVersions(root) {
  const [packageLock, serverPackage, serverPackageLock] = targetPaths(root).map((filePath) =>
    JSON.parse(fs.readFileSync(filePath, 'utf8'))
  );
  return {
    root: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
    packageLock: packageLock.version,
    packageLockRoot: packageLock.packages[''].version,
    serverPackage: serverPackage.version,
    serverPackageLock: serverPackageLock.version,
    serverPackageLockRoot: serverPackageLock.packages[''].version,
  };
}

function runScript(root, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'update-version.cjs'), ...args], {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

function withFixture(callback, options) {
  const root = createFixture(options);
  return Promise.resolve()
    .then(() => callback(root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function createRenameFailurePreload(root) {
  const preloadPath = path.join(root, 'rename-failure.cjs');
  fs.writeFileSync(
    preloadPath,
    `const fs = require('node:fs');
const originalRenameSync = fs.renameSync;
const targets = new Set(JSON.parse(process.env.GSM_TEST_RENAME_TARGETS));
const failAfter = Number(process.env.GSM_TEST_FAIL_AFTER_RENAME);
let targetRenameCount = 0;
fs.renameSync = function patchedRenameSync(source, destination) {
  const result = originalRenameSync.call(this, source, destination);
  if (targets.has(destination)) {
    targetRenameCount += 1;
    if (targetRenameCount === failAfter) {
      throw new Error('simulated interruption after target rename');
    }
  }
  return result;
};
`
  );
  return preloadPath;
}

async function createExitedProcessPid() {
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], {
    stdio: 'ignore',
  });
  await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  return child.pid;
}

async function interruptedTransactionFixture(root, { pid } = {}) {
  const paths = transactionPaths(root);
  fs.mkdirSync(paths.backupDir);
  const targets = targetPaths(root).map((targetPath, index) => {
    const backupPath = path.join(paths.backupDir, `${index}-${path.basename(targetPath)}.bak`);
    fs.copyFileSync(targetPath, backupPath);
    return { targetPath, backupPath };
  });

  const rootVersion = readVersions(root).root;
  const lockPid = pid ?? await createExitedProcessPid();
  writeJson(paths.journal, {
    transaction: 'package-version-sync',
    version: rootVersion,
    targets,
    startedAt: new Date().toISOString(),
    state: 'prepared',
  });
  writeJson(paths.lock, { pid: lockPid, createdAt: new Date().toISOString() });

  const partialPackageLock = JSON.parse(fs.readFileSync(targets[0].targetPath, 'utf8'));
  partialPackageLock.version = rootVersion;
  partialPackageLock.packages[''].version = rootVersion;
  writeJson(targets[0].targetPath, partialPackageLock);
  return paths;
}

test('normal release update synchronizes all derived files and removes transaction artifacts', async () => {
  await withFixture(async (root) => {
    const result = await runScript(root, ['release note']);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readVersions(root), {
      root: '1.2.3',
      packageLock: '1.2.3',
      packageLockRoot: '1.2.3',
      serverPackage: '1.2.3',
      serverPackageLock: '1.2.3',
      serverPackageLockRoot: '1.2.3',
    });
    assert.match(
      fs.readFileSync(path.join(root, 'versions', 'version-info.xml'), 'utf8'),
      /<number>1\.2\.3<\/number>/
    );
    const paths = transactionPaths(root);
    assert.equal(fs.existsSync(paths.journal), false);
    assert.equal(fs.existsSync(paths.backupDir), false);
    assert.equal(fs.existsSync(paths.lock), false);
  });
});

for (const failAfter of [1, 2]) {
  test(`exception after target rename ${failAfter} restores the pre-transaction state`, async () => {
    await withFixture(async (root) => {
      const preloadPath = createRenameFailurePreload(root);
      const result = await runScript(root, ['--sync-lock'], {
        NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${preloadPath}`.trim(),
        GSM_TEST_RENAME_TARGETS: JSON.stringify(targetPaths(root)),
        GSM_TEST_FAIL_AFTER_RENAME: String(failAfter),
      });

      assert.equal(result.code, 1);
      assert.match(result.stderr, /simulated interruption after target rename/);
      assert.deepEqual(readVersions(root), {
        root: '1.2.3',
        packageLock: '0.1.0',
        packageLockRoot: '0.1.0',
        serverPackage: '0.1.0',
        serverPackageLock: '0.1.0',
        serverPackageLockRoot: '0.1.0',
      });
      const paths = transactionPaths(root);
      assert.equal(fs.existsSync(paths.journal), false);
      assert.equal(fs.existsSync(paths.backupDir), false);
      assert.equal(fs.existsSync(paths.lock), false);
    });
  });
}

test('stale lock and interrupted transaction recover before the next sync', async () => {
  await withFixture(async (root) => {
    const paths = await interruptedTransactionFixture(root);
    const result = await runScript(root, ['--sync-lock']);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readVersions(root), {
      root: '1.2.3',
      packageLock: '1.2.3',
      packageLockRoot: '1.2.3',
      serverPackage: '1.2.3',
      serverPackageLock: '1.2.3',
      serverPackageLockRoot: '1.2.3',
    });
    assert.equal(fs.existsSync(paths.journal), false);
    assert.equal(fs.existsSync(paths.backupDir), false);
    assert.equal(fs.existsSync(paths.lock), false);

    const repeated = await runScript(root, ['--sync-lock']);
    assert.equal(repeated.code, 0, repeated.stderr);
    assert.deepEqual(readVersions(root), {
      root: '1.2.3',
      packageLock: '1.2.3',
      packageLockRoot: '1.2.3',
      serverPackage: '1.2.3',
      serverPackageLock: '1.2.3',
      serverPackageLockRoot: '1.2.3',
    });
    assert.equal(fs.existsSync(paths.journal), false);
    assert.equal(fs.existsSync(paths.backupDir), false);
  });
});

test('recovery is idempotent when the same interrupted fixture is encountered again', async () => {
  await withFixture(async (root) => {
    const firstPaths = await interruptedTransactionFixture(root);
    const first = await runScript(root, ['--sync-lock']);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(fs.existsSync(firstPaths.journal), false);

    const secondPaths = await interruptedTransactionFixture(root);
    const second = await runScript(root, ['--sync-lock']);
    assert.equal(second.code, 0, second.stderr);
    assert.deepEqual(readVersions(root), {
      root: '1.2.3',
      packageLock: '1.2.3',
      packageLockRoot: '1.2.3',
      serverPackage: '1.2.3',
      serverPackageLock: '1.2.3',
      serverPackageLockRoot: '1.2.3',
    });
    assert.equal(fs.existsSync(secondPaths.journal), false);
    assert.equal(fs.existsSync(secondPaths.backupDir), false);
    assert.equal(fs.existsSync(secondPaths.lock), false);
  });
});

test('a live lock owner is never taken over during recovery', async () => {
  await withFixture(async (root) => {
    const owner = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    try {
      const paths = await interruptedTransactionFixture(root, { pid: owner.pid });
      const result = await runScript(root, ['--sync-lock']);

      assert.equal(result.code, 1);
      assert.match(result.stderr, /live|正在运行|実行中/);
      assert.equal(fs.existsSync(paths.lock), true);
      assert.equal(fs.existsSync(paths.journal), true);
      assert.equal(fs.existsSync(paths.backupDir), true);
      assert.equal(readVersions(root).packageLock, '1.2.3');
    } finally {
      owner.kill('SIGTERM');
    }
  });
});

test('--sync-lock success path remains available without release metadata changes', async () => {
  await withFixture(async (root) => {
    const xmlPath = path.join(root, 'versions', 'version-info.xml');
    const beforeXml = fs.readFileSync(xmlPath, 'utf8');
    const result = await runScript(root, ['--sync-lock']);

    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(readVersions(root), {
      root: '1.2.3',
      packageLock: '1.2.3',
      packageLockRoot: '1.2.3',
      serverPackage: '1.2.3',
      serverPackageLock: '1.2.3',
      serverPackageLockRoot: '1.2.3',
    });
    assert.equal(fs.readFileSync(xmlPath, 'utf8'), beforeXml);
  });
});
