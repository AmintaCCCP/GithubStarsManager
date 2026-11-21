
import type { GitHubUser } from '../../types';

const BACKEND_SECRET_SESSION_KEY = 'github-stars-manager-backend-secret';
const AUTH_MIRROR_KEY = 'github-stars-manager-auth';

interface AuthMirror {
  user: GitHubUser | null;
  githubToken: string | null;
  backendApiSecret: string | null;
}

export const readAuthMirror = (): AuthMirror | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthMirror>;
    return {
      user: parsed.user ?? null,
      // 审计修复（B7/CWE-922）：镜像不再回读明文 PAT——历史镜像里的
      // githubToken 一律视为 null（PAT 只存桌面端 safeStorage 或内存）。
      githubToken: null,
      backendApiSecret: typeof parsed.backendApiSecret === 'string' ? parsed.backendApiSecret : null,
    };
  } catch {
    return null;
  }
};

/**
 * 仅供 v19 一次性桌面端迁移使用：读取旧认证镜像中尚未迁出的明文 PAT 与对应用户 ID，
 * 以便桌面端在成功迁入 safeStorage 加密文件后再安全清除旧镜像中的 PAT。
 */
export const readLegacyAuthMirrorForDesktopMigration = (): {
  user: GitHubUser | null;
  githubToken: string | null;
  backendApiSecret: string | null;
} | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AUTH_MIRROR_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthMirror>;
    const token = typeof parsed.githubToken === 'string' && parsed.githubToken.trim()
      ? parsed.githubToken.trim()
      : null;
    if (!token) return null;
    return {
      user: parsed.user ?? null,
      githubToken: token,
      backendApiSecret: typeof parsed.backendApiSecret === 'string' ? parsed.backendApiSecret : null,
    };
  } catch {
    return null;
  }
};

export const writeAuthMirror = (auth: AuthMirror): void => {
  if (typeof window === 'undefined') return;
  try {
    // 审计修复（B7/CWE-922）：githubToken 形参仅为保持调用方签名兼容，
    // 镜像永远不落明文 PAT（桌面端经 ghAccounts IPC 写 safeStorage 文件）。
    window.localStorage.setItem(AUTH_MIRROR_KEY, JSON.stringify({
      user: auth.user,
      githubToken: null,
      backendApiSecret: auth.backendApiSecret,
    }));
  } catch {
    // Quota/security errors are expected in constrained environments; the
    // IndexedDB persist path remains the fallback there.
  }
};

export const clearAuthMirror = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_MIRROR_KEY);
  } catch {
    // ignore
  }
};

export const readSessionBackendSecret = (): string | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage.getItem(BACKEND_SECRET_SESSION_KEY);
  } catch {
    return null;
  }
};

export const writeSessionBackendSecret = (secret: string | null): void => {
  if (typeof window === 'undefined') return;
  try {
    if (secret) {
      window.sessionStorage.setItem(BACKEND_SECRET_SESSION_KEY, secret);
    } else {
      window.sessionStorage.removeItem(BACKEND_SECRET_SESSION_KEY);
    }
  } catch {
    // Storage may be blocked or unavailable; IndexedDB remains the durable path.
  }
};
