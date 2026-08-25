import { describe, expect, it } from 'vitest';
import type { Repository } from '../../../types';
import {
  applyAnalysisFailure,
  applyAnalysisSuccess,
  applyCategoryAssignment,
  lockRepositoryCategory,
  restoreRepositoryFields,
  setReleaseSubscriptionMarker,
  unlockRepositoryCategory,
} from '../application/repositoryPatches';

const analyzedAt = '2026-08-25T10:00:00.000Z';
const editedAt = '2026-08-25T10:05:00.000Z';

const createRepository = (overrides: Partial<Repository> = {}): Repository => ({
  id: 1,
  name: 'repository',
  full_name: 'owner/repository',
  description: 'Original description',
  html_url: 'https://github.com/owner/repository',
  stargazers_count: 10,
  forks_count: 2,
  forks: 2,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: ['testing'],
  ...overrides,
});

const expectInputUnchanged = <T>(input: T, snapshot: T) => {
  expect(input).toEqual(snapshot);
};

describe('repositoryPatches', () => {
  describe('applyAnalysisSuccess', () => {
    it('stores successful AI fields, clears an old failure, and keeps a locked category', () => {
      const repository = createRepository({
        ai_summary: 'Old summary',
        analysis_failed: true,
        analysis_error: 'Old failure',
        custom_description: 'User description',
        custom_tags: ['user-tag'],
        custom_category: 'Locked category',
        category_locked: true,
      });
      const before = structuredClone(repository);

      const result = applyAnalysisSuccess(repository, {
        summary: 'New summary',
        tags: ['new-tag'],
        platforms: ['web'],
        category: 'AI category',
        categoryLocked: true,
        analyzedAt,
      });

      expect(result).toEqual(expect.objectContaining({
        ai_summary: 'New summary',
        ai_tags: ['new-tag'],
        ai_platforms: ['web'],
        custom_category: 'AI category',
        category_locked: true,
        analyzed_at: analyzedAt,
        analysis_failed: false,
        analysis_error: undefined,
        custom_description: 'User description',
        custom_tags: ['user-tag'],
      }));
      expectInputUnchanged(repository, before);
    });

    it.each([
      { category: undefined, categoryLocked: false, label: 'undefined category' },
      { category: '', categoryLocked: false, label: 'explicitly empty category' },
      { category: 'Default category', categoryLocked: false, label: 'default category' },
      { category: 'AI category', categoryLocked: false, label: 'AI category' },
    ])('keeps the supplied $label distinct from the lock state', ({ category, categoryLocked }) => {
      const repository = createRepository({ category_locked: true, custom_category: 'Manual category' });
      const before = structuredClone(repository);

      const result = applyAnalysisSuccess(repository, {
        summary: 'Summary',
        tags: [],
        platforms: [],
        category,
        categoryLocked,
        analyzedAt,
      });

      expect(result.custom_category).toBe(category);
      expect(result.category_locked).toBe(categoryLocked);
      expectInputUnchanged(repository, before);
    });
  });

  describe('applyAnalysisFailure', () => {
    it('records only failure fields and preserves user-managed values', () => {
      const repository = createRepository({
        ai_summary: 'Keep prior AI summary',
        custom_description: 'User description',
        custom_tags: ['user-tag'],
        custom_category: 'Manual category',
        category_locked: true,
      });
      const before = structuredClone(repository);

      const result = applyAnalysisFailure(repository, { analyzedAt, error: 'AI unavailable' });

      expect(result).toEqual(expect.objectContaining({
        analyzed_at: analyzedAt,
        analysis_failed: true,
        analysis_error: 'AI unavailable',
        ai_summary: 'Keep prior AI summary',
        custom_description: 'User description',
        custom_tags: ['user-tag'],
        custom_category: 'Manual category',
        category_locked: true,
      }));
      expectInputUnchanged(repository, before);
    });

    it('keeps an absent failure message absent', () => {
      const repository = createRepository();
      const before = structuredClone(repository);

      const result = applyAnalysisFailure(repository, { analyzedAt, error: undefined });

      expect(result.analysis_error).toBeUndefined();
      expect(result.analysis_failed).toBe(true);
      expectInputUnchanged(repository, before);
    });
  });

  describe('restoreRepositoryFields', () => {
    it('restores selected original fields and clears the matching AI metadata', () => {
      const repository = createRepository({
        custom_description: 'Custom description',
        custom_tags: ['custom-tag'],
        custom_category: 'Custom category',
        category_locked: true,
        ai_summary: 'AI summary',
        ai_tags: ['ai-tag'],
        ai_platforms: ['web'],
        analyzed_at: analyzedAt,
        analysis_failed: true,
        analysis_error: 'Old failure',
      });
      const before = structuredClone(repository);

      const result = restoreRepositoryFields(repository, {
        description: { enabled: true, target: 'original' },
        tags: { enabled: true, target: 'original' },
        category: { enabled: true, target: 'original' },
      }, editedAt);

      expect(result).toEqual(expect.objectContaining({
        custom_description: undefined,
        custom_tags: undefined,
        custom_category: undefined,
        category_locked: false,
        ai_summary: undefined,
        ai_tags: undefined,
        ai_platforms: undefined,
        analyzed_at: undefined,
        analysis_failed: undefined,
        analysis_error: undefined,
        last_edited: editedAt,
      }));
      expectInputUnchanged(repository, before);
    });

    it('restores user overrides to the AI view without clearing AI analysis results', () => {
      const repository = createRepository({
        custom_description: 'Custom description',
        custom_tags: ['custom-tag'],
        custom_category: 'Custom category',
        category_locked: true,
        ai_summary: 'AI summary',
        ai_tags: ['ai-tag'],
        ai_platforms: ['web'],
        analyzed_at: analyzedAt,
        analysis_failed: false,
      });
      const before = structuredClone(repository);

      const result = restoreRepositoryFields(repository, {
        description: { enabled: true, target: 'ai' },
        tags: { enabled: true, target: 'ai' },
        category: { enabled: true, target: 'ai' },
      }, editedAt);

      expect(result).toEqual(expect.objectContaining({
        custom_description: undefined,
        custom_tags: undefined,
        custom_category: undefined,
        category_locked: false,
        ai_summary: 'AI summary',
        ai_tags: ['ai-tag'],
        ai_platforms: ['web'],
        analyzed_at: analyzedAt,
        analysis_failed: false,
        last_edited: editedAt,
      }));
      expectInputUnchanged(repository, before);
    });

    it('returns no-op when no compared restore fields would change', () => {
      const repository = createRepository({ analysis_error: 'orphaned failure message' });
      const before = structuredClone(repository);

      const result = restoreRepositoryFields(repository, {
        description: { enabled: true, target: 'original' },
        tags: { enabled: false, target: 'ai' },
        category: { enabled: false, target: 'ai' },
      }, editedAt);

      expect(result).toBeUndefined();
      expectInputUnchanged(repository, before);
    });
  });

  describe('category commands', () => {
    it.each([
      { category: undefined, expectedLocked: false, label: 'AI/default category without an override' },
      { category: '', expectedLocked: false, label: 'explicitly empty category' },
      { category: 'Manual category', expectedLocked: true, label: 'manual category' },
    ])('assigns $label without conflating it with category locking', ({ category, expectedLocked }) => {
      const repository = createRepository({ custom_category: 'Previous category', category_locked: true });
      const before = structuredClone(repository);

      const result = applyCategoryAssignment(repository, category, editedAt);

      expect(result).toEqual(expect.objectContaining({
        custom_category: category,
        category_locked: expectedLocked,
        last_edited: editedAt,
      }));
      expectInputUnchanged(repository, before);
    });

    it.each([
      { category: undefined, label: 'undefined category' },
      { category: '', label: 'empty category' },
    ])('does not lock a repository with $label', ({ category }) => {
      const repository = createRepository({ custom_category: category });
      const before = structuredClone(repository);

      expect(lockRepositoryCategory(repository, editedAt)).toBeUndefined();
      expectInputUnchanged(repository, before);
    });

    it('locks a non-empty custom category and unlocks without modifying that category', () => {
      const repository = createRepository({ custom_category: 'Manual category', category_locked: false });
      const before = structuredClone(repository);

      const locked = lockRepositoryCategory(repository, editedAt);
      const unlocked = unlockRepositoryCategory(locked!, analyzedAt);

      expect(locked).toEqual(expect.objectContaining({
        custom_category: 'Manual category',
        category_locked: true,
        last_edited: editedAt,
      }));
      expect(unlocked).toEqual(expect.objectContaining({
        custom_category: 'Manual category',
        category_locked: false,
        last_edited: analyzedAt,
      }));
      expectInputUnchanged(repository, before);
    });
  });

  describe('setReleaseSubscriptionMarker', () => {
    it.each([true, false])('returns an immutable local marker for subscribed=%s', (subscribed) => {
      const repository = createRepository({ subscribed_to_releases: !subscribed });
      const before = structuredClone(repository);

      const result = setReleaseSubscriptionMarker(repository, subscribed);

      expect(result).toEqual(expect.objectContaining({ subscribed_to_releases: subscribed }));
      expectInputUnchanged(repository, before);
    });
  });
});
