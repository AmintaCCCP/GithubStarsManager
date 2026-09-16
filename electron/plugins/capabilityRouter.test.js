const assert = require('node:assert/strict');
const test = require('node:test');

const { createCapabilityRouter } = require('./capabilityRouter');

test('routes only declared storage capability and always allows sanitized logging', async () => {
  const events = [];
  const router = createCapabilityRouter({
    storage: {
      get: (key) => { events.push(['get', key]); return 'value'; },
      set: (key, value) => events.push(['set', key, value]),
      delete: (key) => { events.push(['delete', key]); return true; },
    },
    logger: { log: (...args) => events.push(['log', ...args]) },
  });

  assert.equal(await router.handle(['storage'], {
    capability: 'storage', operation: 'get', args: { key: 'settings' },
  }), 'value');
  await router.handle([], { capability: 'log', operation: 'info', args: { message: 'hello' } });
  await assert.rejects(router.handle([], {
    capability: 'storage', operation: 'get', args: { key: 'settings' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle(['storage'], { capability: 'network', operation: 'fetch' }), {
    code: 'PLUGIN_CAPABILITY_UNKNOWN',
  });
  assert.deepEqual(events, [['get', 'settings'], ['log', 'info', 'hello', undefined]]);
});

test('routes GitHub semantic reads through the Host catalog with exact permissions', async () => {
  const router = createCapabilityRouter({
    storage: {}, logger: { log() {} },
    catalog: {
      getRepository: (id) => ({ id }),
      getRelease: (id) => ({ id }),
      searchRepositories: (query, limit) => [{ query, limit }],
    },
  });
  assert.deepEqual(await router.handle(['repositories:read'], {
    capability: 'github', operation: 'searchRepositories', args: { query: 'electron', limit: 5 },
  }), [{ query: 'electron', limit: 5 }]);
  assert.deepEqual(await router.handle(['releases:read'], {
    capability: 'github', operation: 'getRelease', args: { releaseId: 2 },
  }), { id: 2 });
  await assert.rejects(router.handle([], {
    capability: 'github', operation: 'getRepository', args: { repositoryId: 1 },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  assert.deepEqual(await router.handle(['privateRepositories:read'], {
    capability: 'github', operation: 'getRepository', args: { repositoryId: 9 },
  }), { id: 9 });
  assert.deepEqual(await router.handle(['privateRepositories:read'], {
    capability: 'github', operation: 'searchRepositories', args: { query: 'private', limit: 2 },
  }), [{ query: 'private', limit: 2 }]);
});

test('AI authorization requires an explicit permission and rejects other operations', async () => {
  const router = createCapabilityRouter({ storage: {}, logger: { log() {} }, catalog: {} });
  await assert.rejects(router.handle([], {
    capability: 'ai', operation: 'generate', args: {},
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  assert.equal(await router.handle(['ai:invoke'], {
    capability: 'ai', operation: 'generate', args: {},
  }), null);
  await assert.rejects(router.handle(['ai:invoke'], {
    capability: 'ai', operation: 'other', args: {},
  }), { code: 'PLUGIN_CAPABILITY_UNKNOWN' });
});

test('web search authorization does not grant arbitrary network access', async () => {
  const router = createCapabilityRouter({ storage: {}, logger: { log() {} }, catalog: {} });
  await assert.rejects(router.handle([], { capability: 'web', operation: 'search', args: {} }), {
    code: 'PLUGIN_PERMISSION_DENIED',
  });
  assert.equal(await router.handle(['web:search'], { capability: 'web', operation: 'search', args: {} }), null);
  await assert.rejects(router.handle(['web:search'], { capability: 'web', operation: 'fetch', args: {} }), {
    code: 'PLUGIN_CAPABILITY_UNKNOWN',
  });
});
