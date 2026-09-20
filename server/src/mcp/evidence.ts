import { projectRepoForAgent, type McpRepository } from './repoSearch.js';
import {
  deriveRepositoryHealthFacts,
  type HealthReleaseInput,
  type RepositoryHealthFacts,
} from './repoHealth.js';

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
  latestRelease: McpReleaseEvidence | null,
  /** 该仓库已缓存的 Release；不传表示调用方没有这项数据，Release 相关事实为 null（未知）。 */
  releases?: readonly HealthReleaseInput[],
): {
  repository: Record<string, unknown>;
  evidence: {
    repository: Record<string, unknown>;
    health: RepositoryHealthFacts;
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
  // Repository Health 客观事实：与 UI / Electron MCP 同源（见 repoHealth.ts）。
  const health = deriveRepositoryHealthFacts(repo, releases);
  // 后端 schema 不存储 GitHub 原生状态字段，此时保持 null 并声明限制，而不是断言「未归档」。
  const hasArchivedFlag = typeof repo.archived === 'boolean';

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
        archived: hasArchivedFlag ? repo.archived : null,
      },
      health,
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
        // 只有确实拿不到该事实时才声明限制；本地已有就不再谎称不可用。
        ...(hasArchivedFlag ? [] : ['archived is not stored locally']),
        'health facts cover the stored repository record and locally cached releases only',
        // 与 Electron 侧保持同一句：每仓最多使用 500 条本地缓存的 Release，
        // release_count / releases_per_year 均按该上限内的集合计算。
        'health facts use at most 500 locally cached releases per repository',
        'contributors, closed issues, security policy, CI and README presence require extra GitHub requests and are not stored locally',
        'release evidence is limited to locally cached releases',
      ],
    },
  };
}
