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

/**
 * Mount the MCP server (Streamable HTTP at /mcp, SSE fallback at /mcp/sse) onto the
 * Express app. No-op unless MCP is enabled AND a token is configured — existing routes
 * and /api auth are untouched.
 */
export function initMcp(app: Express): void {
  try {
    const db = getDb();
    const row = db.prepare('SELECT * FROM mcp_configs WHERE id = ?').get('default') as
      | Record<string, unknown>
      | undefined;
    if (!row || !row.enabled) {
      logger.info('mcp.init', 'MCP server disabled');
      return;
    }

    let token = '';
    if (row.token_encrypted) {
      try {
        token = decrypt(row.token_encrypted as string, config.encryptionKey);
      } catch {
        token = '';
      }
    }
    if (!token) {
      logger.warn('mcp.init', 'MCP enabled but no token configured; refusing to expose endpoint');
      return;
    }

    const vsRow = db
      .prepare('SELECT * FROM vector_search_configs WHERE id = ?')
      .get('default') as Record<string, unknown> | undefined;
    const vectorEnabled = !!(
      vsRow &&
      vsRow.enabled &&
      vsRow.worker_url &&
      vsRow.embedding_config_id
    );

    const provider = new SqliteMcpProvider(db);
    const server = createMcpServer(provider, vectorEnabled);
    const checkToken = (req: Request, res: Response): boolean => {
      if (!tokenMatches(extractBearer(req), token)) {
        res.status(401).json({ error: 'unauthorized' });
        return false;
      }
      return true;
    };

    // ── Streamable HTTP (primary, MCP 2025 spec) ──
    app.all('/mcp', async (req, res) => {
      if (!checkToken(req, res)) return;
      try {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          transport.close().catch(() => undefined);
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (err) {
        logger.errorFromError('mcp.streamable', 'Streamable HTTP error', err as Error);
        if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      }
    });

    // ── SSE fallback (for clients not yet supporting Streamable HTTP) ──
    const sseTransports = new Map<string, SSEServerTransport>();

    app.get('/mcp/sse', async (req, res) => {
      if (!checkToken(req, res)) return;
      try {
        const transport = new SSEServerTransport('/mcp/sse/messages', res);
        sseTransports.set(transport.sessionId, transport);
        res.on('close', () => {
          sseTransports.delete(transport.sessionId);
        });
        await server.connect(transport);
        await transport.start();
      } catch (err) {
        logger.errorFromError('mcp.sse', 'SSE connection error', err as Error);
        if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      }
    });

    app.post('/mcp/sse/messages', async (req, res) => {
      if (!checkToken(req, res)) return;
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

    logger.info('mcp.init', `MCP server mounted (vectorSearch=${vectorEnabled})`);
  } catch (err) {
    logger.errorFromError('mcp.init', 'Failed to init MCP server', err as Error);
  }
}
