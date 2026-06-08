import type {
  AppState,
  CustomReleaseRepository,
  Release,
  ReleaseSourceId,
  ReleaseSourceSettings,
  Repository,
} from '../types';
import { defaultReleaseSourceSettings } from '../types';

export const STARRED_RELEASE_SOURCE_ID: ReleaseSourceId = 'starred-release-subscription';
export const WATCH_CUSTOM_RELEASE_SOURCE_ID: ReleaseSourceId = 'watch-custom-release';
export const CUSTOM_RELEASE_SOURCE_ID: ReleaseSourceId = 'custom-release';

export const RELEASE_SOURCE_LABELS: Record<ReleaseSourceId, { zh: string; en: string }> = {
  'starred-release-subscription': { zh: '星标订阅', en: 'Starred subscriptions' },
  'watch-custom-release': { zh: 'watch-custom-release', en: 'GitHub Watch releases' },
  'custom-release': { zh: '自定义订阅', en: 'Custom subscriptions' },
};

const RELEASE_SOURCE_IDS: ReleaseSourceId[] = [
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
  CUSTOM_RELEASE_SOURCE_ID,
];

export interface NormalizedGitHubRepoInput {
  owner: string;
  name: string;
  full_name: string;
  html_url: string;
}

export interface ResolvedReleaseSourceRepository {
  repository: Repository;
  sources: ReleaseSourceId[];
}

export interface ResolvedReleaseSources {
  repositories: Repository[];
  entries: ResolvedReleaseSourceRepository[];
  enabledSourceIds: ReleaseSourceId[];
}

export const normalizeRepoKey = (fullName: string): string => fullName.trim().toLowerCase();

export const isReleaseSourceId = (value: unknown): value is ReleaseSourceId => (
  typeof value === 'string' && RELEASE_SOURCE_IDS.includes(value as ReleaseSourceId)
);

export const getReleaseSourceLabel = (sourceId: ReleaseSourceId, language: 'zh' | 'en'): string => {
  const label = RELEASE_SOURCE_LABELS[sourceId];
  return language === 'zh' ? label.zh : label.en;
};

export const normalizeGitHubRepoInput = (input: string): NormalizedGitHubRepoInput | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let candidate = trimmed.replace(/^github\.com\//i, '');
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://github.com/${candidate}`;
    const url = new URL(withProtocol);
    if (url.hostname.toLowerCase() !== 'github.com') return null;
    candidate = url.pathname.replace(/^\/+|\/+$/g, '');
  } catch {
    candidate = trimmed.replace(/^github\.com\//i, '').replace(/^\/+|\/+$/g, '');
  }

  const [owner, rawRepo, ...rest] = candidate.split('/');
  if (!owner || !rawRepo || rest.length > 0) return null;

  const name = rawRepo.replace(/\.git$/i, '');
  const ownerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
  const repoPattern = /^[A-Za-z0-9._-]+$/;
  if (!ownerPattern.test(owner) || !repoPattern.test(name)) return null;

  return {
    owner,
    name,
    full_name: `${owner}/${name}`,
    html_url: `https://github.com/${owner}/${name}`,
  };
};

export const getLocalReleaseRepoId = (fullName: string, sourceId?: ReleaseSourceId): number => {
  const input = `${sourceId || 'release-source'}:${normalizeRepoKey(fullName)}`;
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return -Math.abs(hash || 1);
};

export const createCustomReleaseRepository = (
  input: string,
  sourceId: ReleaseSourceId = CUSTOM_RELEASE_SOURCE_ID,
  now = new Date().toISOString()
): CustomReleaseRepository | null => {
  const normalized = normalizeGitHubRepoInput(input);
  if (!normalized) return null;

  return {
    id: getLocalReleaseRepoId(normalized.full_name, sourceId),
    name: normalized.name,
    full_name: normalized.full_name,
    html_url: normalized.html_url,
    owner: {
      login: normalized.owner,
      avatar_url: `https://github.com/${normalized.owner}.png`,
    },
    source_added_at: now,
  };
};

