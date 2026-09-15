const assert = require('node:assert/strict');
const test = require('node:test');

const { createPluginCatalog } = require('./pluginCatalog');

function repository() {
  return {
    id: 1, name: 'project', full_name: 'owner/project', description: 'Desktop manager',
    html_url: 'https://github.com/owner/project', stargazers_count: 4, forks_count: 1,
    language: 'TypeScript', created_at: '2026-01-01', updated_at: '2026-01-02',
    pushed_at: '2026-01-03', owner: { login: 'owner', avatar_url: 'private' }, topics: ['electron'],
  };
}

function release() {
  return {
    id: 2, tag_name: 'v1.0.0', name: 'One', body: 'Notes', published_at: '2026-01-04',
    html_url: 'https://github.com/owner/project/releases/tag/v1.0.0', repository: { id: 1, full_name: 'owner/project', name: 'project' },
    assets: [{
      id: 3, name: 'project-x64.exe', size: 100, download_count: 5,
      browser_download_url: 'https://github.com/owner/project/releases/download/v1.0.0/project-x64.exe',
      content_type: 'application/octet-stream', created_at: '2026-01-04', updated_at: '2026-01-04',
    }],
  };
}

test('stores trusted download URLs but returns only sanitized GitHub data', () => {
  const catalog = createPluginCatalog();
  assert.deepEqual(catalog.update({ repositories: [repository()], releases: [release()] }), { repositories: 1, releases: 1 });
  assert.equal(catalog.searchRepositories('electron')[0].full_name, 'owner/project');
  assert.equal('avatar_url' in catalog.getRepository(1).owner, false);
  assert.equal('browser_download_url' in catalog.getRelease(2).assets[0], false);
  assert.equal(catalog.getDownloadAsset(2, 3).asset.browser_download_url.includes('/project-x64.exe'), true);
});

test('rejects non-GitHub and non-HTTPS asset URLs', () => {
  const catalog = createPluginCatalog();
  const input = release();
  input.assets[0].browser_download_url = 'https://evil.example/file.exe';
  assert.throws(() => catalog.update({ repositories: [], releases: [input] }), { code: 'PLUGIN_SNAPSHOT_INVALID' });
});

test('does not partially update a repository when release validation fails', () => {
  const catalog = createPluginCatalog();
  const invalidRelease = release();
  invalidRelease.assets[0].browser_download_url = 'https://evil.example/file.exe';

  assert.throws(() => catalog.upsert(repository(), invalidRelease), { code: 'PLUGIN_SNAPSHOT_INVALID' });
  assert.equal(catalog.getRepository(1), null);
  assert.equal(catalog.getRelease(2), null);
});
