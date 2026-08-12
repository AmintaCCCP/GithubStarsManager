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

describe('GitHubApiService.getMultipleRepositoryReleases asset refresh', () => {
  it('collects the latest release per already-synced repo when refreshExistingAssets is enabled', async () => {
    const service = new GitHubApiService('token');
    const latest = makeRelease(1, '2026-01-03T00:00:00.000Z');
    const older = makeRelease(2, '2026-01-01T00:00:00.000Z');

    // 已同步仓库：水印在 01-02，最新 Release(01-03) 在水印之后（fresh），老 Release 在水印前。
    vi.spyOn(service, 'getRepositoryReleases' as never).mockResolvedValueOnce(
      [latest, older] as never
    );
    vi.spyOn(service, 'fetchAllReleasesForRepo' as never).mockResolvedValueOnce([] as never);

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
    vi.spyOn(service, 'getRepositoryReleases' as never).mockResolvedValueOnce(
      [latest, older] as never
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

    vi.spyOn(service, 'getRepositoryReleases' as never).mockResolvedValueOnce([latest] as never);

    const repo = makeRepository(10, 'owner/repo', { has_fetched_releases: true, last_release_fetch_time: '2026-01-02T00:00:00.000Z' });

    const result = await service.getMultipleRepositoryReleases(
      [repo],
      { includePreRelease: true, refreshExistingAssets: false }
    );

    expect(result.latestReleases).toBeUndefined();
  });
});
