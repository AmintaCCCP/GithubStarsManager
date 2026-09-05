import { describe, expect, it } from 'vitest';
import type { DiscoveryRepo } from '../../../../types';
import { applyDiscoveryAnalysisFailure, applyDiscoveryAnalysisSuccess } from '../discoveryRepoPatches';

const repo: DiscoveryRepo = {
  id: 7,
  name: 'discovered-repo',
  full_name: 'owner/discovered-repo',
  description: 'A discovered repository',
  html_url: 'https://github.com/owner/discovered-repo',
  stargazers_count: 512,
  forks_count: 12,
  forks: 12,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['test'],
  rank: 3,
  channel: 'trending',
  platform: 'Macos',
};

describe('applyDiscoveryAnalysisSuccess', () => {
  it('patches analysis fields without touching custom_category/category_locked', () => {
    const patched = applyDiscoveryAnalysisSuccess(repo, {
      summary: 'AI summary',
      tags: ['ai', 'tools'],
      platforms: ['cli'],
      analyzedAt: '2026-09-05T00:00:00.000Z',
      analysisFailed: false,
    });

    expect(patched).toEqual({
      ...repo,
      ai_summary: 'AI summary',
      ai_tags: ['ai', 'tools'],
      ai_platforms: ['cli'],
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: false,
      analysis_error: undefined,
    });
    expect('custom_category' in patched).toBe(false);
    expect('category_locked' in patched).toBe(false);
  });

  it('keeps discovery-specific fields (rank/channel/platform)', () => {
    const patched = applyDiscoveryAnalysisSuccess(repo, {
      summary: undefined,
      tags: undefined,
      platforms: undefined,
      analyzedAt: '2026-09-05T00:00:00.000Z',
      analysisFailed: false,
    });
    expect(patched.rank).toBe(3);
    expect(patched.channel).toBe('trending');
    expect(patched.platform).toBe('Macos');
  });
});

describe('applyDiscoveryAnalysisFailure', () => {
  it('marks the failure fields and keeps the original analysis_error input', () => {
    const patched = applyDiscoveryAnalysisFailure(repo, {
      analyzedAt: '2026-09-05T00:00:00.000Z',
      analysisFailed: true,
      analysisError: 'boom',
    });

    expect(patched).toEqual({
      ...repo,
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'boom',
    });
    expect(patched.ai_summary).toBeUndefined();
  });
});
