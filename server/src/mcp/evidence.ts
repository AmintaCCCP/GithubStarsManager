import { projectRepoForAgent, type McpRepository } from './repoSearch.js';

export interface McpReleaseEvidence {
  id: number;
  tag_name: string | null;
  name: string | null;
  html_url: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
}

export function buildRepoEvidence(
  repo: McpRepository,
  latestRelease: McpReleaseEvidence | null
): {
  repository: Record<string, unknown>;
  evidence: {
    repository: Record<string, unknown>;
    latest_release: McpReleaseEvidence | null;
    sources: { repository: 'repositories'; latest_release: 'releases_cache' | null };
    evidenceFreshness: {
      repositoryUpdatedAt: string | null;
      repositorySyncedAt: string | null;
      releaseCacheUpdatedAt: string | null;
      analyzedAt: string | null;
      latestReleasePublishedAt: string | null;
      limitations: string[];
    };
    limitations: string[];
  };
} {
  const analysisStatus = repo.analyzed_at
    ? repo.analysis_failed
      ? 'failed'
      : 'analyzed'
    : 'not_analyzed';

  return {
    repository: projectRepoForAgent(repo, { summaryMaxChars: 2000 }),
    evidence: {
      repository: {
        full_name: repo.full_name,
        html_url: repo.html_url,
        description: repo.description,
        language: repo.language,
        license: repo.license ?? null,
        stargazers_count: repo.stargazers_count,
        created_at: repo.created_at ?? null,
        updated_at: repo.updated_at ?? null,
        pushed_at: repo.pushed_at ?? null,
        starred_at: repo.starred_at ?? null,
        subscribed_to_releases: !!repo.subscribed_to_releases,
        analysis_status: analysisStatus,
        analyzed_at: repo.analyzed_at ?? null,
        archived: null,
      },
      latest_release: latestRelease,
      sources: {
        repository: 'repositories',
        latest_release: latestRelease ? 'releases_cache' : null,
      },
      evidenceFreshness: {
        // This is the stored GitHub repository updated_at value, not a local
        // sync timestamp. Do not present it as a freshness check time.
        repositoryUpdatedAt: repo.updated_at ?? null,
        repositorySyncedAt: null,
        releaseCacheUpdatedAt: null,
        analyzedAt: repo.analyzed_at ?? null,
        latestReleasePublishedAt: latestRelease?.published_at ?? null,
        limitations: [
          'repositoryUpdatedAt is the stored repository updated_at, not a local sync timestamp',
          'repositorySyncedAt and release-cache update time are not stored locally',
        ],
      },
      limitations: [
        'archived is not stored locally',
        'release evidence is limited to locally cached releases',
      ],
    },
  };
}