export const repositoryToCustomReleaseRepository = (
  repository: Repository,
  sourceId: ReleaseSourceId,
  now = new Date().toISOString()
): CustomReleaseRepository => ({
  id: getLocalReleaseRepoId(repository.full_name, sourceId),
  name: repository.name,
  full_name: repository.full_name,
  html_url: repository.html_url,
  owner: repository.owner,
  has_fetched_releases: repository.has_fetched_releases,
  last_release_fetch_time: repository.last_release_fetch_time,
  source_added_at: now,
});

export const customReleaseRepositoryToRepository = (
  repo: CustomReleaseRepository,
  sourceId: ReleaseSourceId
): Repository => ({
  id: repo.id || getLocalReleaseRepoId(repo.full_name, sourceId),
  name: repo.name,
  full_name: repo.full_name,
  description: null,
  html_url: repo.html_url,
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: repo.source_added_at || new Date(0).toISOString(),
  updated_at: repo.last_release_fetch_time || repo.source_added_at || new Date(0).toISOString(),
  pushed_at: repo.last_release_fetch_time || repo.source_added_at || new Date(0).toISOString(),
  owner: repo.owner,
  topics: [],
  has_fetched_releases: repo.has_fetched_releases,
  last_release_fetch_time: repo.last_release_fetch_time,
  subscribed_to_releases: true,
});

const normalizeCustomReleaseRepo = (
  value: unknown,
  sourceId: ReleaseSourceId
): CustomReleaseRepository | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const fullName = typeof record.full_name === 'string' ? record.full_name : '';
  const parsed = normalizeGitHubRepoInput(fullName);
  if (!parsed) return null;

  const ownerRecord = record.owner && typeof record.owner === 'object'
    ? record.owner as Record<string, unknown>
    : {};

  return {
    id: typeof record.id === 'number' && Number.isFinite(record.id)
      ? record.id
      : getLocalReleaseRepoId(parsed.full_name, sourceId),
    name: typeof record.name === 'string' && record.name ? record.name : parsed.name,
    full_name: parsed.full_name,
    html_url: typeof record.html_url === 'string' && record.html_url ? record.html_url : parsed.html_url,
    owner: {
      login: typeof ownerRecord.login === 'string' && ownerRecord.login ? ownerRecord.login : parsed.owner,
      avatar_url: typeof ownerRecord.avatar_url === 'string' && ownerRecord.avatar_url
        ? ownerRecord.avatar_url
        : `https://github.com/${parsed.owner}.png`,
    },
    has_fetched_releases: typeof record.has_fetched_releases === 'boolean' ? record.has_fetched_releases : undefined,
    last_release_fetch_time: typeof record.last_release_fetch_time === 'string' ? record.last_release_fetch_time : undefined,
    source_added_at: typeof record.source_added_at === 'string' ? record.source_added_at : undefined,
  };
};

export const normalizeCustomReleaseRepositories = (
  value: unknown,
  sourceId: ReleaseSourceId
): CustomReleaseRepository[] => {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const normalized: CustomReleaseRepository[] = [];
  for (const item of value) {
    const repo = normalizeCustomReleaseRepo(item, sourceId);
    if (!repo) continue;
    const key = normalizeRepoKey(repo.full_name);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(repo);
  }
  return normalized;
};

export const normalizeReleaseSourceSettings = (value: unknown): ReleaseSourceSettings => {
  if (!value || typeof value !== 'object') return defaultReleaseSourceSettings;
  const record = value as Record<string, unknown>;
  const enabledSourceIds = Array.isArray(record.enabledSourceIds)
    ? record.enabledSourceIds.filter(isReleaseSourceId)
    : defaultReleaseSourceSettings.enabledSourceIds;

  return {
    enabledSourceIds: enabledSourceIds.length > 0
      ? Array.from(new Set(enabledSourceIds))
      : defaultReleaseSourceSettings.enabledSourceIds,
    watchCustomReleaseRepos: normalizeCustomReleaseRepositories(
      record.watchCustomReleaseRepos,
      WATCH_CUSTOM_RELEASE_SOURCE_ID
    ),
    customReleaseRepos: normalizeCustomReleaseRepositories(
      record.customReleaseRepos,
      CUSTOM_RELEASE_SOURCE_ID
    ),
  };
};

