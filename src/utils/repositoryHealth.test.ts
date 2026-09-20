import { describe, it, expect } from 'vitest';
import type { Release, Repository } from '../types';
import {
  deriveRepositoryHealthSnapshot,
  deriveRepositoryHealthSignals,
  groupRepositoryHealthFacts,
  hasDeclaredLicense,
  hasRecentActivity,
  isArchivedRepository,
  isPrereleaseRelease,
  NO_RECENT_ACTIVITY_DAYS,
  releasesForRepository,
  REPOSITORY_HEALTH_GROUP_ORDER,
} from './repositoryHealth';

const NOW = Date.parse('2026-09-17T00:00:00.000Z');

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: 'alpha',
    full_name: 'acme/alpha',
    description: 'A test repository',
    html_url: 'https://github.com/acme/alpha',
    stargazers_count: 1500,
    forks_count: 120,
    forks: 120,
    language: 'TypeScript',
    created_at: '2020-09-17T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    pushed_at: '2026-09-01T00:00:00.000Z',
    owner: { login: 'acme', avatar_url: '' },
    topics: [],
    license: 'MIT',
    ...overrides,
  };
}

function makeRelease(overrides: Partial<Release> & Pick<Release, 'id' | 'tag_name' | 'published_at'>): Release {
  return {
    name: null,
    body: null,
    html_url: `https://github.com/acme/alpha/releases/tag/${overrides.tag_name}`,
    assets: [],
    repository: { id: 1, full_name: 'acme/alpha', name: 'alpha' },
    ...overrides,
  };
}

describe('isPrereleaseRelease', () => {
  it('trusts the GitHub prerelease flag', () => {
    expect(isPrereleaseRelease({ prerelease: true, tag_name: 'v1.0.0' })).toBe(true);
  });

  it('falls back to tag tokens without matching unrelated words', () => {
    expect(isPrereleaseRelease({ tag_name: 'v1.2.0-rc1' })).toBe(true);
    expect(isPrereleaseRelease({ tag_name: 'v1.2.0-beta.2' })).toBe(true);
    expect(isPrereleaseRelease({ tag_name: 'nightly-2026-01-01' })).toBe(true);
    // 'presto' 只是普通单词，不能因为含有 'pre' 就被当作预发布
    expect(isPrereleaseRelease({ tag_name: 'presto-1.0.0' })).toBe(false);
    expect(isPrereleaseRelease({ tag_name: 'v1.2.0' })).toBe(false);
  });
});

describe('releasesForRepository', () => {
  it('keeps only the matching repository and sorts newest first', () => {
    const releases = [
      makeRelease({ id: 1, tag_name: 'v1.0.0', published_at: '2025-01-01T00:00:00.000Z' }),
      makeRelease({ id: 2, tag_name: 'v2.0.0', published_at: '2026-01-01T00:00:00.000Z' }),
      makeRelease({
        id: 3,
        tag_name: 'v9.0.0',
        published_at: '2026-02-01T00:00:00.000Z',
        repository: { id: 99, full_name: 'other/repo', name: 'repo' },
      }),
      makeRelease({ id: 4, tag_name: 'broken', published_at: 'not-a-date' }),
    ];

    expect(releasesForRepository(releases, 1).map((release) => release.id)).toEqual([2, 1]);
  });
});

