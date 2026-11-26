import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_PROFILE_ID,
  ACTIVE_PROFILE_KEY,
  COPYABLE_SETTINGS_KEYS,
  DEFAULT_PROFILE_ID,
  PENDING_SEED_KEY,
  PROFILES_REGISTRY_KEY,
  clearPendingSeed,
  clearProfileLocalStorage,
  consumePendingSeed,
  findConflictingVectorProfile,
  flushProfileRegistryWrites,
  findConflictingWebdavProfile,
  getProfileHeader,
  isDefaultProfile,
  isValidProfileId,
  makeProfileId,
  mergeServerProfiles,
  normalizeVectorWorkerUrl,
  normalizeWebdavTarget,
  pickCopyableSettings,
  readActiveProfileIdAtBoot,
  readPendingSeed,
  readProfiles,
  removeProfileFromRegistry,
  scopedKey,
  syncActiveProfileMetadata,
  upsertProfile,
  writePendingSeed,
  writeProfiles,
} from './profileStorage';
import { DB_NAME } from './indexedDbStorage';
import { appPersistenceOptions } from '../store/persistence/options';
import { PERSISTENCE_SHARD_FORMAT, PERSISTENCE_SHARD_NAMES } from '../store/persistence/shards';
import type { GitHubUser } from '../types';

const mockUser = (id: number, login: string): GitHubUser => ({
  id,
  login,
  name: login,
  avatar_url: `https://avatars.githubusercontent.com/u/${id}`,
  email: null,
});

