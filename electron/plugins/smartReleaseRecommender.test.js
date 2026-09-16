const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

// Installed plugins run as CommonJS from the desktop user-data directory, which is outside this
// repository's "type": "module" scope. Load the example the same way so the test exercises the
// shipped file instead of only its source text.
const exampleDirectory = path.resolve(__dirname, '../../examples/plugins/smart-release-recommender');
const loadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-example-plugin-'));
test.after(() => fs.rmSync(loadDirectory, { recursive: true, force: true }));
const loadPath = path.join(loadDirectory, 'worker.cjs');
fs.writeFileSync(loadPath, fs.readFileSync(path.join(exampleDirectory, 'worker.js'), 'utf8'));
const worker = require(loadPath);

function asset(id, name) {
  return {
    id,
    name,
    size: 10,
    download_count: 0,
    browser_download_url: `https://github.com/owner/project/releases/download/v1/${name}`,
    content_type: 'application/octet-stream',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
}

function release(assets) {
  return {
    id: 1,
    tag_name: 'v1',
    name: null,
    body: null,
    published_at: '2026-01-01',
    html_url: 'https://github.com/owner/project/releases/tag/v1',
    repository: { id: 1, full_name: 'owner/project', name: 'project' },
    assets,
  };
}

async function recommend(assetName, environment) {
  // The Host almost always already has the release, so a null lookup falls back to the input.
  worker.activate({ github: { getRelease: async () => null } });
  return worker.runReleaseProcessor({
    release: release([asset(7, assetName)]),
    hostEnvironment: environment,
  });
}

test('recommends only assets that declare the Host platform and architecture', async () => {
  const cases = [
    // Electron-style Windows names mix the platform token and the architecture: both must survive.
    ['project-win32-x64.zip', { os: 'win32', arch: 'x64' }, true],
    ['electron-v33-win32-x64.zip', { os: 'win32', arch: 'x64' }, true],
    ['project-win32-arm64.zip', { os: 'win32', arch: 'arm64' }, true],
    ['project-macos-arm64.dmg', { os: 'darwin', arch: 'arm64' }, true],
    // A platform-only Windows name is still a Windows build.
    ['project-win32.zip', { os: 'win32', arch: 'x64' }, true],
    // No architecture token at all (universal builds) stays eligible.
    ['project-macos-universal.dmg', { os: 'darwin', arch: 'arm64' }, true],
    ['project-linux-x64.AppImage', { os: 'linux', arch: 'x64' }, true],
    // Another platform or another architecture must be rejected instead of only losing points.
    ['project-x64.AppImage', { os: 'darwin', arch: 'arm64' }, false],
    ['project-macos-x64.dmg', { os: 'darwin', arch: 'arm64' }, false],
    ['project-win32-arm64.zip', { os: 'darwin', arch: 'arm64' }, false],
    ['project-linux-arm64.AppImage', { os: 'win32', arch: 'x64' }, false],
    ['project-source-code.zip', { os: 'darwin', arch: 'arm64' }, false],
    ['project-win32-linux-x64.zip', { os: 'win32', arch: 'x64' }, false],
    ['project-win32-x64-arm64.zip', { os: 'win32', arch: 'x64' }, false],
  ];

  for (const [name, environment, expected] of cases) {
    const label = `${name} on ${environment.os}/${environment.arch}`;
    if (!expected) {
      await assert.rejects(recommend(name, environment), { code: 'NO_COMPATIBLE_RELEASE_ASSET' }, label);
      continue;
    }
    const recommendation = await recommend(name, environment);
    assert.equal(recommendation.recommendedAssetId, 7, label);
    assert.equal(recommendation.confidence > 0 && recommendation.confidence <= 0.99, true, label);
  }
});

test('prefers the asset that names the Host architecture exactly', async () => {
  worker.activate({ github: { getRelease: async () => null } });
  const recommendation = await worker.runReleaseProcessor({
    release: release([asset(7, 'project-win32.zip'), asset(8, 'project-win32-x64.zip')]),
    hostEnvironment: { os: 'win32', arch: 'x64' },
  });

  assert.equal(recommendation.recommendedAssetId, 8);
});