import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchStarImport } from './useBatchStarImport';
import { GitHubTokenPermissionError } from '../../../services/githubApi';
import { bumpAccountSessionGeneration } from '../../../store/helpers/accountWorkspace';

const mocks = vi.hoisted(() => ({
  token: 'token',
  language: 'zh',
  addRepository: vi.fn(),
  getRepositoryDetails: vi.fn(),
  isRepositoryStarred: vi.fn(),
  starRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
  translateBatch: vi.fn(),
  // 审计修复：切号后已成功的星标写回发起账号工作区并登记待同步——测试桩
  // 提供最小 getState/setState 驱动账号代次校验与归档写回。
  storeUser: null as { id: number } | null,
  storeAccountWorkspaces: {} as Record<string, unknown>,
  markPendingAccountSync: vi.fn(),
  // R13 审计修复（CodeRabbit）：待同步标记的后端归属必须在「发起时后端 X →
  // 等待期间切到 Y」的场景下验证——只有空 URL 断言无法区分实现读取的是
  // 发起时地址还是请求完成时地址。
  backend: { backendUrl: null as string | null },
}));
vi.mock('../../../store/useAppStore', () => {
  const store = (selector: (state: unknown) => unknown) => selector({
    githubToken: mocks.token, language: mocks.language, addRepository: mocks.addRepository,
  });
  (store as unknown as { getState: () => unknown }).getState = () => ({
    user: mocks.storeUser,
    githubToken: mocks.token,
    language: mocks.language,
    addRepository: mocks.addRepository,
    accountWorkspaces: mocks.storeAccountWorkspaces,
  });
  (store as unknown as { setState: (patch: unknown) => void }).setState = (patch: unknown) => {
    const partial = typeof patch === 'function'
      ? (patch as (state: unknown) => Record<string, unknown>)((store as unknown as { getState: () => unknown }).getState())
      : (patch as Record<string, unknown>);
    if (partial && typeof partial === 'object' && 'accountWorkspaces' in partial) {
      mocks.storeAccountWorkspaces = partial.accountWorkspaces as Record<string, unknown>;
    }
  };
  return { useAppStore: store };
});
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => mocks }));
vi.mock('../../../services/autoSync', () => ({
  forceSyncToBackend: mocks.forceSyncToBackend,
  markPendingAccountSync: mocks.markPendingAccountSync,
  // 审计修复：切号后的星标写回经簿记守卫——测试桩直通执行。
  withAccountSwitchGuardSync: (fn: () => void) => fn(),
}));
vi.mock('../../../services/translateService', () => ({ translateBatch: mocks.translateBatch }));
vi.mock('../../../services/backendAdapter', () => ({ backend: mocks.backend }));

const detail = (owner: string, name: string) => ({
  id: 1, name, full_name: `${owner}/${name}`, description: 'A repository',
  html_url: `https://github.com/${owner}/${name}`, stargazers_count: 10,
  forks_count: 0, forks: 0, language: 'TypeScript', topics: [], license: 'MIT',
  owner: { login: owner, avatar_url: '' },
  created_at: '', updated_at: '', pushed_at: '',
});

