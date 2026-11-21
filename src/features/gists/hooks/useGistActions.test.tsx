import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Gist } from '../../../types';
import { bumpAccountSessionGeneration } from '../../../store/helpers/accountWorkspace';
import { applyGistAnalysisFailure, applyGistAnalysisSuccess, GistDetailSessionSwitchedError, useGistActions } from './useGistActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  forceSyncToBackend: vi.fn(),
  getGist: vi.fn(),
  getGistForAnalysis: vi.fn(),
  getGistContentPreview: vi.fn(),
  unstarGist: vi.fn(),
  deleteGist: vi.fn(),
  getGistFileRaw: vi.fn(),
  updateGist: vi.fn(),
  createGist: vi.fn(),
  analyzeGist: vi.fn(),
  searchGistsWithReranking: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
  // 审计修复：切号后远端已成功的 Gist 变更经簿记守卫写回发起账号工作区——
  // 测试桩直通执行（真实实现只静音订阅簿记）。
  withAccountSwitchGuardSync: (fn: () => void) => fn(),
}));

vi.mock('../../../services/githubApiFactory', () => ({
  createGitHubApiService: () => ({
    getGist: mocks.getGist,
    getGistForAnalysis: mocks.getGistForAnalysis,
    getGistContentPreview: mocks.getGistContentPreview,
    unstarGist: mocks.unstarGist,
    deleteGist: mocks.deleteGist,
    getGistFileRaw: mocks.getGistFileRaw,
    updateGist: mocks.updateGist,
    createGist: mocks.createGist,
  }),
}));

vi.mock('../../../services/aiService', () => ({
  AIService: class {
    analyzeGist = mocks.analyzeGist;
    searchGistsWithReranking = mocks.searchGistsWithReranking;
  },
}));

const createStoreState = () => ({
  // 审计修复：账号 ID 必须是数值——peekCurrentAccountId 以 id 归一账号键，
  // 切号期间远端已成功的 Gist 变更按发起账号 ID 写回其归档工作区。
  user: { id: 1, login: 'me', avatar_url: 'https://example.com/me.png' },
  githubToken: 'github-token' as string | null,
  gists: [] as Gist[],
  starredGists: [] as Gist[],
  accountWorkspaces: {} as Record<string, unknown>,
  gistSearchFilters: {
    query: '',
    sortBy: 'updated' as const,
    sortOrder: 'desc' as const,
    isAnalyzed: undefined as boolean | undefined,
  },
  gistSearchResults: [],
  selectedGistCategory: 'all' as const,
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }],
  activeAIConfig: 'ai-config',
  language: 'zh' as const,
  setGists: vi.fn(),
  setStarredGists: vi.fn(),
  updateGist: vi.fn(),
  deleteGist: vi.fn(),
  setGistSearchFilters: vi.fn(),
  setGistSearchResults: vi.fn(),
  setSelectedGistCategory: vi.fn(),
  setAnalyzingGist: vi.fn(),
  analyzingGistIds: new Set<string>(),
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;
// 审计修复：切号后远端已成功的 Gist 变更经 useAppStore.setState 写回发起账号
// 的归档工作区——选择器桩补齐 setState（对象或 updater 两种形态）。
(mockUseAppStore as unknown as { setState: (patch: unknown) => void }).setState = vi.fn((patch: unknown) => {
  if (typeof patch === 'function') {
    Object.assign(storeState, (patch as (state: typeof storeState) => Partial<typeof storeState>)(storeState));
  } else {
    Object.assign(storeState, patch as Partial<typeof storeState>);
  }
});

const gist: Gist = {
  id: 'gist-1',
  description: 'A gist',
  public: true,
  html_url: 'https://gist.github.com/me/gist-1',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  comments: 0,
  owner: { login: 'me', avatar_url: 'https://example.com/me.png' },
  files: {
    'a.ts': { filename: 'a.ts', type: 'text/plain', language: 'TypeScript', size: 10, content: 'const a = 1;' },
  },
};

const gistDetail: Gist = {
  ...gist,
  files: {
    'a.ts': { filename: 'a.ts', type: 'text/plain', language: 'TypeScript', size: 20, content: 'const a = 1; // full' },
  },
};

