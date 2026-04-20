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
    const reasoningEffort = aiConfig.reasoning_effort === 'minimal'
      ? 'low'
      : aiConfig.reasoning_effort as string | null | undefined;

    let targetUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (apiType === 'openai' || apiType === 'openai-responses') {
      targetUrl = buildApiUrl(baseUrl, apiType === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions');
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

    const effectiveRequestBody = (
      reasoningEffort
      && typeof requestBody === 'object'
      && requestBody !== null
      && (apiType === 'openai' || apiType === 'openai-responses')
      && !('reasoning' in requestBody)
    )
      ? { ...requestBody, reasoning: { effort: reasoningEffort } }
      : requestBody;

    const timeout = apiType === 'openai-responses' || !!reasoningEffort ? 600000 : 60000;

    const result = await proxyRequest({
      url: targetUrl,
      method: 'POST',
      headers,
      body: effectiveRequestBody,
      timeout,
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

    const { Authorization: _ignored, ...safeHeaders } = extraHeaders || {};
    const headers: Record<string, string> = {
      ...safeHeaders,
      'Authorization': `Basic ${credentials}`,
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

    const result = await proxyRequest({ url: targetUrl, method: 'GET', headers });
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('GitHub search repositories proxy error:', err);
    res.status(500).json({ error: 'GitHub search proxy failed', code: 'GITHUB_SEARCH_PROXY_FAILED' });
  }
});

// POST /api/proxy/github/trending
router.post('/api/proxy/github/trending', async (req, res) => {
  try {
    const { since = 'daily', language } = req.body as { since?: string; language?: string };
    
    // 构建请求 URL
    let url = 'https://github.com/trending';
    if (language) {
      url += `/${encodeURIComponent(language)}`;
    }
    url += `?since=${since}`;
    
    const headers: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
    
    const result = await proxyRequest({ url, method: 'GET', headers });
    
    // 解析 HTML 提取 trending 数据
    if (result.status === 200 && typeof result.data === 'string') {
      const repos = parseTrendingHtml(result.data);
      res.json(repos);
    } else {
      res.status(result.status).json(result.data);
    }
  } catch (err) {
    console.error('GitHub trending proxy error:', err);
    res.status(500).json({ error: 'GitHub trending proxy failed', code: 'GITHUB_TRENDING_PROXY_FAILED' });
  }
});

// 解析 GitHub Trending HTML 页面
function parseTrendingHtml(html: string): Array<{
  name: string;
  owner: string;
  full_name: string;
  html_url: string;
  description: string;
  language: string | null;
  language_color: string | null;
  stars: number;
  forks: number;
  stars_today: number;
  since: string;
}> {
  const repos: Array<{
    name: string;
    owner: string;
    full_name: string;
    html_url: string;
    description: string;
    language: string | null;
    language_color: string | null;
    stars: number;
    forks: number;
    stars_today: number;
    since: string;
  }> = [];
  
  // 简单的正则匹配解析 (生产环境应该用 cheerio 等库)
  const articleRegex = /<article[^>]*class="[^"]*Box-row[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  
  while ((match = articleRegex.exec(html)) !== null) {
    const article = match[1];
    
    // 提取 repo 名称和链接
    const repoLinkMatch = article.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="\/([^"/]+)\/([^"/]+)"[^>]*>/i);
    if (!repoLinkMatch) continue;
    
    const owner = repoLinkMatch[1].trim();
    const name = repoLinkMatch[2].trim();
    const full_name = `${owner}/${name}`;
    const html_url = `https://github.com/${owner}/${name}`;
    
    // 提取描述
    const descMatch = article.match(/<p[^>]*class="[^"]*col-9[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const description = descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '';
    
    // 提取语言
    const langMatch = article.match(/<span[^>]*itemprop="programmingLanguage"[^>]*>([^<]+)<\/span>/i);
    const language = langMatch ? langMatch[1].trim() : null;
    
    // 提取语言颜色
    const colorMatch = article.match(/<span[^>]*class="[^"]*repo-language-color[^"]*"[^>]*style="background-color:\s*([^;"]+)/i);
    const language_color = colorMatch ? colorMatch[1].trim() : null;
    
    // 提取 star 数
    const starsMatch = article.match(/<a[^>]*href="[^"]*\/stargazers"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/i);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0;
    
    // 提取 fork 数
    const forksMatch = article.match(/<a[^>]*href="[^"]*\/forks"[^>]*>[\s\S]*?<\/svg>\s*([\d,]+)/i);
    const forks = forksMatch ? parseInt(forksMatch[1].replace(/,/g, ''), 10) : 0;
    
    // 提取今日新增 star
    const starsTodayMatch = article.match(/([\d,]+)\s*stars\s*today/i);
    const stars_today = starsTodayMatch ? parseInt(starsTodayMatch[1].replace(/,/g, ''), 10) : 0;
    
    repos.push({
      name,
      owner,
      full_name,
      html_url,
      description,
      language,
      language_color,
      stars,
      forks,
      stars_today,
      since: 'daily',
    });
  }
  
  return repos;
}

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

    const result = await proxyRequest({ url: targetUrl, method: 'GET', headers });
    res.status(result.status).json(result.data);
  } catch (err) {
    console.error('GitHub search users proxy error:', err);
    res.status(500).json({ error: 'GitHub search proxy failed', code: 'GITHUB_SEARCH_PROXY_FAILED' });
  }
});

export default router;
