const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MANIFEST_VERSION,
  PLUGIN_API_VERSION,
  validateManifest,
} = require('./manifestSchema');

function manifest(overrides = {}) {
  return {
    manifestVersion: MANIFEST_VERSION,
    id: 'com.example.markdown-exporter',
    name: 'Markdown Exporter',
    version: '0.1.0',
    apiVersion: PLUGIN_API_VERSION,
    main: 'worker.js',
    permissions: ['repositories:read'],
    contributes: {
      repositoryActions: [
        {
          id: 'export-markdown',
          title: 'Export as Markdown',
          placement: 'bulk-toolbar',
        },
      ],
    },
    ...overrides,
  };
}

test('accepts the v1 manifest contract', () => {
  const input = manifest();
  const result = validateManifest(input);

  assert.equal(result.success, true);
  assert.equal(result.data.id, 'com.example.markdown-exporter');
  assert.notEqual(result.data, input);
  assert.notEqual(result.data.contributes, input.contributes);
});

test('rejects missing required fields with a stable error code', () => {
  const input = manifest();
  delete input.name;

  assert.deepEqual(validateManifest(input), {
    success: false,
    code: 'MANIFEST_FIELD_REQUIRED',
    message: "Manifest field 'name' is required",
  });
});

test('rejects unknown top-level and contribution fields', () => {
  assert.equal(validateManifest(manifest({ surprise: true })).code, 'MANIFEST_UNKNOWN_FIELD');

  const input = manifest();
  input.contributes.repositoryActions[0].handler = 'run';
  assert.equal(validateManifest(input).code, 'MANIFEST_UNKNOWN_FIELD');
});

test('rejects incompatible manifest and API versions', () => {
  assert.equal(
    validateManifest(manifest({ manifestVersion: 2 })).code,
    'MANIFEST_VERSION_UNSUPPORTED'
  );
  assert.equal(
    validateManifest(manifest({ apiVersion: '2' })).code,
    'PLUGIN_API_VERSION_UNSUPPORTED'
  );
});

test('rejects malformed ids, versions, permissions, and contributions', () => {
  assert.equal(validateManifest(manifest({ id: '../escape' })).code, 'MANIFEST_FIELD_INVALID');
  assert.equal(validateManifest(manifest({ version: 'latest' })).code, 'MANIFEST_FIELD_INVALID');
  assert.equal(
    validateManifest(manifest({ permissions: ['credentials:read'] })).code,
    'MANIFEST_PERMISSION_UNKNOWN'
  );

  const input = manifest();
  input.contributes.repositoryActions[0].placement = 'header';
  assert.equal(validateManifest(input).code, 'MANIFEST_FIELD_INVALID');
});

test('accepts a page-only manifest and domain-scoped HTTPS permission declaration', () => {
  const input = manifest({
    main: undefined,
    permissions: ['repositories:read', 'network:api.github.com'],
    contributes: {
      pages: [{ id: 'dashboard', title: 'Repository Health', entry: 'ui/index.html' }],
    },
  });
  delete input.main;

  const result = validateManifest(input);
  assert.equal(result.success, true);
  assert.equal(result.data.contributes.pages[0].entry, 'ui/index.html');
});

test('rejects page-only manifests that declare Worker contributions', () => {
  const input = manifest({
    main: undefined,
    permissions: ['repositories:read'],
    contributes: {
      pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'ui/index.html' }],
      repositoryActions: [{ id: 'export-markdown', title: 'Export as Markdown', placement: 'bulk-toolbar' }],
    },
  });
  delete input.main;

  const result = validateManifest(input);
  assert.equal(result.success, false);
  assert.equal(result.code, 'MANIFEST_FIELD_REQUIRED');
  assert.equal(result.message, "Manifest field 'main' is required for runtime contributions");
});

test('requires contributed page entries to be HTML documents', () => {
  const input = manifest();
  delete input.main;
  input.contributes = { pages: [{ id: 'dashboard', title: 'Dashboard', entry: 'ui/index.js' }] };
  const result = validateManifest(input);
  assert.equal(result.success, false);
  assert.equal(result.code, 'MANIFEST_FIELD_INVALID');
});

test('requires repositories:read for repository contributions', () => {
  assert.deepEqual(validateManifest(manifest({ permissions: [] })), {
    success: false,
    code: 'MANIFEST_PERMISSION_REQUIRED',
    message: "Repository contributions require permission 'repositories:read' or 'privateRepositories:read'",
  });
  assert.equal(validateManifest(manifest({ permissions: ['privateRepositories:read'] })).success, true);
});

test('validates repository processors and exporters', () => {
  const result = validateManifest(manifest({
    contributes: {
      repositoryProcessors: [{ id: 'health', title: 'Analyze health' }],
      exporters: [{ id: 'markdown', title: 'Markdown', fileExtension: '.md', mimeType: 'text/markdown' }],
    },
  }));
  assert.equal(result.success, true);

  const invalid = manifest({
    contributes: {
      exporters: [{ id: 'bad', title: 'Bad', fileExtension: '../exe', mimeType: 'anything' }],
    },
  });
  assert.equal(validateManifest(invalid).code, 'MANIFEST_FIELD_INVALID');
});

test('requires releases:read for release processors and accepts download permission', () => {
  const contribution = { releaseProcessors: [{ id: 'recommend', title: 'Recommend asset' }] };
  assert.equal(validateManifest(manifest({ permissions: [], contributes: contribution })).code, 'MANIFEST_PERMISSION_REQUIRED');
  assert.equal(validateManifest(manifest({
    permissions: ['releases:read', 'downloads:create'],
    contributes: contribution,
  })).success, true);
});