describe('useGistActions card actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  describe('analyzeOne', () => {
    it('validates token, config presence and completeness in order before analyzing', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenCalledTimes(1);
      expect(mocks.toast).toHaveBeenCalledWith('GitHub token 未找到，请重新登录。', 'error');

      storeState.githubToken = 'github-token';
      storeState.aiConfigs = [];
      rerender();
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenLastCalledWith('请先在设置中配置AI服务。', 'error');

      storeState.aiConfigs = [{ id: 'ai-config', name: 'Broken', baseUrl: '', apiKey: '', model: '' }];
      rerender();
      await act(async () => { await result.current.analyzeOne(gist); });
      expect(mocks.toast).toHaveBeenLastCalledWith('AI服务配置不完整，请检查设置。', 'error');
      expect(mocks.getGistForAnalysis).not.toHaveBeenCalled();
    });

    it('asks for confirmation when the gist was analyzed before and aborts on cancel', async () => {
      storeState.gists = [];
      const analyzedGist = { ...gist, analyzed_at: '2026-01-03T00:00:00.000Z' };
      mocks.confirm.mockResolvedValue(false);
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(analyzedGist); });
      expect(mocks.confirm).toHaveBeenCalledWith(
        '重新分析确认',
        '此 gist 已经分析过，是否覆盖现有摘要？',
        { type: 'warning' },
      );
      expect(mocks.getGistForAnalysis).not.toHaveBeenCalled();
      expect(storeState.setAnalyzingGist).not.toHaveBeenCalled();
    });

    it('patches the success fields from the fetched detail and does not force sync', async () => {
      mocks.getGistForAnalysis.mockResolvedValue(gistDetail);
      mocks.getGistContentPreview.mockReturnValue('preview');
      mocks.analyzeGist.mockResolvedValue('  summary text  ');
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });

      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(storeState.setAnalyzingGist).toHaveBeenCalledWith('gist-1', true);
      expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith('gist-1', false);
      expect(storeState.updateGist).toHaveBeenCalledTimes(1);
      const patch = storeState.updateGist.mock.calls[0][0] as Gist;
      expect(patch.ai_summary).toBe('summary text');
      expect(patch.analyzed_at).toEqual(expect.any(String));
      expect(patch.analysis_failed).toBe(false);
      expect(patch.analysis_error).toBeUndefined();
      // 成功 patch 以拉取到的 detail 为底（内容比列表缓存更完整）
      expect(patch.files['a.ts'].content).toBe('const a = 1; // full');
      expect(mocks.toast).toHaveBeenCalledWith('Gist AI分析完成', 'success');
      expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    });

    it('patches failure fields and toasts on analysis error', async () => {
      mocks.getGistForAnalysis.mockRejectedValue(new Error('boom'));
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.analyzeOne(gist); });

      expect(storeState.updateGist).toHaveBeenCalledTimes(1);
      const patch = storeState.updateGist.mock.calls[0][0] as Gist;
      expect(patch.analyzed_at).toEqual(expect.any(String));
      expect(patch.analysis_failed).toBe(true);
      expect(patch.analysis_error).toBe('boom');
      expect(mocks.toast).toHaveBeenCalledWith('Gist AI分析失败', 'error');
      expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith('gist-1', false);
    });
  });

  describe('unstarGist', () => {
    it('aborts silently without token and when confirm is declined', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, vi.fn()); });
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.unstarGist).not.toHaveBeenCalled();

      storeState.githubToken = 'github-token';
      rerender();
      mocks.confirm.mockResolvedValue(false);
      await act(async () => { await result.current.unstarGist(gist, vi.fn()); });
      expect(mocks.confirm).toHaveBeenCalledTimes(1);
      expect(mocks.unstarGist).not.toHaveBeenCalled();
    });

    it('calls onUnstarred before the store update and toasts success', async () => {
      mocks.confirm.mockResolvedValue(true);
      // R12：取消星标只改星标字段——列表中的最新条目可能已被编辑
      storeState.gists = [{ ...gist, description: 'edited while unstarring' }];
      storeState.starredGists = [{ ...gist }];
      const onUnstarred = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, onUnstarred); });

      expect(mocks.unstarGist).toHaveBeenCalledWith('gist-1');
      const onUnstarredOrder = onUnstarred.mock.invocationCallOrder[0];
      const setStateMock = (mockUseAppStore as unknown as {
        setState: { mock: { invocationCallOrder: number[] } };
      }).setState;
      expect(onUnstarredOrder).toBeLessThan(setStateMock.mock.invocationCallOrder[0]);
      expect(storeState.gists[0]).toEqual({ ...gist, description: 'edited while unstarring', starred: false });
      expect(storeState.starredGists[0]).toEqual({ ...gist, starred: false });
      expect(mocks.toast).toHaveBeenCalledWith('已取消收藏', 'success');
    });

    it('toasts failure without store update when the api call rejects', async () => {
      mocks.confirm.mockResolvedValue(true);
      mocks.unstarGist.mockRejectedValue(new Error('network'));
      const onUnstarred = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.unstarGist(gist, onUnstarred); });

      expect(onUnstarred).not.toHaveBeenCalled();
      expect(storeState.updateGist).not.toHaveBeenCalled();
      expect(mocks.toast).toHaveBeenCalledWith('取消收藏失败', 'error');
    });
  });

  describe('deleteGist', () => {
    it('skips silently without token or when the gist is not owned by the user', async () => {
      storeState.githubToken = null;
      const { result, rerender } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });
      expect(mocks.deleteGist).not.toHaveBeenCalled();

      storeState.githubToken = 'github-token';
      rerender();
      const foreignGist = { ...gist, owner: { login: 'someone-else', avatar_url: '' } };
      await act(async () => { await result.current.deleteGist(foreignGist, vi.fn()); });
      expect(mocks.confirm).not.toHaveBeenCalled();
      expect(mocks.deleteGist).not.toHaveBeenCalled();
    });

    it('aborts when confirm is declined', async () => {
      mocks.confirm.mockResolvedValue(false);
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });
      expect(mocks.confirm).toHaveBeenCalledWith(
        '删除 Gist',
        '确定要删除这个 gist 吗？此操作不可撤销。',
        { type: 'danger', confirmText: '删除' },
      );
      expect(mocks.deleteGist).not.toHaveBeenCalled();
    });

    it('removes the store record, then calls onDeleted, then toasts success', async () => {
      mocks.confirm.mockResolvedValue(true);
      const onDeleted = vi.fn();
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, onDeleted); });

      expect(mocks.deleteGist).toHaveBeenCalledWith('gist-1');
      const storeDeleteOrder = storeState.deleteGist.mock.invocationCallOrder[0];
      const onDeletedOrder = onDeleted.mock.invocationCallOrder[0];
      expect(storeDeleteOrder).toBeLessThan(onDeletedOrder);
      expect(mocks.toast).toHaveBeenCalledWith('Gist 已删除', 'success');
    });

    it('maps permission errors into the scoped hint toast', async () => {
      mocks.confirm.mockResolvedValue(true);
      mocks.deleteGist.mockRejectedValue(new Error('403 forbidden'));
      const { result } = renderHook(() => useGistActions());
      await act(async () => { await result.current.deleteGist(gist, vi.fn()); });

      expect(mocks.toast).toHaveBeenCalledWith(
        '删除 Gist 失败：403 forbidden（请确认 token 已勾选 gist 权限，并在设置中重新输入 token 登录）',
        'error',
      );
    });
  });

  describe('fetchGistFileRaw', () => {
    it('throws the verbatim no-token message', async () => {
      storeState.githubToken = null;
      const { result } = renderHook(() => useGistActions());
      await expect(result.current.fetchGistFileRaw('https://raw.example/x')).rejects.toThrow(
        '未配置 GitHub token，无法加载文件内容',
      );
      expect(mocks.getGistFileRaw).not.toHaveBeenCalled();
    });

    it('passes the raw url and signal through to the api service', async () => {
      mocks.getGistFileRaw.mockResolvedValue('file body');
      const { result } = renderHook(() => useGistActions());
      const controller = new AbortController();
      await act(async () => {
        await expect(result.current.fetchGistFileRaw('https://raw.example/x', controller.signal)).resolves.toBe('file body');
      });
      expect(mocks.getGistFileRaw).toHaveBeenCalledWith('https://raw.example/x', controller.signal);
    });
  });

  describe('isAnalyzingGist', () => {
    it('reflects the store analyzing set', () => {
      storeState.analyzingGistIds = new Set(['gist-1']);
      const { result } = renderHook(() => useGistActions());
      expect(result.current.isAnalyzingGist('gist-1')).toBe(true);
      expect(result.current.isAnalyzingGist('gist-2')).toBe(false);
    });
  });
});

