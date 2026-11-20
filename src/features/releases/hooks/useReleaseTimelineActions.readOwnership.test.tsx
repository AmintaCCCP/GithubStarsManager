import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useReleaseTimelineActions } from './useReleaseTimelineActions';

// 本文件验证 R12 finding 2 的回滚所有权判定：必须依据 store 侧登记的写入
// 来源/版本，而不是集合差值。使用真实 store（覆盖 setup.ts 的 store mock），
// 只替换后端/提示等外部依赖。
vi.mock('../../../store/useAppStore', async () => await vi.importActual('../../../store/useAppStore'));

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  confirm: vi.fn(),
  markAllReleasesAsRead: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
}));

vi.mock('../../../services/backendAdapter', () => ({
  backend: {
    isAvailable: true,
    markAllReleasesAsRead: mocks.markAllReleasesAsRead,
  },
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getMultipleRepositoryReleases: vi.fn().mockResolvedValue({ releases: [], latestReleases: [], failedRepos: [] }),
  }),
}));

const release = (id: number, repoId: number): Release => ({
  id,
  repository: { id: repoId, name: `repo-${repoId}`, full_name: `owner/repo-${repoId}` },
  name: `v${id}`,
  is_read: false,
} as unknown as Release);

const resetReadState = (): void => {
  useAppStore.setState({
    user: { id: 1, login: 'me', name: 'Me', avatar_url: '', email: null },
    releases: [release(10, 1), release(20, 2), release(30, 3)],
    readReleases: new Set<number>([5]),
    releaseLatestMode: 'all',
  });
};

describe('useReleaseTimelineActions optimistic read rollback ownership (R12 finding 2)', () => {
  beforeEach(() => {
    resetReadState();
    mocks.toast.mockReset();
    mocks.confirm.mockReset();
    mocks.forceSyncToBackend.mockReset().mockResolvedValue(undefined);
    mocks.markAllReleasesAsRead.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const startMarkAllRead = async () => {
    let rejectBackend!: (error: unknown) => void;
    mocks.markAllReleasesAsRead.mockReturnValue(new Promise((_, reject) => {
      rejectBackend = reject;
    }));
    const { result } = renderHook(() => useReleaseTimelineActions());
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.handleMarkAllRead();
    });
    // 「全部已读」按当前 releases 整组替换（历史 {5} 不在 releases 中）。
    expect(useAppStore.getState().readReleases).toEqual(new Set([10, 20, 30]));
    return {
      rejectBackend: (error: unknown) => rejectBackend(error),
      settle: () => act(async () => { await pending; }),
    };
  };

  it('treats a backup bulk replace that adds exactly one id as a whole-set replacement (no rollback)', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    // 备份恢复是用原始 setState 整组替换：{5,10,20,30} → {5,10,20,30,40}
    // 旧判定会因「size +1 且旧集合是子集」误判为并发单条已读，回滚时删掉备份
    // 带来的 40 甚至本次乐观更新之外的历史记录。
    act(() => {
      useAppStore.setState({ readReleases: new Set<number>([5, 10, 20, 30, 40]) });
    });

    rejectBackend(new Error('backend down'));
    await settle();

    // 所有权已丢失：保留整组替换后的集合，不执行任何回滚。
    expect(useAppStore.getState().readReleases).toEqual(new Set([5, 10, 20, 30, 40]));
  });

  it('preserves a genuine single-read performed while mark-all is pending and still rolls back its own ids', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    // 并发单条已读经 store action 登记为 single-read：不得阻止本次乐观
    // mark-all 的回滚，但该条已读必须保留。
    act(() => {
      useAppStore.getState().markReleaseAsRead(99);
    });

    rejectBackend(new Error('backend down'));
    await settle();

    const read = useAppStore.getState().readReleases;
    expect(read.has(99)).toBe(true);
    expect(read.has(10)).toBe(false);
    expect(read.has(20)).toBe(false);
    expect(read.has(30)).toBe(false);
    // 回滚恢复乐观更新前的历史已读记录。
    expect(read.has(5)).toBe(true);
  });
});
