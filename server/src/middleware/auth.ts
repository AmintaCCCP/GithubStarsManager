import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

let warnedOnce = false;

// 与前端 src/utils/backendErrors.ts 的 AUTH_NOT_CONFIGURED 双语文案对应；
// error 字段仅是非更新客户端看到的英文兜底，前端按 code 显示双语提示。
const AUTH_NOT_CONFIGURED_MESSAGE =
  'The server generated its own API secret (security hardening). Retrieve it from the backend logs or data/.api-secret, then enter it as the client API Secret.';

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip auth for health check
  if (req.method === 'GET' && req.path === '/health') {
    next();
    return;
  }

  // No API_SECRET available. Fail closed by default (security hardening): an
  // unauthenticated deployment must not serve /api wide open. resolveApiSecret()
  // normally guarantees a secret (env or auto-generated data/.api-secret), so
  // this branch only fires in the explicit ALLOW_INSECURE_NO_AUTH dev mode.
  if (!config.apiSecret) {
    if (config.allowInsecureNoAuth) {
      if (!warnedOnce) {
        console.warn('⚠️  API_SECRET not set and ALLOW_INSECURE_NO_AUTH is enabled — auth is DISABLED (dev mode). Never expose this server to untrusted networks.');
        warnedOnce = true;
      }
      next();
      return;
    }

    // Defensive: a null secret without the dev flag is not reachable via
    // loadConfig(); stay fail-closed if it ever happens.
    res.status(401).json({ error: AUTH_NOT_CONFIGURED_MESSAGE, code: 'AUTH_NOT_CONFIGURED' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    // Missing credentials (as opposed to a wrong token): when the secret was
    // generated server-side, the client simply does not know it yet — return an
    // actionable code instead of a generic Unauthorized. With an operator-set
    // API_SECRET the client was told the secret, so keep the plain message.
    if (config.apiSecretSource === 'generated') {
      res.status(401).json({ error: AUTH_NOT_CONFIGURED_MESSAGE, code: 'AUTH_NOT_CONFIGURED' });
      return;
    }
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  const token = authHeader.slice(7);

  // Constant-time comparison
  // 使用固定时间的比较来防止时序攻击
  const tokenBuf = Buffer.from(token);
  const secretBuf = Buffer.from(config.apiSecret);

  if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
    res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
    return;
  }

  next();
}
