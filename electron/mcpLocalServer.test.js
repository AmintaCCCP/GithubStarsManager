const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const {
  buildBatchLookupResult,
  buildRepoEvidence,
  buildRepositoryEmbeddingText,
  filterVectorCandidates,
  hasActiveVectorFilters,
} = require('./mcpDiscovery');
const {
  createMcpLocalServer,
  getMcpToolDefinitions,
  getMcpToolAvailability,
} = require('./mcpLocalServer');
const { version: applicationVersion } = require('../package.json');

function repo(overrides = {}) {
  return {
    id: 1,
    name: 'alpha',
    full_name: 'acme/alpha',
    description: 'retrieval repository',
    html_url: 'https://github.com/acme/alpha',
    stargazers_count: 100,
    language: 'Rust',
    topics: ['retrieval'],
    ai_summary: 'A retrieval system',
    ai_tags: ['semantic'],
    ai_platforms: ['linux'],
    custom_tags: [],
    custom_category: 'infrastructure',
    analyzed_at: '2026-02-04T00:00:00.000Z',
    analysis_failed: false,
    subscribed_to_releases: true,
    license: 'MIT',
    ...overrides,
  };
}

test('Electron discovery preserves batch order and duplicates', () => {
  const value = repo();
  const result = buildBatchLookupResult(
    ['acme/alpha', 'missing/repo', 'acme/alpha'],
    (input) => (input === 'acme/alpha' ? value : null)
  );

  assert.equal(result.requested, 3);
  assert.equal(result.foundCount, 2);
  assert.deepEqual(result.notFound, ['missing/repo']);
  assert.deepEqual(result.items.map((item) => item.input), [
    'acme/alpha',
    'missing/repo',
    'acme/alpha',
  ]);
  assert.deepEqual(result.items[0], result.items[2]);
});

test('Electron discovery mirrors structured similarity text and vector filtering', () => {
  const value = repo({
    description: 'A description',
    ai_summary: 'A summary',
    custom_description: 'An internal note',
    topics: ['one'],
    ai_tags: ['two'],
    custom_tags: ['three'],
    language: 'TypeScript',
  });
  assert.equal(
    buildRepositoryEmbeddingText(value),
    'Repository: acme/alpha\n' +
      'Description: A description\n' +
      'About: An internal note\n' +
      'Summary: A summary\n' +
      'Topics: one, two, three\n' +
      'Language: TypeScript\n' +
      'License: MIT'
  );

  const other = repo({ id: 2, full_name: 'acme/other', language: 'Python' });
  const filtered = filterVectorCandidates(
    [
      { id: '1', score: 0.9, repository: value },
      { id: '2', score: 0.8, repository: other },
    ],
    { languages: ['TypeScript'] },
    1
  );
  assert.deepEqual(filtered.matches.map((match) => match.repository.full_name), ['acme/alpha']);
  assert.equal(filtered.candidateCount, 2);
  assert.equal(filtered.filteredCount, 1);
  assert.equal(hasActiveVectorFilters({ isSubscribed: false }), true);
});

test('Electron evidence is cache-only and does not infer unavailable fields', () => {
  const value = repo({ updated_at: '2026-02-04T00:00:00.000Z' });
  const result = buildRepoEvidence(value, {
    id: 10,
    tag_name: 'v1.0.0',
    name: 'Release',
    html_url: 'https://github.com/acme/alpha/releases/tag/v1.0.0',
    published_at: '2026-03-01T00:00:00.000Z',
    prerelease: false,
    draft: false,
  });
  assert.equal(result.evidence.repository.archived, null);
  assert.equal(result.evidence.sources.latest_release, 'releases_cache');
  assert.deepEqual(result.evidence.evidenceFreshness, {
    repositoryUpdatedAt: '2026-02-04T00:00:00.000Z',
    repositorySyncedAt: null,
    releaseCacheUpdatedAt: null,
    analyzedAt: '2026-02-04T00:00:00.000Z',
    latestReleasePublishedAt: '2026-03-01T00:00:00.000Z',
    limitations: [
      'repositoryUpdatedAt is the stored repository updated_at, not a local sync timestamp',
      'repositorySyncedAt and release-cache update time are not stored locally',
    ],
  });
  assert.match(result.evidence.limitations[0], /archived is not stored locally/);
  assert.doesNotMatch(JSON.stringify(result), /ADOPT|ADAPT|REFERENCE|REJECT/);
});

