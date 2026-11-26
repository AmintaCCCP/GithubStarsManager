import type { GitHubUser } from '../types';

export const DEFAULT_PROFILE_ID = 'default';
export const PROFILES_REGISTRY_KEY = 'gsm:profiles';
export const ACTIVE_PROFILE_KEY = 'gsm:active-profile';
export const PENDING_SEED_KEY = 'gsm:pending-seed';
export const PROFILES_UPDATED_EVENT = 'gsm:profiles-updated';
export const PROFILE_CONFLICT_EVENT = 'gsm:profile-conflict';

export interface ProfileConflictEventDetail {
  kind: 'webdav' | 'vector';
  conflictingProfile: string;
}

export const notifyProfileConflict = (detail: ProfileConflictEventDetail): void => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<ProfileConflictEventDetail>(PROFILE_CONFLICT_EVENT, { detail }));
  } catch {
    // ignore
  }
};

const PROFILE_ID_RE = /^p_[a-z0-9_-]{1,32}$/;

export interface ProfileEntry {
  id: string;
  login?: string;
  name?: string;
  avatarUrl?: string;
  webdavTargets?: string[];
  vectorWorkerUrl?: string;
}

export interface PendingProfileSeed {
  profileId: string;
  user: GitHubUser;
  githubToken: string;
  copiedSettings?: Record<string, unknown>;
}

/**
 * Strict allowlist of general settings that may be copied when adding a new account.
 * NEVER includes webdavConfigs, activeWebDAVConfig, vectorSearchConfig, mcpConfig,
 * githubToken, user, repositories, or any account-specific data.
 */
export const COPYABLE_SETTINGS_KEYS = [
  'aiConfigs',
  'activeAIConfig',
  'embeddingConfigs',
  'activeEmbeddingConfig',
  'theme',
  'themeMode',
  'themePresetLight',
  'themePresetDark',
  'themeTokens',
  'language',
  'proxyConfig',
  'rpcDownloadConfig',
  'repositoryCardFields',
  'repositoryCardActions',
] as const;

const COPYABLE_SETTINGS_SET = new Set<string>(COPYABLE_SETTINGS_KEYS);

export const isValidProfileId = (id: string): boolean =>
  id === DEFAULT_PROFILE_ID || PROFILE_ID_RE.test(id);

export const readActiveProfileIdAtBoot = (): string => {
  if (typeof window === 'undefined') return DEFAULT_PROFILE_ID;
  try {
    const raw = window.localStorage.getItem(ACTIVE_PROFILE_KEY);
    if (raw && isValidProfileId(raw)) {
      return raw;
    }
  } catch {
    // Storage blocked or unavailable; fall back to default profile.
  }
  return DEFAULT_PROFILE_ID;
};

/**
 * Frozen once at module load so all storage keys, IndexedDB names, and HTTP
 * headers remain 100% consistent for the lifetime of the page.
 */
export const ACTIVE_PROFILE_ID: string = readActiveProfileIdAtBoot();

export const isDefaultProfile = (profileId: string = ACTIVE_PROFILE_ID): boolean =>
  profileId === DEFAULT_PROFILE_ID;

export const scopedKey = (base: string, profileId: string = ACTIVE_PROFILE_ID): string =>
  profileId === DEFAULT_PROFILE_ID ? base : `${base}__${profileId}`;

export const getProfileHeader = (profileId: string = ACTIVE_PROFILE_ID): Record<string, string> =>
  profileId === DEFAULT_PROFILE_ID ? {} : { 'X-GSM-Profile': profileId };

export const makeProfileId = (githubUserId: number | string): string => {
  const sanitized = String(githubUserId)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  if (!sanitized) {
    throw new Error('Invalid GitHub user ID for profile');
  }
  return `p_${sanitized.slice(0, 32)}`;
};

const notifyProfilesUpdated = (): void => {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(PROFILES_UPDATED_EVENT));
  } catch {
    // ignore
  }
};

