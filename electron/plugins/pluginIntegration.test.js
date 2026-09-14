const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createPluginManager } = require('./pluginManager');

function repository() {
  return {
    id: 1,
    name: 'project',
    full_name: 'owner/project',
    description: 'Example repository',
    html_url: 'https://github.com/owner/project',
    stargazers_count: 42,
    forks_count: 3,
    language: 'TypeScript',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    pushed_at: '2026-01-03T00:00:00Z',
    owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
    topics: ['desktop'],
  };
}

test('runs the full trusted-local V1 lifecycle with the example plugin', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-e2e-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const manager = createPluginManager({
    pluginsRoot: path.join(workspace, 'plugins'),
    statePath: path.join(workspace, 'plugins-state.json'),
    dataRoot: path.join(workspace, 'plugin-data'),
    logsRoot: path.join(workspace, 'plugin-logs'),
    runtimeTimeoutMs: 2000,
  });
  const source = path.resolve(__dirname, '../../examples/plugins/markdown-exporter');
  const pluginId = 'com.githubstarsmanager.markdown-exporter';
  const permissions = ['repositories:read', 'storage', 'clipboard:write'];

  assert.deepEqual(manager.installFromDirectory(source), { success: true, pluginId });
  assert.deepEqual(await manager.enable(pluginId, permissions), { success: true });

  const action = await manager.runAction({
    pluginId,
    actionId: 'copy-repository',
    repositories: [repository()],
  });
  assert.equal(action.success, true);
  assert.match(action.result.content, /\[owner\/project\]\(https:\/\/github\.com\/owner\/project\)/);

  const processor = await manager.runProcessor({
    pluginId,
    processorId: 'activity-summary',
    repositories: [repository()],
  });
  assert.deepEqual(processor, {
    success: true,
    result: {
      repositories: [{ id: 1, summary: 'owner/project: 42 stars', tags: ['has-push-history'] }],
    },
  });

  const exporter = await manager.runExporter({
    pluginId,
    exporterId: 'markdown',
    repositories: [repository()],
  });
  assert.equal(exporter.success, true);
  assert.equal(exporter.result.fileName, 'github-stars.md');
  assert.equal(exporter.result.mimeType, 'text/markdown');

  assert.deepEqual(await manager.disable(pluginId), { success: true });
  assert.equal((await manager.list()).plugins[0].status, 'disabled');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(workspace, 'plugin-data', `${pluginId}.json`), 'utf8')).activations,
    1
  );
  assert.match(
    fs.readFileSync(path.join(workspace, 'plugin-logs', `${pluginId}.log`), 'utf8'),
    /Markdown exporter deactivated/
  );
});

test('runs the V1.1 Smart Release Recommendation example without exposing download URLs', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-release-e2e-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const manager = createPluginManager({
    pluginsRoot: path.join(workspace, 'plugins'),
    statePath: path.join(workspace, 'plugins-state.json'),
    runtimeTimeoutMs: 2000,
  });
  const source = path.resolve(__dirname, '../../examples/plugins/smart-release-recommender');
  const pluginId = 'com.githubstarsmanager.smart-release-recommender';
  assert.deepEqual(manager.installFromDirectory(source), { success: true, pluginId });
  assert.deepEqual(await manager.enable(pluginId, ['releases:read', 'downloads:create']), { success: true });
  const names = {
    win32: `project-${process.arch}-setup.exe`,
    darwin: `project-${process.arch}.dmg`,
    linux: `project-${process.arch}.AppImage`,
  };
  const selectedName = names[process.platform] || `project-${process.arch}-installer`;
  const release = {
    id: 20, tag_name: 'v2', name: 'Two', body: 'Notes', published_at: '2026-02-01',
    html_url: 'https://github.com/owner/project/releases/tag/v2',
    repository: { id: 1, full_name: 'owner/project', name: 'project' },
    assets: [
      { id: 21, name: selectedName, size: 100, download_count: 1,
        browser_download_url: `https://github.com/owner/project/releases/download/v2/${selectedName}`,
        content_type: 'application/octet-stream', created_at: '2026-02-01', updated_at: '2026-02-01' },
      { id: 22, name: 'source-code.zip', size: 50, download_count: 1,
        browser_download_url: 'https://github.com/owner/project/releases/download/v2/source-code.zip',
        content_type: 'application/zip', created_at: '2026-02-01', updated_at: '2026-02-01' },
    ],
  };
  const operation = await manager.runReleaseProcessor({ pluginId, processorId: 'recommend-platform-asset', release });
  assert.equal(operation.success, true);
  assert.equal(operation.result.recommendedAssetId, 21);
  assert.equal(manager.getDownloadAsset(pluginId, 20, 21).success, true);
  manager.shutdown();
});

test('installs and serves the V1.2 page-only example without starting a Worker', async (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-page-e2e-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const manager = createPluginManager({
    pluginsRoot: path.join(workspace, 'plugins'),
    statePath: path.join(workspace, 'plugins-state.json'),
  });
  const source = path.resolve(__dirname, '../../examples/plugins/repo-health-page');
  const pluginId = 'com.example.repo-health-page';
  assert.deepEqual(manager.installFromDirectory(source), { success: true, pluginId });
  assert.deepEqual(await manager.enable(pluginId, ['repositories:read']), { success: true });
  const page = manager.getPage(pluginId, 'dashboard');
  assert.equal(page.success, true);
  assert.match(manager.readPageResource(page.url).body.toString(), /Repository Health/);
  assert.match(manager.readPageResource(page.url.replace('index.html', 'index.js')).body.toString(), /repositories\.search/);
  await manager.disable(pluginId);
  assert.equal(manager.readPageResource(page.url), null);
});