test('Electron lists the same ten-tool conditional surface', () => {
  const allTools = getMcpToolDefinitions(true);
  const byName = new Map(allTools.map((tool) => [tool.name, tool]));
  assert.deepEqual(
    allTools.map((tool) => tool.name),
    [
      'gsm_status',
      'gsm_search_repos',
      'gsm_get_repo',
      'gsm_get_repos',
      'gsm_get_repo_evidence',
      'gsm_list_categories',
      'gsm_list_repos_by_category',
      'gsm_stats',
      'gsm_find_similar_repos',
      'gsm_vector_search',
    ]
  );
  assert.deepEqual(Object.keys(byName.get('gsm_search_repos').inputSchema.properties), [
    'query',
    'languages',
    'tags',
    'platforms',
    'licenses',
    'category',
    'minStars',
    'maxStars',
    'isAnalyzed',
    'isSubscribed',
    'sortBy',
    'sortOrder',
    'limit',
    'offset',
  ]);
  assert.deepEqual(Object.keys(byName.get('gsm_vector_search').inputSchema.properties), [
    'query',
    'topK',
    'threshold',
    'languages',
    'tags',
    'platforms',
    'licenses',
    'category',
    'minStars',
    'maxStars',
    'isAnalyzed',
    'isSubscribed',
  ]);
  assert.deepEqual(byName.get('gsm_get_repos').inputSchema.required, ['idsOrFullNames']);
  assert.deepEqual(byName.get('gsm_get_repo_evidence').inputSchema.required, ['idOrFullName']);
  assert.deepEqual(byName.get('gsm_find_similar_repos').inputSchema.required, ['idOrFullName']);
  assert.deepEqual(
    getMcpToolDefinitions(false).map((tool) => tool.name),
    [
      'gsm_status',
      'gsm_search_repos',
      'gsm_get_repo',
      'gsm_get_repos',
      'gsm_get_repo_evidence',
      'gsm_list_categories',
      'gsm_list_repos_by_category',
      'gsm_stats',
    ]
  );
});

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, port: address.port });
    });
  });
}

async function postJson(url, payload, token) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json();
  return { response, body };
}

test('Electron status accurately describes both vector tools when vector search is unavailable', async () => {
  const portProbe = await listen((_request, response) => response.end());
  await new Promise((resolve) => portProbe.server.close(resolve));
  const state = {
    config: { enabled: true, host: '127.0.0.1', port: portProbe.port, token: 'local-token' },
    snapshot: {
      repositories: [],
      customCategories: [],
      releases: [],
      vectorSearchConfig: { enabled: false },
    },
  };
  const local = createMcpLocalServer(() => state);
  const started = await local.start();

  try {
    const result = await postJson(
      started.url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'gsm_status', arguments: {} },
      },
      'local-token'
    );
    const text = result.body.result.content[0].text;
    const payload = JSON.parse(text);
    assert.equal(payload.version, applicationVersion);
    assert.equal(
      payload.toolsNote,
      'gsm_find_similar_repos and gsm_vector_search are not listed until vector search is configured and enabled'
    );
    assert.deepEqual(payload.availableTools, getMcpToolDefinitions(false).map((tool) => tool.name));
    assert.deepEqual(payload.conditionalTools, ['gsm_find_similar_repos', 'gsm_vector_search']);
  } finally {
    await local.stop();
  }
});

test('Electron status reports exact registered and conditional tools when vector search is available', async () => {
  const mcpPortProbe = await listen((_request, response) => response.end());
  await new Promise((resolve) => mcpPortProbe.server.close(resolve));
  const state = {
    config: { enabled: true, host: '127.0.0.1', port: mcpPortProbe.port, token: 'local-token' },
    snapshot: {
      repositories: [],
      customCategories: [],
      releases: [],
      vectorSearchConfig: {
        enabled: true,
        workerUrl: 'http://worker.example',
        authToken: 'worker-token',
        embedding: { apiType: 'ollama', model: 'bge-m3' },
      },
    },
  };
  const local = createMcpLocalServer(() => state);
  const started = await local.start();

  try {
    const result = await postJson(
      started.url,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'gsm_status', arguments: {} },
      },
      'local-token'
    );
    const initialize = await postJson(
      started.url,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      },
      'local-token'
    );
    const payload = JSON.parse(result.body.result.content[0].text);
    assert.equal(payload.version, applicationVersion);
    assert.equal(initialize.body.result.serverInfo.version, applicationVersion);
    assert.deepEqual(payload.availableTools, getMcpToolDefinitions(true).map((tool) => tool.name));
    assert.deepEqual(payload.conditionalTools, ['gsm_find_similar_repos', 'gsm_vector_search']);
    assert.deepEqual(getMcpToolAvailability(true), {
      availableTools: getMcpToolDefinitions(true).map((tool) => tool.name),
      conditionalTools: ['gsm_find_similar_repos', 'gsm_vector_search'],
    });
  } finally {
    await local.stop();
  }
});

