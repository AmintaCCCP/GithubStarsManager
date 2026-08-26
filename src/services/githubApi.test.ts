import { describe, expect, it, vi } from 'vitest';
import type { Repository, Release } from '../types';
import { GitHubApiService } from './githubApi';

const makeRepository = (id: number, fullName: string, overrides: Partial<Repository> = {}): Repository => {
  const [owner, name] = fullName.split('/');
  return {
    id,
    name,
    full_name: fullName,
    description: null,
    html_url: `https://github.com/${fullName}`,
    stargazers_count: 1,
    forks_count: 0,
    forks: 0,
    language: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    pushed_at: '2026-01-01T00:00:00.000Z',
    owner: { login: owner, avatar_url: `https://github.com/${owner}.png` },
    topics: [],
    ...overrides,
  };
};

const makeRelease = (id: number, publishedAt: string, overrides: Partial<Release> = {}): Release => ({
  id,
  tag_name: `v${id}`,
  name: `Release ${id}`,
  body: null,
  published_at: publishedAt,
  html_url: `https://github.com/owner/repo/releases/tag/v${id}`,
  assets: [
    {
      id: 100 + id,
      name: 'app.dmg',
      size: 1000,
      download_count: 0,
      browser_download_url: 'https://example.com/app.dmg',
      content_type: 'application/octet-stream',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    },
  ],
  repository: { id: 0, full_name: 'owner/repo', name: 'repo' },
  ...overrides,
});

const releasePage = (releases: Release[], hasMore = false) => ({ releases, hasMore });