describe('deriveRepositoryHealthSnapshot', () => {
  it('derives release facts, age and activity from local data only', () => {
    const releases = [
      makeRelease({ id: 1, tag_name: 'v1.0.0', published_at: '2025-01-01T00:00:00.000Z' }),
      makeRelease({ id: 2, tag_name: 'v1.1.0', published_at: '2026-01-01T00:00:00.000Z' }),
      makeRelease({ id: 3, tag_name: 'v2.0.0-rc1', published_at: '2026-06-01T00:00:00.000Z' }),
    ];

    const snapshot = deriveRepositoryHealthSnapshot(
      makeRepo({ has_fetched_releases: true }),
      releases,
      undefined,
      NOW,
    );

    expect(snapshot.releaseCount).toBe(3);
    expect(snapshot.hasReleases).toBe(true);
    expect(snapshot.latestReleaseAt).toBe('2026-06-01T00:00:00.000Z');
    expect(snapshot.latestStableVersion).toBe('v1.1.0');
    expect(snapshot.latestPrereleaseVersion).toBe('v2.0.0-rc1');
    // 仓库年龄恰好 6 年（含闰年共 2191 天）→ 3 个 release ≈ 0.5 次/年
    expect(snapshot.ageDays).toBe(2191);
    expect(snapshot.releasesPerYear).toBe(0.5);
    expect(snapshot.daysSinceLastPush).toBe(16);
    expect(snapshot.stars).toBe(1500);
    expect(snapshot.forks).toBe(120);
    expect(snapshot.license).toBe('MIT');
  });

  it('marks enrichment-backed facts as unknown when no enrichment is supplied', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo(), [], undefined, NOW);

    expect(snapshot.contributors).toBeUndefined();
    expect(snapshot.closedIssues).toBeUndefined();
    expect(snapshot.latestCommitAt).toBeUndefined();
    expect(snapshot.recentCommitCount).toBeUndefined();
    expect(snapshot.hasSecurityPolicy).toBeUndefined();
    expect(snapshot.hasCI).toBeUndefined();
    expect(snapshot.hasReadme).toBeUndefined();
    expect(snapshot.hasDocs).toBeUndefined();
  });

  it('prefers forks_count and falls back to the legacy forks field', () => {
    expect(deriveRepositoryHealthSnapshot(makeRepo({ forks_count: 7 }), [], undefined, NOW).forks).toBe(7);
    expect(
      deriveRepositoryHealthSnapshot(
        makeRepo({ forks_count: undefined as unknown as number, forks: 3 }),
        [],
        undefined,
        NOW,
      ).forks,
    ).toBe(3);
  });

  it('keeps release frequency unknown instead of reporting zero when nothing is known', () => {
    // 既没有可解析的创建时间、也没有 Release 数据：只能承认「不知道」。
    const unknown = deriveRepositoryHealthSnapshot(
      makeRepo({ created_at: 'not-a-date' }),
      undefined,
      undefined,
      NOW,
    );
    expect(unknown.releasesPerYear).toBeNull();
    expect(unknown.ageDays).toBeNull();

    // 给了 Release 数组（哪怕是空数组）就说明调用方知道 Release 情况，此时 0 才是事实。
    const knownEmpty = deriveRepositoryHealthSnapshot(
      makeRepo({ created_at: 'not-a-date' }),
      [],
      undefined,
      NOW,
    );
    expect(knownEmpty.releasesPerYear).toBe(0);
  });

  it('does not report a release total as a per-year frequency when the age is unknown', () => {
    // created_at 不可解析 → 没有时间窗口可以换算「频率」。
    // 此时把 Release 总数当成「次/年」是错的（例如 3 条会被读成 3 次/年）。
    const snapshot = deriveRepositoryHealthSnapshot(
      makeRepo({ created_at: 'not-a-date', has_fetched_releases: true }),
      [
        makeRelease({ id: 1, tag_name: 'v1', published_at: '2025-01-01T00:00:00.000Z' }),
        makeRelease({ id: 2, tag_name: 'v2', published_at: '2025-06-01T00:00:00.000Z' }),
        makeRelease({ id: 3, tag_name: 'v3', published_at: '2026-01-01T00:00:00.000Z' }),
      ],
      undefined,
      NOW,
    );

    expect(snapshot.releaseCount).toBe(3);
    expect(snapshot.releasesPerYear).toBeNull();
  });

  it('keeps missing GitHub status fields unknown instead of reporting false', () => {
    // 后端 schema 不存储这些列，旧数据也可能缺失：必须保持 undefined，
    // 否则面板会把「未知」显示成「否」，等于伪造事实。
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo(), [], undefined, NOW);
    expect(snapshot.archived).toBeUndefined();
    expect(snapshot.disabled).toBeUndefined();
    expect(snapshot.fork).toBeUndefined();
    expect(snapshot.isTemplate).toBeUndefined();

    // 已知事实照实传递
    const known = deriveRepositoryHealthSnapshot(
      makeRepo({ archived: false, fork: true, is_template: false }),
      [],
      undefined,
      NOW,
    );
    expect(known.archived).toBe(false);
    expect(known.fork).toBe(true);
    expect(known.isTemplate).toBe(false);
  });

  it('falls back to updated_at when pushed_at is unusable, like the MCP mirrors', () => {
    const snapshot = deriveRepositoryHealthSnapshot(
      makeRepo({ pushed_at: 'not-a-date', updated_at: '2026-09-10T00:00:00.000Z' }),
      [],
      undefined,
      NOW,
    );
    expect(snapshot.daysSinceLastPush).toBe(7);
  });

  it('never emits a numeric health score', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo(), [], undefined, NOW);
    expect(snapshot).not.toHaveProperty('score');
    expect(snapshot).not.toHaveProperty('healthScore');
  });
});

