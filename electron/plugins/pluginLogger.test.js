const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginLogger, removePluginLogs } = require('./pluginLogger');

test('redacts tokens and sensitive metadata from plugin logs', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-logs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logger = createPluginLogger({ logsRoot: root, pluginId: 'com.example.logger' });

  logger.log('info', 'Authorization: Bearer secret-value', {
    apiKey: 'secret-key',
    nested: { token: 'secret-token', safe: 'visible' },
  });

  const text = fs.readFileSync(path.join(root, 'com.example.logger.log'), 'utf8');
  assert.equal(text.includes('secret-value'), false);
  assert.equal(text.includes('secret-key'), false);
  assert.equal(text.includes('secret-token'), false);
  assert.equal(text.includes('visible'), true);
});

test('removePluginLogs deletes the current and rotated log files', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-logs-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logger = createPluginLogger({ logsRoot: root, pluginId: 'com.example.logger' });
  logger.log('info', 'keep', {});
  fs.writeFileSync(path.join(root, 'com.example.logger.log.1'), 'rotated');

  assert.equal(removePluginLogs({ logsRoot: root, pluginId: 'com.example.logger' }), true);
  assert.equal(fs.existsSync(path.join(root, 'com.example.logger.log')), false);
  assert.equal(fs.existsSync(path.join(root, 'com.example.logger.log.1')), false);
  assert.equal(removePluginLogs({ logsRoot: root, pluginId: 'com.example.logger' }), true);
});
