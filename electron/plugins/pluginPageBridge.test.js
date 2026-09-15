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