export const readProfiles = (): ProfileEntry[] => {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PROFILES_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Normalize every optional field: the registry can be hand-edited or written
    // by an older/newer build, and a non-array webdavTargets would make conflict
    // detection throw (`targets.some`).
    const entries: ProfileEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const rawItem = item as Record<string, unknown>;
      if (typeof rawItem.id !== 'string' || !isValidProfileId(rawItem.id)) continue;
      const entry: ProfileEntry = { id: rawItem.id };
      if (typeof rawItem.login === 'string') entry.login = rawItem.login;
      if (typeof rawItem.name === 'string') entry.name = rawItem.name;
      if (typeof rawItem.avatarUrl === 'string') entry.avatarUrl = rawItem.avatarUrl;
      if (Array.isArray(rawItem.webdavTargets)) {
        entry.webdavTargets = rawItem.webdavTargets.filter(
          (target): target is string => typeof target === 'string',
        );
      }
      if (typeof rawItem.vectorWorkerUrl === 'string') {
        entry.vectorWorkerUrl = rawItem.vectorWorkerUrl;
      }
      entries.push(entry);
    }
    return entries;
  } catch {
    return [];
  }
};

const writeProfilesRaw = (profiles: ProfileEntry[]): void => {
  if (typeof window === 'undefined') return;
  try {
    const sanitized = profiles.filter((p) => isValidProfileId(p.id));
    window.localStorage.setItem(PROFILES_REGISTRY_KEY, JSON.stringify(sanitized));
    notifyProfilesUpdated();
  } catch {
    // ignore quota/security errors
  }
};

export const writeProfiles = (profiles: ProfileEntry[]): void => {
  writeProfilesRaw(profiles);
};

const REGISTRY_LOCK_NAME = 'gsm:profiles-registry';
let registryWriteChain: Promise<void> = Promise.resolve();

const supportsRegistryLock = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.locks?.request === 'function';

/**
 * Read-modify-write the registry. When the Web Locks API is available the write
 * runs inside a cross-tab lock and re-reads the registry there, so it cannot
 * overwrite an entry another tab wrote after our optimistic read. Falls back to
 * the synchronous write where locks are unavailable (older engines, tests).
 */
const mutateRegistry = (
  mutate: (existing: ProfileEntry[]) => ProfileEntry[],
): ProfileEntry[] => {
  const current = readProfiles();
  const optimistic = mutate(current);
  if (optimistic === current) return optimistic;

  if (!supportsRegistryLock()) {
    writeProfilesRaw(optimistic);
    return optimistic;
  }

  registryWriteChain = registryWriteChain
    .catch(() => undefined)
    .then(() => navigator.locks.request(REGISTRY_LOCK_NAME, () => {
      const fresh = readProfiles();
      const next = mutate(fresh);
      if (next !== fresh) writeProfilesRaw(next);
    }))
    .catch(() => undefined);
  return optimistic;
};

/** Resolve once every queued registry write has been applied. */
export const flushProfileRegistryWrites = (): Promise<void> => registryWriteChain;

