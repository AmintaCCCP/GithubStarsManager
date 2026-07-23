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
 * Does not create a token until MCP has been enabled at least once.
 */
router.get('/api/mcp/status', (_req, res) => {
  try {
    const enabled = isMcpEnabled();
    // Only mint a token when already enabled (or one already exists)
    let token = getMcpTokenPlain() || '';
    if (enabled && !token) {
      token = ensureMcpToken();
    }
    const vector = getVectorAvailability();
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
router.put('/api/mcp/config', (req, res) => {
  try {
    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      enabled?: boolean;
      resetToken?: boolean;
    };

    if (typeof body.enabled === 'boolean') {
      setMcpEnabled(body.enabled);
      if (body.enabled) {
        ensureMcpToken();
      }
    }

    let token = getMcpTokenPlain();
    if (body.resetToken) {
      token = resetMcpToken();
    } else if (isMcpEnabled() && !token) {
      token = ensureMcpToken();
    }

    res.json({
      enabled: isMcpEnabled(),
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
