import type { Express, Request, Response, NextFunction } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './server.js';
import {
  getMcpTokenPlain,
  isMcpEnabled,
  timingSafeEqualString,
} from './settings.js';
import { logger } from '../services/logger.js';

/** Legacy SSE transports keyed by session id (cleaned on connection close). */
const sseSessions = new Map<string, SSEServerTransport>();

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  const alt = req.headers['x-mcp-token'];
  if (typeof alt === 'string' && alt.trim()) return alt.trim();
  return null;
}

/**
 * Live config gate: read enabled + token from SQLite on every request so toggles
 * take effect without restart. No module-level server or cached token.
 */
export function mcpAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (!isMcpEnabled()) {
    // 404 when disabled — do not advertise MCP surface
    res.status(404).json({ error: 'not found', code: 'MCP_DISABLED' });
    return;
  }

  const expected = getMcpTokenPlain();
  if (!expected) {
    res.status(503).json({ error: 'MCP token not configured', code: 'MCP_TOKEN_MISSING' });
    return;
  }

  const provided = extractBearer(req);
  if (!provided || !timingSafeEqualString(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized', code: 'MCP_UNAUTHORIZED' });
    return;
  }

  next();
}

/**
 * Stateless Streamable HTTP: new transport + McpServer per request.
 * Avoids unbounded session maps and ensures tools/list reflects live vector config.
 */
async function handleStreamable(req: Request, res: Response): Promise<void> {
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on('close', () => {
      void transport.close().catch(() => undefined);
    });
    const server = createMcpServer();
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    logger.errorFromError('mcp.streamable', 'Streamable HTTP request failed', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP request failed' });
    }
  }
}

/** Shared SSE connect + cleanup so all SSE entrypoints close transport on disconnect. */
async function connectSse(messagesPath: string, res: Response): Promise<void> {
  const transport = new SSEServerTransport(messagesPath, res);
  sseSessions.set(transport.sessionId, transport);
  res.on('close', () => {
    sseSessions.delete(transport.sessionId);
    const maybeClose = (transport as { close?: () => Promise<void> }).close;
    if (typeof maybeClose === 'function') {
      void maybeClose.call(transport).catch(() => undefined);
    }
  });
  const server = createMcpServer();
  await server.connect(transport);
}

async function handleSseMessage(req: Request, res: Response): Promise<void> {
  const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
  const transport = sseSessions.get(sessionId);
  if (!transport) {
    res.status(404).json({ error: 'unknown session', code: 'MCP_UNKNOWN_SESSION' });
    return;
  }
  try {
    await transport.handlePostMessage(req, res, req.body);
  } catch (err) {
    logger.errorFromError('mcp.sse', 'SSE message failed', err);
    if (!res.headersSent) res.status(500).json({ error: 'SSE message failed' });
  }
}

/**
 * Mount MCP Streamable HTTP (/mcp) and legacy SSE (/mcp/sse + /mcp/sse/messages).
 * Auth uses MCP token (not API_SECRET). Config is read per request — no token write on mount.
 *
 * Stateless Streamable HTTP is POST-only (SDK guidance): GET/DELETE return 405 so clients
 * do not open orphan SSE streams on /mcp. Use /mcp/sse for legacy SSE.
 */
export function mountMcpRoutes(app: Express): void {
  app.post('/mcp', mcpAuthMiddleware, (req, res) => {
    void handleStreamable(req, res);
  });
  app.get('/mcp', mcpAuthMiddleware, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. Use POST for Streamable HTTP or GET /mcp/sse for legacy SSE.' },
      id: null,
    });
  });
  app.delete('/mcp', mcpAuthMiddleware, (_req, res) => {
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    });
  });

  app.get('/mcp/sse', mcpAuthMiddleware, async (_req, res) => {
    try {
      await connectSse('/mcp/sse/messages', res);
    } catch (err) {
      logger.errorFromError('mcp.sse', 'SSE connection failed', err);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post('/mcp/sse/messages', mcpAuthMiddleware, (req, res) => {
    void handleSseMessage(req, res);
  });

  // Backward-compatible aliases (older docs / clients)
  app.get('/sse', mcpAuthMiddleware, async (_req, res) => {
    try {
      await connectSse('/messages', res);
    } catch (err) {
      logger.errorFromError('mcp.sse', 'SSE connection failed', err);
      if (!res.headersSent) res.status(500).end();
    }
  });

  app.post('/messages', mcpAuthMiddleware, (req, res) => {
    void handleSseMessage(req, res);
  });

  logger.info(
    'mcp.mount',
    'MCP routes registered at /mcp (Streamable HTTP) and /mcp/sse (legacy); gated by settings'
  );
}
