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
  // 内容生成页会把 README 全文放进正文：恰好 160k 字符的正文要能通过（20 前缀 + 31_996*5），
  // 同时仍在 1 MiB 通用字节预算之内。
  const readmeSizedPrompt = 'README (full text):\n' + '仓库说明 '.repeat(31_996);
  assert.equal(readmeSizedPrompt.length, 160_000);
  assert.doesNotThrow(() => validatePageCapabilityRequest({
    pluginId: 'com.example.page', pageId: 'dashboard', method: 'ai.generate',
    args: { system: 'Summarize', user: readmeSizedPrompt },
  }));
  for (const args of [
    { system: '', user: '' },
    { system: 'x'.repeat(2001), user: 'example' },
    { system: 'ok', user: 'x'.repeat(160_001) },
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

test('network requests map to the network capability with normalized args', () => {
  const base = { pluginId: 'com.example.page', pageId: 'dashboard' };
  assert.deepEqual(validatePageCapabilityRequest({
    ...base, method: 'network.request', args: { host: 'api.github.com', path: '/repos/facebook/react' },
  }), {
    ...base, capability: 'network', operation: 'request',
    args: { host: 'api.github.com', path: '/repos/facebook/react' },
  });
  assert.deepEqual(validatePageCapabilityRequest({
    ...base, method: 'network.request',
    args: { host: 'api.github.com', path: '/repos/a-b-c-d/e_f.g/contributors', query: { per_page: 12, page: 2 } },
  }).args.query, { per_page: 12, page: 2 });
});

test('network requests accept only allowlisted hosts, metric paths and pagination params', () => {
  const base = { pluginId: 'com.example.page', pageId: 'dashboard', method: 'network.request' };
  const allowed = [
    { host: 'api.github.com', path: '/repos/facebook/react' },
    { host: 'api.github.com', path: '/repos/facebook/react/stats/commit_activity' },
    { host: 'api.github.com', path: '/repos/facebook/react/stats/participation' },
    { host: 'api.github.com', path: '/repos/facebook/react/stats/code_frequency' },
    { host: 'api.github.com', path: '/repos/facebook/react/contributors', query: { per_page: 12 } },
    { host: 'api.github.com', path: '/repos/facebook/react/languages' },
    { host: 'api.github.com', path: '/repos/facebook/react/releases' },
    { host: 'api.github.com', path: '/repos/facebook/react/tags' },
    { host: 'api.github.com', path: '/repos/facebook/react/stargazers' },
    { host: 'api.github.com', path: '/repos/facebook/react/stargazers/history', query: { per_page: 30, page: 3 } },
    { host: 'api.github.com', path: '/repos/facebook/react/community/profile' },
    { host: 'api.github.com', path: '/repos/facebook/react/security-advisories' },
    { host: 'api.github.com', path: '/repos/facebook/react/pulls', query: { state: 'closed', per_page: 30 } },
    { host: 'api.github.com', path: '/users/facebook' },
    { host: 'api.github.com', path: '/repos/o/r', query: {} },
  ];
  for (const args of allowed) {
    assert.doesNotThrow(() => validatePageCapabilityRequest({ ...base, args }),
      `should accept ${JSON.stringify(args)}`);
  }
  const rejected = [
    [{ host: 'evil.example', path: '/repos/facebook/react' }, 'unknown host'],
    [{ host: 'api.github.com', path: '/repos/facebook/react/settings' }, 'unknown suffix'],
    [{ host: 'api.github.com', path: '/repos/facebook/react/stats/unknown' }, 'unknown stats suffix'],
    [{ host: 'api.github.com', path: '/repos/facebook' }, 'missing repo segment'],
    [{ host: 'api.github.com', path: '/repos/facebook/react?per_page=1' }, 'query string in path'],
    [{ host: 'api.github.com', path: '/repos/facebook/react#frag' }, 'fragment in path'],
    [{ host: 'api.github.com', path: '/repos/facebook/../evil' }, 'path traversal'],
    [{ host: 'api.github.com', path: '/repos/%2e%2e/evil' }, 'percent-encoded traversal'],
    [{ host: 'api.github.com', path: `/repos/o/${'r'.repeat(101)}` }, 'repo too long'],
    [{ host: 'api.github.com', path: '/repos/-bad/react' }, 'owner with leading dash'],
    [{ host: 'api.github.com', path: `/repos/${'a'.repeat(40)}/react` }, 'owner too long'],
    [{ host: 'api.github.com', path: '//repos/facebook/react' }, 'double slash'],
    [{ host: 'api.github.com', path: '/repos/facebook/react', query: { url: 'https://evil.example' } }, 'unknown query key'],
    [{ host: 'api.github.com', path: '/repos/facebook/react', query: { per_page: 101 } }, 'per_page over range'],
    [{ host: 'api.github.com', path: '/repos/facebook/react', query: { page: 0 } }, 'page under range'],
    [{ host: 'api.github.com', path: '/repos/facebook/react', query: 'per_page=12' }, 'query not an object'],
    [{ host: 'api.github.com', path: '' }, 'empty path'],
    [{ host: 'api.github.com' }, 'missing path'],
    [{ path: '/repos/facebook/react' }, 'missing host'],
  ];
  for (const [args, label] of rejected) {
    assert.throws(() => validatePageCapabilityRequest({ ...base, args }),
      { code: 'PLUGIN_PAGE_REQUEST_INVALID' }, `should reject ${label}`);
  }
});
