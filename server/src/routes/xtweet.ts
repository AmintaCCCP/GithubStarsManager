import { Router } from 'express';
import { logger } from '../services/logger.js';

/**
 * X 推文频道：服务端代抓 x.com 未登录主页 HTML，以及鉴权路径的
 * GraphQL / 静态资源代理。
 * 浏览器渲染进程受 CORS 限制无法直连 x.com，桌面端走 Electron 主进程 IPC，
 * 服务端（fullstack）部署走本路由。只抓固定的 https://x.com/<handle>，
 * handle 严格校验，不透传任意 URL。
 *
 * 鉴权路径（POST /api/xtweet/graphql）：用户在设置中填写自己的
 * auth_token/ct0 Cookie，本路由逐请求转发（不落库），带公共 Web Bearer 与
 * Cookie 代发 GET；仅允许 x.com 与 abs.twimg.com 两个主机名。
 */
const X_HANDLE_PATTERN = /^[A-Za-z0-9_]{1,15}$/;
// 鉴权代抓仅允许受控操作对应的 URL（调用方不可任意指定 x.com 路径）：
// 首页（queryId 提取入口）、abs.twimg.com 主脚本（绝不附带 X Cookie）、
// GraphQL UserTweets / UserByScreenName（queryId 动态，操作名固定）。
const X_HOME_URL = 'https://x.com/home';
const X_MAIN_JS_PATTERN = /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-f0-9]+\.js$/;
const X_GRAPHQL_API_PATTERN = /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(UserTweets|UserByScreenName)(\?.*)?$/;
const isAllowedXProxyUrl = (url: string): boolean =>
  url === X_HOME_URL || X_MAIN_JS_PATTERN.test(url) || X_GRAPHQL_API_PATTERN.test(url);
const X_COOKIE_VALUE_PATTERN = /^[\w%+/=-]+$/;
const X_WEB_BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const router: Router = Router();

router.get('/api/xtweet/profile/:handle', async (req, res) => {
  const { handle } = req.params;
  if (typeof handle !== 'string' || !X_HANDLE_PATTERN.test(handle)) {
    res.status(400).json({ error: 'invalid handle', code: 'INVALID_HANDLE' });
    return;
  }
  try {
    const response = await fetch(`https://x.com/${handle}`, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) {
      logger.warn('xtweet', `x.com responded ${response.status} for @${handle}`);
      res.status(502).json({ error: `x.com responded ${response.status}`, code: 'UPSTREAM_ERROR' });
      return;
    }
    const html = await response.text();
    res.json({ html });
  } catch (error) {
    logger.warn('xtweet', `fetch failed for @${handle}`, error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'fetch failed',
      code: 'UPSTREAM_ERROR',
    });
  }
});

router.post('/api/xtweet/graphql', async (req, res) => {
  const url = typeof req.body?.url === 'string' ? req.body.url : '';
  const authToken = typeof req.body?.auth?.authToken === 'string' ? req.body.auth.authToken.trim() : '';
  const ct0 = typeof req.body?.auth?.ct0 === 'string' ? req.body.auth.ct0.trim() : '';
  if (!isAllowedXProxyUrl(url)) {
    res.status(400).json({ error: 'invalid url', code: 'INVALID_URL' });
    return;
  }
  if (!authToken || !ct0 || !X_COOKIE_VALUE_PATTERN.test(authToken) || !X_COOKIE_VALUE_PATTERN.test(ct0)) {
    res.status(400).json({ error: 'invalid auth cookies', code: 'INVALID_AUTH' });
    return;
  }
  try {
    // GraphQL API 请求带 Bearer/CSRF 等专有头；HTML 页面与静态资源带这些头
    // 反而被 x.com 拒 401（实测），只发 UA + Cookie
    const isApiCall = url.startsWith('https://x.com/i/api/');
    const headers: Record<string, string> = isApiCall
      ? {
          'User-Agent': BROWSER_UA,
          'Accept': '*/*',
          'Authorization': `Bearer ${X_WEB_BEARER}`,
          'X-CSRF-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
        }
      : {
          'User-Agent': BROWSER_UA,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          ...(url.startsWith('https://x.com/') ? { 'Cookie': `auth_token=${authToken}; ct0=${ct0}` } : {}),
        };
    // redirect: 'error' — 拒绝跨域重定向，避免 Cookie 被转到允许域名之外
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'error',
    });
    if (typeof response.url === 'string' && response.url && !isAllowedXProxyUrl(response.url)) {
      res.status(400).json({ error: 'redirect blocked', code: 'INVALID_URL' });
      return;
    }
    if (!response.ok) {
      logger.warn('xtweet', `x.com graphql responded ${response.status} for ${new URL(url).hostname}`);
      res.status(502).json({
        error: `x.com responded ${response.status}`,
        code: 'UPSTREAM_ERROR',
        upstreamStatus: response.status,
      });
      return;
    }
    const body = await response.text();
    res.json({ body });
  } catch (error) {
    logger.warn('xtweet', 'graphql proxy fetch failed', error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'fetch failed',
      code: 'UPSTREAM_ERROR',
    });
  }
});

export default router;