test('Electron MCP executes batch, evidence, and candidate-set vector calls', async () => {
  const workerBodies = [];
  const embeddingUpstream = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
  });
  const workerUpstream = await listen((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      workerBodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        matches: [
          { id: '1', score: 1 },
          { id: '2', score: 0.8 },
          { id: '3', score: 0.8 },
        ],
      }));
    });
  });
  const mcpPortProbe = await listen((_request, response) => response.end());
  await new Promise((resolve) => mcpPortProbe.server.close(resolve));

  const source = repo({ id: 1, full_name: 'acme/source', name: 'source', language: 'Go' });
  const rust = repo({ id: 2, full_name: 'acme/rust', name: 'rust', language: 'Rust' });
  const python = repo({ id: 3, full_name: 'acme/python', name: 'python', language: 'Python' });
  const state = {
    config: { enabled: true, host: '127.0.0.1', port: mcpPortProbe.port, token: 'local-token' },
    snapshot: {
      repositories: [source, rust, python],
      customCategories: [],
      releases: [
        {
          id: 99,
          tag_name: 'v1.0.0',
          name: 'Release',
          html_url: 'https://github.com/acme/source/releases/tag/v1.0.0',
          published_at: '2026-03-01T00:00:00.000Z',
          prerelease: false,
          draft: false,
          repository: { id: 1, full_name: 'acme/source', name: 'source' },
        },
      ],
      vectorSearchConfig: {
        enabled: true,
        workerUrl: `http://127.0.0.1:${workerUpstream.port}`,
        authToken: 'worker-token',
        searchTopK: 20,
        embedding: {
          apiType: 'ollama',
          baseUrl: `http://127.0.0.1:${embeddingUpstream.port}`,
          model: 'bge-m3',
        },
      },
    },
  };
  const local = createMcpLocalServer(() => state);

  try {
    const started = await local.start();
    assert.equal(started.success, true);
    const unauthorized = await fetch(started.url, { method: 'POST', body: '{}' });
    assert.equal(unauthorized.status, 401);

    const batch = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'gsm_get_repos', arguments: {
        idsOrFullNames: ['acme/rust', 'missing/repo', 'acme/rust'],
      } } },
      'local-token'
    );
    const batchData = JSON.parse(batch.body.result.content[0].text);
    assert.deepEqual(batchData.items.map((item) => item.input), [
      'acme/rust',
      'missing/repo',
      'acme/rust',
    ]);
    assert.equal(batchData.items[1].status, 'not_found');

    const evidence = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gsm_get_repo_evidence', arguments: {
        idOrFullName: 'acme/source',
      } } },
      'local-token'
    );
    const evidenceData = JSON.parse(evidence.body.result.content[0].text);
    assert.equal(evidenceData.evidence.latest_release.id, 99);
    assert.equal(evidenceData.evidence.repository.archived, null);

    const vector = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'gsm_vector_search', arguments: {
        query: 'retrieval', topK: 1, languages: ['Rust'],
      } } },
      'local-token'
    );
    const vectorData = JSON.parse(vector.body.result.content[0].text);
    assert.deepEqual(vectorData.matches.map((match) => match.full_name), ['acme/rust']);
    assert.equal(vectorData.filtering.exactCorpusFilteredTopK, false);
    assert.equal(workerBodies[0].topK, 50);

    const similar = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'gsm_find_similar_repos', arguments: {
        idOrFullName: 'acme/source', topK: 2,
      } } },
      'local-token'
    );
    const similarData = JSON.parse(similar.body.result.content[0].text);
    assert.equal(similarData.sourceExcluded, true);
    assert.equal(similarData.matches.some((match) => match.id === 1), false);
    assert.equal(workerBodies[1].topK, 10);
  } finally {
    await local.stop();
    await new Promise((resolve) => embeddingUpstream.server.close(resolve));
    await new Promise((resolve) => workerUpstream.server.close(resolve));
  }
});

