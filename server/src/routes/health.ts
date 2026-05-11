import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

const router = Router();

router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
  });
});

export default router;
