import { Router } from 'express';
import { logger, LogLevel } from '../services/logger.js';

const router = Router();

const ALLOWED_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

// Note: Authentication is handled by authMiddleware applied to all /api/* routes in index.ts

// GET /api/logs — returns recent backend log entries
router.get('/api/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 2000);

    // Validate level parameter
    const rawLevel = typeof req.query.level === 'string' ? req.query.level : undefined;
    if (rawLevel && !ALLOWED_LEVELS.includes(rawLevel as LogLevel)) {
      res.status(400).json({ error: 'Invalid log level', code: 'INVALID_LOG_LEVEL' });
      return;
    }
    const level = rawLevel as LogLevel | undefined;

    // Validate since parameter
    const rawSince = typeof req.query.since === 'string' ? req.query.since : undefined;
    if (rawSince && Number.isNaN(Date.parse(rawSince))) {
      res.status(400).json({ error: 'Invalid since value', code: 'INVALID_SINCE' });
      return;
    }
    const since = rawSince;

    // Get all matching entries first for count, then apply limit
    const allEntries = logger.getEntries({ level, since });
    const total = allEntries.length;
    const entries = limit > 0 ? allEntries.slice(-limit) : allEntries;

    // Include total count as header for efficient client-side count queries
    res.setHeader('X-Log-Count', String(total));
    res.json(entries);
  } catch (err) {
    logger.errorFromError('logs.getLogs', 'Failed to fetch logs', err);
    res.status(500).json({ error: 'Failed to fetch logs', code: 'FETCH_LOGS_FAILED' });
  }
});

// DELETE /api/logs — clear all backend log entries
router.delete('/api/logs', (_req, res) => {
  try {
    logger.clear();
    res.json({ success: true });
  } catch (err) {
    logger.errorFromError('logs.clearLogs', 'Failed to clear logs', err);
    res.status(500).json({ error: 'Failed to clear logs', code: 'CLEAR_LOGS_FAILED' });
  }
});

// GET /api/logs/debug — return current debug mode status
router.get('/api/logs/debug', (_req, res) => {
  res.json({ debugMode: logger.isDebugMode() });
});

// POST /api/logs/debug — toggle backend debug mode
router.post('/api/logs/debug', (req, res) => {
  try {
    const enabled = req.body.enabled === true;
    logger.setLevel(enabled ? 'debug' : 'info');
    logger.info('logs.debug', enabled ? 'Backend debug mode enabled' : 'Backend debug mode disabled');
    res.json({ success: true, debugMode: logger.isDebugMode() });
  } catch (err) {
    logger.errorFromError('logs.debugToggle', 'Failed to toggle debug mode', err);
    res.status(500).json({ error: 'Failed to toggle debug mode', code: 'DEBUG_TOGGLE_FAILED' });
  }
});

export default router;