test('Electron vector tools report worker_query_failed for a non-JSON worker response', async () => {
  const embeddingUpstream = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
  });
  const workerUpstream = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end('<html>gateway error</html>');
  });
  const mcpPortProbe = await listen((_request, response) => response.end());
  await new Promise((resolve) => mcpPortProbe.server.close(resolve));

  const state = {
    config: { enabled: true, host: '127.0.0.1', port: mcpPortProbe.port, token: 'local-token' },
    snapshot: {
      repositories: [repo()],
      customCategories: [],
      releases: [],
      vectorSearchConfig: {
        enabled: true,
        workerUrl: `http://127.0.0.1:${workerUpstream.port}`,
        authToken: 'worker-token',
        searchTopK: 20,
        embedding: {
          apiType: 'ollama',
          baseUrl: `http://127.0.0.1:${embeddingUpstream.port}`,
          model: 'bge-m3',
        },
      },
    },
  };
  const local = createMcpLocalServer(() => state);

  try {
    const started = await local.start();
    const vector = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'gsm_vector_search', arguments: { query: 'retrieval' } } },
      'local-token'
    );
    const vectorData = JSON.parse(vector.body.result.content[0].text);
    assert.equal(vectorData.available, false);
    assert.equal(vectorData.reason, 'worker_query_failed');

    const similar = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gsm_find_similar_repos', arguments: { idOrFullName: 'acme/alpha' } } },
      'local-token'
    );
    const similarData = JSON.parse(similar.body.result.content[0].text);
    assert.equal(similarData.available, false);
    assert.equal(similarData.reason, 'worker_query_failed');
  } finally {
    await local.stop();
    await new Promise((resolve) => embeddingUpstream.server.close(resolve));
    await new Promise((resolve) => workerUpstream.server.close(resolve));
  }
});

test('Electron vector tools reject malformed worker payloads instead of returning empty matches', async () => {
  const embeddingUpstream = await listen((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ embeddings: [[0.1, 0.2]] }));
  });
  let workerRequests = 0;
  const workerUpstream = await listen((_request, response) => {
    workerRequests += 1;
    response.writeHead(200, { 'Content-Type': 'application/json' });
    // 第 1 次返回 JSON null，第 2 次返回 matches 非数组的合法 JSON
    response.end(workerRequests === 1 ? 'null' : JSON.stringify({ matches: 42 }));
  });
  const mcpPortProbe = await listen((_request, response) => response.end());
  await new Promise((resolve) => mcpPortProbe.server.close(resolve));

  const state = {
    config: { enabled: true, host: '127.0.0.1', port: mcpPortProbe.port, token: 'local-token' },
    snapshot: {
      repositories: [repo({ id: 1, full_name: 'acme/source', name: 'source' })],
      customCategories: [],
      releases: [],
      vectorSearchConfig: {
        enabled: true,
        workerUrl: `http://127.0.0.1:${workerUpstream.port}`,
        authToken: 'worker-token',
        searchTopK: 20,
        embedding: {
          apiType: 'ollama',
          baseUrl: `http://127.0.0.1:${embeddingUpstream.port}`,
          model: 'bge-m3',
        },
      },
    },
  };
  const local = createMcpLocalServer(() => state);

  try {
    const started = await local.start();
    const vector = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'gsm_vector_search', arguments: { query: 'retrieval' } } },
      'local-token'
    );
    const vectorData = JSON.parse(vector.body.result.content[0].text);
    assert.deepEqual(vectorData, { available: false, reason: 'worker_query_failed' });

    const similar = await postJson(
      started.url,
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'gsm_find_similar_repos', arguments: { idOrFullName: 'acme/source' } } },
      'local-token'
    );
    const similarData = JSON.parse(similar.body.result.content[0].text);
    assert.deepEqual(similarData, { available: false, reason: 'worker_query_failed' });
  } finally {
    await local.stop();
    await new Promise((resolve) => embeddingUpstream.server.close(resolve));
    await new Promise((resolve) => workerUpstream.server.close(resolve));
  }
});
