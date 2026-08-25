import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { useBulkRepositoryActions } from './useBulkRepositoryActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  unstarRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/githubApi', () => ({
  GitHubApiService: vi.fn(function GitHubApiService() {
    return { unstarRepository: mocks.unstarRepository };
  }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

const repository = (id: number, overrides: Partial<Repository> = {}): Repository => ({
  id,
  name: `repository-${id}`,
  full_name: `owner/repository-${id}`,
  description: 'Repository description',
  html_url: `https://github.com/owner/repository-${id}`,
  stargazers_count: 10,
  forks_count: 1,
  forks: 1,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
  ...overrides,
});

const categories = [
  { id: 'all', name: '全部分类', icon: 'folder', keywords: [] },
  { id: 'tools', name: '工具', icon: 'wrench', keywords: ['tool'], isCustom: true },
];

const createStoreState = () => ({
  githubToken: 'github-token',
  language: 'zh' as const,
  updateRepository: vi.fn(),
  deleteRepository: vi.fn(),
  toggleReleaseSubscription: vi.fn(),
  batchUnsubscribeReleases: vi.fn(),
  releaseSubscriptions: new Set<number>(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(useAppStore);
const renderActions = () => renderHook(() => useBulkRepositoryActions({ allCategories: categories }));

describe('useBulkRepositoryActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
    mocks.confirm.mockResolvedValue(true);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.unstarRepository.mockResolvedValue(undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('has zero side effects when batch unstar confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar([repository(1)]);
    });

    expect(mocks.unstarRepository).not.toHaveBeenCalled();
    expect(storeState.deleteRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('deletes only remote-successful repositories, reports partial batch unstar failure, and syncs once', async () => {
    const first = repository(1);
    const second = repository(2);
    mocks.unstarRepository.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('network unavailable'));
    const { result } = renderActions();

    await act(async () => {
      await result.current.unstar([first, second]);
    });

    expect(storeState.deleteRepository).toHaveBeenCalledTimes(1);
    expect(storeState.deleteRepository).toHaveBeenCalledWith(first.id);
    expect(storeState.deleteRepository).not.toHaveBeenCalledWith(second.id);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('失败 (1 个)'), 'error');
  });

  it('restores original fields through the pure patch and syncs exactly once', async () => {
    const target = repository(1, {
      custom_description: 'Custom description',
      custom_tags: ['custom'],
      custom_category: '工具',
      category_locked: true,
      ai_summary: 'AI summary',
      ai_tags: ['ai'],
      analyzed_at: '2026-02-01T00:00:00.000Z',
    });
    const { result } = renderActions();

    await act(async () => {
      await result.current.restore([target], {
        description: { enabled: true, target: 'original' },
        tags: { enabled: true, target: 'original' },
        category: { enabled: true, target: 'original' },
      });
    });

    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({
      id: target.id,
      custom_description: undefined,
      custom_tags: undefined,
      custom_category: undefined,
      category_locked: false,
      ai_summary: undefined,
    }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('uses category and lock patches while synchronizing each completed batch once', async () => {
    const categorized = repository(1, { ai_tags: ['tool'], custom_category: '手动' });
    const notCategorized = repository(2);
    const { result } = renderActions();

    await act(async () => {
      await result.current.categorize([categorized], '工具');
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: categorized.id, custom_category: undefined }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.lockCategory([categorized, notCategorized]);
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: categorized.id, category_locked: true }));
    expect(storeState.updateRepository).not.toHaveBeenCalledWith(expect.objectContaining({ id: notCategorized.id, category_locked: true }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('keeps release subscription markers and subscriptions consistent on subscribe and unsubscribe', async () => {
    const alreadySubscribed = repository(1, { subscribed_to_releases: true });
    const toSubscribe = repository(2);
    storeState.releaseSubscriptions = new Set([alreadySubscribed.id]);
    const { result } = renderActions();

    await act(async () => {
      await result.current.subscribe([alreadySubscribed, toSubscribe]);
    });
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: alreadySubscribed.id, subscribed_to_releases: true }));
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: toSubscribe.id, subscribed_to_releases: true }));
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledTimes(1);
    expect(storeState.toggleReleaseSubscription).toHaveBeenCalledWith(toSubscribe.id);
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    await act(async () => {
      await result.current.unsubscribe([alreadySubscribed, toSubscribe]);
    });
    expect(storeState.batchUnsubscribeReleases).toHaveBeenCalledWith([alreadySubscribed.id]);
    expect(storeState.updateRepository).toHaveBeenCalledWith(expect.objectContaining({ id: alreadySubscribed.id, subscribed_to_releases: false }));
    expect(storeState.updateRepository).not.toHaveBeenCalledWith(expect.objectContaining({ id: toSubscribe.id, subscribed_to_releases: false }));
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });
});
