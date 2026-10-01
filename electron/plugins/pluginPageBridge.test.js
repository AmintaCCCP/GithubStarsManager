const assert = require('node:assert/strict');
const test = require('node:test');

const { validatePageCapabilityRequest } = require('./pluginPageBridge');

test('maps only declared semantic page requests', () => {
  assert.deepEqual(validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'repositories.search', args: { query: 'react', limit: 10 },
  }), {
    pluginId: 'com.example.page', pageId: 'dashboard', capability: 'github',
    operation: 'searchRepositories', args: { query: 'react', limit: 10 },
  });
  assert.throws(() => validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'network.fetch', args: {},
  }), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
  assert.throws(() => validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'repositories.get', args: { repositoryId: 1, token: 'x' },
  }), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
});

test('AI page requests require bounded prompts and cannot carry credentials', () => {
  assert.deepEqual(validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'ai.generate',
    args: { system: 'Summarize', user: 'Example repository', maxTokens: 500 },
  }), {
    pluginId: 'com.example.page', pageId: 'dashboard', capability: 'ai', operation: 'generate',
    args: { system: 'Summarize', user: 'Example repository', maxTokens: 500 },
  });
  for (const args of [
    { system: '', user: '' },
    { system: 'x'.repeat(2001), user: 'example' },
    { system: '', user: 'example', maxTokens: 4001 },
    { system: '', user: 'example', apiKey: 'secret' },
  ]) {
    assert.throws(() => validatePageCapabilityRequest({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'ai.generate', args,
    }), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
  }
});

test('web search requests accept only a bounded query and result limit', () => {
  assert.deepEqual(validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'web.search', args: { query: 'Example', limit: 3 },
  }), {
    pluginId: 'com.example.page', pageId: 'dashboard', capability: 'web', operation: 'search',
    args: { query: 'Example', limit: 3 },
  });
  for (const args of [{ query: '' }, { query: 'x'.repeat(201) }, { query: 'Example', limit: 11 }, { query: 'Example', url: 'https://evil.example' }]) {
    assert.throws(() => validatePageCapabilityRequest({
      pluginId: 'com.example.page', pageId: 'dashboard', method: 'web.search', args,
    }), { code: 'PLUGIN_PAGE_REQUEST_INVALID' });
  }
});

test('clipboard and download page requests are bounded and path-free', () => {
  const base = { pluginId: 'com.example.page', pageId: 'dashboard' };

  assert.deepEqual(validatePageCapabilityRequest({
    ...base, method: 'clipboard.write', args: { text: 'hello' },
  }), {
    ...base, capability: 'clipboard', operation: 'write', args: { text: 'hello' },
  });
  assert.deepEqual(validatePageCapabilityRequest({
    ...base, method: 'downloads.saveFile',
    args: { fileName: 'card-1x1.png', dataBase64: Buffer.from('png').toString('base64') },
  }), {
    ...base, capability: 'downloads', operation: 'saveFile',
    args: { fileName: 'card-1x1.png', dataBase64: Buffer.from('png').toString('base64') },
  });

  for (const [method, args] of [
    ['clipboard.write', { text: '' }],
    ['clipboard.write', { text: 'x'.repeat(200_001) }],
    ['clipboard.write', { text: 'hello', dataBase64: 'AAAA' }],
    ['clipboard.writeImage', { dataBase64: 'not base64!!' }],
    ['clipboard.writeImage', { dataBase64: '' }],
    ['downloads.saveFile', { fileName: '../evil.png', dataBase64: 'AAAA' }],
    ['downloads.saveFile', { fileName: 'sub/dir.png', dataBase64: 'AAAA' }],
    ['downloads.saveFile', { fileName: '.hidden.png', dataBase64: 'AAAA' }],
    ['downloads.saveFile', { fileName: 'ok.png', dataBase64: 'AAAA', overwrite: true }],
  ]) {
    assert.throws(() => validatePageCapabilityRequest({ ...base, method, args }),
      { code: 'PLUGIN_PAGE_REQUEST_INVALID' }, `${method} ${JSON.stringify(args)}`);
  }
});

test('binary export payloads get a larger budget than ordinary requests', () => {
  const base = { pluginId: 'com.example.page', pageId: 'dashboard' };
  // 7 MiB binary -> ~9.3 MiB base64, under the 10 MiB binary budget.
  const bigBase64 = Buffer.alloc(7 * 1024 * 1024, 7).toString('base64');
  assert.throws(() => validatePageCapabilityRequest({
    ...base, method: 'repositories.search', args: { query: 'x'.repeat(1024 * 1024 + 1) },
  }), { code: 'PLUGIN_PAGE_REQUEST_TOO_LARGE' });
  assert.equal(validatePageCapabilityRequest({
    ...base, method: 'downloads.saveFile', args: { fileName: 'big.png', dataBase64: bigBase64 },
  }).args.fileName, 'big.png');
});
