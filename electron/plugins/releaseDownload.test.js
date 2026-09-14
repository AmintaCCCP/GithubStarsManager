const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { downloadReleaseAsset, isAllowedGitHubDownloadUrl, safeAssetName } = require('./releaseDownload');

test('allows only HTTPS GitHub release download hosts', () => {
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com/o/r/releases/download/v1/a.exe'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://release-assets.githubusercontent.com/file'), true);
  assert.equal(isAllowedGitHubDownloadUrl('http://github.com/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com.evil.example/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://user:pass@github.com/file'), false);
});

test('normalizes suggested asset names without accepting paths', () => {
  assert.equal(safeAssetName('../folder/setup?.exe'), 'setup_.exe');
  assert.equal(safeAssetName(''), 'release-asset');
});

test('streams an approved GitHub asset to the user-selected path', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-plugin-download-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'setup.exe');

  const result = await downloadReleaseAsset({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      url: 'https://release-assets.githubusercontent.com/file',
      body: new Blob(['hello']).stream(),
    }),
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    ownerWindow: null,
    release: { repository: { full_name: 'owner/repository' }, tag_name: 'v1.0.0' },
    asset: {
      name: 'setup.exe',
      size: 5,
      browser_download_url: 'https://github.com/owner/repository/releases/download/v1.0.0/setup.exe',
    },
  });

  assert.deepEqual(result, { success: true, fileName: 'setup.exe', bytes: 5 });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'hello');
});
