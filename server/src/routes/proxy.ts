import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { proxyRequest } from '../services/proxyService.js';

const router = Router();

// Helper: build API URL handling baseUrl already ending in version prefix
function buildApiUrl(baseUrl: string, pathWithVersion: string): string {
  const baseUrlWithSlash = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const versionPrefix = pathWithVersion.split('/')[0] || '';

  try {
    const base = new URL(baseUrlWithSlash);
    const basePath = base.pathname.replace(/\/$/, '');

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

    const result = await proxyRequest({ url: targetUrl, method, headers });
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('GitHub proxy error:', err);
    res.status(500).json({ error: 'GitHub proxy failed', code: 'GITHUB_PROXY_FAILED' });
  }
});

// POST /api/proxy/ai
router.post('/api/proxy/ai', async (req, res) => {
  try {
    const db = getDb();
    const { configId, body: requestBody } = req.body as { configId: string; body: Record<string, unknown> };

    if (!configId) {
      res.status(400).json({ error: 'configId required', code: 'CONFIG_ID_REQUIRED' });
      return;
    }

    const aiConfig = db.prepare('SELECT * FROM ai_configs WHERE id = ?').get(configId) as Record<string, unknown> | undefined;
    if (!aiConfig) {
      res.status(404).json({ error: 'AI config not found', code: 'AI_CONFIG_NOT_FOUND' });
      return;
    }

    const apiKey = decrypt(aiConfig.api_key_encrypted as string, config.encryptionKey);
    const apiType = (aiConfig.api_type as string) || 'openai';
    const baseUrl = aiConfig.base_url as string;
    const model = aiConfig.model as string;

    let targetUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (apiType === 'openai') {
      targetUrl = buildApiUrl(baseUrl, 'v1/chat/completions');
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

    const result = await proxyRequest({
      url: targetUrl,
      method: 'POST',
      headers,
      body: requestBody,
      timeout: 60000,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('AI proxy error:', err);
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

    const headers: Record<string, string> = {
      'Authorization': `Basic ${credentials}`,
      ...(extraHeaders || {}),
    };

    if (method === 'PROPFIND') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/xml';
    }

    const result = await proxyRequest({
      url: targetUrl,
      method,
      headers,
      body: requestBody,
      timeout: 60000,
    });

    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('WebDAV proxy error:', err);
    res.status(500).json({ error: 'WebDAV proxy failed', code: 'WEBDAV_PROXY_FAILED' });
  }
});

export default router;
