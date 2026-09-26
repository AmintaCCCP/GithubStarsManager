import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchStarImport } from './useBatchStarImport';

const mocks = vi.hoisted(() => ({
  token: 'token',
  addRepository: vi.fn(),
  getRepositoryDetails: vi.fn(),
  isRepositoryStarred: vi.fn(),
  starRepository: vi.fn(),
  forceSyncToBackend: vi.fn(),
}));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    githubToken: mocks.token, addRepository: mocks.addRepository,
  }),
}));
vi.mock('../../../services/githubApiFactory', () => ({ createGitHubApiService: () => mocks }));
vi.mock('../../../services/autoSync', () => ({ forceSyncToBackend: mocks.forceSyncToBackend }));

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
    mocks.getRepositoryDetails.mockImplementation(async (owner, name) => detail(owner, name));
    mocks.isRepositoryStarred.mockResolvedValue(false);
    mocks.starRepository.mockResolvedValue(undefined);
    mocks.forceSyncToBackend.mockResolvedValue(undefined);
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

  it('keeps already-starred and inaccessible repositories out of the selection', async () => {
    mocks.isRepositoryStarred.mockResolvedValue(true);
    mocks.getRepositoryDetails.mockRejectedValueOnce(new Error('GitHub API error: 404 Not Found'));
    const { result } = renderHook(() => useBatchStarImport());
    await act(() => result.current.preview('https://github.com/owner/missing https://github.com/owner/existing'));
    expect(result.current.rows.map(row => row.status)).toEqual(['unavailable', 'already-starred']);
    await act(() => result.current.starSelected());
    expect(mocks.starRepository).not.toHaveBeenCalled();
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
});