describe('useGistActions AI search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('reapplies the latest analysis filter without reordering AI-ranked results', async () => {
    const analyzed: Gist = { ...gist, id: 'analyzed', analyzed_at: '2026-01-03T00:00:00.000Z' };
    const pending: Gist = { ...gist, id: 'pending' };
    const ranked: Gist[] = [analyzed, pending];
    let resolveRanking: (gists: Gist[]) => void = () => undefined;
    mocks.searchGistsWithReranking.mockReturnValue(new Promise<Gist[]>(resolve => {
      resolveRanking = resolve;
    }));
    const { result } = renderHook(() => useGistActions());
    const onReranked = vi.fn();

    let searchPromise: Promise<void>;
    await act(async () => {
      searchPromise = result.current.aiSearch('query', [gist], onReranked);
      await Promise.resolve();
    });

    storeState.gistSearchFilters = {
      ...storeState.gistSearchFilters,
      isAnalyzed: false,
    };
    await act(async () => {
      resolveRanking(ranked);
      await searchPromise;
    });

    expect(storeState.setGistSearchResults).toHaveBeenCalledWith([pending]);
    expect(onReranked).toHaveBeenCalledWith(ranked);
  });
});

/**
 * 账号代次校验回归（Issue #611 审计修复）：任何异步 Gist 操作在等待期间切号后，
 * 结果绝不写入切号后的当前账号工作区，结果回调不再触发。
 */