describe('conservative health signals', () => {
  it('reports archived / disabled as objective status', () => {
    const snapshot = deriveRepositoryHealthSnapshot(
      makeRepo({ archived: true, disabled: true }),
      [],
      undefined,
      NOW,
    );
    expect(snapshot.signals.map((signal) => signal.id)).toEqual(['archived', 'disabled']);
  });

  it('only reports no-releases once releases were actually synced', () => {
    const neverSynced = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: false }), [], undefined, NOW);
    expect(neverSynced.signals.map((signal) => signal.id)).not.toContain('no-releases');

    const syncedEmpty = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: true }), [], undefined, NOW);
    expect(syncedEmpty.signals.map((signal) => signal.id)).toContain('no-releases');
  });

  it('does not claim release facts when the caller has no release data at all', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: true }), undefined, undefined, NOW);
    expect(snapshot.releasesFetched).toBe(false);
    expect(snapshot.signals.map((signal) => signal.id)).not.toContain('no-releases');
  });

  it('flags stale pushes neutrally, without calling a mature project unhealthy', () => {
    const mature = makeRepo({ pushed_at: '2024-01-01T00:00:00.000Z' });
    const snapshot = deriveRepositoryHealthSnapshot(mature, [], undefined, NOW);
    const signal = snapshot.signals.find((item) => item.id === 'no-recent-activity');

    expect(signal).toBeDefined();
    // 观测值就是最后一次 push 时间，供 UI 原样展示，不含任何判定
    expect(signal?.since).toBe(Date.parse('2024-01-01T00:00:00.000Z'));
    expect(snapshot.daysSinceLastPush).toBeGreaterThan(NO_RECENT_ACTIVITY_DAYS);
    // 成熟项目仍然保留完整的客观事实
    expect(snapshot.stars).toBe(1500);
    expect(snapshot.license).toBe('MIT');
  });

  it('does not flag repositories pushed within the threshold', () => {
    const recent = makeRepo({ pushed_at: '2026-08-01T00:00:00.000Z' });
    expect(
      deriveRepositoryHealthSnapshot(recent, [], undefined, NOW).signals.map((s) => s.id),
    ).not.toContain('no-recent-activity');
  });

  it('keeps signal order stable', () => {
    const snapshot = deriveRepositoryHealthSnapshot(
      makeRepo({ archived: true, disabled: true, pushed_at: '2020-01-01T00:00:00.000Z', has_fetched_releases: true }),
      [],
      undefined,
      NOW,
    );
    expect(deriveRepositoryHealthSignals(snapshot).map((signal) => signal.id)).toEqual([
      'archived',
      'disabled',
      'no-releases',
      'no-recent-activity',
    ]);
  });
});

