import { Router, type Request } from 'express';
import {
  ensureMcpToken,
  getMcpTokenPlain,
  isMcpEnabled,
  resetMcpToken,
  setMcpEnabled,
} from '../mcp/settings.js';
import { isValidProfileId } from '../db/connection.js';
import { getVectorAvailability } from '../mcp/provider.js';
import { logger } from '../services/logger.js';

const router = Router();

function buildMcpEndpoints(req: Request): { streamableHttp: string; sse: string; messages: string } {
  const profileHeader = req.header('X-GSM-Profile')?.trim();
  const query =
    profileHeader && profileHeader !== 'default' && isValidProfileId(profileHeader)
      ? `?profile=${encodeURIComponent(profileHeader)}`
      : '';
  return {
    streamableHttp: `/mcp${query}`,
    sse: `/mcp/sse${query}`,
    messages: `/mcp/sse/messages${query}`,
  };
}

/**
 * GET /api/mcp/status
 * Protected by existing API_SECRET auth (via /api middleware).
 * Token is returned in full for owner UI (viewable anytime) when present.
 * Mint only when enabled and missing — never rotates an existing token.
 */
router.get('/api/mcp/status', (req, res) => {
  try {
    const enabled = isMcpEnabled();
    // Only mint when already enabled and no token exists yet (first enable path)
    let token = getMcpTokenPlain() || '';
    if (enabled && !token) {
      token = ensureMcpToken();
    }
    const vector = getVectorAvailability();
    res.json({
      enabled,
      token,
      endpoints: buildMcpEndpoints(req),
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
    // Only mint/reset when MCP is (or remains) enabled — never create tokens while disabled
    if (body.resetToken) {
      if (!isMcpEnabled()) {
        res.status(400).json({
          error: 'Cannot reset token while MCP is disabled',
          code: 'MCP_DISABLED',
        });
        return;
      }
      token = resetMcpToken();
    } else if (isMcpEnabled() && !token) {
      token = ensureMcpToken();
    }

    res.json({
      enabled: isMcpEnabled(),
      token: token || '',
      endpoints: buildMcpEndpoints(req),
    });
  } catch (err) {
    logger.errorFromError('mcp.config', 'PUT /api/mcp/config failed', err);
    res.status(500).json({ error: 'Failed to update MCP config', code: 'MCP_CONFIG_FAILED' });
  }
});

export default router;