describe('profileStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('single-account byte-for-byte invariants', () => {
    it('keeps default profile ID, storage keys, DB name, version 17, and 7 shards untouched', () => {
      expect(ACTIVE_PROFILE_ID).toBe(DEFAULT_PROFILE_ID);
      expect(isDefaultProfile()).toBe(true);
      expect(getProfileHeader()).toEqual({});
      expect(Object.keys(getProfileHeader())).toHaveLength(0);

      expect(DB_NAME).toBe('github-stars-manager-db');
      expect(appPersistenceOptions.name).toBe('github-stars-manager');
      expect(appPersistenceOptions.version).toBe(17);
      expect(PERSISTENCE_SHARD_FORMAT).toBe(1);
      expect(PERSISTENCE_SHARD_NAMES).toEqual([
        'core',
        'repositories',
        'gists',
        'releases',
        'forks',
        'accountWorkspaces',
        'trendingSnapshots',
      ]);

      expect(scopedKey('github-stars-manager')).toBe('github-stars-manager');
      expect(scopedKey('github-stars-manager-db')).toBe('github-stars-manager-db');
      expect(scopedKey('github-stars-manager-auth')).toBe('github-stars-manager-auth');
      expect(scopedKey('github-stars-search-history')).toBe('github-stars-search-history');
      expect(scopedKey('gsm-repository-chat-db')).toBe('gsm-repository-chat-db');
    });

    it('uses gsm: prefix for all multi-account registry keys', () => {
      expect(PROFILES_REGISTRY_KEY).toBe('gsm:profiles');
      expect(ACTIVE_PROFILE_KEY).toBe('gsm:active-profile');
      expect(PENDING_SEED_KEY).toBe('gsm:pending-seed');
    });
  });

  describe('non-default profile scoping and validation', () => {
    it('scopes keys and adds X-GSM-Profile header for non-default profiles', () => {
      const id = makeProfileId(987654);
      expect(id).toBe('p_987654');
      expect(isDefaultProfile(id)).toBe(false);
      expect(scopedKey('github-stars-manager', id)).toBe('github-stars-manager__p_987654');
      expect(scopedKey('github-stars-manager-db', id)).toBe('github-stars-manager-db__p_987654');
      expect(getProfileHeader(id)).toEqual({ 'X-GSM-Profile': 'p_987654' });
    });

    it('validates profile IDs strictly and falls back to default on invalid stored value', () => {
      expect(isValidProfileId('default')).toBe(true);
      expect(isValidProfileId('p_12345')).toBe(true);
      expect(isValidProfileId('p_abc-123_xyz')).toBe(true);

      expect(isValidProfileId('')).toBe(false);
      expect(isValidProfileId('../etc/passwd')).toBe(false);
      expect(isValidProfileId('p_UPPER')).toBe(false);
      expect(isValidProfileId('other')).toBe(false);

      localStorage.setItem(ACTIVE_PROFILE_KEY, '../hack');
      expect(readActiveProfileIdAtBoot()).toBe('default');

      localStorage.setItem(ACTIVE_PROFILE_KEY, 'p_42');
      expect(readActiveProfileIdAtBoot()).toBe('p_42');
    });
  });

  describe('strict copy-settings allowlist & pending seed', () => {
    it('copies ONLY allowlisted general settings and strips all account-specific data', () => {
      const source: Record<string, unknown> = {
        // Allowlisted
        aiConfigs: [{ id: 'ai1', name: 'OpenAI' }],
        activeAIConfig: 'ai1',
        embeddingConfigs: [{ id: 'emb1', model: 'text-embedding-3-small' }],
        activeEmbeddingConfig: 'emb1',
        theme: 'dark',
        themeMode: 'dark',
        themePresetLight: 'linear',
        themePresetDark: 'linear',
        themeTokens: { radius: '8px' },
        language: 'en',
        proxyConfig: { enabled: true, type: 'http', host: '127.0.0.1', port: 7890, username: 'alice', password: 'proxy-secret-password' },
        rpcDownloadConfig: { enabled: false, host: '', port: 6800, secret: 'aria2-rpc-secret' },
        repositoryCardFields: { stars: true },
        repositoryCardActions: { edit: true },

        // Forbidden / account-specific
        webdavConfigs: [{ id: 'w1', url: 'https://dav.example.com', password: 'secret', path: '/stars' }],
        activeWebDAVConfig: 'w1',
        vectorSearchConfig: { enabled: true, workerUrl: 'https://vec.example.com', authToken: 'tok' },
        vectorSearchStatus: { vectorCount: 100 },
        mcpConfig: { enabled: true, token: 'mcp-secret' },
        githubToken: 'test-token-default-secret',
        user: mockUser(1, 'alice'),
        isAuthenticated: true,
        repositories: [{ id: 1, name: 'secret-repo' }],
        gists: [{ id: 'g1' }],
        releases: [{ id: 10 }],
        forks: [{ id: 20 }],
        customCategories: [{ id: 'c1' }],
        accountWorkspaces: { '1': {} },
        backendApiSecret: 'backend-secret',
      };

      const copied = pickCopyableSettings(source);
      expect(Object.keys(copied).sort()).toEqual([...COPYABLE_SETTINGS_KEYS].sort());
      expect(copied.proxyConfig).toEqual({ enabled: true, type: 'http', host: '127.0.0.1', port: 7890 });
      expect(copied.proxyConfig).not.toHaveProperty('username');
      expect(copied.proxyConfig).not.toHaveProperty('password');
      expect(copied.rpcDownloadConfig).toEqual({ enabled: false, host: '', port: 6800 });
      expect(copied.rpcDownloadConfig).not.toHaveProperty('secret');

      expect(copied).not.toHaveProperty('webdavConfigs');
      expect(copied).not.toHaveProperty('activeWebDAVConfig');
      expect(copied).not.toHaveProperty('vectorSearchConfig');
      expect(copied).not.toHaveProperty('vectorSearchStatus');
      expect(copied).not.toHaveProperty('mcpConfig');
      expect(copied).not.toHaveProperty('githubToken');
      expect(copied).not.toHaveProperty('user');
      expect(copied).not.toHaveProperty('repositories');
      expect(copied).not.toHaveProperty('gists');
      expect(copied).not.toHaveProperty('releases');
      expect(copied).not.toHaveProperty('forks');
      expect(copied).not.toHaveProperty('customCategories');
      expect(copied).not.toHaveProperty('accountWorkspaces');
      expect(copied).not.toHaveProperty('backendApiSecret');
    });

    it('consumes pending seed once for matching profile and deletes it', () => {
      const user = mockUser(222, 'bob');
      writePendingSeed({
        profileId: 'p_222',
        user,
        githubToken: 'test-token-bob',
        copiedSettings: {
          language: 'ja',
          webdavConfigs: [{ id: 'should-be-stripped' }],
        },
      });

      // Wrong profile does not consume
      expect(consumePendingSeed('default')).toBeNull();
      expect(localStorage.getItem(PENDING_SEED_KEY)).not.toBeNull();

      // Matching profile consumes and deletes
      const seed = consumePendingSeed('p_222');
      expect(seed).not.toBeNull();
      expect(seed?.user.login).toBe('bob');
      expect(seed?.githubToken).toBe('test-token-bob');
      expect(seed?.copiedSettings).toEqual({ language: 'ja' });
      expect(localStorage.getItem(PENDING_SEED_KEY)).toBeNull();

      // Second read returns null
      expect(consumePendingSeed('p_222')).toBeNull();
    });
  });

  describe('profile registry sanitization', () => {
    it('ignores malformed optional fields instead of throwing in conflict detection', () => {
      window.localStorage.setItem(
        PROFILES_REGISTRY_KEY,
        JSON.stringify([
          { id: 'p_222', login: 'bob', webdavTargets: 'not-an-array', vectorWorkerUrl: 42 },
          { id: 'not a valid id', webdavTargets: ['https://dav.example.com/x'] },
          null,
        ]),
      );

      expect(readProfiles()).toEqual([{ id: 'p_222', login: 'bob' }]);
      expect(() => findConflictingWebdavProfile('https://dav.example.com', '/x')).not.toThrow();
      expect(() => findConflictingVectorProfile('https://vec.example.workers.dev')).not.toThrow();
    });

    it('only clears the pending seed that belongs to the requested profile', () => {
      writePendingSeed({
        profileId: 'p_222',
        user: mockUser(222, 'bob'),
        githubToken: 'seed-token',
      });

      clearPendingSeed('p_333');
      expect(readPendingSeed('p_222')).not.toBeNull();

      clearPendingSeed('p_222');
      expect(readPendingSeed('p_222')).toBeNull();
    });

    it('re-reads the registry inside the cross-tab lock before writing', async () => {
      const requestLock = vi.fn(
        (_name: string, callback: () => void | Promise<void>) =>
          Promise.resolve(callback()),
      );
      Object.defineProperty(navigator, 'locks', {
        configurable: true,
        value: { request: requestLock },
      });
      try {
        window.localStorage.setItem(
          PROFILES_REGISTRY_KEY,
          JSON.stringify([{ id: 'p_222', login: 'bob' }]),
        );

        upsertProfile({ id: 'p_333', login: 'carol' });
        // Another tab updates the registry while our locked write is queued.
        writeProfiles([{ id: 'p_222', login: 'bob-updated' }]);

        await flushProfileRegistryWrites();
        expect(requestLock).toHaveBeenCalledTimes(1);

        expect(readProfiles()).toEqual([
          { id: 'p_222', login: 'bob-updated' },
          { id: 'p_333', login: 'carol' },
        ]);
      } finally {
        delete (navigator as unknown as Record<string, unknown>).locks;
      }
    });

    it('reads the pending seed without deleting it until the caller clears it', () => {
      writePendingSeed({
        profileId: ACTIVE_PROFILE_ID,
        user: mockUser(7, 'peek'),
        githubToken: 'peek-token',
      });

      expect(readPendingSeed()?.githubToken).toBe('peek-token');
      expect(window.localStorage.getItem(PENDING_SEED_KEY)).not.toBeNull();

      clearPendingSeed();
      expect(readPendingSeed()).toBeNull();
      expect(window.localStorage.getItem(PENDING_SEED_KEY)).toBeNull();
    });
  });

  describe('WebDAV & Vectorize conflict guards', () => {
    it('normalizes WebDAV targets and Vectorize worker URLs consistently', () => {
      expect(normalizeWebdavTarget('HTTPS://DAV.Example.COM/dav/', '/stars/backup/')).toBe(
        'https://dav.example.com/dav/stars/backup',
      );
      expect(normalizeWebdavTarget('https://dav.example.com/dav', 'stars/backup')).toBe(
        'https://dav.example.com/dav/stars/backup',
      );
      expect(normalizeWebdavTarget('https://dav.example.com', '/stars/../backup')).toBe(
        'https://dav.example.com/backup',
      );
      expect(normalizeWebdavTarget('https://dav.example.com/dav/sub', '../backup/./')).toBe(
        'https://dav.example.com/dav/backup',
      );
      expect(normalizeVectorWorkerUrl('HTTPS://My-Worker.Workers.DEV/api/')).toBe(
        'https://my-worker.workers.dev/api',
      );
      expect(normalizeVectorWorkerUrl('https://my-worker.workers.dev/api?token=123')).toBe(
        'https://my-worker.workers.dev/api',
      );
    });

    it('detects WebDAV and Vectorize conflicts against other profiles without storing secrets', () => {
      syncActiveProfileMetadata(
        {
          user: mockUser(1, 'alice'),
          webdavConfigs: [{ url: 'https://dav.example.com/root', path: '/gsm/' }],
          vectorSearchConfig: { workerUrl: 'https://vec.alice.workers.dev/' },
        },
        { force: true, profileId: 'default' },
      );

      // Registry contains only normalized URLs/paths, never secrets
      const storedRaw = localStorage.getItem(PROFILES_REGISTRY_KEY) || '';
      expect(storedRaw).toContain('https://dav.example.com/root/gsm');
      expect(storedRaw).toContain('https://vec.alice.workers.dev');

      // Same profile does not conflict with itself
      expect(findConflictingWebdavProfile('https://dav.example.com/root', '/gsm', 'default')).toBeNull();
      expect(findConflictingVectorProfile('https://vec.alice.workers.dev', 'default')).toBeNull();

      // Another profile conflicts on identical normalized target
      expect(findConflictingWebdavProfile('HTTPS://DAV.EXAMPLE.COM/root/', '/gsm/', 'p_222')).toEqual({
        id: 'default',
        login: 'alice',
      });
      expect(findConflictingVectorProfile('HTTPS://VEC.ALICE.WORKERS.DEV', 'p_222')).toEqual({
        id: 'default',
        login: 'alice',
      });

      // Separate subdirectory or separate worker URL has no conflict
      expect(findConflictingWebdavProfile('https://dav.example.com/root', '/gsm/account_bob/', 'p_222')).toBeNull();
      expect(findConflictingVectorProfile('https://vec.bob.workers.dev', 'p_222')).toBeNull();
    });
  });

  describe('profile registry and clearProfileLocalStorage isolation', () => {
    it('merges server profiles and prevents removing the active profile', () => {
      upsertProfile({ id: 'default', login: 'alice' });
      const merged = mergeServerProfiles([
        { id: 'default', login: 'alice', avatarUrl: 'https://example.com/a.png' },
        { id: 'p_222', login: 'bob', avatarUrl: 'https://example.com/b.png' },
        { id: '../invalid', login: 'bad' },
      ]);
      expect(merged.map((p) => p.id)).toEqual(['default', 'p_222']);
      expect(merged[0].avatarUrl).toBe('https://example.com/a.png');

      expect(() => removeProfileFromRegistry('default', 'default')).toThrow();
      const afterRemove = removeProfileFromRegistry('p_222', 'default');
      expect(afterRemove.map((p) => p.id)).toEqual(['default']);
    });

    it('isolates clearProfileLocalStorage so other profiles and global keys survive', () => {
      writeProfiles([
        { id: 'default', login: 'alice' },
        { id: 'p_222', login: 'bob' },
      ]);
      localStorage.setItem(ACTIVE_PROFILE_KEY, 'default');
      localStorage.setItem('github-stars-manager-backend-url', 'https://backend.example.com/api');

      // Default profile keys
      localStorage.setItem('github-stars-manager', 'legacy');
      localStorage.setItem('github-stars-manager#meta', '{"format":1}');
      localStorage.setItem('github-stars-manager#shard:core', '{"state":{}}');
      localStorage.setItem('github-stars-manager-auth', '{"user":{"login":"alice"}}');
      localStorage.setItem('github-stars-search-history', '["react"]');
      sessionStorage.setItem('github-stars-manager-backend-secret', 'sec-default');

      // Second profile keys
      localStorage.setItem('github-stars-manager__p_222#meta', '{"format":1}');
      localStorage.setItem('github-stars-manager__p_222#shard:core', '{"state":{}}');
      localStorage.setItem('github-stars-manager-auth__p_222', '{"user":{"login":"bob"}}');
      localStorage.setItem('github-stars-search-history__p_222', '["vue"]');
      sessionStorage.setItem('github-stars-manager-backend-secret__p_222', 'sec-bob');

      // Clear ONLY default profile
      clearProfileLocalStorage('default');

      // Default profile keys removed
      expect(localStorage.getItem('github-stars-manager')).toBeNull();
      expect(localStorage.getItem('github-stars-manager#meta')).toBeNull();
      expect(localStorage.getItem('github-stars-manager#shard:core')).toBeNull();
      expect(localStorage.getItem('github-stars-manager-auth')).toBeNull();
      expect(localStorage.getItem('github-stars-search-history')).toBeNull();
      expect(sessionStorage.getItem('github-stars-manager-backend-secret')).toBeNull();

      // Global & registry keys untouched
      expect(readProfiles()).toHaveLength(2);
      expect(localStorage.getItem(ACTIVE_PROFILE_KEY)).toBe('default');
      expect(localStorage.getItem('github-stars-manager-backend-url')).toBe('https://backend.example.com/api');

      // Second profile keys completely intact
      expect(localStorage.getItem('github-stars-manager__p_222#meta')).toBe('{"format":1}');
      expect(localStorage.getItem('github-stars-manager__p_222#shard:core')).toBe('{"state":{}}');
      expect(localStorage.getItem('github-stars-manager-auth__p_222')).toBe('{"user":{"login":"bob"}}');
      expect(localStorage.getItem('github-stars-search-history__p_222')).toBe('["vue"]');
      expect(sessionStorage.getItem('github-stars-manager-backend-secret__p_222')).toBe('sec-bob');
    });
  });
});