describe('groupRepositoryHealthFacts', () => {
  it('groups every fact in the fixed Activity/Maintenance/Community/Maturity order', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: true }), [], undefined, NOW);
    const views = groupRepositoryHealthFacts(snapshot);

    expect(views.map((view) => view.group)).toEqual([...REPOSITORY_HEALTH_GROUP_ORDER]);
    expect(views.flatMap((view) => view.facts).length).toBeGreaterThan(20);
  });

  it('distinguishes unknown facts from known-empty facts', () => {
    const noLicense = deriveRepositoryHealthSnapshot(makeRepo({ license: null }), [], undefined, NOW);
    const licenseFact = groupRepositoryHealthFacts(noLicense)
      .flatMap((view) => view.facts)
      .find((fact) => fact.id === 'license');
    // 已知且为空 → null
    expect(licenseFact?.value).toBeNull();

    const unknownContributors = groupRepositoryHealthFacts(noLicense)
      .flatMap((view) => view.facts)
      .find((fact) => fact.id === 'contributors');
    // 尚未获得 → undefined
    expect(unknownContributors?.value).toBeUndefined();
  });

  it('treats NOASSERTION as no declared license', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo({ license: 'NOASSERTION' }), [], undefined, NOW);
    const licenseFact = groupRepositoryHealthFacts(snapshot)
      .flatMap((view) => view.facts)
      .find((fact) => fact.id === 'license');
    expect(licenseFact?.value).toBeNull();
  });

  it('reports hasReleases as unknown until releases were synced', () => {
    const unsynced = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: false }), [], undefined, NOW);
    const fact = groupRepositoryHealthFacts(unsynced)
      .flatMap((view) => view.facts)
      .find((item) => item.id === 'hasReleases');
    expect(fact?.value).toBeUndefined();

    const synced = deriveRepositoryHealthSnapshot(makeRepo({ has_fetched_releases: true }), [], undefined, NOW);
    const syncedFact = groupRepositoryHealthFacts(synced)
      .flatMap((view) => view.facts)
      .find((item) => item.id === 'hasReleases');
    expect(syncedFact?.value).toBe(false);
  });

  it('marks enrichment-backed facts with their source so the UI can label them', () => {
    const snapshot = deriveRepositoryHealthSnapshot(makeRepo(), [], undefined, NOW);
    const contributors = groupRepositoryHealthFacts(snapshot)
      .flatMap((view) => view.facts)
      .find((fact) => fact.id === 'contributors');
    expect(contributors?.source).toBe('enrichment');
  });
});

describe('list filter predicates', () => {
  it('keeps a missing archived field unknown instead of claiming it is not archived', () => {
    // 未知必须是 undefined：否则 healthArchived=false 会把本地没有该字段的仓库也算进来
    expect(isArchivedRepository(makeRepo())).toBeUndefined();
    expect(isArchivedRepository(makeRepo({ archived: true }))).toBe(true);
    expect(isArchivedRepository(makeRepo({ archived: false }))).toBe(false);
  });

  it('never matches unknown archived with either filter value', () => {
    const unknown = isArchivedRepository(makeRepo());
    expect(unknown === true).toBe(false);
    expect(unknown === false).toBe(false);
  });

  it('falls back to updated_at for recent activity', () => {
    const repo = makeRepo({ pushed_at: 'not-a-date', updated_at: '2026-09-10T00:00:00.000Z' });
    expect(hasRecentActivity(repo, NOW)).toBe(true);
  });

  it('treats unparsable activity timestamps as not recently active', () => {
    expect(hasRecentActivity(makeRepo({ pushed_at: '', updated_at: '' }), NOW)).toBe(false);
  });

  it('reuses the shared license normalization', () => {
    expect(hasDeclaredLicense(makeRepo({ license: 'Apache-2.0' }))).toBe(true);
    expect(hasDeclaredLicense(makeRepo({ license: null }))).toBe(false);
    expect(hasDeclaredLicense(makeRepo({ license: 'Other' }))).toBe(false);
  });
});
