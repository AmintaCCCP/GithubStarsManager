import type { Repository } from '../../../types';

export interface AnalysisSuccessInput {
  summary: string | undefined;
  tags: string[] | undefined;
  platforms: string[] | undefined;
  category: string | undefined;
  categoryLocked: boolean | undefined;
  analyzedAt: string;
}

export interface AnalysisFailureInput {
  analyzedAt: string;
  error: string | undefined;
}

export type RestoreTarget = 'original' | 'ai';

export interface RestoreFieldConfig {
  enabled: boolean;
  target: RestoreTarget;
}

export interface RepositoryRestoreConfig {
  description: RestoreFieldConfig;
  tags: RestoreFieldConfig;
  category: RestoreFieldConfig;
}

export const applyAnalysisSuccess = (
  repository: Repository,
  input: AnalysisSuccessInput,
): Repository => ({
  ...repository,
  ai_summary: input.summary,
  ai_tags: input.tags,
  ai_platforms: input.platforms,
  custom_category: input.category,
  category_locked: input.categoryLocked,
  analyzed_at: input.analyzedAt,
  analysis_failed: false,
  analysis_error: undefined,
});

export const applyAnalysisFailure = (
  repository: Repository,
  input: AnalysisFailureInput,
): Repository => ({
  ...repository,
  analyzed_at: input.analyzedAt,
  analysis_failed: true,
  analysis_error: input.error,
});

export const restoreRepositoryFields = (
  repository: Repository,
  config: RepositoryRestoreConfig,
  editedAt: string,
): Repository | undefined => {
  const updatedRepository: Repository = { ...repository };

  if (config.description.enabled) {
    updatedRepository.custom_description = undefined;
    if (config.description.target === 'original') {
      updatedRepository.ai_summary = undefined;
      updatedRepository.analyzed_at = undefined;
      updatedRepository.analysis_failed = undefined;
      updatedRepository.analysis_error = undefined;
    }
  }

  if (config.tags.enabled) {
    updatedRepository.custom_tags = undefined;
    if (config.tags.target === 'original') {
      updatedRepository.ai_tags = undefined;
      updatedRepository.ai_platforms = undefined;
      updatedRepository.analyzed_at = undefined;
      updatedRepository.analysis_failed = undefined;
      updatedRepository.analysis_error = undefined;
    }
  }

  if (config.category.enabled) {
    updatedRepository.custom_category = undefined;
    updatedRepository.category_locked = false;
    if (config.category.target === 'original') {
      updatedRepository.ai_tags = undefined;
      updatedRepository.ai_platforms = undefined;
      updatedRepository.analyzed_at = undefined;
      updatedRepository.analysis_failed = undefined;
      updatedRepository.analysis_error = undefined;
    }
  }

  const hasChanges = updatedRepository.custom_description !== repository.custom_description
    || updatedRepository.custom_tags !== repository.custom_tags
    || updatedRepository.custom_category !== repository.custom_category
    || updatedRepository.category_locked !== repository.category_locked
    || updatedRepository.ai_summary !== repository.ai_summary
    || updatedRepository.ai_tags !== repository.ai_tags
    || updatedRepository.ai_platforms !== repository.ai_platforms
    || updatedRepository.analyzed_at !== repository.analyzed_at
    || updatedRepository.analysis_failed !== repository.analysis_failed;

  return hasChanges
    ? { ...updatedRepository, last_edited: editedAt }
    : undefined;
};

export const applyCategoryAssignment = (
  repository: Repository,
  category: string | undefined,
  editedAt: string,
): Repository => ({
  ...repository,
  custom_category: category,
  category_locked: category !== undefined && category !== '',
  last_edited: editedAt,
});

export const lockRepositoryCategory = (
  repository: Repository,
  editedAt: string,
): Repository | undefined => {
  if (!repository.custom_category || repository.custom_category === '') {
    return undefined;
  }

  return {
    ...repository,
    category_locked: true,
    last_edited: editedAt,
  };
};

export const unlockRepositoryCategory = (
  repository: Repository,
  editedAt: string,
): Repository => ({
  ...repository,
  category_locked: false,
  last_edited: editedAt,
});

export const setReleaseSubscriptionMarker = (
  repository: Repository,
  subscribed: boolean,
): Repository => ({
  ...repository,
  subscribed_to_releases: subscribed,
});
