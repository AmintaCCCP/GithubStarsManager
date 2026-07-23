/**
 * Lightweight local MCP HTTP server for Electron (read-only tools over JSON-RPC).
 * Implements a practical subset of Streamable HTTP / JSON responses for local agents.
 * Does not depend on @modelcontextprotocol/sdk so the desktop shell stays lean.
 */
const http = require('http');
const crypto = require('crypto');

function performBasicTextSearch(repos, query) {
  const normalizedQuery = String(query || '').toLowerCase().trim();
  if (!normalizedQuery) return repos;
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return repos.filter((repo) => {
    const text = [
      repo.name,
      repo.full_name,
      repo.description || '',
      repo.custom_description || '',
      repo.language || '',
      ...(repo.topics || []),
      repo.ai_summary || '',
      ...(repo.ai_tags || []),
      ...(repo.ai_platforms || []),
      ...(repo.custom_tags || []),
      repo.custom_category || '',
    ]
      .join(' ')
      .toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

function projectRepo(repo, max = 400) {
  const summary = repo.ai_summary || repo.custom_description || repo.description || null;
  const truncated =
    typeof summary === 'string' && summary.length > max ? `${summary.slice(0, max)}…` : summary;
  return {
    id: repo.id,
    full_name: repo.full_name,
    name: repo.name,
    html_url: repo.html_url,
    description: repo.description,
    language: repo.language,
    stargazers_count: repo.stargazers_count,
    topics: repo.topics || [],
    ai_summary: truncated,
    ai_tags: repo.ai_tags || [],
    ai_platforms: repo.ai_platforms || [],
    custom_description: repo.custom_description,
    custom_tags: repo.custom_tags,
    custom_category: repo.custom_category,
    analyzed_at: repo.analyzed_at,
    subscribed_to_releases: !!repo.subscribed_to_releases,
    starred_at: repo.starred_at,
    updated_at: repo.updated_at,
    pushed_at: repo.pushed_at,
  };
}

function getTools(vectorAvailable) {
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
          category: { type: 'string' },
          minStars: { type: 'number' },
          maxStars: { type: 'number' },
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
      name: 'gsm_vector_search',
      description:
        'Vector search is configured in the app but runs on the backend Worker; in Electron local mode use gsm_search_repos or connect backend MCP.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
      },
    });
  }
  return tools;
}

function callTool(name, args, snapshot) {
  const repos = Array.isArray(snapshot?.repositories) ? snapshot.repositories : [];
  const categories = Array.isArray(snapshot?.customCategories) ? snapshot.customCategories : [];
  const vectorEnabled = !!(
    snapshot?.vectorSearchConfig?.enabled &&
    snapshot?.vectorSearchConfig?.workerUrl &&
    snapshot?.vectorSearchConfig?.embeddingConfigId
  );

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
          available: vectorEnabled,
          reason: vectorEnabled
            ? 'configured_in_app_use_backend_mcp_for_live_vector'
            : 'vector_search_disabled',
        },
      });
    case 'gsm_search_repos': {
      let list = performBasicTextSearch(repos, args?.query || '');
      if (args?.languages?.length) {
        list = list.filter((r) => r.language && args.languages.includes(r.language));
      }
      if (args?.tags?.length) {
        list = list.filter((r) => {
          const tags = [...(r.ai_tags || []), ...(r.topics || []), ...(r.custom_tags || [])];
          return args.tags.some((t) => tags.includes(t));
        });
      }
      if (args?.category) {
        list = list.filter((r) => r.custom_category === args.category);
      }
      if (typeof args?.minStars === 'number') {
        list = list.filter((r) => (r.stargazers_count || 0) >= args.minStars);
      }
      if (typeof args?.maxStars === 'number') {
        list = list.filter((r) => (r.stargazers_count || 0) <= args.maxStars);
      }
      list = [...list].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
      const offset = Math.max(0, args?.offset || 0);
      const limit = Math.min(100, Math.max(1, args?.limit || 20));
      const items = list.slice(offset, offset + limit).map((r) => projectRepo(r));
      return text({ total: list.length, count: items.length, offset, limit, items });
    }
    case 'gsm_get_repo': {
      const key = String(args?.idOrFullName || '');
      const repo = repos.find(
        (r) =>
          String(r.id) === key ||
          (r.full_name && r.full_name.toLowerCase() === key.toLowerCase())
      );
      if (!repo) return text({ error: 'not_found', idOrFullName: key });
      return text(projectRepo(repo, 2000));
    }
    case 'gsm_list_categories':
      return text({ categories });
    case 'gsm_list_repos_by_category': {
      const cat = args?.category;
      let list = repos.filter((r) => r.custom_category === cat);
      list = [...list].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
      const offset = Math.max(0, args?.offset || 0);
      const limit = Math.min(100, Math.max(1, args?.limit || 20));
      const items = list.slice(offset, offset + limit).map((r) => projectRepo(r));
      return text({ total: list.length, count: items.length, items });
    }
    case 'gsm_stats': {
      const byLanguage = {};
      let analyzed = 0;
      let subscribed = 0;
      for (const r of repos) {
        const lang = r.language || 'Unknown';
        byLanguage[lang] = (byLanguage[lang] || 0) + 1;
        if (r.analyzed_at && !r.analysis_failed) analyzed += 1;
        if (r.subscribed_to_releases) subscribed += 1;
      }
      return text({
        totalRepositories: repos.length,
        analyzed,
        subscribedToReleases: subscribed,
        byLanguage,
      });
    }
    case 'gsm_vector_search':
      return text({
        available: false,
        reason:
          'Electron local MCP does not call embedding/worker APIs. Use backend-hosted MCP for gsm_vector_search, or gsm_search_repos for keyword search.',
      });
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

  function handleJsonRpc(body, snapshot) {
    const method = body?.method;
    const id = body?.id ?? null;
    const vectorAvailable = !!(
      snapshot?.vectorSearchConfig?.enabled &&
      snapshot?.vectorSearchConfig?.workerUrl &&
      snapshot?.vectorSearchConfig?.embeddingConfigId
    );

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
        result: { tools: getTools(vectorAvailable) },
      };
    }
    if (method === 'tools/call') {
      const name = body?.params?.name;
      const args = body?.params?.arguments || {};
      const result = callTool(name, args, snapshot);
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
    if (server) {
      return { success: true, url: `http://${state.config.host}:${state.config.port}/mcp` };
    }

    // Hard-bind loopback only — never listen on 0.0.0.0 for local MCP token auth
    const requestedHost = state.config.host || '127.0.0.1';
    const host =
      requestedHost === '0.0.0.0' || requestedHost === '::' || requestedHost === '[::]'
        ? '127.0.0.1'
        : requestedHost;
    const port = state.config.port || 3927;

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
      if (url.pathname !== '/mcp' && url.pathname !== '/sse') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      if (req.method === 'GET') {
        // Minimal health / capability probe
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            transport: 'json-rpc-http',
            path: '/mcp',
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
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? JSON.parse(raw) : {};
          const messages = Array.isArray(body) ? body : [body];
          const responses = [];
          for (const msg of messages) {
            const out = handleJsonRpc(msg, current.snapshot);
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

module.exports = { createMcpLocalServer };