describe('useGistActions account switch guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    // accountIdKey 需要数值 id：默认账号 A(id=1)，切号目标 B(id=2)
    (storeState as unknown as { user: { id: number; login: string; avatar_url: string } }).user = { id: 1, login: 'me', avatar_url: 'https://example.com/me.png' };
  });

  const switchToB = () => {
    (storeState as unknown as { user: { id: number; login: string; avatar_url: string } }).user = { id: 2, login: 'other', avatar_url: 'https://example.com/other.png' };
  };

  it('aiSearch drops results, callbacks and filter writes after a switch', async () => {
    mocks.searchGistsWithReranking.mockImplementation(async () => {
      switchToB();
      return [gist];
    });
    const { result } = renderHook(() => useGistActions());
    const onReranked = vi.fn();
    await act(async () => { await result.current.aiSearch('query', [gist], onReranked); });

    expect(mocks.searchGistsWithReranking).toHaveBeenCalledTimes(1);
    expect(onReranked).not.toHaveBeenCalled();
    expect(storeState.setGistSearchFilters).not.toHaveBeenCalled();
    expect(storeState.setGistSearchResults).not.toHaveBeenCalled();
  });

  it('aiSearch also drops the failure fallback filter write after a switch', async () => {
    mocks.searchGistsWithReranking.mockImplementation(async () => {
      switchToB();
      throw new Error('ai down');
    });
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.aiSearch('query', [gist], vi.fn()); });

    expect(mocks.searchGistsWithReranking).toHaveBeenCalledTimes(1);
    expect(storeState.setGistSearchFilters).not.toHaveBeenCalled();
    expect(storeState.setGistSearchResults).not.toHaveBeenCalled();
  });

  it('single-card analyzeOne skips result writes and the analyzing cleanup after a switch', async () => {
    mocks.getGistForAnalysis.mockImplementation(async () => {
      switchToB();
      return gistDetail;
    });
    mocks.getGistContentPreview.mockReturnValue('preview');
    mocks.analyzeGist.mockResolvedValue('summary');
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.analyzeOne(gist); });

    expect(storeState.updateGist).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    // 审计修复（C36a）：AI 发送边界——切号后绝不把旧账号 Gist 正文发给 AI
    expect(mocks.analyzeGist).not.toHaveBeenCalled();
    // 分析标记作用于发起账号：切号后 finally 不清理当前账号工作区的标记
    expect(storeState.setAnalyzingGist).toHaveBeenCalledTimes(1);
    expect(storeState.setAnalyzingGist).toHaveBeenCalledWith('gist-1', true);
  });

  it('drops the stale result after A→B→A with a pending gist request', async () => {
    // 审计修复（C36b）：Gist 请求在 A 发起后保持 pending，用真实切号推进会话
    // 代次（A→B→A 后账号 ID 复发），完成旧请求后断言未写入、未回调。
    let resolveSearch!: (gists: Gist[]) => void;
    mocks.searchGistsWithReranking.mockReturnValue(new Promise<Gist[]>(resolve => {
      resolveSearch = resolve;
    }));
    const { result } = renderHook(() => useGistActions());
    const onReranked = vi.fn();
    let searchPromise!: Promise<void>;
    await act(async () => {
      searchPromise = result.current.aiSearch('query', [gist], onReranked);
    });
    expect(mocks.searchGistsWithReranking).toHaveBeenCalledTimes(1);
    switchToB();
    bumpAccountSessionGeneration();
    (storeState as unknown as { user: { id: number; login: string; avatar_url: string } }).user = { id: 1, login: 'me', avatar_url: 'https://example.com/me.png' };
    await act(async () => {
      resolveSearch([gist]);
      await searchPromise;
    });

    expect(onReranked).not.toHaveBeenCalled();
    expect(storeState.setGistSearchFilters).not.toHaveBeenCalled();
    expect(storeState.setGistSearchResults).not.toHaveBeenCalled();
  });

  it('fetchGistDetail throws the session-switch marker and skips updateGist after a switch', async () => {
    mocks.getGist.mockImplementation(async () => {
      switchToB();
      return gistDetail;
    });
    const { result } = renderHook(() => useGistActions());
    let caught: unknown = null;
    await act(async () => {
      try {
        await result.current.fetchGistDetail(gist);
      } catch (error) {
        caught = error;
      }
    });

    // 审计修复（C35）：会话切换与普通失败可区分——抛出专用标记错误，调用方
    // 据此清除旧账号 detailGist 并关闭详情面板；绝不返回/写入旧账号详情。
    expect(caught).toBeInstanceOf(GistDetailSessionSwitchedError);
    expect(storeState.updateGist).not.toHaveBeenCalled();
  });

  it('unstarGist skips the onUnstarred callback and local writes after a switch', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.unstarGist.mockImplementation(async () => {
      switchToB();
      return undefined;
    });
    // 审计修复：发起账号 A 仍停放时，远端已完成的取消星标写回其归档快照
    (storeState as unknown as { accountWorkspaces: Record<string, unknown> }).accountWorkspaces = {
      '1': { gists: [{ ...gist, starred: true }], starredGists: [{ ...gist, starred: true }] },
    };
    const { result } = renderHook(() => useGistActions());
    const onUnstarred = vi.fn();
    await act(async () => { await result.current.unstarGist(gist, onUnstarred); });

    // 远端取消星标已按发起账号完成；本地写入与回调被丢弃
    expect(mocks.unstarGist).toHaveBeenCalledWith('gist-1');
    expect(onUnstarred).not.toHaveBeenCalled();
    expect(storeState.updateGist).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    // 切回 A 时归档快照换入实时列表——归档必须已反映 GitHub 的取消星标结果
    const parked = (storeState as unknown as { accountWorkspaces: Record<string, { gists: Array<{ id: string; starred?: boolean }>; starredGists: Array<{ id: string; starred?: boolean }> }> }).accountWorkspaces['1'];
    expect(parked.gists[0].starred).toBe(false);
    expect(parked.starredGists[0].starred).toBe(false);
  });

  it('deleteGist skips local deletion and the onDeleted callback after a switch', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.deleteGist.mockImplementation(async () => {
      switchToB();
      return undefined;
    });
    // 审计修复：发起账号 A 仍停放时，远端已完成的删除写回其归档快照
    //（切回 A 后已删除的 Gist 不得复活）
    (storeState as unknown as { accountWorkspaces: Record<string, unknown> }).accountWorkspaces = {
      '1': { gists: [gist], starredGists: [gist] },
    };
    const { result } = renderHook(() => useGistActions());
    const onDeleted = vi.fn();
    await act(async () => { await result.current.deleteGist(gist, onDeleted); });

    // R2-C28：远端删除请求确实已按发起账号发出（本地副作用被丢弃不改变该事实）
    expect(mocks.deleteGist).toHaveBeenCalledWith(gist.id);
    expect(onDeleted).not.toHaveBeenCalled();
    expect(storeState.deleteGist).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    const parked = (storeState as unknown as { accountWorkspaces: Record<string, { gists: Array<{ id: string }>; starredGists: Array<{ id: string }> }> }).accountWorkspaces['1'];
    expect(parked.gists).toHaveLength(0);
    expect(parked.starredGists).toHaveLength(0);
  });

  it('submitGist skips the local update and success toast after a switch', async () => {
    mocks.updateGist.mockImplementation(async () => {
      switchToB();
      return gistDetail;
    });
    // 审计修复：发起账号 A 仍停放时，远端已完成的编辑写回其归档快照
    (storeState as unknown as { accountWorkspaces: Record<string, unknown> }).accountWorkspaces = {
      '1': { gists: [gist], starredGists: [] },
    };
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.submitGist({ description: 'x' } as never, gist); });

    // R2-C28：远端更新请求确实已按发起账号发出
    expect(mocks.updateGist).toHaveBeenCalledWith(gist.id, expect.anything(), expect.anything());
    expect(storeState.updateGist).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    const parked = (storeState as unknown as { accountWorkspaces: Record<string, { gists: Array<{ id: string; files: Record<string, { size: number }> }> }> }).accountWorkspaces['1'];
    expect(parked.gists[0].id).toBe('gist-1');
    expect(parked.gists[0].files['a.ts'].size).toBe(gistDetail.files['a.ts'].size);
  });

  it('submitGist writes a created gist back to the parked owner archive after a switch (R12)', async () => {
    const created = { ...gist, id: 'gist-new', description: 'created during switch' };
    mocks.createGist.mockImplementation(async () => {
      switchToB();
      return created;
    });
    (storeState as unknown as { accountWorkspaces: Record<string, unknown> }).accountWorkspaces = {
      '1': { gists: [gist], starredGists: [] },
    };
    storeState.gists = [{ ...gist, id: 'b-gist' }];
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.submitGist({ description: 'created during switch' } as never, null); });

    expect(mocks.createGist).toHaveBeenCalledTimes(1);
    // 不显示旧会话的成功提示，也不写当前账号（B）的实时列表
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(storeState.gists.map(item => item.id)).toEqual(['b-gist']);
    // 发起账号 A 的归档补入新 Gist（按 ID 插入，保留原条目）
    const parked = (storeState as unknown as { accountWorkspaces: Record<string, { gists: Array<{ id: string }> }> }).accountWorkspaces['1'];
    expect(parked.gists.map(item => item.id)).toEqual(['gist-new', 'gist-1']);
  });

  it('late unstar only patches the starred field and preserves edits made during the switch (R12)', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.unstarGist.mockImplementation(async () => {
      switchToB();
      return undefined;
    });
    // A 的归档在等待期间被编辑（描述更新），迟到的取消星标不得覆盖它
    (storeState as unknown as { accountWorkspaces: Record<string, unknown> }).accountWorkspaces = {
      '1': { gists: [{ ...gist, description: 'edited later' }], starredGists: [{ ...gist, description: 'edited later' }] },
    };
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.unstarGist(gist, vi.fn()); });

    const parked = (storeState as unknown as {
      accountWorkspaces: Record<string, { gists: Array<{ id: string; description: string; starred?: boolean }>; starredGists: Array<{ id: string; description: string; starred?: boolean }> }>;
    }).accountWorkspaces['1'];
    expect(parked.gists[0]).toEqual({ ...gist, description: 'edited later', starred: false });
    expect(parked.starredGists[0]).toEqual({ ...gist, description: 'edited later', starred: false });
  });

  it('clears the analyzing marker after a same-account credential switch (R12)', async () => {
    // 同账号换凭据：账号 ID 不变，只有会话代次推进
    mocks.getGistForAnalysis.mockImplementation(async () => {
      bumpAccountSessionGeneration();
      return gistDetail;
    });
    mocks.getGistContentPreview.mockReturnValue('preview');
    mocks.analyzeGist.mockResolvedValue('summary');
    const { result } = renderHook(() => useGistActions());
    await act(async () => { await result.current.analyzeOne(gist); });

    // 旧任务不得写入新会话的结果/提示，但必须清掉自己留下的「分析中」标记
    expect(storeState.updateGist).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(storeState.setAnalyzingGist).toHaveBeenCalledTimes(2);
    expect(storeState.setAnalyzingGist).toHaveBeenLastCalledWith('gist-1', false);
  });
});

describe('gist analysis patch helpers', () => {
  it('applyGistAnalysisSuccess trims the summary and resets failure state on the detail', () => {
    const patched = applyGistAnalysisSuccess(gistDetail, '  trimmed  ', '2026-09-05T00:00:00.000Z');
    expect(patched).toEqual({
      ...gistDetail,
      ai_summary: 'trimmed',
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: false,
      analysis_error: undefined,
    });
  });

  it('applyGistAnalysisFailure marks failure on the original gist', () => {
    const patched = applyGistAnalysisFailure(gist, 'boom', '2026-09-05T00:00:00.000Z');
    expect(patched).toEqual({
      ...gist,
      analyzed_at: '2026-09-05T00:00:00.000Z',
      analysis_failed: true,
      analysis_error: 'boom',
    });
  });
});
