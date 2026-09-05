/**
 * Lightweight local MCP HTTP server for Electron (read-only tools over JSON-RPC).
 * Implements a practical subset of Streamable HTTP / JSON responses for local agents.
 * Does not depend on @modelcontextprotocol/sdk so the desktop shell stays lean.
 */
const http = require('http');
const crypto = require('crypto');
const {
  buildBatchLookupResult,
  buildRepoEvidence,
  buildRepositoryEmbeddingText,
  buildStats,
  filterVectorCandidates,
  getLatestCachedRelease,
  hasActiveVectorFilters,
  projectRepo,
  searchRepositories,
} = require('./mcpDiscovery');

const MCP_BATCH_LIMIT = 50;
const VECTOR_CANDIDATE_LIMIT = 50;

function getVectorAvailability(snapshot) {
  const vs = snapshot?.vectorSearchConfig;
  if (!vs || !vs.enabled) {
    return { available: false, reason: 'vector_search_disabled' };
  }
  const workerUrl = String(vs.workerUrl || '').trim();
  if (!workerUrl) {
    return { available: false, reason: 'worker_url_missing' };
  }
  const emb = vs.embedding;
  if (!emb || !emb.model) {
    return { available: false, reason: 'embedding_config_missing' };
  }
  const apiType = emb.apiType || 'openai';
  if (apiType !== 'ollama' && !emb.apiKey) {
    return { available: false, reason: 'embedding_api_key_missing' };
  }
  return {
    available: true,
    reason: null,
    embeddingModel: emb.model,
    workerUrl,
  };
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build embedding request URL/body to match app EmbeddingClient
 * (src/services/vectorSearchService.ts). Critical: siliconflow/openai use
 * `${baseUrl}/v1/embeddings` where baseUrl is typically host WITHOUT trailing /v1
 * (e.g. https://api.siliconflow.cn → .../v1/embeddings).
 */
async function embedQuery(text, emb) {
  const apiType = emb.apiType || 'openai';
  const model = emb.model || '';
  const apiKey = emb.apiKey || '';
  const baseUrl = String(emb.baseUrl || '').replace(/\/+$/, '');
  let url;
  const headers = { 'Content-Type': 'application/json' };
  let body;

  if (apiType === 'ollama') {
    // App: POST /api/embed with { model, input }
    url = `${baseUrl || 'http://127.0.0.1:11434'}/api/embed`;
    body = { model, input: [text] };
  } else if (apiType === 'gemini') {
    // App: batchEmbedContents for query purpose
    const root = baseUrl || 'https://generativelanguage.googleapis.com';
    url = `${root}/v1beta/models/${model}:batchEmbedContents?key=${encodeURIComponent(apiKey)}`;
    body = {
      requests: [
        {
          model: `models/${model}`,
          content: { parts: [{ text }] },
          taskType: 'RETRIEVAL_QUERY',
        },
      ],
    };
  } else if (apiType === 'cohere') {
    // App: POST ${baseUrl}/v1/embed
    url = `${baseUrl || 'https://api.cohere.com'}/v1/embed`;
    headers.Authorization = `Bearer ${apiKey}`;
    body = { model, texts: [text], input_type: 'search_query' };
  } else if (apiType === 'openai-compatible') {
    // App: use baseUrl as full embeddings endpoint URL
    if (!baseUrl) throw new Error('openai-compatible baseUrl is required (full embeddings endpoint)');
    url = baseUrl;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: [text] };
  } else {
    // openai / siliconflow — App appends /v1/embeddings to host baseUrl
    const root =
      baseUrl ||
      (apiType === 'siliconflow' ? 'https://api.siliconflow.cn' : 'https://api.openai.com');
    // Avoid double /v1 if user already stored .../v1
    url = /\/v1$/i.test(root) ? `${root}/embeddings` : `${root}/v1/embeddings`;
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    body = { model, input: [text] };
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(
      `Embedding API error ${res.status} (${apiType} ${url}): ${errText.slice(0, 200)}`
    );
  }
  const data = await res.json();

  if (apiType === 'ollama') {
    // App: { embeddings: [[...]] }
    if (Array.isArray(data.embeddings?.[0])) return data.embeddings[0];
    if (Array.isArray(data.embedding)) return data.embedding;
    throw new Error('Ollama embedding missing');
  }
  if (apiType === 'gemini') {
    // batchEmbedContents: { embeddings: [{ values: [...] }] }
    if (Array.isArray(data.embeddings?.[0]?.values)) return data.embeddings[0].values;
    if (Array.isArray(data.embedding?.values)) return data.embedding.values;
    throw new Error('Gemini embedding missing');
  }
  if (apiType === 'cohere') {
    if (!data.embeddings?.[0]) throw new Error('Cohere embedding missing');
    return data.embeddings[0];
  }
  if (!data.data?.[0]?.embedding) throw new Error('OpenAI-compatible embedding missing');
  return data.data[0].embedding;
}

async function runVectorSearch(query, args, snapshot) {
  const availability = getVectorAvailability(snapshot);
  if (!availability.available) {
    return { available: false, reason: availability.reason || 'unavailable' };
  }

  const vs = snapshot.vectorSearchConfig;
  const emb = vs.embedding;
  const topK = Math.min(50, Math.max(1, Number(args?.topK) || vs.searchTopK || 20));
  const threshold =
    typeof args?.threshold === 'number'
      ? args.threshold
      : typeof vs.searchThreshold === 'number'
        ? vs.searchThreshold
        : 0.35;
  const filtersActive = hasActiveVectorFilters(args || {});
  const workerTopK = filtersActive ? VECTOR_CANDIDATE_LIMIT : topK;

  let vector;
  try {
    vector = await embedQuery(String(query || ''), emb);
  } catch (err) {
    return {
      available: false,
      reason: `embedding_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const workerUrl = String(vs.workerUrl).replace(/\/$/, '');
  const workerToken = vs.authToken || '';
  let res;
  try {
    res = await fetchWithTimeout(`${workerUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(workerToken ? { Authorization: `Bearer ${workerToken}` } : {}),
      },
      body: JSON.stringify({ vector, topK: workerTopK, threshold }),
    });
  } catch (err) {
    return {
      available: false,
      reason: `worker_query_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return {
      available: false,
      reason: `worker_query_failed: ${res.status} ${errText.slice(0, 120)}`,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    // 200 但响应体不是合法 JSON（如网关错误页）；findSimilarRepositories 依赖
    // runVectorSearch 永不 throw，异常必须折叠进声明的 { available: false } 结果
    return {
      available: false,
      reason: `worker_query_failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const repos = Array.isArray(snapshot?.repositories) ? snapshot.repositories : [];
  const byId = new Map(repos.map((r) => [String(r.id), r]));

  const candidates = matches
    .map((m) => {
      const repo = byId.get(String(m.id));
      if (!repo) return null;
      return { id: String(m.id), score: Number(m.score), repository: repo };
    })
    .filter(Boolean);

  if (!filtersActive) {
    const enriched = candidates.map((candidate) => ({
      score: candidate.score,
      ...projectRepo(candidate.repository),
    }));
    return { available: true, total: enriched.length, matches: enriched };
  }

  // This is local filtering over the retrieved candidate set, not an exact
  // filtered topK over the complete Vectorize corpus. The Worker returns at
  // most VECTOR_CANDIDATE_LIMIT candidates and is intentionally unchanged.
  const filtered = filterVectorCandidates(candidates, args || {}, topK);
  const enriched = filtered.matches.map((candidate) => ({
    score: candidate.score,
    ...projectRepo(candidate.repository),
  }));

  return {
    available: true,
    total: enriched.length,
    matches: enriched,
    filtering: {
      mode: 'local_candidate_set',
      candidateLimit: VECTOR_CANDIDATE_LIMIT,
      exactCorpusFilteredTopK: false,
      candidateCount: filtered.candidateCount,
      filteredCount: filtered.filteredCount,
    },
  };
}

function getMcpToolDefinitions(vectorAvailable) {
  const tools = [
    {
      name: 'gsm_status',
      description: 'Get GithubStarsManager MCP status.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'gsm_search_repos',
      description: 'Keyword search over starred repositories with AI fields.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          languages: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          platforms: { type: 'array', items: { type: 'string' } },
          licenses: {
            type: 'array',
            items: { type: 'string' },
            description: 'SPDX id list (e.g. ["MIT","Apache-2.0"]); use "__NO_LICENSE__" for repos with no license',
          },
          category: { type: 'string' },
          minStars: { type: 'number' },
          maxStars: { type: 'number' },
          isAnalyzed: { type: 'boolean' },
          isSubscribed: { type: 'boolean' },
          sortBy: { type: 'string', enum: ['stars', 'updated', 'name', 'starred'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
          limit: { type: 'number' },
          offset: { type: 'number' },
        },
      },
    },
    {
      name: 'gsm_get_repo',
      description: 'Get one repository by id or full_name.',
      inputSchema: {
        type: 'object',
        properties: { idOrFullName: { type: 'string' } },
        required: ['idOrFullName'],
      },
    },
    {
      name: 'gsm_get_repos',
      description:
        'Get multiple starred repositories by id or full_name. Preserves input order and reports partial not_found results.',
      inputSchema: {
        type: 'object',
        properties: {
          idsOrFullNames: {
            type: 'array',
            minItems: 1,
            maxItems: MCP_BATCH_LIMIT,
            items: { type: 'string', minLength: 1 },
          },
        },
        required: ['idsOrFullNames'],
      },
    },
    {
      name: 'gsm_get_repo_evidence',
      description:
        'Get deterministic local repository evidence and the latest cached release, without remote GitHub requests or inferred values.',
      inputSchema: {
        type: 'object',
        properties: { idOrFullName: { type: 'string', minLength: 1 } },
        required: ['idOrFullName'],
      },
    },
    {
      name: 'gsm_list_categories',
      description: 'List custom categories.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'gsm_list_repos_by_category',
      description: 'List repositories by custom_category.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          limit: { type: 'number' },
          offset: { type: 'number' },
          sortBy: { type: 'string', enum: ['stars', 'updated', 'name', 'starred'] },
          sortOrder: { type: 'string', enum: ['asc', 'desc'] },
        },
        required: ['category'],
      },
    },
    {
      name: 'gsm_stats',
      description: 'Aggregate stats over starred repositories.',
      inputSchema: { type: 'object', properties: {} },
    },
  ];
  if (vectorAvailable) {
    tools.push({
      name: 'gsm_find_similar_repos',
      description:
        'Find semantically similar starred repositories using the existing vector index; the source repository is excluded.',
      inputSchema: {
        type: 'object',
        properties: {
          idOrFullName: { type: 'string', minLength: 1 },
          topK: { type: 'number', minimum: 1, maximum: 50 },
          threshold: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['idOrFullName'],
      },
    });
    tools.push({
      name: 'gsm_vector_search',
      description:
        'Semantic vector search over starred repositories (uses the app embedding + Vectorize worker config).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          topK: { type: 'number' },
          threshold: { type: 'number' },
          languages: { type: 'array', items: { type: 'string' } },
          tags: { type: 'array', items: { type: 'string' } },
          platforms: { type: 'array', items: { type: 'string' } },
          licenses: {
            type: 'array',
            items: { type: 'string' },
            description: 'SPDX id list; use "__NO_LICENSE__" for repos with no license',
          },
          category: { type: 'string' },
          minStars: { type: 'number' },
          maxStars: { type: 'number' },
          isAnalyzed: { type: 'boolean' },
          isSubscribed: { type: 'boolean' },
        },
        required: ['query'],
      },
    });
  }
  return tools;
}

