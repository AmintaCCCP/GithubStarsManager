import type { DiscoveryRepo } from '../../../types';

export interface DiscoveryAnalysisSuccessInput {
  summary: string | undefined;
  tags: string[] | undefined;
  platforms: string[] | undefined;
  analyzedAt: string;
  analysisFailed: boolean | undefined;
}

export interface DiscoveryAnalysisFailureInput {
  analyzedAt: string;
  analysisFailed: boolean | undefined;
  analysisError: string | undefined;
}

// 发现页单卡分析的 patch 形状：与 repositoryPatches.applyAnalysisSuccess 不是同一形状
// ——这里不含 custom_category/category_locked，输入输出均 DiscoveryRepo（保留 rank/channel/platform）。
export const applyDiscoveryAnalysisSuccess = (
  repo: DiscoveryRepo,
  input: DiscoveryAnalysisSuccessInput,
): DiscoveryRepo => ({
  ...repo,
  ai_summary: input.summary,
  ai_tags: input.tags,
  ai_platforms: input.platforms,
  analyzed_at: input.analyzedAt,
  analysis_failed: input.analysisFailed,
  analysis_error: undefined,
});

export const applyDiscoveryAnalysisFailure = (
  repo: DiscoveryRepo,
  input: DiscoveryAnalysisFailureInput,
): DiscoveryRepo => ({
  ...repo,
  analyzed_at: input.analyzedAt,
  analysis_failed: input.analysisFailed,
  analysis_error: input.analysisError,
});