export const mergeReleaseSourceSettings = (
  current: ReleaseSourceSettings,
  incoming: ReleaseSourceSettings
): ReleaseSourceSettings => {
  const mergeRepos = (
    a: CustomReleaseRepository[],
    b: CustomReleaseRepository[]
  ): CustomReleaseRepository[] => {
    const merged = new Map<string, CustomReleaseRepository>();
    [...a, ...b].forEach(repo => {
      const key = normalizeRepoKey(repo.full_name);
      if (!merged.has(key)) merged.set(key, repo);
    });
    return Array.from(merged.values());
  };

  return normalizeReleaseSourceSettings({
    enabledSourceIds: Array.from(new Set([...current.enabledSourceIds, ...incoming.enabledSourceIds])),
    watchCustomReleaseRepos: mergeRepos(current.watchCustomReleaseRepos, incoming.watchCustomReleaseRepos),
    customReleaseRepos: mergeRepos(current.customReleaseRepos, incoming.customReleaseRepos),
  });
};

export const resolveReleaseSources = (
  state: Pick<AppState, 'repositories' | 'releaseSubscriptions' | 'releaseSourceSettings'>
): ResolvedReleaseSources => {
  const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
  const enabled = new Set(settings.enabledSourceIds);
  const entriesByKey = new Map<string, ResolvedReleaseSourceRepository>();

  const addRepository = (repository: Repository, sourceId: ReleaseSourceId) => {
    const key = normalizeRepoKey(repository.full_name);
    const existing = entriesByKey.get(key);
    if (existing) {
      if (!existing.sources.includes(sourceId)) existing.sources.push(sourceId);
      return;
    }
    entriesByKey.set(key, { repository, sources: [sourceId] });
  };

  if (enabled.has(STARRED_RELEASE_SOURCE_ID)) {
    state.repositories
      .filter(repo => state.releaseSubscriptions.has(repo.id))
      .forEach(repo => addRepository(repo, STARRED_RELEASE_SOURCE_ID));
  }

  if (enabled.has(WATCH_CUSTOM_RELEASE_SOURCE_ID)) {
    settings.watchCustomReleaseRepos.forEach(repo => {
      addRepository(customReleaseRepositoryToRepository(repo, WATCH_CUSTOM_RELEASE_SOURCE_ID), WATCH_CUSTOM_RELEASE_SOURCE_ID);
    });
  }

  if (enabled.has(CUSTOM_RELEASE_SOURCE_ID)) {
    settings.customReleaseRepos.forEach(repo => {
      addRepository(customReleaseRepositoryToRepository(repo, CUSTOM_RELEASE_SOURCE_ID), CUSTOM_RELEASE_SOURCE_ID);
    });
  }

  const entries = Array.from(entriesByKey.values());
  return {
    entries,
    repositories: entries.map(entry => entry.repository),
    enabledSourceIds: settings.enabledSourceIds,
  };
};

export const getSourcesForReleaseRepository = (
  state: Pick<AppState, 'repositories' | 'releaseSubscriptions' | 'releaseSourceSettings'>,
  repository: Release['repository']
): ReleaseSourceId[] => {
  const repoKey = normalizeRepoKey(repository.full_name);
  const settings = normalizeReleaseSourceSettings(state.releaseSourceSettings);
  const sources: ReleaseSourceId[] = [];

  if (
    state.repositories.some(repo => normalizeRepoKey(repo.full_name) === repoKey && state.releaseSubscriptions.has(repo.id))
  ) {
    sources.push(STARRED_RELEASE_SOURCE_ID);
  }

  if (
    settings.watchCustomReleaseRepos.some(repo => normalizeRepoKey(repo.full_name) === repoKey)
  ) {
    sources.push(WATCH_CUSTOM_RELEASE_SOURCE_ID);
  }

  if (
    settings.customReleaseRepos.some(repo => normalizeRepoKey(repo.full_name) === repoKey)
  ) {
    sources.push(CUSTOM_RELEASE_SOURCE_ID);
  }

  return sources;
};

export const releaseBelongsToResolvedSources = (
  release: Release,
  resolved: ResolvedReleaseSources
): boolean => {
  const repoKey = normalizeRepoKey(release.repository.full_name);
  return resolved.entries.some(entry => normalizeRepoKey(entry.repository.full_name) === repoKey);
};