describe('GitHubApiService.getMultipleRepositoryReleases asset refresh', () => {
  it('collects the latest release per already-synced repo when refreshExistingAssets is enabled', async () => {
    const service = new GitHubApiService('token');
    const latest = makeRelease(1, '2026-01-03T00:00:00.000Z');
    const older = makeRelease(2, '2026-01-01T00:00:00.000Z');

    // 已同步仓库：水印在 01-02，最新 Release(01-03) 在水印之后（fresh），老 Release 在水印前。
    vi.spyOn(service, 'getRepositoryReleasesPage').mockResolvedValueOnce(
      releasePage([latest, older]) as never
    );
    vi.spyOn(service, 'fetchAllReleasesForRepo').mockResolvedValueOnce([] as never);

    const repo = makeRepository(10, 'owner/repo', { has_fetched_releases: true, last_release_fetch_time: '2026-01-02T00:00:00.000Z' });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: true, refreshExistingAssets: true }
    );

    // 新列表包含水印后的最新 Release
    expect(result.releases.map(r => r.id)).toEqual([1]);
    // 最新 Release 也被收集，用于资产指纹比对，且带上了仓库 id
    expect(result.latestReleases).toHaveLength(1);
    expect(result.latestReleases![0].id).toBe(1);
    expect(result.latestReleases![0].repository.id).toBe(10);
  });

  it('collects latest release even when it is below the watermark (already fetched)', async () => {
    const service = new GitHubApiService('token');
    const latest = makeRelease(1, '2026-01-01T00:00:00.000Z'); // 水印之前
    const older = makeRelease(2, '2025-12-01T00:00:00.000Z');

    // 返回一页包含两条，都在水印之前，故 releases 为空，但最新条仍应被收集
    vi.spyOn(service, 'getRepositoryReleasesPage').mockResolvedValueOnce(
      releasePage([latest, older]) as never
    );

    const repo = makeRepository(10, 'owner/repo', { has_fetched_releases: true, last_release_fetch_time: '2026-01-02T00:00:00.000Z' });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: true, refreshExistingAssets: true }
    );

    expect(result.releases).toHaveLength(0);
    expect(result.latestReleases).toHaveLength(1);
    expect(result.latestReleases![0].id).toBe(1);
    expect(result.latestReleases![0].repository.id).toBe(10);
  });

  it('does not populate latestReleases when refreshExistingAssets is disabled', async () => {
    const service = new GitHubApiService('token');
    const latest = makeRelease(1, '2026-01-03T00:00:00.000Z');

    vi.spyOn(service, 'getRepositoryReleasesPage').mockResolvedValueOnce(releasePage([latest]) as never);

    const repo = makeRepository(10, 'owner/repo', { has_fetched_releases: true, last_release_fetch_time: '2026-01-02T00:00:00.000Z' });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: true, refreshExistingAssets: false }
    );

    expect(result.latestReleases).toBeUndefined();
  });

  it('skips a prerelease latest when includePreRelease is false and collects the newest stable release instead', async () => {
    const service = new GitHubApiService('token');
    const prerelease = makeRelease(1, '2026-01-05T00:00:00.000Z', { prerelease: true });
    const stable = makeRelease(2, '2026-01-04T00:00:00.000Z');

    // 第一页第一条是新发布（预发布），其下才是最新的正式发行
    vi.spyOn(service, 'getRepositoryReleasesPage').mockResolvedValueOnce(
      releasePage([prerelease, stable]) as never
    );

    const repo = makeRepository(10, 'owner/repo', { has_fetched_releases: true, last_release_fetch_time: '2026-01-02T00:00:00.000Z' });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: false, refreshExistingAssets: true }
    );

    // 最新 Release 应跳过预发布，收集到第一个正式发行
    expect(result.latestReleases).toHaveLength(1);
    expect(result.latestReleases![0].id).toBe(2);
    expect(result.latestReleases![0].repository.id).toBe(10);
  });

  it('continues past page one of only prereleases to collect the newest stable release', async () => {
    const service = new GitHubApiService('token');
    // 第一页 10 条全是预发布（且都在水印之后），第二页才出现正式版
    const page1 = Array.from({ length: 10 }, (_, i) =>
      makeRelease(100 + i, `2026-01-${String(20 - i).padStart(2, '0')}T00:00:00.000Z`, { prerelease: true })
    );
    const stable = makeRelease(50, '2026-01-05T00:00:00.000Z');
    const older = makeRelease(40, '2025-12-01T00:00:00.000Z');

    vi.spyOn(service, 'getRepositoryReleasesPage')
      .mockResolvedValueOnce(releasePage(page1, true) as never)
      .mockResolvedValueOnce(releasePage([stable, older]) as never);

    const repo = makeRepository(10, 'owner/repo', {
      has_fetched_releases: true,
      last_release_fetch_time: '2026-01-02T00:00:00.000Z',
    });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: false, refreshExistingAssets: true }
    );

    expect(result.latestReleases).toHaveLength(1);
    expect(result.latestReleases![0].id).toBe(50);
    expect(result.latestReleases![0].repository.id).toBe(10);
    // 正式版在水印之后，应进入新列表；预发布被 includePreRelease=false 过滤
    expect(result.releases.map(r => r.id)).toEqual([50]);
  });
});

describe('GitHubApiService.getWatchedRepositories', () => {
  it('returns [] when GitHub responds 204 and makeRequest normalizes the body to null', async () => {
    const service = new GitHubApiService('token');
    // 复现 issue #285：GitHub 对 watched repos 返回 204 空响应体，makeRequest 归一化为 null
    vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest').mockResolvedValueOnce(null as never);

    const repos = await service.getWatchedRepositories();

    expect(repos).toEqual([]);
  });

  it('normalizes raw license objects into SPDX ids', async () => {
    const service = new GitHubApiService('token');
    const repo = makeRepository(10, 'owner/repo', {
      license: { key: 'mit', name: 'MIT License', spdx_id: 'MIT', url: 'https://api.github.com/licenses/mit', node_id: 'x' } as never,
    });
    vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest').mockResolvedValueOnce([repo] as never);

    const [result] = await service.getWatchedRepositories();

    expect(result.license).toBe('MIT');
  });

  it('paginates /user/subscriptions only and stops on a partial page', async () => {
    const service = new GitHubApiService('token');
    const makeRequestSpy = vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest')
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => makeRepository(i + 1, `owner/repo-${i + 1}`)) as never)
      .mockResolvedValueOnce([makeRepository(999, 'owner/last')] as never);

    const repos = await service.getAllWatchedRepositories();

    expect(repos).toHaveLength(101);
    // 固定分页行为与端点序列：只走 /user/subscriptions
    // （旧的 /users/{login}/subscriptions 并行合并已整体移除，由编译器兜底）
    expect(makeRequestSpy.mock.calls.map((call: unknown[]) => (call[0] as string).split('?')[0])).toEqual([
      '/user/subscriptions',
      '/user/subscriptions',
    ]);
  });
});


