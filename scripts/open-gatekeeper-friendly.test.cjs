'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts/mac/Open Gatekeeper Friendly.command');
const BUILDER_CONFIG_PATH = path.join(REPO_ROOT, 'electron-builder.yml');

test('Open Gatekeeper Friendly script file exists and is executable', (t) => {
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

test('Open Gatekeeper Friendly script has valid bash syntax', (t) => {
  const result = spawnSync('bash', ['-n', SCRIPT_PATH], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('bash not found in environment');
    return;
  }
  assert.equal(result.status, 0, `bash -n failed: ${result.stderr}`);
});

test('Open Gatekeeper Friendly script responds to --help', (t) => {
  const result = spawnSync('bash', [SCRIPT_PATH, '--help'], { encoding: 'utf8' });
  if (result.error && result.error.code === 'ENOENT') {
    t.skip('bash not found in environment');
    return;
  }
  assert.equal(result.status, 0, `script --help failed: ${result.stderr}`);
  assert.match(result.stdout, /Usage:/);
  assert.match(result.stdout, /quarantine/i);
});

test('Open Gatekeeper Friendly script rejects non-application directories', (t) => {
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

test('electron-builder.yml specifies Open Gatekeeper Friendly.command in dmg.contents', () => {
  assert.ok(fs.existsSync(BUILDER_CONFIG_PATH), 'electron-builder.yml should exist');
  const content = fs.readFileSync(BUILDER_CONFIG_PATH, 'utf8');
  assert.match(content, /scripts\/mac\/Open Gatekeeper Friendly\.command/);
  assert.match(content, /dmg:\s*\n[\s\S]*contents:/);
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
