import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitHubApiService } from './githubApi';

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item>
    <title>owner/repo-a</title>
    <link>https://github.com/owner/repo-a</link>
    <description>&lt;h1&gt;README WALL OF TEXT&lt;/h1&gt; &lt;p&gt;Full readme content that must never become the description.&lt;/p&gt;</description>
  </item>
</channel></rss>`;

const apiRepoDetail = (description: string | null) => ({
  id: 5,
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  description,
  topics: [],
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-02T00:00:00Z',
});

const stubFetch = (apiDescription: string | null) => {
  const fetchMock = vi.fn().mockImplementation(async (url: string) => {
    if (url.includes('mshibanami.github.io')) {
      return { ok: true, status: 200, text: async () => RSS_XML };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => apiRepoDetail(apiDescription),
    };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

describe('GitHubApiService.getTrendingRepositories description source', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never uses the RSS README text as the repo description when GitHub has none', async () => {
    stubFetch(null);
    const service = new GitHubApiService('token');

    const result = await service.getTrendingRepositories('All', 1, 20, 'weekly');

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].full_name).toBe('owner/repo-a');
    expect(result.repos[0].description).toBeNull();
    // 其他字段仍由 GitHub API 正常补全
    expect(result.repos[0].stargazers_count).toBe(10);
    expect(result.repos[0].language).toBe('TypeScript');
  });

  it('takes the description from the GitHub API when it exists', async () => {
    stubFetch('Real description');
    const service = new GitHubApiService('token');

    const result = await service.getTrendingRepositories('All', 1, 20, 'weekly');

    expect(result.repos[0].description).toBe('Real description');
  });
});