describe('GitHubApiService.getRepositoryReleases draft filtering', () => {
  it('excludes draft releases with null publication times from direct GitHub results', async () => {
    const service = new GitHubApiService('token');
    const draft = { ...makeRelease(1, '2026-01-03T00:00:00.000Z'), draft: true, published_at: null };
    const published = makeRelease(2, '2026-01-02T00:00:00.000Z');
    vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest')
      .mockResolvedValueOnce([draft, published] as never);

    const releases = await service.getRepositoryReleases('owner', 'repo');

    expect(releases).toEqual([expect.objectContaining({ id: published.id, published_at: published.published_at })]);
  });
});


describe('GitHubApiService repository chat read APIs', () => {
  it('resolves default branch, immutable head SHA, and a recursive tree through tagged read requests', async () => {
    const service = new GitHubApiService('token');
    const makeRequestSpy = vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest')
      .mockResolvedValueOnce({ default_branch: 'main' } as never)
      .mockResolvedValueOnce({ sha: 'abcdef1234567890' } as never)
      .mockResolvedValueOnce({ sha: 'tree-sha', truncated: false, tree: [{ path: 'src/App.tsx', type: 'blob', sha: 'file-sha' }] } as never);

    await expect(service.getRepositoryMeta('owner', 'repo')).resolves.toEqual({ defaultBranch: 'main' });
    await expect(service.getRepositoryHeadSha('owner', 'repo', 'main')).resolves.toBe('abcdef1234567890');
    await expect(service.getRepositoryTree('owner', 'repo', 'abcdef1234567890')).resolves.toMatchObject({
      ref: 'abcdef1234567890',
      sha: 'tree-sha',
      truncated: false,
      entries: [{ path: 'src/App.tsx', type: 'blob' }],
    });

    expect(makeRequestSpy.mock.calls.map((call: unknown[]) => call[1])).toEqual([
      { operationTag: 'repository-chat:meta' },
      { operationTag: 'repository-chat:head-sha' },
      { operationTag: 'repository-chat:tree' },
    ]);
  });

  it('reads a text file at the supplied immutable ref and rejects sensitive paths before any request', async () => {
    const service = new GitHubApiService('token');
    const makeRequestSpy = vi.spyOn(service as unknown as { makeRequest: () => Promise<unknown> }, 'makeRequest')
      .mockResolvedValueOnce({
        type: 'file',
        path: 'src/App.tsx',
        sha: 'file-sha',
        size: 20,
        encoding: 'base64',
        content: btoa('export const App = () => null;'),
      } as never);

    await expect(service.getRepositoryFile('owner', 'repo', 'src/App.tsx', 'abcdef1234567890')).resolves.toMatchObject({
      path: 'src/App.tsx',
      ref: 'abcdef1234567890',
      sha: 'file-sha',
      content: 'export const App = () => null;',
    });
    const requestCalls = makeRequestSpy.mock.calls as unknown as Array<[string]>;
    expect(requestCalls[0]?.[0]).toContain('?ref=abcdef1234567890');

    await expect(service.getRepositoryFile('owner', 'repo', '.env.production', 'abcdef1234567890')).rejects.toThrow(/excluded/i);
    await expect(service.getRepositoryFile('owner', 'repo', 'package-lock.json', 'abcdef1234567890')).rejects.toThrow(/excluded/i);
    expect(makeRequestSpy).toHaveBeenCalledTimes(1);
  });
});
