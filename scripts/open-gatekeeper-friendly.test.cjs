'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/mac/Fix Damaged App.command');
const BUILDER_CONFIG_PATH = path.join(REPO_ROOT, 'electron-builder.yml');
const DMG_BG_1X_PATH = path.join(REPO_ROOT, 'assets/dmg-background.png');
const DMG_BG_2X_PATH = path.join(REPO_ROOT, 'assets/dmg-background@2x.png');

test('Fix Damaged App script file exists and is executable', (t) => {
  assert.ok(fs.existsSync(SCRIPT_PATH), 'script file should exist');
  if (process.platform === 'win32') {
    t.skip('Windows fs.stat does not report POSIX execute bits');
    return;
  }
  const stat = fs.statSync(SCRIPT_PATH);
  // Verify user executable bit
  const isExecutable = (stat.mode & 0o111) !== 0;
  assert.ok(isExecutable, 'script file should be executable');
});

test('Fix Damaged App script has valid bash syntax', (t) => {
  const result = spawnSync('bash', ['-n', SCRIPT_PATH], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('bash not found in environment');
    return;
  }
  assert.equal(result.status, 0, `bash -n failed: ${result.stderr}`);
});

test('Fix Damaged App script responds to --help', (t) => {
  const result = spawnSync('bash', [SCRIPT_PATH, '--help'], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('bash not found in environment');
    return;
  }
  assert.equal(result.status, 0, `script --help failed: ${result.stderr}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /quarantine/i);
});

test('Fix Damaged App script rejects non-application directories', (t) => {
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'non-app-test-'));
  try {
    const result = spawnSync('bash', [SCRIPT_PATH, '--non-interactive', tmpDir], { encoding: 'utf8' });
    if (result.error && result.error.code === 'ENOENT') {
      t.skip('bash not found in environment');
      return;
    }
    assert.notEqual(result.status, 0, 'script should fail when target is not a macOS app bundle');
    assert.match(result.stdout, /missing Contents\/Info\.plist/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('electron-builder.yml specifies afterPack hook, custom DMG background, and Fix Damaged App.command in dmg.contents', () => {
  assert.ok(fs.existsSync(BUILDER_CONFIG_PATH), 'electron-builder.yml should exist');
  assert.ok(fs.existsSync(DMG_BG_1X_PATH), 'assets/dmg-background.png should exist');
  assert.ok(fs.existsSync(DMG_BG_2X_PATH), 'assets/dmg-background@2x.png should exist');
  const content = fs.readFileSync(BUILDER_CONFIG_PATH, 'utf8');
  assert.match(content, /scripts\/mac\/Fix Damaged App\.command/);
  assert.match(content, /background:\s*assets\/dmg-background\.png/);
  assert.match(content, /dmg:\s*\n[\s\S]*contents:/);
  assert.match(content, /afterPack:\s*scripts\/mac\/after-pack\.cjs/);
});

test('afterPack hook signs and strictly verifies macOS app bundle', async (t) => {
  const afterPackScript = path.join(REPO_ROOT, 'scripts/mac/after-pack.cjs');
  assert.ok(fs.existsSync(afterPackScript), 'scripts/mac/after-pack.cjs should exist');

  if (process.platform !== 'darwin') {
    t.skip('afterPack codesign execution only runs on macOS');
    return;
  }

  const afterPack = require(afterPackScript);
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'after-pack-test-'));
  const appDir = path.join(tmpDir, 'TestProduct.app');
  const macOsDir = path.join(appDir, 'Contents', 'MacOS');
  fs.mkdirSync(macOsDir, { recursive: true });
  fs.writeFileSync(path.join(macOsDir, 'TestProduct'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(appDir, 'Contents', 'Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>TestProduct</string></dict></plist>');

  try {
    await afterPack({
      electronPlatformName: 'darwin',
      appOutDir: tmpDir,
      packager: {
        appInfo: {
          productFilename: 'TestProduct',
        },
      },
    });

    // Verify strict codesign
    const verify = spawnSync('codesign', ['--verify', '--deep', '--strict', appDir], { encoding: 'utf8' });
    assert.equal(verify.status, 0, `codesign --verify --deep --strict failed: ${verify.stderr}`);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Open Gatekeeper Friendly removes quarantine attribute on macOS', (t) => {
  if (process.platform !== 'darwin') {
    t.skip('quarantine attribute test only runs on macOS');
    return;
  }

  // Create mock app bundle in temp dir with valid macOS app bundle layout
  const tmpDir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'gatekeeper-test-'));
  const mockAppDir = path.join(tmpDir, 'MockTest.app');
  const macOsDir = path.join(mockAppDir, 'Contents', 'MacOS');
  fs.mkdirSync(macOsDir, { recursive: true });

  const dummyBin = path.join(macOsDir, 'dummy');
  fs.writeFileSync(dummyBin, '#!/bin/sh\nexit 0\n', { mode: 0o755 });

  const infoPlist = path.join(mockAppDir, 'Contents', 'Info.plist');
  fs.writeFileSync(infoPlist, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict></dict></plist>');

  try {
    // Set quarantine attribute on both bundle root and nested binary
    const setXattr = spawnSync('xattr', ['-w', 'com.apple.quarantine', '0081;test;Chrome;', mockAppDir]);
    if (setXattr.status !== 0) {
      t.skip('xattr not supported on current filesystem');
      return;
    }
    spawnSync('xattr', ['-w', 'com.apple.quarantine', '0081;test;Chrome;', dummyBin]);

    // Verify attribute was set
    const verifyBefore = spawnSync('xattr', ['-p', 'com.apple.quarantine', mockAppDir], { encoding: 'utf8' });
    assert.equal(verifyBefore.status, 0, 'quarantine attribute should be set initially');
    const verifyNestedBefore = spawnSync('xattr', ['-p', 'com.apple.quarantine', dummyBin], { encoding: 'utf8' });
    assert.equal(verifyNestedBefore.status, 0, 'nested quarantine attribute should be set initially');

    // Run the fix script in non-interactive mode
    const runScript = spawnSync('bash', [SCRIPT_PATH, '--non-interactive', mockAppDir], {
      encoding: 'utf8',
      env: { ...process.env, CI: 'true' },
    });
    assert.equal(runScript.status, 0, `script failed: ${runScript.stderr || runScript.stdout}`);

    // Verify quarantine attribute is removed from both bundle root and nested binary
    const verifyAfter = spawnSync('xattr', ['-p', 'com.apple.quarantine', mockAppDir], { encoding: 'utf8' });
    assert.notEqual(verifyAfter.status, 0, 'quarantine attribute should no longer exist on root');
    const verifyNestedAfter = spawnSync('xattr', ['-p', 'com.apple.quarantine', dummyBin], { encoding: 'utf8' });
    assert.notEqual(verifyNestedAfter.status, 0, 'nested quarantine attribute should no longer exist');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
