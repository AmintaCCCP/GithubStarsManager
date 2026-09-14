const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginRuntime } = require('./pluginRuntime');

function writePlugin(t, source) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-runtime-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const entryPath = path.join(directory, 'worker.js');
  fs.writeFileSync(entryPath, source);
  return entryPath;
}

test('activates a plugin, runs an action, and deactivates it', async (t) => {
  const entryPath = writePlugin(t, `
    let active = false;
    module.exports = {
      activate(context) { active = context.pluginId === 'com.example.runtime'; },
      runAction(input) {
        if (!active) throw new Error('not active');
        return { type: 'text', content: input.repositories[0].full_name };
      },
      deactivate() { active = false; },
    };
  `);
  const runtime = createPluginRuntime({
    entryPath,
    pluginId: 'com.example.runtime',
    permissions: ['repositories:read'],
    timeoutMs: 2000,
  });

  await runtime.activate();
  assert.equal(runtime.isActive(), true);
  assert.deepEqual(
    await runtime.runAction({ actionId: 'show-name', repositories: [{ full_name: 'owner/project' }] }),
    { type: 'text', content: 'owner/project' }
  );
  await runtime.deactivate();
  assert.equal(runtime.isActive(), false);
});

test('surfaces plugin startup and action errors without crashing the host', async (t) => {
  const brokenEntry = writePlugin(t, `throw new Error('load failed');`);
  const broken = createPluginRuntime({
    entryPath: brokenEntry,
    pluginId: 'com.example.broken',
    permissions: [],
    timeoutMs: 2000,
  });
  await assert.rejects(broken.activate(), { code: 'PLUGIN_RUNTIME_ERROR', message: 'load failed' });

  const actionEntry = writePlugin(t, `module.exports = { runAction() { throw new Error('action failed'); } };`);
  const action = createPluginRuntime({
    entryPath: actionEntry,
    pluginId: 'com.example.action',
    permissions: [],
    timeoutMs: 2000,
  });
  await action.activate();
  await assert.rejects(action.runAction({ actionId: 'fail', repositories: [] }), {
    code: 'PLUGIN_RUNTIME_ERROR',
    message: 'action failed',
  });
  await action.deactivate();
});

test('terminates a plugin runtime when a call times out', async (t) => {
  const entryPath = writePlugin(t, `module.exports = { runAction() { return new Promise(() => {}); } };`);
  const runtime = createPluginRuntime({
    entryPath,
    pluginId: 'com.example.timeout',
    permissions: [],
    timeoutMs: 50,
  });
  await runtime.activate();

  await assert.rejects(runtime.runAction({ actionId: 'hang', repositories: [] }), {
    code: 'PLUGIN_RUNTIME_TIMEOUT',
  });
  assert.equal(runtime.isActive(), false);
});

test('exposes only permission-backed Host capabilities to plugin code', async (t) => {
  const entryPath = writePlugin(t, `
    let stored;
    module.exports = {
      async activate(context) {
        await context.storage.set('value', 42);
        stored = await context.storage.get('value');
        await context.log.info('activated', { stored });
      },
      runAction() { return { type: 'text', content: String(stored) }; },
    };
  `);
  const events = [];
  const runtime = createPluginRuntime({
    entryPath,
    pluginId: 'com.example.capabilities',
    permissions: ['storage'],
    timeoutMs: 2000,
    capabilityHandler: async (request) => {
      events.push(request);
      if (request.operation === 'get') return 42;
      return null;
    },
  });

  await runtime.activate();
  assert.deepEqual(await runtime.runAction({ actionId: 'show', repositories: [] }), {
    type: 'text', content: '42',
  });
  assert.deepEqual(events.map((event) => [event.capability, event.operation]), [
    ['storage', 'set'], ['storage', 'get'], ['log', 'info'],
  ]);
  await runtime.deactivate();
});

test('runs release processors with semantic GitHub Host capabilities', async (t) => {
  const entryPath = writePlugin(t, `
    let context;
    module.exports = {
      activate(value) { context = value; },
      async runReleaseProcessor(input) {
        const release = await context.github.getRelease(input.release.id);
        return { recommendedAssetId: release.assets[0].id, confidence: 1, reason: 'matched' };
      },
    };
  `);
  const runtime = createPluginRuntime({
    entryPath, pluginId: 'com.example.release', permissions: ['releases:read'], timeoutMs: 2000,
    capabilityHandler: async () => ({ assets: [{ id: 7 }] }),
  });
  await runtime.activate();
  assert.deepEqual(await runtime.runReleaseProcessor({ release: { id: 4, assets: [{ id: 7 }] } }), {
    recommendedAssetId: 7, confidence: 1, reason: 'matched',
  });
  await runtime.deactivate();
});
