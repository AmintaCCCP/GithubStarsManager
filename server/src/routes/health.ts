import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    // Non-sensitive hint for the UI: whether /api calls expect a Bearer token.
    // False only in the explicit ALLOW_INSECURE_NO_AUTH dev mode.
    authRequired: config.apiSecret !== null && config.apiSecret !== '',
  });
});

export default router;