function findSnapshotRepository(repos, idOrFullName) {
  const key = String(idOrFullName || '');
  return repos.find(
    (repo) =>
      String(repo.id) === key ||
      (repo.full_name && String(repo.full_name).toLowerCase() === key.toLowerCase())
  );
}

async function callTool(name, args, snapshot) {
  const repos = Array.isArray(snapshot?.repositories) ? snapshot.repositories : [];
  const categories = Array.isArray(snapshot?.customCategories) ? snapshot.customCategories : [];
  const releases = Array.isArray(snapshot?.releases) ? snapshot.releases : [];
  const vectorInfo = getVectorAvailability(snapshot);

  const text = (data) => ({
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  });

  switch (name) {
    case 'gsm_status':
      return text({
        name: 'github-stars-manager',
        version: '0.7.0',
        mode: 'electron-local',
        repositoryCount: repos.length,
        snapshotAt: snapshot?.snapshotAt || null,
        vector: {
          available: vectorInfo.available,
          reason: vectorInfo.reason,
          embeddingModel: vectorInfo.embeddingModel || null,
        },
        toolsNote: vectorInfo.available
          ? 'gsm_vector_search is available'
          : 'gsm_find_similar_repos and gsm_vector_search are not listed until vector search is configured and enabled',
      });
    case 'gsm_search_repos': {
      const result = searchRepositories(repos, args || {});
      return text({
        total: result.total,
        count: result.items.length,
        offset: result.offset,
        limit: result.limit,
        items: result.items.map((repo) => projectRepo(repo)),
      });
    }
    case 'gsm_get_repo': {
      const key = String(args?.idOrFullName || '');
      const repo = findSnapshotRepository(repos, key);
      if (!repo) return text({ error: 'not_found', idOrFullName: key });
      return text(projectRepo(repo, 2000));
    }
    case 'gsm_get_repos': {
      const inputs = args?.idsOrFullNames;
      if (
        !Array.isArray(inputs) ||
        inputs.length < 1 ||
        inputs.length > MCP_BATCH_LIMIT ||
        inputs.some((input) => typeof input !== 'string' || !input.trim())
      ) {
        return text({
          error: 'invalid_input',
          field: 'idsOrFullNames',
          message: `idsOrFullNames must contain between 1 and ${MCP_BATCH_LIMIT} non-empty strings`,
        });
      }
      const normalizedInputs = inputs.map((input) => input.trim());
      return text(
        buildBatchLookupResult(normalizedInputs, (input) => findSnapshotRepository(repos, input))
      );
    }
    case 'gsm_get_repo_evidence': {
      const key = String(args?.idOrFullName || '').trim();
      const repo = findSnapshotRepository(repos, key);
      if (!repo) return text({ error: 'not_found', idOrFullName: key });
      return text(buildRepoEvidence(repo, getLatestCachedRelease(releases, repo.id)));
    }
    case 'gsm_list_categories':
      return text({ categories });
    case 'gsm_list_repos_by_category': {
      const result = searchRepositories(repos, {
        ...(args || {}),
        category: args?.category,
      });
      return text({
        total: result.total,
        count: result.items.length,
        offset: result.offset,
        limit: result.limit,
        items: result.items.map((repo) => projectRepo(repo)),
      });
    }
    case 'gsm_stats':
      return text(buildStats(repos));
    case 'gsm_find_similar_repos': {
      if (!vectorInfo.available) {
        return text({
          available: false,
          reason: vectorInfo.reason || 'vector_search_disabled',
          hint: 'Enable Vector Search in Settings and ensure embedding + worker are configured, then retry.',
        });
      }
      const key = String(args?.idOrFullName || '').trim();
      const source = findSnapshotRepository(repos, key);
      if (!source) return text({ error: 'not_found', idOrFullName: key });
      const requestedTopK = Math.min(50, Math.max(1, Number(args?.topK) || 10));
      const result = await runVectorSearch(
        buildRepositoryEmbeddingText(source),
        { topK: Math.min(50, requestedTopK + 8), threshold: args?.threshold },
        snapshot
      );
      if (!result.available) return text(result);

      const bestById = new Map();
      for (const match of result.matches) {
        const matchId = String(match.id || '');
        if (!matchId || matchId === String(source.id)) continue;
        const score = Number.isFinite(Number(match.score)) ? Number(match.score) : Number.NEGATIVE_INFINITY;
        const current = bestById.get(matchId);
        if (!current || score > current.score) bestById.set(matchId, { score, match });
      }
      const similarMatches = [...bestById.values()]
        .sort(
          (left, right) =>
            right.score - left.score ||
            String(left.match.full_name || '').localeCompare(String(right.match.full_name || ''))
        )
        .slice(0, requestedTopK)
        .map(({ match }) => match);
      return text({
        available: true,
        source: projectRepo(source, 2000),
        sourceExcluded: true,
        matches: similarMatches,
      });
    }
    case 'gsm_vector_search': {
      if (!vectorInfo.available) {
        return text({
          available: false,
          reason: vectorInfo.reason || 'vector_search_disabled',
          hint: 'Enable Vector Search in Settings and ensure embedding + worker are configured, then retry.',
        });
      }
      const result = await runVectorSearch(args?.query || '', args, snapshot);
      return text(result);
    }
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function createMcpLocalServer(getState) {
  /** @type {import('http').Server | null} */
  let server = null;
  let lastError = null;
  /** @type {Map<string, import('http').ServerResponse>} */
  const sseStreams = new Map();

  function writeSse(res, event, data) {
    if (res.writableEnded) return;
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  }

  async function handleJsonRpc(body, snapshot) {
    const method = body?.method;
    const id = body?.id ?? null;
    const vectorInfo = getVectorAvailability(snapshot);

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: body?.params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'github-stars-manager', version: '0.7.0' },
        },
      };
    }
    if (method === 'notifications/initialized' || method === 'initialized') {
      return null; // notification
    }
    if (method === 'ping') {
      return { jsonrpc: '2.0', id, result: {} };
    }
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: getMcpToolDefinitions(vectorInfo.available) },
      };
    }
    if (method === 'tools/call') {
      const name = body?.params?.name;
      const args = body?.params?.arguments || {};
      const result = await callTool(name, args, snapshot);
      return { jsonrpc: '2.0', id, result };
    }
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }

  function authOk(req, token) {
    if (!token) return false;
    const header = req.headers.authorization || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const alt = req.headers['x-mcp-token'];
    const provided = bearer || (typeof alt === 'string' ? alt.trim() : '');
    return provided && timingSafeEqualString(provided, token);
  }

  async function start() {
    const state = getState();
    if (!state.config?.enabled) {
      return { success: false, error: 'MCP disabled' };
    }
    const normalizeHost = (raw) => {
      const h = typeof raw === 'string' && raw.trim() ? raw.trim() : '127.0.0.1';
      if (
        h === '0.0.0.0' ||
        h === '::' ||
        h === '[::]' ||
        h === '::1' ||
        h === '[::1]' ||
        h === 'localhost'
      ) {
        return '127.0.0.1';
      }
      return h === '127.0.0.1' ? h : '127.0.0.1';
    };

    if (server) {
      const h = normalizeHost(state.config?.host);
      const p = state.config?.port || 3927;
      return { success: true, url: `http://${h}:${p}/mcp` };
    }

    // Hard-bind loopback only — never listen on 0.0.0.0 for local MCP token auth
    const host = normalizeHost(state.config?.host);
    const port = state.config?.port || 3927;

    server = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type, Authorization, X-MCP-Token, Mcp-Session-Id'
      );
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      const current = getState();
      if (!current.config?.enabled) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'MCP disabled', code: 'MCP_DISABLED' }));
        return;
      }
      if (!authOk(req, current.config.token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized', code: 'MCP_UNAUTHORIZED' }));
        return;
      }

      const url = new URL(req.url || '/', `http://${host}:${port}`);
      const pathname = url.pathname;

      // ── Legacy SSE transport (MCP HTTP+SSE): GET open stream, POST messages ──
      // Paths aligned with backend: /sse + /messages (also /mcp/sse + /mcp/sse/messages)
      const isSseOpen =
        (req.method === 'GET' || req.method === 'HEAD') &&
        (pathname === '/sse' || pathname === '/mcp/sse');
      const isSseMessage =
        req.method === 'POST' &&
        (pathname === '/messages' || pathname === '/mcp/sse/messages');

      if (isSseOpen) {
        const sessionId = crypto.randomUUID();
        const messagesPath =
          pathname === '/mcp/sse' ? '/mcp/sse/messages' : '/messages';
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        // MCP SSE handshake: first event points client to the POST endpoint
        writeSse(res, 'endpoint', `${messagesPath}?sessionId=${sessionId}`);
        sseStreams.set(sessionId, res);
        // Keepalive comments so proxies don't drop the stream
        const keepAlive = setInterval(() => {
          if (!res.writableEnded) res.write(': ping\n\n');
        }, 15000);
        const cleanup = () => {
          clearInterval(keepAlive);
          sseStreams.delete(sessionId);
        };
        res.on('close', cleanup);
        res.on('error', cleanup);
        req.on('close', cleanup);
        return;
      }

      if (isSseMessage) {
        const sessionId = url.searchParams.get('sessionId') || '';
        const stream = sseStreams.get(sessionId);
        if (!stream || stream.writableEnded) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'unknown session', code: 'MCP_UNKNOWN_SESSION' }));
          return;
        }
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          try {
            const raw = Buffer.concat(chunks).toString('utf8');
            const body = raw ? JSON.parse(raw) : {};
            const messages = Array.isArray(body) ? body : [body];
            for (const msg of messages) {
              const out = await handleJsonRpc(msg, current.snapshot);
              // notifications have no response
              if (out) writeSse(stream, 'message', out);
            }
            // MCP SSE: acknowledge POST with 202; actual result rides the SSE stream
            res.writeHead(202).end();
          } catch (err) {
            lastError = err instanceof Error ? err.message : String(err);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON-RPC', detail: lastError }));
          }
        });
        return;
      }

      // ── Streamable HTTP (primary): JSON-RPC over POST /mcp ──
      if (pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        // Health / capability probe (not SSE — use /sse for that)
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            transport: 'json-rpc-http',
            path: '/mcp',
            sse: '/sse',
            mode: 'electron-local',
          })
        );
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? JSON.parse(raw) : {};
          const messages = Array.isArray(body) ? body : [body];
          const responses = [];
          for (const msg of messages) {
            const out = await handleJsonRpc(msg, current.snapshot);
            if (out) responses.push(out);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          if (Array.isArray(body)) {
            res.end(JSON.stringify(responses));
          } else {
            res.end(JSON.stringify(responses[0] || { jsonrpc: '2.0', result: {} }));
          }
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON-RPC', detail: lastError }));
        }
      });
    });

    await new Promise((resolve, reject) => {
      server.once('error', (err) => {
        lastError = err.message;
        server = null;
        reject(err);
      });
      server.listen(port, host, () => resolve());
    });

    return { success: true, url: `http://${host}:${port}/mcp` };
  }

  async function stop() {
    for (const [, stream] of sseStreams) {
      try {
        if (!stream.writableEnded) stream.end();
      } catch {
        /* ignore */
      }
    }
    sseStreams.clear();
    if (!server) return { success: true };
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
    server = null;
    return { success: true };
  }

  function getStatus() {
    const state = getState();
    const cfg = state?.config || {};
    const host =
      !cfg.host || cfg.host === '0.0.0.0' || cfg.host === '::'
        ? '127.0.0.1'
        : cfg.host;
    return {
      running: !!server,
      url: server ? `http://${host}:${cfg.port || 3927}/mcp` : undefined,
      error: lastError || undefined,
    };
  }

  return { start, stop, getStatus };
}

module.exports = { createMcpLocalServer, getMcpToolDefinitions };
