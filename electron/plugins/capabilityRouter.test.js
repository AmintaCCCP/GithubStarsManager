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

test('clipboard and downloads capabilities require permissions, decode payloads, and use host operations', async () => {
  const calls = [];
  const router = createCapabilityRouter({
    storage: {}, logger: { log() {} }, catalog: {},
    hostOperations: {
      clipboardWrite: (args) => { calls.push(['write', args]); return null; },
      clipboardWriteImage: (args) => { calls.push(['writeImage', args.buffer.toString('utf8')]); return null; },
      saveFile: async (args) => { calls.push(['saveFile', args.fileName, args.buffer.toString('utf8')]); return { fileName: args.fileName }; },
    },
  });

  await router.handle(['clipboard:write'], {
    capability: 'clipboard', operation: 'write', args: { text: 'hello' },
  });
  await router.handle(['clipboard:write'], {
    capability: 'clipboard', operation: 'writeImage', args: { dataBase64: Buffer.from('png-bytes').toString('base64') },
  });
  assert.deepEqual(await router.handle(['downloads:create'], {
    capability: 'downloads', operation: 'saveFile',
    args: { fileName: 'card.png', dataBase64: Buffer.from('png-bytes-2').toString('base64') },
  }), { fileName: 'card.png' });
  assert.deepEqual(calls, [
    ['write', { text: 'hello' }],
    ['writeImage', 'png-bytes'],
    ['saveFile', 'card.png', 'png-bytes-2'],
  ]);

  await assert.rejects(router.handle([], {
    capability: 'clipboard', operation: 'write', args: { text: 'hello' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle([], {
    capability: 'downloads', operation: 'saveFile', args: { fileName: 'x', dataBase64: 'QQ==' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle(['clipboard:write'], {
    capability: 'clipboard', operation: 'deleteHistory', args: {},
  }), { code: 'PLUGIN_CAPABILITY_UNKNOWN' });
  await assert.rejects(router.handle(['downloads:create'], {
    capability: 'downloads', operation: 'deleteFile', args: {},
  }), { code: 'PLUGIN_CAPABILITY_UNKNOWN' });
});

test('clipboard and downloads stay unavailable when the host injects no operations', async () => {
  const router = createCapabilityRouter({ storage: {}, logger: { log() {} }, catalog: {} });
  await assert.rejects(router.handle(['clipboard:write'], {
    capability: 'clipboard', operation: 'write', args: { text: 'hello' },
  }), { code: 'PLUGIN_CAPABILITY_UNAVAILABLE' });
  await assert.rejects(router.handle(['downloads:create'], {
    capability: 'downloads', operation: 'saveFile', args: { fileName: 'x', dataBase64: 'QQ==' },
  }), { code: 'PLUGIN_CAPABILITY_UNAVAILABLE' });
});

test('network requests authorize per host and only through the page bridge shape', async () => {
  const router = createCapabilityRouter({ storage: {}, logger: { log() {} }, catalog: {} });
  await assert.rejects(router.handle([], {
    capability: 'network', operation: 'request', args: { host: 'api.github.com', path: '/repos/o/r' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle(['network:evil.example'], {
    capability: 'network', operation: 'request', args: { host: 'api.github.com', path: '/repos/o/r' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle(['network:api.github.com'], {
    capability: 'network', operation: 'request', args: { host: 42, path: '/repos/o/r' },
  }), { code: 'PLUGIN_PERMISSION_DENIED' });
  await assert.rejects(router.handle(['network:api.github.com'], {
    capability: 'network', operation: 'fetch', args: { host: 'api.github.com' },
  }), { code: 'PLUGIN_CAPABILITY_UNKNOWN' });
  // 授权型返回：实际请求由渲染端用用户自己的 Token 执行。
  assert.equal(await router.handle(['network:api.github.com'], {
    capability: 'network', operation: 'request', args: { host: 'api.github.com', path: '/repos/o/r' },
  }), null);
});
