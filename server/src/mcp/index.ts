import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { getDb } from '../db/connection.js';
import { decrypt } from '../services/crypto.js';
import { config } from '../config.js';
import { logger } from '../services/logger.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { createMcpServer } from './server.js';
import { SqliteMcpProvider } from './sqliteProvider.js';

function extractBearer(req: Request): string {
  const header = req.headers['authorization'] ?? '';
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    return header.slice(7).trim();
  }
  return '';
}

// Constant-time comparison to avoid timing attacks on the MCP bearer token
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

interface McpState {
  db: ReturnType<typeof getDb>;
  token: string;
  vectorEnabled: boolean;
}

/**
 * Resolve the live MCP configuration from the database on every call. This keeps a
 * single Express mount stable across config updates (no restart, no stale module-level
 * server or cached token) and lets config edits take effect on the next request.
 * Returns null when MCP is disabled or has no usable token.
 */
function loadMcpState(): McpState | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM mcp_configs WHERE id = ?').get('default') as
    | Record<string, unknown>
    | undefined;
  if (!row || !row.enabled) return null;

  let token = '';
  if (row.token_encrypted) {
    try {
      token = decrypt(row.token_encrypted as string, config.encryptionKey);
    } catch {
      token = '';
    }
  }
  if (!token) return null;

  const vsRow = db
    .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
    .get('default') as Record<string, unknown> | undefined;
  const vectorEnabled = !!(
    vsRow &&
    vsRow.enabled &&
    vsRow.worker_url &&
    vsRow.embedding_config_id
  );
  return { db, token, vectorEnabled };
}

function unauthorized(res: Response): void {
  res.status(401).json({ error: 'unauthorized' });
}

/** Build a fresh, isolated McpServer per request/connection. */
function buildServer(state: McpState): ReturnType<typeof createMcpServer> {
  const provider = new SqliteMcpProvider(state.db);
  return createMcpServer(provider, state.vectorEnabled);
}

/**
 * Mount the MCP server (Streamable HTTP at /mcp, SSE fallback at /mcp/sse) onto the
 * Express app. Mounts unconditionally, but each request is gated on the live config —
 * existing routes and /api auth are untouched.
 */
export function initMcp(app: Express): void {
  try {
    // Transports for in-flight SSE connections, keyed by session id.
    const sseTransports = new Map<string, SSEServerTransport>();

    // ── Streamable HTTP (primary, MCP 2025 spec) ──
    app.all('/mcp', async (req, res) => {
      const state = loadMcpState();
      if (!state) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (!tokenMatches(extractBearer(req), state.token)) {
        unauthorized(res);
        return;
      }
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          transport.close().catch(() => undefined);
        });
        const server = buildServer(state);
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        logger.errorFromError('mcp.streamable', 'Streamable HTTP error', err as Error);
        if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      }
    });

    // ── SSE fallback (for clients not yet supporting Streamable HTTP) ──
    app.get('/mcp/sse', async (req, res) => {
      const state = loadMcpState();
      if (!state) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (!tokenMatches(extractBearer(req), state.token)) {
        unauthorized(res);
        return;
      }
      try {
        const transport = new SSEServerTransport('/mcp/sse/messages', res);
        sseTransports.set(transport.sessionId, transport);
        res.on('close', () => {
          sseTransports.delete(transport.sessionId);
        });
        const server = buildServer(state);
        await server.connect(transport);
        await transport.start();
      } catch (err) {
        logger.errorFromError('mcp.sse', 'SSE connection error', err as Error);
        if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      }
    });

    app.post('/mcp/sse/messages', async (req, res) => {
      const state = loadMcpState();
      if (!state) {
        res.status(404).json({ error: 'not found' });
        return;
      }
      if (!tokenMatches(extractBearer(req), state.token)) {
        unauthorized(res);
        return;
      }
      const sessionId = req.query.sessionId as string | undefined;
      const transport = sessionId ? sseTransports.get(sessionId) : undefined;
      if (!transport) {
        res.status(404).json({ error: 'unknown session' });
        return;
      }
      try {
        await transport.handlePostMessage(req, res, req.body);
      } catch (err) {
        logger.errorFromError('mcp.sseMsg', 'SSE message error', err as Error);
        if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      }
    });

    logger.info('mcp.init', 'MCP server mount registered (config read per request)');
  } catch (err) {
    logger.errorFromError('mcp.init', 'Failed to init MCP server', err as Error);
  }
}
