import { Router } from 'express';
import { logger, LogLevel } from '../services/logger.js';

const router = Router();

const ALLOWED_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

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

export default router;