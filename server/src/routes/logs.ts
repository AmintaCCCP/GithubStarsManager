import { Router } from 'express';
import { logger, LogLevel } from '../services/logger.js';

const router = Router();

// GET /api/logs — returns recent backend log entries
router.get('/api/logs', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 1000, 2000);
    const level = req.query.level as LogLevel | undefined;
    const since = req.query.since as string | undefined;

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