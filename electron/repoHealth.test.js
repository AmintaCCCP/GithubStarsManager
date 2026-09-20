const test = require('node:test');
const assert = require('node:assert/strict');

const {
  NO_RECENT_ACTIVITY_DAYS,
  deriveRepositoryHealthFacts,
  hasRecentActivity,
  isArchivedRepository,
  isPrereleaseRelease,
  releasesForRepository,
} = require('./repoHealth');

const NOW = Date.parse('2026-09-17T00:00:00.000Z');

function repo(overrides = {}) {
  return {
    id: 1,
    full_name: 'acme/alpha',
    created_at: '2020-09-17T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    pushed_at: '2026-09-01T00:00:00.000Z',
    stargazers_count: 1500,
    forks_count: 120,
    license: 'MIT',
    has_fetched_releases: true,
    ...overrides,
  };
}

function release(id, tag, publishedAt, extra = {}) {
  return {
    id,
    repo_id: 1,
    tag_name: tag,
    published_at: publishedAt,
    prerelease: false,
    ...extra,
  };
}

test('Electron health facts mirror the renderer algorithm', () => {
  const facts = deriveRepositoryHealthFacts(
    repo(),
    [
      release(1, 'v1.0.0', '2025-01-01T00:00:00.000Z'),
      release(2, 'v1.1.0', '2026-01-01T00:00:00.000Z'),
      release(3, 'v2.0.0-rc1', '2026-06-01T00:00:00.000Z', { prerelease: true }),
    ],
    NOW
  );

  assert.equal(facts.release_count, 3);
  assert.equal(facts.has_releases, true);
  assert.equal(facts.latest_release_at, '2026-06-01T00:00:00.000Z');
  assert.equal(facts.latest_stable_version, 'v1.1.0');
  assert.equal(facts.latest_prerelease_version, 'v2.0.0-rc1');
  assert.equal(facts.age_days, 2191);
  assert.equal(facts.days_since_last_push, 16);
  assert.equal(facts.releases_per_year, 0.5);
  assert.equal(facts.stars, 1500);
});

test('Electron health facts keep unknown values null instead of guessing', () => {
  const withoutReleases = deriveRepositoryHealthFacts(repo(), undefined, NOW);
  assert.equal(withoutReleases.release_count, null);
  assert.equal(withoutReleases.has_releases, null);
  assert.equal(withoutReleases.releases_fetched, false);

  // 后端 schema 不存储 GitHub 原生状态字段时必须保持 null（未知），不能断言「未归档」。
  const withoutStatus = deriveRepositoryHealthFacts(repo(), [], NOW);
  assert.equal(withoutStatus.archived, null);
  assert.equal(withoutStatus.disabled, null);
  assert.equal(withoutStatus.fork, null);
  assert.equal(withoutStatus.is_template, null);
  assert.equal(withoutStatus.signals.includes('archived'), false);

  // 有了事实就照实上报
  const archived = deriveRepositoryHealthFacts(repo({ archived: true }), [], NOW);
  assert.equal(archived.archived, true);
  assert.equal(archived.signals.includes('archived'), true);
});

test('Electron health signals stay conservative and ordered', () => {
  const facts = deriveRepositoryHealthFacts(
    repo({ archived: true, disabled: true, pushed_at: '2020-01-01T00:00:00.000Z' }),
    [],
    NOW
  );
  assert.deepEqual(facts.signals, ['archived', 'disabled', 'no-releases', 'no-recent-activity']);
});

test('Electron never invents release facts without release data', () => {
  const facts = deriveRepositoryHealthFacts(repo({ has_fetched_releases: false }), undefined, NOW);
  assert.equal(facts.signals.includes('no-releases'), false);
});

test('Electron prerelease detection matches tag tokens only', () => {
  assert.equal(isPrereleaseRelease({ prerelease: true, tag_name: 'v1.0.0' }), true);
  assert.equal(isPrereleaseRelease({ tag_name: 'v1.2.0-rc1' }), true);
  assert.equal(isPrereleaseRelease({ tag_name: 'presto-1.0.0' }), false);
  assert.equal(isPrereleaseRelease({ tag_name: 'v1.2.0' }), false);
});

test('Electron release lookup filters by repo and sorts newest first', () => {
  const releases = [
    release(1, 'v1.0.0', '2025-01-01T00:00:00.000Z'),
    release(2, 'v2.0.0', '2026-01-01T00:00:00.000Z'),
    { ...release(3, 'v9.0.0', '2026-02-01T00:00:00.000Z'), repo_id: 99 },
    release(4, 'broken', 'not-a-date'),
  ];
  assert.deepEqual(
    releasesForRepository(releases, 1).map((item) => item.id),
    [2, 1]
  );
});

test('Electron filter predicates match the renderer semantics', () => {
  assert.equal(isArchivedRepository({}), undefined);
  assert.equal(isArchivedRepository({ archived: false }), false);
  assert.equal(isArchivedRepository({ archived: true }), true);
  assert.equal(hasRecentActivity({ pushed_at: '2026-09-10T00:00:00.000Z' }, NOW), true);
  assert.equal(hasRecentActivity({ pushed_at: '2024-01-01T00:00:00.000Z' }, NOW), false);
  // 时间不可解析时不算「近期活跃」，且阈值就是 12 个月
  assert.equal(hasRecentActivity({ pushed_at: '', updated_at: '' }, NOW), false);
  assert.equal(typeof NO_RECENT_ACTIVITY_DAYS, 'number');
});
