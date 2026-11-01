const assert = require('node:assert/strict');
const test = require('node:test');

const { docsOnly, isDocsPath } = require('./ci-scope.cjs');

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
