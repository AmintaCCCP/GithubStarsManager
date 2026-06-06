import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { encrypt, decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { proxyRequest, ProxyConfig, validateUrl } from '../services/proxyService.js';
import { logger } from '../services/logger.js';

function getProxyConfig(): ProxyConfig | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('proxy_config') as { value: string } | undefined;
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    if (parsed && parsed.enabled && parsed.host && parsed.port) {
      // Decrypt password if encrypted - fail closed on decrypt error
      if (parsed.password_encrypted) {
        parsed.password = decrypt(parsed.password_encrypted, config.encryptionKey);
        delete parsed.password_encrypted;
      }
      return parsed as ProxyConfig;
    }
    return null;
  } catch {
    return null;
  }
}

const router = Router();

// Helper: build API URL handling baseUrl already ending in version prefix
function buildApiUrl(baseUrl: string, pathWithVersion: string): string {
  const baseUrlWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const versionPrefix = pathWithVersion.split('/')[0] || '';

  try {
    const base = new URL(baseUrlWithSlash);
    const basePath = base.pathname.replace(/\/$/, '');

    // 检测 baseUrl 是否已经以任何版本号结尾（v1, v2, v3, v1beta, v1alpha 等）
    // 这样可以兼容火山引擎（/v3）、OpenAI（/v1）、Gemini（/v1beta）等不同版本号
    const anyVersionPattern = /\/v\d+(?:beta|alpha)?$/;
    const hasVersionInBase = anyVersionPattern.test(basePath);

    if (hasVersionInBase) {
      // baseUrl 已包含版本号，只补全端点路径（去掉版本号部分）
      const endpointPath = pathWithVersion.includes('/')
        ? pathWithVersion.split('/').slice(1).join('/')
        : pathWithVersion;
      return new URL(endpointPath, baseUrlWithSlash).toString();
    }

    if (versionPrefix) {
      const versionRe = new RegExp(`/${versionPrefix}$`);
      if (versionRe.test(basePath) && pathWithVersion.startsWith(`${versionPrefix}/`)) {
        const rest = pathWithVersion.slice(versionPrefix.length + 1);
        return new URL(rest, baseUrlWithSlash).toString();
      }
    }

    return new URL(pathWithVersion, baseUrlWithSlash).toString();
  } catch {
    return `${baseUrlWithSlash}${pathWithVersion}`;
  }
}

// POST /api/proxy/github/*
router.post('/api/proxy/github/*', async (req, res) => {
  try {
    const db = getDb();
    const githubPath = (req.params as Record<string, string>)[0]; // wildcard capture
    
    // Read and decrypt GitHub token from settings
    const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined;
    if (!tokenRow?.value) {
      res.status(400).json({ error: 'GitHub token not configured', code: 'GITHUB_TOKEN_NOT_CONFIGURED' });
      return;
    }

    let token: string;
    try {
      token = decrypt(tokenRow.value, config.encryptionKey);
    } catch {
      res.status(500).json({ error: 'Failed to decrypt GitHub token', code: 'GITHUB_TOKEN_DECRYPT_FAILED' });
      return;
    }

    // Build target URL with query params
    const queryString = new URL(req.url, 'http://localhost').search;
    const targetUrl = `https://api.github.com/${githubPath}${queryString}`;

    const body = req.body as { method?: string; headers?: Record<string, string> };
    const method = body.method || 'GET';
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': body.headers?.Accept || 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GithubStarsManager-Backend',
    };

    const proxyConfig = getProxyConfig();
    const result = await proxyRequest({ url: targetUrl, method, headers, proxyConfig });
    res.status(result.status).json(result.data);
  } catch (err) {
    logger.errorFromError('proxy.github', 'GitHub proxy error', err);
    res.status(500).json({ error: 'GitHub proxy failed', code: 'GITHUB_PROXY_FAILED' });
  }
});

function normalizeReasoningEffort(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value === 'minimal' ? 'low' : value;
}

