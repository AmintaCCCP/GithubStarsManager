import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStarSyncActions } from './useStarSyncActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  confirm: vi.fn(),
  pushCategoriesToLists: vi.fn(),
  setListsPushError: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubListsApiService: (token: string) => ({ __factory: true, token }),
}));

const storeState: { language: string; githubToken: string | null; pushCategoriesToLists: ReturnType<typeof vi.fn>; setListsPushError: ReturnType<typeof vi.fn> } = {
  language: 'zh',
  githubToken: 'token',
  pushCategoriesToLists: mocks.pushCategoriesToLists,
  setListsPushError: mocks.setListsPushError,
};

const mockUseAppStore = vi.mocked(useAppStore);

describe('useStarSyncActions 命名空间绑定回归', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
  });

  it('确认弹窗使用 settings 命名空间的译文而非原始 key', async () => {
    mocks.confirm.mockResolvedValue(true);
    const { result } = renderHook(() => useStarSyncActions());

    await act(async () => { await result.current.pushCategoriesToLists(); });

    const [title, body] = mocks.confirm.mock.calls[0];
    // 若回退为 app 命名空间，这两个 key 将原样渲染（历史 bug）
    expect(title).toBe('同步仓库分类到 GitHub list');
    expect(title).not.toContain('useStarSyncActions.');
    expect(body).toContain('同名 list 将覆盖其成员');
    expect(body).not.toContain('useStarSyncActions.');
    expect(mocks.pushCategoriesToLists).toHaveBeenCalledTimes(1);
  });

  it('未连接 GitHub 时通过 setListsPushError 提示 settings 命名空间文案', async () => {
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector({ ...storeState, githubToken: null }) : storeState
    )) as typeof useAppStore);
    const { result } = renderHook(() => useStarSyncActions());

    await act(async () => { await result.current.pushCategoriesToLists(); });

    expect(mocks.setListsPushError).toHaveBeenCalledWith('未登录 GitHub，请先连接');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
});