export const setActiveProfileId = (profileId: string): void => {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Invalid profile ID: ${profileId}`);
  }
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ACTIVE_PROFILE_KEY, profileId);
};

export const upsertProfile = (entry: ProfileEntry): ProfileEntry[] => {
  if (!isValidProfileId(entry.id)) {
    return readProfiles();
  }
  return mutateRegistry((existing) => {
    const idx = existing.findIndex((p) => p.id === entry.id);
    const next = [...existing];
    if (idx >= 0) {
      next[idx] = {
        ...existing[idx],
        ...entry,
        id: entry.id,
      };
    } else {
      next.push({ ...entry });
    }
    return next;
  });
};

export const removeProfileFromRegistry = (
  profileId: string,
  activeProfileId: string = ACTIVE_PROFILE_ID,
): ProfileEntry[] => {
  if (profileId === activeProfileId) {
    throw new Error('Cannot remove the active profile');
  }
  return mutateRegistry((existing) => existing.filter((p) => p.id !== profileId));
};

export const mergeServerProfiles = (
  serverProfiles: ReadonlyArray<{ id: string; login?: string; name?: string; avatarUrl?: string }>,
): ProfileEntry[] => {
  const existing = readProfiles();
  const byId = new Map<string, ProfileEntry>(existing.map((p) => [p.id, { ...p }]));
  let changed = false;

  for (const sp of serverProfiles) {
    if (!sp || typeof sp.id !== 'string' || !isValidProfileId(sp.id)) continue;
    const prev = byId.get(sp.id);
    if (!prev) {
      byId.set(sp.id, {
        id: sp.id,
        ...(sp.login ? { login: sp.login } : {}),
        ...(sp.name ? { name: sp.name } : {}),
        ...(sp.avatarUrl ? { avatarUrl: sp.avatarUrl } : {}),
      });
      changed = true;
    } else {
      const merged: ProfileEntry = {
        ...prev,
        login: prev.login || sp.login,
        name: prev.name || sp.name,
        avatarUrl: prev.avatarUrl || sp.avatarUrl,
      };
      if (
        merged.login !== prev.login ||
        merged.name !== prev.name ||
        merged.avatarUrl !== prev.avatarUrl
      ) {
        byId.set(sp.id, merged);
        changed = true;
      }
    }
  }

  const result = Array.from(byId.values());
  if (changed) {
    return mutateRegistry((fresh) => {
      // Merge into the freshest registry snapshot so an entry written while we
      // were merging is not dropped.
      const merged = new Map<string, ProfileEntry>(fresh.map((p) => [p.id, { ...p }]));
      for (const entry of result) {
        const prev = merged.get(entry.id);
        merged.set(entry.id, prev ? { ...prev, ...entry } : entry);
      }
      return Array.from(merged.values());
    });
  }
  return result;
};

/**
 * Normalize a WebDAV (url, path) target to lowercase origin + normalized path without trailing slash.
 * Used solely for cross-profile conflict detection. Never includes credentials.
 */
export const normalizeWebdavTarget = (url: string, path: string): string => {
  const trimmedUrl = (url || '').trim();
  const trimmedPath = (path || '').trim();
  if (!trimmedUrl) return '';

  const joinPath = (basePath: string, extraPath: string): string => {
    const combined = `${basePath}/${extraPath}`.replace(/\/+/g, '/');
    const resolved = new URL(combined, 'http://localhost').pathname;
    const stripped = resolved.replace(/\/+$/, '');
    return stripped || '/';
  };

  try {
    const parsed = new URL(trimmedUrl);
    const origin = parsed.origin.toLowerCase();
    const normalizedPath = joinPath(parsed.pathname || '/', trimmedPath);
    return normalizedPath === '/' ? origin : `${origin}${normalizedPath}`;
  } catch {
    const fallbackBase = trimmedUrl.toLowerCase().replace(/\/+$/, '');
    const fallbackPath = trimmedPath ? `/${trimmedPath}`.replace(/\/+/g, '/').replace(/\/+$/, '') : '';
    return `${fallbackBase}${fallbackPath}`;
  }
};

/**
 * Normalize a Vectorize Worker URL to lowercase origin + normalized pathname without trailing slash.
 * Never includes auth tokens or query strings.
 */
export const normalizeVectorWorkerUrl = (url: string): string => {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  try {
    const parsed = new URL(trimmed);
    const origin = parsed.origin.toLowerCase();
    const pathname = parsed.pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
    return `${origin}${pathname}`;
  } catch {
    return trimmed.toLowerCase().replace(/\/+$/, '');
  }
};

export const extractWebdavTargets = (
  webdavConfigs?: ReadonlyArray<{ url?: string; path?: string }>,
): string[] => {
  if (!Array.isArray(webdavConfigs)) return [];
  const targets = new Set<string>();
  for (const cfg of webdavConfigs) {
    if (!cfg?.url) continue;
    const normalized = normalizeWebdavTarget(cfg.url, cfg.path ?? '');
    if (normalized) targets.add(normalized);
  }
  return Array.from(targets);
};

/**
 * Sync the active profile's non-sensitive metadata (user login/name/avatar,
 * normalized WebDAV target URLs/paths, normalized Vectorize Worker URL) into
 * `gsm:profiles`. Never stores passwords, tokens, or secrets.
 *
 * When `force` is false (default), avoids creating `gsm:profiles` for pure
 * single-account users who have never used multi-account features.
 */
export const syncActiveProfileMetadata = (
  input: {
    user?: { login?: string; name?: string | null; avatar_url?: string } | null;
    webdavConfigs?: ReadonlyArray<{ url?: string; path?: string }>;
    vectorSearchConfig?: { workerUrl?: string } | null;
  },
  options: { force?: boolean; profileId?: string } = {},
): void => {
  const profileId = options.profileId ?? ACTIVE_PROFILE_ID;
  const existing = readProfiles();
  if (!options.force && isDefaultProfile(profileId) && existing.length === 0) {
    return;
  }

  const prev = existing.find((p) => p.id === profileId);
  const nextEntry: ProfileEntry = {
    ...(prev ?? { id: profileId }),
    id: profileId,
  };

  if (input.user !== undefined) {
    if (input.user) {
      nextEntry.login = input.user.login || nextEntry.login;
      nextEntry.name = input.user.name || undefined;
      nextEntry.avatarUrl = input.user.avatar_url || nextEntry.avatarUrl;
    }
  }
  if (input.webdavConfigs !== undefined) {
    nextEntry.webdavTargets = extractWebdavTargets(input.webdavConfigs);
  }
  if (input.vectorSearchConfig !== undefined) {
    const normalized = normalizeVectorWorkerUrl(input.vectorSearchConfig?.workerUrl ?? '');
    nextEntry.vectorWorkerUrl = normalized || undefined;
  }

  upsertProfile(nextEntry);
};

export const findConflictingWebdavProfile = (
  url: string,
  path: string,
  currentProfileId: string = ACTIVE_PROFILE_ID,
): { id: string; login?: string } | null => {
  const target = normalizeWebdavTarget(url, path);
  if (!target) return null;

  const profiles = readProfiles();
  for (const profile of profiles) {
    if (profile.id === currentProfileId) continue;
    const targets = profile.webdavTargets ?? [];
    if (targets.some((existingTarget) => existingTarget === target)) {
      return { id: profile.id, login: profile.login };
    }
  }
  return null;
};

export const findConflictingVectorProfile = (
  workerUrl: string,
  currentProfileId: string = ACTIVE_PROFILE_ID,
): { id: string; login?: string } | null => {
  const normalized = normalizeVectorWorkerUrl(workerUrl);
  if (!normalized) return null;

  const profiles = readProfiles();
  for (const profile of profiles) {
    if (profile.id === currentProfileId) continue;
    if (profile.vectorWorkerUrl && normalizeVectorWorkerUrl(profile.vectorWorkerUrl) === normalized) {
      return { id: profile.id, login: profile.login };
    }
  }
  return null;
};

const COPYABLE_NESTED_FIELDS: Record<string, readonly string[]> = {
  proxyConfig: ['enabled', 'type', 'host', 'port'],
  rpcDownloadConfig: ['enabled', 'host', 'port'],
};

/**
 * Pick ONLY allowlisted general settings from a source state object.
 * Strips all account-specific data (WebDAV, Vectorize, MCP, GitHub token,
 * user, repositories, gists, releases, forks, categories, workspaces, etc.)
 * and nested credentials (proxyConfig.username/password, rpcDownloadConfig.secret).
 */
export const pickCopyableSettings = (
  source: Record<string, unknown>,
): Record<string, unknown> => {
  const result: Record<string, unknown> = {};
  for (const key of COPYABLE_SETTINGS_KEYS) {
    if (COPYABLE_SETTINGS_SET.has(key) && source[key] !== undefined) {
      const nestedFields = COPYABLE_NESTED_FIELDS[key];
      if (nestedFields) {
        const value = source[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          const picked: Record<string, unknown> = {};
          for (const field of nestedFields) {
            const fieldValue = (value as Record<string, unknown>)[field];
            if (fieldValue !== undefined) {
              picked[field] = fieldValue;
            }
          }
          result[key] = picked;
        }
        continue;
      }
      try {
        result[key] = JSON.parse(JSON.stringify(source[key]));
      } catch {
        result[key] = source[key];
      }
    }
  }
  return result;
};

export const writePendingSeed = (seed: PendingProfileSeed): void => {
  if (typeof window === 'undefined') return;
  const sanitizedSeed: PendingProfileSeed = {
    profileId: seed.profileId,
    user: seed.user,
    githubToken: seed.githubToken,
    ...(seed.copiedSettings ? { copiedSettings: pickCopyableSettings(seed.copiedSettings) } : {}),
  };
  window.localStorage.setItem(PENDING_SEED_KEY, JSON.stringify(sanitizedSeed));
};

const parsePendingSeed = (expectedProfileId: string): PendingProfileSeed | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_SEED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingProfileSeed>;
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.profileId !== 'string' ||
      !parsed.user ||
      typeof parsed.githubToken !== 'string'
    ) {
      return null;
    }
    if (parsed.profileId !== expectedProfileId) {
      return null;
    }
    return {
      profileId: parsed.profileId,
      user: parsed.user,
      githubToken: parsed.githubToken,
      copiedSettings:
        parsed.copiedSettings && typeof parsed.copiedSettings === 'object'
          ? pickCopyableSettings(parsed.copiedSettings)
          : undefined,
    };
  } catch {
    return null;
  }
};

/**
 * Read `gsm:pending-seed` without deleting it. The boot path keeps the seed
 * until the seeded state has actually been persisted, so a crash before the
 * snapshot write replays the seed instead of silently losing it.
 */
export const readPendingSeed = (
  expectedProfileId: string = ACTIVE_PROFILE_ID,
): PendingProfileSeed | null => parsePendingSeed(expectedProfileId);

/**
 * Remove `gsm:pending-seed` once the seeded state is safely persisted. When an
 * expected profile ID is given the seed is only deleted if it belongs to that
 * profile, so a late flush for an abandoned add-account attempt cannot discard
 * the seed another profile is still waiting to apply.
 */
export const clearPendingSeed = (expectedProfileId?: string): void => {
  if (typeof window === 'undefined') return;
  try {
    if (expectedProfileId !== undefined && readPendingSeed(expectedProfileId) === null) {
      return;
    }
    window.localStorage.removeItem(PENDING_SEED_KEY);
  } catch {
    // ignore
  }
};

/**
 * Consume and delete `gsm:pending-seed` if it matches the booting profile ID.
 * Returns null if absent, malformed, or intended for another profile.
 */
export const consumePendingSeed = (
  expectedProfileId: string = ACTIVE_PROFILE_ID,
): PendingProfileSeed | null => {
  const seed = parsePendingSeed(expectedProfileId);
  if (!seed) return null;
  clearPendingSeed(expectedProfileId);
  return seed;
};

/**
 * Clear ONLY the specified profile's localStorage and sessionStorage keys.
 * NEVER removes `gsm:profiles`, `gsm:active-profile`, `gsm:pending-seed`,
 * `github-stars-manager-backend-url`, or any other profile's keys.
 */
export const clearProfileLocalStorage = (profileId: string = ACTIVE_PROFILE_ID): void => {
  if (typeof window === 'undefined') return;

  const storeKey = scopedKey('github-stars-manager', profileId);
  const storeDerivedPrefix = `${storeKey}#`;

  const exactLocalKeys = new Set<string>([
    storeKey,
    scopedKey('github-stars-manager-auth', profileId),
    scopedKey('github-stars-search-history', profileId),
    scopedKey('lastSearchTime', profileId),
    scopedKey('gsm-repository-chat-fallback-v1', profileId),
    scopedKey('gsm-repository-chat-use-fallback-v1', profileId),
  ]);

  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (exactLocalKeys.has(key) || key.startsWith(storeDerivedPrefix)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // ignore
  }

  try {
    window.sessionStorage.removeItem(scopedKey('github-stars-manager-backend-secret', profileId));
  } catch {
    // ignore
  }
};
