const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_RESULT_BYTES,
  validateRunActionRequest,
  validatePluginActionResult,
  validateRunProcessorRequest,
  validatePluginProcessorResult,
  validatePluginExporterResult,
  validateRunReleaseProcessorRequest,
  validatePluginReleaseProcessorResult,
} = require('./pluginProtocol');

function repository(overrides = {}) {
  return {
    id: 1,
    name: 'project',
    full_name: 'owner/project',
    description: 'Example',
    html_url: 'https://github.com/owner/project',
    stargazers_count: 10,
    forks_count: 2,
    language: 'TypeScript',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    pushed_at: '2026-01-03T00:00:00Z',
    owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
    topics: ['desktop'],
    ai_summary: 'must not cross the plugin boundary',
    ...overrides,
  };
}

test('sanitizes repository action input to the public plugin shape', () => {
  const result = validateRunActionRequest({
    pluginId: 'com.example.exporter',
    actionId: 'export-markdown',
    repositories: [repository()],
  });

  assert.equal(result.repositories[0].full_name, 'owner/project');
  assert.equal('ai_summary' in result.repositories[0], false);
  assert.equal('avatar_url' in result.repositories[0].owner, false);
});

test('rejects malformed action input and unknown fields', () => {
  assert.throws(
    () => validateRunActionRequest({ pluginId: '../bad', actionId: 'run', repositories: [] }),
    { code: 'PLUGIN_REQUEST_INVALID' }
  );
  assert.throws(
    () => validateRunActionRequest({
      pluginId: 'com.example.valid',
      actionId: 'run',
      repositories: [repository()],
      token: 'secret',
    }),
    { code: 'PLUGIN_REQUEST_INVALID' }
  );
});

test('accepts structured action results and normalizes HTTPS URLs', () => {
  assert.deepEqual(validatePluginActionResult({ type: 'text', content: 'ok', suggestedAction: 'copy' }), {
    type: 'text',
    content: 'ok',
    suggestedAction: 'copy',
  });
  assert.deepEqual(validatePluginActionResult({ type: 'open-external', url: 'https://example.com' }), {
    type: 'open-external',
    url: 'https://example.com/',
  });
});

test('rejects unsafe, unknown, or oversized action results', () => {
  assert.throws(
    () => validatePluginActionResult({ type: 'open-external', url: 'file:///tmp/secret' }),
    { code: 'PLUGIN_RESULT_INVALID' }
  );
  assert.throws(() => validatePluginActionResult({ type: 'html', content: '<script />' }), {
    code: 'PLUGIN_RESULT_INVALID',
  });
  assert.throws(
    () => validatePluginActionResult({ type: 'text', content: 'x'.repeat(MAX_RESULT_BYTES + 1) }),
    { code: 'PLUGIN_RESULT_TOO_LARGE' }
  );
});

test('validates processor inputs and restricts processor output to requested repositories', () => {
  const request = validateRunProcessorRequest({
    pluginId: 'com.example.processor',
    processorId: 'health',
    repositories: [repository()],
  });
  assert.equal(request.processorId, 'health');
  assert.deepEqual(validatePluginProcessorResult({
    repositories: [{ id: 1, summary: 'Active', tags: ['healthy'] }],
  }, [1]), {
    repositories: [{ id: 1, summary: 'Active', tags: ['healthy'] }],
  });
  assert.throws(() => validatePluginProcessorResult({ repositories: [{ id: 2 }] }, [1]), {
    code: 'PLUGIN_RESULT_INVALID',
  });
});

test('validates text exporter output and rejects file paths', () => {
  assert.deepEqual(validatePluginExporterResult({ content: '# Repositories', fileName: 'stars.md' }), {
    content: '# Repositories', fileName: 'stars.md',
  });
  assert.throws(() => validatePluginExporterResult({ content: 'x', fileName: '../escape.md' }), {
    code: 'PLUGIN_RESULT_INVALID',
  });
});

test('sanitizes release inputs and accepts only recommendations for its assets', () => {
  const release = {
    id: 5, tag_name: 'v1', name: null, body: 'notes', published_at: '2026-01-01',
    html_url: 'https://github.com/owner/project/releases/tag/v1',
    repository: { id: 1, full_name: 'owner/project', name: 'project' },
    assets: [{ id: 9, name: 'setup.exe', size: 10, download_count: 2,
      browser_download_url: 'https://github.com/owner/project/releases/download/v1/setup.exe',
      content_type: 'application/octet-stream', created_at: '2026-01-01', updated_at: '2026-01-01' }],
  };
  const request = validateRunReleaseProcessorRequest({
    pluginId: 'com.example.release', processorId: 'recommend', release, repository: repository(),
  });
  assert.equal('browser_download_url' in request.release.assets[0], false);
  assert.deepEqual(validatePluginReleaseProcessorResult({ recommendedAssetId: 9, confidence: 0.9, reason: 'Windows x64' }, [9]), {
    recommendedAssetId: 9, confidence: 0.9, reason: 'Windows x64',
  });
  assert.throws(() => validatePluginReleaseProcessorResult({ recommendedAssetId: 10, confidence: 0.9, reason: 'bad' }, [9]), {
    code: 'PLUGIN_RESULT_INVALID',
  });
});
