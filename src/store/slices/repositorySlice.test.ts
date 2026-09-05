import { describe, expect, it, vi } from 'vitest';
import { beforeEach } from 'vitest';
import type { Repository } from '../../types';
import { defaultCategories } from '../schema';
import { createRepositorySlice } from './repositorySlice';
import { logger } from '../../services/logger';

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorFromError: vi.fn() },
}));

interface HarnessState {
  listsPush: { isRunning: boolean; total: number; done: number; currentLabel: string | null; message: string | null; error: string | null };
  categoryListIdMap: Record<string, string>;
  [key: string]: unknown;
}

type MockListsApi = {
  getUserLists: ReturnType<typeof vi.fn>;
  createUserList: ReturnType<typeof vi.fn>;
  updateUserList: ReturnType<typeof vi.fn>;
  updateUserListsForItem: ReturnType<typeof vi.fn>;
  resolveRepositoryNodeIds: ReturnType<typeof vi.fn>;
};

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: 'my-cli-app',
    full_name: 'owner/my-cli-app',
    description: null,
    html_url: 'https://github.com/owner/my-cli-app',
    stargazers_count: 1,
    forks_count: 0,
    forks: 0,
    language: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    pushed_at: '2024-01-01T00:00:00Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: ['cli'],
    ...overrides,
  };
}

/**
 * 最小化 slice 测试装置：仅提供 pushCategoriesToLists 读取/写入的状态字段。
 * 仓库 my-cli-app（topics: ['cli']）经 devtools 分类关键词 'cli' 命中，
 * 使推送流程完整走到最终 set()，从而可断言 categoryListIdMap 的持久化。
 */
function makeSliceHarness(options: {
  currentLists: Array<{ id: string; name: string; items: string[] }>;
  categoryListIdMap?: Record<string, string>;
  repositories?: Repository[];
}) {
  const state: HarnessState = {
    listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: null },
    githubToken: 'token',
    user: { login: 'octocat' },
    repositories: options.repositories ?? [makeRepo()],
    customCategories: [],
    language: 'en',
    hiddenDefaultCategoryIds: defaultCategories.filter(c => c.id !== 'devtools').map(c => c.id),
    defaultCategoryOverrides: {},
    categoryListIdMap: options.categoryListIdMap ?? {},
  };
  const set = (partial: unknown) => {
    const next = typeof partial === 'function'
      ? (partial as (s: HarnessState) => Partial<HarnessState>)(state)
      : partial;
    Object.assign(state, next);
  };
  const get = () => state;
  const api: MockListsApi = {
    getUserLists: vi.fn().mockResolvedValue(options.currentLists),
    createUserList: vi.fn().mockResolvedValue('L_new'),
    updateUserList: vi.fn().mockResolvedValue(undefined),
    updateUserListsForItem: vi.fn().mockResolvedValue(undefined),
    resolveRepositoryNodeIds: vi.fn().mockResolvedValue(new Map()),
  };
  const slice = createRepositorySlice(set as never, get as never);
  const push = () => slice.pushCategoriesToLists(api as never);
  return { push, api, state };
}

describe('pushCategoriesToLists 语言切换自动重命名', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persistedId 映射的中文 list 在英文语言下被重命名为分类名，不新建 list', async () => {
    const { push, api, state } = makeSliceHarness({
      currentLists: [{ id: 'L_zh', name: '开发工具', items: [] }],
      categoryListIdMap: { devtools: 'L_zh' },
    });

    await push();

    expect(api.updateUserList).toHaveBeenCalledTimes(1);
    expect(api.updateUserList).toHaveBeenCalledWith('L_zh', 'Development Tools');
    expect(api.createUserList).not.toHaveBeenCalled();
    expect(state.categoryListIdMap.devtools).toBe('L_zh');
    expect(state.listsPush.error).toBeNull();
  });

  it('无映射时按名称变体匹配既有中文 list：重命名并写入映射', async () => {
    const { push, api, state } = makeSliceHarness({
      currentLists: [{ id: 'L_legacy', name: '开发工具', items: [] }],
    });

    await push();

    expect(api.updateUserList).toHaveBeenCalledWith('L_legacy', 'Development Tools');
    expect(api.createUserList).not.toHaveBeenCalled();
    expect(state.categoryListIdMap.devtools).toBe('L_legacy');
  });

  it('list 名称已与分类名一致时不调用 updateUserList', async () => {
    const { push, api } = makeSliceHarness({
      currentLists: [{ id: 'L_en', name: 'Development Tools', items: [] }],
      categoryListIdMap: { devtools: 'L_en' },
    });

    await push();

    expect(api.updateUserList).not.toHaveBeenCalled();
    expect(api.createUserList).not.toHaveBeenCalled();
  });

  it('重命名失败时保留映射并继续推送（best-effort，下轮重试）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { push, api, state } = makeSliceHarness({
      currentLists: [{ id: 'L_zh', name: '开发工具', items: [] }],
      categoryListIdMap: { devtools: 'L_zh' },
    });
    api.updateUserList.mockRejectedValue(new Error('network down'));

    await expect(push()).resolves.toBeUndefined();

    expect(api.createUserList).not.toHaveBeenCalled();
    expect(state.categoryListIdMap.devtools).toBe('L_zh');
    expect(state.listsPush.error).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      'githubLists',
      'Some lists failed to rename, will retry next push',
      { failures: ['开发工具 -> Development Tools'] }
    );
    warnSpy.mockRestore();
  });

  it('新建 list 使用当前语言的分类名（而非规范中文名）', async () => {
    const { push, api, state } = makeSliceHarness({
      currentLists: [],
    });

    await push();

    expect(api.createUserList).toHaveBeenCalledWith('Development Tools', true);
    expect(state.categoryListIdMap.devtools).toBe('L_new');
  });
});
