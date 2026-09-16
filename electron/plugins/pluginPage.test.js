const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { pageCsp, pageUrl, readPageResource } = require('./pluginPage');

test('serves only declared page resources within the page directory', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-page-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ui'));
  fs.writeFileSync(path.join(root, 'ui', 'index.html'), '<!doctype html><script src="index.js"></script>');
  fs.writeFileSync(path.join(root, 'ui', 'index.js'), 'document.body.textContent = "safe";');
  fs.writeFileSync(path.join(root, 'worker.js'), 'private worker source');
  const manifest = {
    id: 'com.example.page', main: 'worker.js',
    contributes: { pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'ui/index.html' }] },
  };
  const url = pageUrl(manifest.id, 'dashboard');
  assert.equal(readPageResource(url, root, manifest).mimeType, 'text/html; charset=utf-8');
  assert.match(readPageResource(url.replace('index.html', 'index.js'), root, manifest).body.toString(), /safe/);
  assert.equal(readPageResource('plugin-page://com.example.page/dashboard/%2e%2e/worker.js', root, manifest), null);
  assert.equal(readPageResource('plugin-page://com.example.page/dashboard/worker.js', root, manifest), null);
  assert.equal(readPageResource('plugin-page://com.other.page/dashboard/index.html', root, manifest), null);
  assert.match(pageCsp(manifest.id), /connect-src 'none'/);
  assert.match(pageCsp(manifest.id), /script-src plugin-page:\/\/com\.example\.page/);
  assert.doesNotMatch(pageCsp(manifest.id), /unsafe-inline/);
});
