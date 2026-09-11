import { Router } from 'express';
import {
  ensureMcpToken,
  getMcpTokenPlain,
  isMcpEnabled,
  resetMcpToken,
  setMcpEnabled,
} from '../mcp/settings.js';
import { getVectorAvailability } from '../mcp/provider.js';
import { logger } from '../services/logger.js';

const router = Router();

/**
 * GET /api/mcp/status
 * Protected by existing API_SECRET auth (via /api middleware).
 * Token is returned in full for owner UI (viewable anytime) when present.
 * Mint only when enabled and missing — never rotates an existing token.
 */
router.get('/api/mcp/status', async (_req, res) => {
  try {
    const enabled = await isMcpEnabled();
    // Only mint when already enabled and no token exists yet (first enable path)
    let token = (await getMcpTokenPlain()) || '';
    if (enabled && !token) {
      token = await ensureMcpToken();
    }
    const vector = await getVectorAvailability();
    res.json({
      enabled,
      token,
      endpoints: {
        streamableHttp: '/mcp',
        sse: '/mcp/sse',
        messages: '/mcp/sse/messages',
      },
      vectorAvailable: vector.available,
      vectorReason: vector.reason ?? null,
    });
  } catch (err) {
    logger.errorFromError('mcp.status', 'GET /api/mcp/status failed', err);
    res.status(500).json({ error: 'Failed to get MCP status', code: 'MCP_STATUS_FAILED' });
  }
});

/**
 * PUT /api/mcp/config
 * body: { enabled?: boolean, resetToken?: boolean }
 */
router.put('/api/mcp/config', async (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      enabled?: boolean;
      resetToken?: boolean;
    };

    if (typeof body.enabled === 'boolean') {
      await setMcpEnabled(body.enabled);
      if (body.enabled) {
        await ensureMcpToken();
      }
    }

    let token = await getMcpTokenPlain();
    // Only mint/reset when MCP is (or remains) enabled — never create tokens while disabled
    if (body.resetToken) {
      if (!(await isMcpEnabled())) {
        res.status(400).json({
          error: 'Cannot reset token while MCP is disabled',
          code: 'MCP_DISABLED',
        });
        return;
      }
      token = await resetMcpToken();
    } else if (await isMcpEnabled() && !token) {
      token = await ensureMcpToken();
    }

    res.json({
      enabled: await isMcpEnabled(),
      token: token || '',
      endpoints: {
        streamableHttp: '/mcp',
        sse: '/mcp/sse',
        messages: '/mcp/sse/messages',
      },
    });
  } catch (err) {
    logger.errorFromError('mcp.config', 'PUT /api/mcp/config failed', err);
    res.status(500).json({ error: 'Failed to update MCP config', code: 'MCP_CONFIG_FAILED' });
  }
});

export default router;
