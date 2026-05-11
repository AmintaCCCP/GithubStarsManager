import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
let version = 'unknown';
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));
  version = pkg.version ?? 'unknown';
} catch {
  version = 'unknown';
}

const router = Router();

router.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version,
    timestamp: new Date().toISOString(),
  });
});

export default router;
