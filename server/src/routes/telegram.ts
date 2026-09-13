import { Router } from 'express';
import { logger } from '../services/logger.js';

/**
 * Telegram 频道：服务端代抓 t.me/s/<name> 公开网页预览 HTML。
 * 与 X 推文频道同构：浏览器渲染进程受 CORS 限制无法直连 t.me，桌面端走
 * Electron 主进程 IPC，服务端（fullstack）部署走本路由。只抓公开预览页
 * https://t.me/s/<name>（可选 ?before=<id> 向历史翻页），name 严格校验，
 * 不透传任意 URL。
 */
const TG_CHANNEL_PATTERN = /^[A-Za-z0-9_]{3,64}$/;
const BEFORE_PATTERN = /^\d{1,20}$/;
const FETCH_TIMEOUT_MS = 20_000;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const router: Router = Router();

router.get('/api/telegram/channel/:channel', async (req, res) => {
  const { channel } = req.params;
  if (typeof channel !== 'string' || !TG_CHANNEL_PATTERN.test(channel)) {
    res.status(400).json({ error: 'invalid channel', code: 'INVALID_CHANNEL' });
    return;
  }
  const before = typeof req.query.before === 'string' ? req.query.before : '';
  if (before && !BEFORE_PATTERN.test(before)) {
    res.status(400).json({ error: 'invalid before cursor', code: 'INVALID_BEFORE' });
    return;
  }
  try {
    const url = before
      ? `https://t.me/s/${channel}?before=${before}`
      : `https://t.me/s/${channel}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!response.ok) {
      logger.warn('telegram', `t.me responded ${response.status} for @${channel}`);
      res.status(502).json({ error: `t.me responded ${response.status}`, code: 'UPSTREAM_ERROR' });
      return;
    }
    const html = await response.text();
    res.json({ html });
  } catch (error) {
    logger.warn('telegram', `fetch failed for @${channel}`, error);
    res.status(502).json({
      error: error instanceof Error ? error.message : 'fetch failed',
      code: 'UPSTREAM_ERROR',
    });
  }
});

export default router;