// POST /api/proxy/ai
// Accepts either { configId, body } (lookup from DB) or { config, body } (inline config for one-time requests)
router.post('/api/proxy/ai', async (req, res) => {
  try {
    const db = getDb();
    const { configId, config: inlineConfig, body: requestBody } = req.body as {
      configId?: string;
      config?: { apiType?: string; baseUrl: string; apiKey: string; model: string; reasoningEffort?: string };
      body: Record<string, unknown>;
    };

    let apiKey: string;
    let apiType: string;
    let baseUrl: string;
    let model: string;
    let reasoningEffort: string | null;

    if (inlineConfig && !configId) {
      // Inline config path (for form tests without a saved config ID)
      apiKey = inlineConfig.apiKey;
      apiType = inlineConfig.apiType || 'openai';
      baseUrl = inlineConfig.baseUrl;
      model = inlineConfig.model;
      reasoningEffort = normalizeReasoningEffort(inlineConfig.reasoningEffort);
      if (!baseUrl || !apiKey || !model) {
        res.status(400).json({ error: 'baseUrl, apiKey, and model are required', code: 'INVALID_REQUEST' });
        return;
      }
      // Warn if API key is transmitted over non-HTTPS connection
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'https:') {
          logger.warn('proxy.ai', `AI API key transmitted over ${parsed.protocol} (not HTTPS). Consider using HTTPS for security.`);
        }
      } catch { /* invalid URL, will be caught by validateUrl later */ }
    } else if (configId) {
      // DB lookup path (for saved configs)
      const aiConfig = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(configId) as Record<string, unknown> | undefined;
      if (!aiConfig) {
        res.status(404).json({ error: 'AI config not found', code: 'AI_CONFIG_NOT_FOUND' });
        return;
      }
      apiKey = decrypt(aiConfig.api_key_encrypted as string, config.encryptionKey);
      apiType = (aiConfig.api_type as string) || 'openai';
      baseUrl = aiConfig.base_url as string;
      model = aiConfig.model as string;
      reasoningEffort = normalizeReasoningEffort(aiConfig.reasoning_effort);
      try {
        const parsed = new URL(baseUrl);
        if (parsed.protocol !== 'https:') {
          logger.warn('proxy.ai', `AI API key transmitted over ${parsed.protocol} (not HTTPS). Consider using HTTPS for security.`);
        }
      } catch { /* invalid URL, will be caught by validateUrl later */ }
    } else {
      res.status(400).json({ error: 'configId or config required', code: 'CONFIG_ID_REQUIRED' });
      return;
    }

    let targetUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible' || apiType === 'deepseek' || apiType === 'mimo') {
      // openai-compatible 类型直接使用 baseUrl 作为完整地址
      targetUrl = apiType === 'openai-compatible'
        ? baseUrl.replace(/\/$/, '')
        : buildApiUrl(baseUrl, apiType === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions');
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (apiType === 'claude') {
      targetUrl = buildApiUrl(baseUrl, 'v1/messages');
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      // gemini
      const rawModel = model.trim();
      const modelName = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
      const path = `v1beta/models/${encodeURIComponent(modelName)}:generateContent`;
      targetUrl = buildApiUrl(baseUrl, path);
      const urlObj = new URL(targetUrl);
      urlObj.searchParams.set('key', apiKey);
      targetUrl = urlObj.toString();
    }

    // DeepSeek Reasoner does not support the reasoning parameter
    const isDeepSeekReasoner = model.trim() === 'deepseek-reasoner';
    const effectiveRequestBody = (
      reasoningEffort
      && !isDeepSeekReasoner
      && typeof requestBody === 'object'
      && requestBody !== null
      && (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible' || apiType === 'deepseek' || apiType === 'mimo')
      && !('reasoning' in requestBody)
    )
      ? { ...requestBody, reasoning: { effort: reasoningEffort } }
      : requestBody;

    const timeout = apiType === 'openai-responses' || !!reasoningEffort ? 600000 : 60000;

    const proxyConfig = getProxyConfig();
    const result = await proxyRequest({
      url: targetUrl,
      method: 'POST',
      headers,
      body: effectiveRequestBody,
      timeout,
      proxyConfig,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    logger.errorFromError('proxy.ai', 'AI proxy error', err);
    res.status(500).json({ error: 'AI proxy failed', code: 'AI_PROXY_FAILED' });
  }
});

// POST /api/proxy/webdav
router.post('/api/proxy/webdav', async (req, res) => {
  try {
    const db = getDb();
    const { configId, method, path, body: requestBody, headers: extraHeaders } = req.body as {
      configId: string;
      method: string;
      path: string;
      body?: string;
      headers?: Record<string, string>;
    };

    if (!configId) {
      res.status(400).json({ error: 'configId required', code: 'CONFIG_ID_REQUIRED' });
      return;
    }

    const webdavConfig = db.prepare('SELECT * FROM webdav_configs WHERE id = ?').get(configId) as Record<string, unknown> | undefined;
    if (!webdavConfig) {
      res.status(404).json({ error: 'WebDAV config not found', code: 'WEBDAV_CONFIG_NOT_FOUND' });
      return;
    }

    const password = decrypt(webdavConfig.password_encrypted as string, config.encryptionKey);
    const username = webdavConfig.username as string;
    const baseUrl = webdavConfig.url as string;

    const targetUrl = `${baseUrl}${path}`;
    const credentials = Buffer.from(`${username}:${password}`).toString('base64');

    const { Authorization: _ignored, ...safeHeaders } = extraHeaders || {};
    const headers: Record<string, string> = {
      ...safeHeaders,
      'Authorization': `Basic ${credentials}`,
    };

    if (method === 'PROPFIND') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/xml';
    }

    const proxyConfig = getProxyConfig();
    const result = await proxyRequest({
      url: targetUrl,
      method,
      headers,
      body: requestBody,
      timeout: 60000,
      proxyConfig,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    logger.errorFromError('proxy.webdav', 'WebDAV proxy error', err);
    res.status(500).json({ error: 'WebDAV proxy failed', code: 'WEBDAV_PROXY_FAILED' });
  }
});

// POST /api/proxy/github/search/repositories
router.post('/api/proxy/github/search/repositories', async (req, res) => {
  try {
    const db = getDb();
    const githubPath = 'search/repositories';
    const { query_params } = req.body as { query_params?: Record<string, string> };

    const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined;
    if (!tokenRow?.value) {
      res.status(400).json({ error: 'GitHub token not configured', code: 'GITHUB_TOKEN_NOT_CONFIGURED' });
      return;
    }

    let token: string;
    try {
      token = decrypt(tokenRow.value, config.encryptionKey);
    } catch {
      res.status(500).json({ error: 'Failed to decrypt GitHub token', code: 'GITHUB_TOKEN_DECRYPT_FAILED' });
      return;
    }

    const queryString = query_params ? '?' + new URLSearchParams(query_params).toString() : '';
    const targetUrl = `https://api.github.com/${githubPath}${queryString}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GithubStarsManager-Backend',
    };

    const proxyConfig = getProxyConfig();
    const result = await proxyRequest({ url: targetUrl, method: 'GET', headers, proxyConfig });
    res.status(result.status).json(result.data);
  } catch (err) {
    logger.errorFromError('proxy.github.search', 'GitHub search repositories proxy error', err);
    res.status(500).json({ error: 'GitHub search proxy failed', code: 'GITHUB_SEARCH_PROXY_FAILED' });
  }
});

// POST /api/proxy/github/search/users
router.post('/api/proxy/github/search/users', async (req, res) => {
  try {
    const db = getDb();
    const githubPath = 'search/users';
    const { query_params } = req.body as { query_params?: Record<string, string> };

    const tokenRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('github_token') as { value: string } | undefined;
    if (!tokenRow?.value) {
      res.status(400).json({ error: 'GitHub token not configured', code: 'GITHUB_TOKEN_NOT_CONFIGURED' });
      return;
    }

    let token: string;
    try {
      token = decrypt(tokenRow.value, config.encryptionKey);
    } catch {
      res.status(500).json({ error: 'Failed to decrypt GitHub token', code: 'GITHUB_TOKEN_DECRYPT_FAILED' });
      return;
    }

    const queryString = query_params ? '?' + new URLSearchParams(query_params).toString() : '';
    const targetUrl = `https://api.github.com/${githubPath}${queryString}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'GithubStarsManager-Backend',
    };

    const proxyConfig = getProxyConfig();
    const result = await proxyRequest({ url: targetUrl, method: 'GET', headers, proxyConfig });
    res.status(result.status).json(result.data);
  } catch (err) {
    logger.errorFromError('proxy.github.search', 'GitHub search users proxy error', err);
    res.status(500).json({ error: 'GitHub search proxy failed', code: 'GITHUB_SEARCH_PROXY_FAILED' });
  }
});

// GET /api/settings/proxy
router.get('/api/settings/proxy', (_req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('proxy_config') as { value: string } | undefined;
    if (!row?.value) {
      res.json({ enabled: false, type: 'http', host: '', port: 7890 });
      return;
    }
    const parsed = JSON.parse(row.value);
    // Mask password - don't expose encrypted value
    if (parsed.password_encrypted) {
      parsed.hasPassword = true;
    }
    delete parsed.password_encrypted;
    delete parsed.password;
    res.json(parsed);
  } catch {
    res.json({ enabled: false, type: 'http', host: '', port: 7890 });
  }
});

// PUT /api/settings/proxy
router.put('/api/settings/proxy', (req, res) => {
  try {
    const db = getDb();
    const { enabled, type, host, port, username, password } = req.body;
    const passwordProvided = 'password' in req.body;

    const configToStore: Record<string, unknown> = { enabled, type, host, port, username };
    if (passwordProvided && password) {
      // New password provided - encrypt and store
      configToStore.password_encrypted = encrypt(password, config.encryptionKey);
    } else if (passwordProvided && !password) {
      // Explicitly empty password - clear stored secret
      // No password_encrypted field = no password
    } else {
      // Password field omitted - preserve existing encrypted password
      const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('proxy_config') as { value: string } | undefined;
      if (existing?.value) {
        try {
          const parsed = JSON.parse(existing.value);
          if (parsed.password_encrypted) {
            configToStore.password_encrypted = parsed.password_encrypted;
          }
        } catch { /* ignore */ }
      }
    }

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('proxy_config', JSON.stringify(configToStore));

    res.json({ success: true });
  } catch (err) {
    logger.errorFromError('proxy.settings', 'Failed to save proxy config', err);
    res.status(500).json({ error: 'Failed to save proxy config' });
  }
});

// POST /api/settings/proxy/test
router.post('/api/settings/proxy/test', async (req, res) => {
  try {
    const { host, port, type, username, password } = req.body;
    if (!host || !port) {
      res.json({ success: false, error: 'Host and port are required' });
      return;
    }

    const net = await import('net');
    type NetSocket = import('net').Socket;

    const connectToProxy = (): Promise<NetSocket> =>
      new Promise((resolve, reject) => {
        const socket = new net.Socket();
        socket.setTimeout(5000);
        socket.on('connect', () => resolve(socket));
        socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')); });
        socket.on('error', (err: Error) => reject(err));
        socket.connect(port, host);
      });

    let result: { success: boolean; error?: string };

    if (type === 'socks5') {
      // SOCKS5 protocol handshake test
      try {
        const socket = await connectToProxy();
        result = await new Promise((resolve) => {
          // Step 1: Send SOCKS5 greeting (version 5, 1 method, no-auth)
          const greeting = username
            ? Buffer.from([0x05, 0x02, 0x00, 0x02]) // no-auth + username/password
            : Buffer.from([0x05, 0x01, 0x00]);        // no-auth only

          socket.setTimeout(5000);
          socket.write(greeting);

          let step = 0;
          socket.on('data', (data: Buffer) => {
            if (step === 0) {
              // Step 2: Server selects auth method
              if (data[0] !== 0x05) {
                socket.destroy();
                resolve({ success: false, error: `Invalid SOCKS5 version: ${data[0]}` });
                return;
              }
              if (data[1] === 0xFF) {
                socket.destroy();
                resolve({ success: false, error: 'SOCKS5 server: no acceptable auth method' });
                return;
              }
              if (data[1] === 0x02 && username && password) {
                // Username/password auth
                step = 1;
                const userBuf = Buffer.from(username, 'utf8');
                const passBuf = Buffer.from(password, 'utf8');
                const authReq = Buffer.alloc(3 + userBuf.length + passBuf.length);
                authReq[0] = 0x01; // auth version
                authReq[1] = userBuf.length;
                userBuf.copy(authReq, 2);
                authReq[2 + userBuf.length] = passBuf.length;
                passBuf.copy(authReq, 3 + userBuf.length);
                socket.write(authReq);
              } else {
                // No-auth accepted, test passed
                socket.destroy();
                resolve({ success: true });
              }
            } else if (step === 1) {
              // Step 3: Auth response
              socket.destroy();
              if (data[0] === 0x01 && data[1] === 0x00) {
                resolve({ success: true });
              } else {
                resolve({ success: false, error: 'SOCKS5 authentication failed' });
              }
            }
          });

          socket.on('timeout', () => { socket.destroy(); resolve({ success: false, error: 'SOCKS5 handshake timeout' }); });
          socket.on('error', (err: Error) => { resolve({ success: false, error: err.message }); });
        });
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
      }
    } else {
      // HTTP proxy: send CONNECT request to verify it's a working proxy
      try {
        const socket = await connectToProxy();
        result = await new Promise((resolve) => {
          socket.setTimeout(5000);
          const authHeader = username && password
            ? `Proxy-Authorization: Basic ${Buffer.from(`${username}:${password}`).toString('base64')}\r\n`
            : '';
          const connectReq = `CONNECT httpbin.org:443 HTTP/1.1\r\nHost: httpbin.org:443\r\n${authHeader}\r\n`;
          socket.write(connectReq);

          let responseData = '';
          socket.on('data', (data: Buffer) => {
            responseData += data.toString();
            // Wait for end of HTTP headers
            if (responseData.includes('\r\n\r\n')) {
              socket.destroy();
              if (responseData.includes('200')) {
                resolve({ success: true });
              } else if (responseData.includes('407')) {
                resolve({ success: false, error: 'Proxy authentication required' });
              } else {
                const statusLine = responseData.split('\r\n')[0] || 'Unknown';
                resolve({ success: false, error: `Proxy rejected CONNECT: ${statusLine}` });
              }
            }
          });

          socket.on('timeout', () => { socket.destroy(); resolve({ success: false, error: 'HTTP proxy handshake timeout' }); });
          socket.on('error', (err: Error) => { resolve({ success: false, error: err.message }); });
        });
      } catch (err) {
        result = { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
      }
    }

    res.json(result);
  } catch (err) {
    res.json({ success: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// --- RPC Download endpoints ---

function getRpcDownloadConfig(): { host: string; port: number; secret: string } | null {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rpc_download_config') as { value: string } | undefined;
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value);
    if (parsed && parsed.enabled && parsed.host && parsed.port) {
      let secret = '';
      if (parsed.secret_encrypted) {
        secret = decrypt(parsed.secret_encrypted, config.encryptionKey);
      }
      return { host: parsed.host, port: parsed.port, secret };
    }
    return null;
  } catch {
    return null;
  }
}

// GET /api/settings/rpc-download
router.get('/api/settings/rpc-download', (_req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('rpc_download_config') as { value: string } | undefined;
    if (!row?.value) {
      res.json({ enabled: false, host: '', port: 6800 });
      return;
    }
    const parsed = JSON.parse(row.value);
    if (parsed.secret_encrypted) {
      parsed.hasSecret = true;
    }
    delete parsed.secret_encrypted;
    delete parsed.secret;
    res.json(parsed);
  } catch {
    res.json({ enabled: false, host: '', port: 6800 });
  }
});

// PUT /api/settings/rpc-download
router.put('/api/settings/rpc-download', (req, res) => {
  try {
    const db = getDb();
    const { enabled, host, port, secret } = req.body;
    const secretProvided = 'secret' in req.body;

    const configToStore: Record<string, unknown> = { enabled, host, port };
    if (secretProvided && secret) {
      configToStore.secret_encrypted = encrypt(secret, config.encryptionKey);
    } else if (secretProvided && !secret) {
      // Explicitly empty secret - clear stored secret
    } else {
      // Secret field omitted - preserve existing encrypted secret
      const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('rpc_download_config') as { value: string } | undefined;
      if (existing?.value) {
        try {
          const parsed = JSON.parse(existing.value);
          if (parsed.secret_encrypted) {
            configToStore.secret_encrypted = parsed.secret_encrypted;
          }
        } catch { /* ignore */ }
      }
    }

    db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
      .run('rpc_download_config', JSON.stringify(configToStore));

    res.json({ success: true });
  } catch (err) {
    logger.errorFromError('rpc.settings', 'Failed to save RPC download config', err);
    res.status(500).json({ error: 'Failed to save RPC download config' });
  }
});

// Helper: fetch with timeout using AbortController (compatible with older Node)
async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 5000, ...fetchInit } = init;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchInit, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// POST /api/settings/rpc-download/test
router.post('/api/settings/rpc-download/test', async (req, res) => {
  const { host, port, secret: requestSecret } = req.body;
  if (!host || !port) {
    res.json({ success: false, error: 'Host and port are required' });
    return;
  }

  // Fall back to stored secret only when field is omitted, not when empty
  const secretProvided = Object.prototype.hasOwnProperty.call(req.body, 'secret');
  let secret = secretProvided ? requestSecret : undefined;
  if (!secretProvided) {
    const stored = getRpcDownloadConfig();
    if (stored && stored.secret) {
      secret = stored.secret;
    }
  }

  try {
    const rpcUrl = `http://${host}:${port}/jsonrpc`;
    const params = secret ? [`token:${secret}`] : [];

    logger.info('rpc.test', `Testing connection to ${host}:${port}`);

    const response = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'test',
        method: 'aria2.getVersion',
        params,
      }),
      timeoutMs: 5000,
    });

    if (!response.ok) {
      logger.warn('rpc.test', `aria2 returned HTTP ${response.status}`);
      res.json({ success: false, error: `aria2 returned HTTP ${response.status}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.error) {
      const error = data.error as { message?: string };
      logger.warn('rpc.test', 'aria2 RPC error', error);
      res.json({ success: false, error: error.message || 'RPC error' });
      return;
    }
    const result = data.result as Record<string, unknown> | undefined;
    logger.info('rpc.test', `Connected to aria2 v${result?.version || 'unknown'}`);
    res.json({
      success: true,
      version: result?.version || 'unknown',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isConnRefused = message.includes('ECONNREFUSED') || message.includes('fetch failed');
    const errorMsg = isAbort
      ? `Connection timeout (${host}:${port})`
      : isConnRefused
        ? 'RPC service not running'
        : message;
    logger.errorFromError('rpc.test', `Test connection failed: ${errorMsg}`, err, { host, port });
    res.json({ success: false, error: errorMsg });
  }
});

// POST /api/download/rpc
router.post('/api/download/rpc', async (req, res) => {
  const rpcConfig = getRpcDownloadConfig();
  if (!rpcConfig) {
    res.status(400).json({ success: false, error: 'RPC download not configured or disabled' });
    return;
  }

  try {
    const { url, filename } = req.body;
    if (!url) {
      res.status(400).json({ success: false, error: 'URL is required' });
      return;
    }

    // SSRF protection: validate the download URL
    try {
      validateUrl(url);
    } catch (e) {
      res.status(400).json({ success: false, error: e instanceof Error ? e.message : 'Invalid URL' });
      return;
    }

    const rpcUrl = `http://${rpcConfig.host}:${rpcConfig.port}/jsonrpc`;
    const params: unknown[] = rpcConfig.secret
      ? [`token:${rpcConfig.secret}`, [url]]
      : [[url]];
    if (filename) {
      params.push({ out: filename });
    }

    logger.info('rpc.download', `Sending to aria2: ${filename || url}`);

    const response = await fetchWithTimeout(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'download',
        method: 'aria2.addUri',
        params,
      }),
      timeoutMs: 10000,
    });

    if (!response.ok) {
      logger.warn('rpc.download', `aria2 returned HTTP ${response.status}`);
      res.json({ success: false, error: `aria2 returned HTTP ${response.status}` });
      return;
    }

    const data = await response.json() as Record<string, unknown>;
    if (data.error) {
      const error = data.error as { message?: string };
      logger.warn('rpc.download', 'aria2 RPC error', error);
      res.json({ success: false, error: error.message || 'RPC error' });
      return;
    }
    logger.info('rpc.download', `Download queued, GID: ${data.result}`);
    res.json({ success: true, gid: data.result });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Connection failed';
    const isAbort = err instanceof Error && err.name === 'AbortError';
    const isConnRefused = message.includes('ECONNREFUSED') || message.includes('fetch failed');
    const errorMsg = isAbort
      ? `Connection timeout (${rpcConfig?.host}:${rpcConfig?.port})`
      : isConnRefused
        ? 'RPC service not running'
        : message;
    logger.errorFromError('rpc.download', `Download failed: ${errorMsg}`, err);
    res.json({ success: false, error: errorMsg });
  }
});

export default router;