describe('useBatchStarImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.token = 'token';
    mocks.language = 'zh';
    mocks.storeUser = null;
    mocks.storeAccountWorkspaces = {};
    mocks.backend.backendUrl = null;
    mocks.getRepositoryDetails.mockImplementation(async (owner, name) => detail(owner, name));
    mocks.isRepositoryStarred.mockResolvedValue(false);
    mocks.starRepository.mockResolvedValue(undefined);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
    mocks.translateBatch.mockResolvedValue([]);
  });

  it('extracts seven unique repositories from a video summary without starring on preview', async () => {
    const names = ['hypit-ai/hypit', 'oraen/oraenView', 'Vincentwei1021/anything2explainer',
      'lanxiuyun/Catrace', 'CialloKing/ba-click-fx', 'CialloKing/ba-click-fx-desktop', 'jslxxgyy/EarthQuakeWarning'];
    const text = `本期视频中提到的一些内容： [anything2explainer](https://search.bilibili.com/all?keyword=anything2explainer)\n${
      names.map(name => `项目说明 [https://github.com/${name}](https://github.com/${name})`).join('\n')}`;
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview(text));
    expect(result.current.rows.map(row => row.detail?.full_name)).toEqual(names);
    expect(result.current.duplicateCount).toBe(7);
    expect(result.current.rows.every(row => row.selected)).toBe(true);
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });

  it('drops preview rows produced by an account that was switched mid-resolution (R12 finding 9)', async () => {
    mocks.storeUser = { id: 1 };
    mocks.getRepositoryDetails.mockImplementation(async (owner: string, name: string) => {
      // 解析等待期间切到账号 2
      mocks.storeUser = { id: 2 };
      bumpAccountSessionGeneration();
      return detail(owner, name);
    });
    const { result } = renderHook(() => useBatchStarImport());

    await act(() => result.current.preview('https://github.com/owner/repository'));

    expect(result.current.rows).toEqual([]);
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });

  it('refuses to star a preview generated before an account switch (R12 finding 9)', async () => {
    mocks.storeUser = { id: 1 };
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repository'));
    expect(result.current.rows).toHaveLength(1);

    // 预览后切到账号 2（旧预览不得用 B 的 Token 提交）
    mocks.storeUser = { id: 2 };
    bumpAccountSessionGeneration();
    mocks.token = 'token-b';
    await act(() => result.current.starSelected());

    expect(mocks.starRepository).not.toHaveBeenCalled();
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(result.current.syncError).toContain('账号已切换');
  });

  it('keeps already-starred and inaccessible repositories out of the selection', async () => {
    mocks.isRepositoryStarred.mockResolvedValue(true);
    mocks.getRepositoryDetails.mockRejectedValueOnce(new Error('GitHub API error: 404 Not Found'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/missing https://github.com/owner/existing'));
    expect(result.current.rows.map(row => row.status)).toEqual(['unavailable', 'already-starred']);
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).not.toHaveBeenCalled();
  });

  it('explains a token permission failure during preview', async () => {
    mocks.isRepositoryStarred.mockRejectedValueOnce(new GitHubTokenPermissionError());
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    expect(result.current.rows[0].status).toBe('unavailable');
    expect(result.current.rows[0].error).toMatch(/Starring|starring/i);
  });

  it('explains a token permission failure during starring', async () => {
    mocks.starRepository.mockRejectedValueOnce(new GitHubTokenPermissionError());
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.starSelected());
    expect(result.current.rows[0].status).toBe('failed');
    expect(result.current.rows[0].error).toMatch(/Starring|starring/i);
  });

  it('requires selection for bare names and renamed repositories, and deduplicates canonical names', async () => {
    mocks.getRepositoryDetails.mockImplementation(async (_owner, name) => detail('new-owner', name));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('old-owner/repo https://github.com/new-owner/repo'));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].selected).toBe(false);
    expect(result.current.duplicateCount).toBe(1);
    act(() => result.current.toggleRow(0));
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).toHaveBeenCalledWith('new-owner', 'repo');
  });

  it('records partial success and syncs only successfully starred repositories', async () => {
    mocks.starRepository.mockRejectedValueOnce(new Error('Forbidden'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/first https://github.com/owner/second'));
    await act(() => result.current.starSelected());
    expect(result.current.rows.map(row => row.status)).toEqual(['failed', 'starred']);
    expect(mocks.addRepository).toHaveBeenCalledTimes(1);
    expect(mocks.addRepository.mock.calls[0][0].full_name).toBe('owner/second');
    expect(mocks.forceSyncToBackend).toHaveBeenCalledWith({ reportFailures: true });
    expect(mocks.forceSyncToBackend).toHaveBeenCalledTimes(1);
  });

  it('does not report a successful GitHub star as failed when backend sync fails', async () => {
    mocks.forceSyncToBackend.mockRejectedValueOnce(new Error('Offline'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.starSelected());
    expect(result.current.rows[0].status).toBe('starred');
    expect(result.current.syncError).toBe('Offline');
  });

  it('rejects empty extraction and oversized batches before network requests', async () => {
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://search.bilibili.com/all'));
    expect(result.current.inputError).toBe('no-repositories');
    await act(() => result.current.preview(Array.from({ length: 51 }, (_, i) => `https://github.com/owner/repo${i}`).join('\n')));
    expect(result.current.inputError).toBe('too-many-repositories');
    expect(mocks.getRepositoryDetails).not.toHaveBeenCalled();
  });

  it('selects and inverts only repositories that can still be starred', async () => {
    mocks.isRepositoryStarred.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/first https://github.com/owner/second'));
    expect(result.current.rows.map(row => row.status)).toEqual(['already-starred', 'ready']);

    act(() => result.current.selectAll());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, true]);
    act(() => result.current.invertSelection());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, false]);
    act(() => result.current.invertSelection());
    expect(result.current.rows.map(row => row.selected)).toEqual([false, true]);
  });

  it('translates descriptions into the interface language and reverts by toggling', async () => {
    mocks.translateBatch.mockResolvedValue([{ translatedText: '一个仓库', detectedLanguage: '' }]);
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    await act(() => result.current.toggleTranslations());
    expect(mocks.translateBatch).toHaveBeenCalledWith(['A repository'], 'zh', undefined, undefined, 'plain');
    expect(result.current.translations).toEqual({ 'owner/repo': '一个仓库' });
    expect(result.current.translationsVisible).toBe(true);
    expect(result.current.translationError).toBe('');

    await act(() => result.current.toggleTranslations());
    expect(result.current.translationsVisible).toBe(false);

    await act(() => result.current.toggleTranslations());
    expect(result.current.translationsVisible).toBe(true);
    expect(mocks.translateBatch).toHaveBeenCalledTimes(1);
  });

  it('keeps same-language descriptions original without a translation request', async () => {
    mocks.getRepositoryDetails.mockImplementation(async (owner, name) => ({ ...detail(owner, name), description: '中文描述' }));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    await act(() => result.current.toggleTranslations());
    expect(mocks.translateBatch).not.toHaveBeenCalled();
    expect(result.current.translations).toEqual({});
    expect(result.current.translationsVisible).toBe(true);
  });

  it('reports translation failures and stays on the original descriptions', async () => {
    mocks.translateBatch.mockRejectedValue(new Error('Translation failed: 429'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));

    await act(() => result.current.toggleTranslations());
    expect(result.current.translationsVisible).toBe(false);
    expect(result.current.translations).toEqual({});
    expect(result.current.translationError).toBe('Translation failed: 429');
  });

  it('resets translation state when the preview is re-run or cleared', async () => {
    mocks.translateBatch.mockResolvedValue([{ translatedText: '一个仓库', detectedLanguage: '' }]);
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.toggleTranslations());
    expect(result.current.translationsVisible).toBe(true);

    await act(() => result.current.preview('https://github.com/owner/other'));
    expect(result.current.translations).toEqual({});
    expect(result.current.translationsVisible).toBe(false);

    await act(() => result.current.toggleTranslations());
    act(() => result.current.clearPreview());
    expect(result.current.translations).toEqual({});
    expect(result.current.translationsVisible).toBe(false);
  });

  it('records a successful star to the starting account workspace when the session switched mid-import', async () => {
    // 审计修复：星标请求已在 GitHub 成功（不可撤销）而会话恰好切换时，
    // 该星标必须记录到发起账号的工作区并登记待同步，绝不静默丢失；
    // 尾部同步（forceSyncToBackend）绝不能在切号后执行。
    mocks.storeUser = { id: 1 };
    mocks.storeAccountWorkspaces = { '1': { repositories: [] } };
    // 发起星标请求时后端为 X；等待期间切换到 Y（模拟切号流程更换后端连接）
    mocks.backend.backendUrl = 'https://backend-x.example/api';
    mocks.starRepository.mockImplementation(async () => {
      // 星标请求期间切换到账号 2，同时后端地址从 X 切到 Y
      mocks.storeUser = { id: 2 };
      mocks.backend.backendUrl = 'https://backend-y.example/api';
    });
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/repo'));
    await act(() => result.current.starSelected());

    expect(mocks.starRepository).toHaveBeenCalledTimes(1);
    expect(mocks.addRepository).not.toHaveBeenCalled();
    expect(mocks.forceSyncToBackend).not.toHaveBeenCalled();
    // 星标记录进发起账号（id=1）的归档快照，并登记 (账号, 发起时后端) 待同步标记
    const parked = mocks.storeAccountWorkspaces['1'] as { repositories: Array<{ id: number }> };
    expect(parked.repositories).toHaveLength(1);
    expect(parked.repositories[0].id).toBe(1);
    // R13 审计修复（CodeRabbit）：待同步标记必须使用请求发起时的后端地址 X，
    // 绝不能记录请求完成时的后端 Y——若实现改为在星标完成后读取地址，本断言
    // 会因多出 Y 调用而失败。
    expect(mocks.markPendingAccountSync).toHaveBeenCalledTimes(1);
    expect(mocks.markPendingAccountSync).toHaveBeenCalledWith('1', 'https://backend-x.example/api');
    expect(mocks.markPendingAccountSync).not.toHaveBeenCalledWith('1', 'https://backend-y.example/api');
    mocks.backend.backendUrl = null;
  });
});
