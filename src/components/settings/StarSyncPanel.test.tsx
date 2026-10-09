import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StarSyncPanel } from './StarSyncPanel';
import { makeT } from '../../i18n/useT';

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    useAppStore: (selector?: (s: Record<string, unknown>) => unknown) => (selector ? selector(state) : state),
    pushCategoriesToLists: vi.fn(),
  };
});

vi.mock('../../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
  getAllCategories: () => [],
}));
vi.mock('../../features/settings/hooks/useStarSyncActions', () => ({
  useStarSyncActions: () => ({ pushCategoriesToLists: mocks.pushCategoriesToLists }),
}));

const t = makeT('zh', 'app');

describe('StarSyncPanel 推送入口', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.state, {
      syncMode: 'stars',
      setSyncMode: vi.fn(),
      setSyncModeConfigured: vi.fn(),
      listsPush: { isRunning: false, total: 0, done: 0 },
      customCategories: [],
      hiddenDefaultCategoryIds: [],
      defaultCategoryOverrides: {},
      language: 'zh',
    });
  });

  it('点击「推送全部」不带参数调用（点击事件不能泄漏为 categoryIds）', async () => {
    render(<StarSyncPanel t={t} />);

    await userEvent.click(screen.getByRole('button', { name: '同步仓库分类到 GitHub list' }));

    expect(mocks.pushCategoriesToLists).toHaveBeenCalledTimes(1);
    expect(mocks.pushCategoriesToLists).toHaveBeenCalledWith();
  });
});
