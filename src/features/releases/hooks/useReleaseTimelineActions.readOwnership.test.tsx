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

vi.mock('../../../services/autoSync', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/autoSync')>();
  return {
    ...actual,
    forceSyncToBackend: mocks.forceSyncToBackend,
  };
});

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

    // 备份恢复是用原始 setState 整组替换：{10,20,30} → {10,20,30,40}
    //（相对乐观更新后的集合仅新增一个 ID，与单条已读用例的差值形状相同，
    // 但写入来源不同）。旧判定会因「size +1 且旧集合是子集」误判为并发单条
    // 已读，回滚时删掉备份带来的 40；所有权判定必须依据写入来源而非集合差值。
    act(() => {
      useAppStore.setState({ readReleases: new Set<number>([10, 20, 30, 40]) });
    });

    rejectBackend(new Error('backend down'));
    await settle();

    // 所有权已丢失：保留整组替换后的集合，不执行任何回滚。
    expect(useAppStore.getState().readReleases).toEqual(new Set([10, 20, 30, 40]));
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

  it('keeps concurrent single-read targets that overlap the mark-all additions (R13 finding 106)', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    // 等待期间用户单条已读 release 20——它同时也在本次「全部已读」的新增集合里
    //（store 侧 single-read 登记登记 targetIds={20}）。按旧逻辑回滚会把它从
    // 已读集合撤销，覆盖用户刚刚点下的已读；targetIds 必须从撤销集合排除。
    act(() => {
      useAppStore.getState().markReleaseAsRead(20);
    });

    rejectBackend(new Error('backend down'));
    await settle();

    const read = useAppStore.getState().readReleases;
    expect(read.has(20)).toBe(true);
    // 其余全部已读新增仍被撤销，历史已读 5 补回
    expect(read.has(10)).toBe(false);
    expect(read.has(30)).toBe(false);
    expect(read.has(5)).toBe(true);
  });

  it('accumulates multiple concurrent single-read targets on the live rollback path', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    act(() => {
      useAppStore.getState().markReleaseAsRead(20);
      useAppStore.getState().markReleaseAsRead(30);
    });

    rejectBackend(new Error('backend down'));
    await settle();

    const read = useAppStore.getState().readReleases;
    expect(read.has(5)).toBe(true);
    expect(read.has(20)).toBe(true);
    expect(read.has(30)).toBe(true);
    expect(read.has(10)).toBe(false);
  });

  it('preserves single-read targets performed before switching away on archived rollback', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    // 在账号 A 中单独标记 10，再切换到账号 B 使批量请求失败，最后切回 A
    act(() => {
      useAppStore.getState().upsertSavedAccount(
        { id: 1, login: 'me', name: 'Me', avatar_url: '', email: null },
        'token-a',
      );
      useAppStore.getState().upsertSavedAccount(
        { id: 2, login: 'other', name: 'Other', avatar_url: '', email: null },
        'token-b',
      );
      useAppStore.getState().markReleaseAsRead(10);
      useAppStore.getState().switchAccount('2');
    });

    rejectBackend(new Error('backend down'));
    await settle();

    act(() => {
      useAppStore.getState().switchAccount('1');
    });

    const read = useAppStore.getState().readReleases;
    expect(read.has(5)).toBe(true);
    expect(read.has(10)).toBe(true);
    expect(read.has(20)).toBe(false);
    expect(read.has(30)).toBe(false);
  });

  it('skips rows rewritten after A→B→A reactivation while rolling back untouched rows', async () => {
    const { rejectBackend, settle } = await startMarkAllRead();

    act(() => {
      useAppStore.getState().upsertSavedAccount(
        { id: 1, login: 'me', name: 'Me', avatar_url: '', email: null },
        'token-a',
      );
      useAppStore.getState().upsertSavedAccount(
        { id: 2, login: 'other', name: 'Other', avatar_url: '', email: null },
        'token-b',
      );
      useAppStore.getState().switchAccount('2');
      useAppStore.getState().switchAccount('1');
      // 仅恢复/改写 release 10（不替换 readReleases），保留 release 20 为原乐观行引用
      const currentReleases = useAppStore.getState().releases;
      useAppStore.setState({
        releases: currentReleases.map((rel) => (
          rel.id === 10
            ? { ...rel, is_read: true, updated_asset_ids: [] }
            : rel
        )),
      });
    });

    rejectBackend(new Error('backend down'));
    await settle();

    const rel10 = useAppStore.getState().releases.find((r) => r.id === 10);
    const rel20 = useAppStore.getState().releases.find((r) => r.id === 20);
    expect(rel10?.is_read).toBe(true);
    expect(rel20?.is_read).toBe(false);
  });
});
