import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorySidebar } from './CategorySidebar';
import { useAppStore } from '../store/useAppStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: () => [
    { id: 'all', name: '全部分类', icon: '📁', keywords: [] },
    { id: 'cat-b', name: '分类B', icon: '📦', keywords: [], isCustom: true },
    { id: 'cat-c', name: '分类C', icon: '🧪', keywords: [], isCustom: true },
  ],
  sortCategoriesByOrder: (categories: { id: string }[]) => categories,
}));

const syncMocks = vi.hoisted(() => ({
  forceSyncToBackend: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: syncMocks.toast, confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../features/repositories/hooks/useCategorySyncActions', () => ({
  useCategorySyncActions: () => syncMocks,
}));

const categorizedRepo: Repository = {
  id: 1,
  name: 'example-repository',
  full_name: 'owner/example-repository',
  description: 'Repository description',
  html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 128,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: ['test'],
  ai_platforms: ['web', 'cli'],
  custom_category: '分类B',
  category_locked: true,
};

const storeState = {
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  defaultCategoryOverrides: {},
  categoryOrder: [],
  collapsedSidebarCategoryCount: 6,
  categoryMatchMode: 'effective' as const,
  deleteCustomCategory: vi.fn(),
  hideDefaultCategory: vi.fn(),
  showDefaultCategory: vi.fn(),
  language: 'zh' as const,
  updateRepository: vi.fn(),
  isSidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
};

const mockUseAppStore = vi.mocked(useAppStore);
const sidebarWidthStorageKey = 'github-stars-category-sidebar-width';

const firePointerEvent = (target: Window | HTMLElement, type: string, clientX: number) => {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  fireEvent(target, event);
};

const setViewport = (width: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  window.dispatchEvent(new Event('resize'));
};

const renderSidebar = (repositories: Repository[], onCategorySelect = vi.fn()) =>
  render(
    <CategorySidebar
      repositories={repositories}
      selectedCategory="cat-b"
      onCategorySelect={onCategorySelect}
    />
  );

const dropOnCategory = async (categoryName: string, repoId: string) => {
  const target = screen.getByText(categoryName);
  const dataTransfer = { getData: vi.fn(() => repoId) };
  await act(async () => {
    fireEvent.drop(target, { dataTransfer });
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  act(() => setViewport(1440));
  useRepositoryDragStore.getState().endDrag();
  syncMocks.forceSyncToBackend.mockReset().mockResolvedValue(undefined);
  mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as typeof useAppStore);
});

describe('CategorySidebar drop-to-uncategorize (issue #353 suggestion)', () => {
  it('将已分类仓库拖到「全部分类」时显式清空分类并同步后端', async () => {
    renderSidebar([categorizedRepo]);

    await dropOnCategory('全部分类', String(categorizedRepo.id));

    expect(storeState.updateRepository).toHaveBeenCalledOnce();
    const updated = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(updated.custom_category).toBe('');
    expect(updated.category_locked).toBe(false);
    expect(syncMocks.forceSyncToBackend).toHaveBeenCalledOnce();
    expect(useRepositoryDragStore.getState().isDragging).toBe(false);
  });

  it('本就无分类的仓库拖到「全部分类」时不写入不同步', async () => {
    renderSidebar([{ ...categorizedRepo, custom_category: '', category_locked: false }]);

    await dropOnCategory('全部分类', String(categorizedRepo.id));

    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(syncMocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('无锁定分类且 AI/默认分类均未命中的仓库拖到「全部分类」时保持 no-op（保留 undefined 以便后续 AI 归类）', async () => {
    const neverMatchedRepo: Repository = {
      ...categorizedRepo,
      id: 2,
      name: 'zzz-project',
      full_name: 'owner/zzz-project',
      description: '',
      language: 'Rust',
      topics: [],
      ai_tags: undefined,
      ai_summary: undefined,
      custom_category: undefined,
      category_locked: false,
    };
    renderSidebar([neverMatchedRepo]);

    await dropOnCategory('全部分类', '2');

    expect(storeState.updateRepository).not.toHaveBeenCalled();
    expect(syncMocks.forceSyncToBackend).not.toHaveBeenCalled();
  });

  it('拖到普通分类时沿用原有改分类逻辑（回归保护）', async () => {
    renderSidebar([categorizedRepo]);

    await dropOnCategory('分类C', String(categorizedRepo.id));

    expect(storeState.updateRepository).toHaveBeenCalledOnce();
    const updated = storeState.updateRepository.mock.calls[0][0] as Repository;
    expect(updated.custom_category).toBe('分类C');
    expect(updated.category_locked).toBe(true);
    expect(syncMocks.forceSyncToBackend).toHaveBeenCalledOnce();
  });

  it('同步失败时回滚为原始仓库数据', async () => {
    syncMocks.forceSyncToBackend.mockRejectedValue(new Error('sync failed'));
    renderSidebar([categorizedRepo]);

    await dropOnCategory('全部分类', String(categorizedRepo.id));

    // 回滚：以原始仓库对象调用 updateRepository
    expect(storeState.updateRepository).toHaveBeenCalledTimes(2);
    const rollback = storeState.updateRepository.mock.calls[1][0] as Repository;
    expect(rollback.custom_category).toBe('分类B');
    expect(rollback.category_locked).toBe(true);
    expect(syncMocks.toast).toHaveBeenCalledWith('同步到后端失败，已恢复分类更改。', 'error');
  });
});

describe('CategorySidebar responsive behavior', () => {
  it('uses a Categories drawer with vertical 44px category controls on mobile', () => {
    act(() => setViewport(390));
    const onCategorySelect = vi.fn();
    renderSidebar([categorizedRepo], onCategorySelect);

    const trigger = screen.getByRole('button', { name: /Categories.*3/i });
    expect(trigger).toHaveClass('min-h-11');
    expect(screen.queryByRole('button', { name: '分类B' })).not.toBeInTheDocument();
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    const addButton = screen.getByRole('button', { name: '添加分类' });
    const closeButton = screen.getByRole('button', { name: '关闭分类' });
    expect(addButton).toHaveClass('min-h-11', 'min-w-11');
    expect(closeButton).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.click(closeButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    const list = screen.getByRole('list', { name: /Categories/i });
    expect(list).toHaveClass('flex-col');
    const categoryButton = screen.getByRole('button', { name: '分类B' });
    for (const button of screen.getAllByRole('button', { name: /^(全部分类|分类B|分类C)$/ })) {
      expect(button).toHaveClass('min-h-11');
    }
    fireEvent.click(categoryButton);

    expect(onCategorySelect).toHaveBeenCalledWith('cat-b');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('exposes a keyboard-operable desktop resize separator and persists width', () => {
    const { container } = renderSidebar([categorizedRepo]);
    const separator = screen.getByRole('separator', { name: /resize categories/i });

    expect(separator).toHaveAttribute('aria-orientation', 'vertical');
    expect(separator).toHaveAttribute('aria-valuemin', '220');
    expect(separator).toHaveAttribute('aria-valuemax', '480');
    expect(separator).toHaveAttribute('aria-valuenow', '256');
    fireEvent.keyDown(separator, { key: 'ArrowRight' });
    expect(separator).toHaveAttribute('aria-valuenow', '264');
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBe('264');
    expect(container.querySelector('.linear-sidebar')).toHaveStyle({ width: '264px' });
    fireEvent.keyDown(separator, { key: 'Home' });
    expect(separator).toHaveAttribute('aria-valuenow', '220');
    fireEvent.keyDown(separator, { key: 'End' });
    expect(separator).toHaveAttribute('aria-valuenow', '480');
    fireEvent.doubleClick(separator);
    expect(separator).toHaveAttribute('aria-valuenow', '256');
  });

  it('resizes from pointer dragging and persists the clamped width', () => {
    const { container } = renderSidebar([categorizedRepo]);
    const separator = screen.getByRole('separator', { name: /resize categories/i });

    firePointerEvent(separator, 'pointerdown', 100);
    firePointerEvent(window, 'pointermove', 180);

    expect(separator).toHaveAttribute('aria-valuenow', '336');
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBeNull();
    firePointerEvent(window, 'pointerup', 180);

    expect(separator).toHaveAttribute('aria-valuenow', '336');
    expect(container.querySelector('.linear-sidebar')).toHaveStyle({ width: '336px' });
    expect(window.localStorage.getItem(sidebarWidthStorageKey)).toBe('336');
  });

  it('restores a persisted desktop width after remount', () => {
    window.localStorage.setItem(sidebarWidthStorageKey, '320');
    const first = renderSidebar([categorizedRepo]);
    expect(screen.getByRole('separator', { name: /resize categories/i })).toHaveAttribute('aria-valuenow', '320');
    first.unmount();

    renderSidebar([categorizedRepo]);
    expect(screen.getByRole('separator', { name: /resize categories/i })).toHaveAttribute('aria-valuenow', '320');
  });

  it('safely falls back or clamps invalid persisted desktop widths', () => {
    window.localStorage.setItem(sidebarWidthStorageKey, 'not-a-width');
    const invalid = renderSidebar([categorizedRepo]);
    expect(screen.getByRole('separator', { name: /resize categories/i })).toHaveAttribute('aria-valuenow', '256');
    invalid.unmount();

    window.localStorage.setItem(sidebarWidthStorageKey, '100');
    const belowMinimum = renderSidebar([categorizedRepo]);
    expect(screen.getByRole('separator', { name: /resize categories/i })).toHaveAttribute('aria-valuenow', '220');
    belowMinimum.unmount();

    window.localStorage.setItem(sidebarWidthStorageKey, '500');
    renderSidebar([categorizedRepo]);
    expect(screen.getByRole('separator', { name: /resize categories/i })).toHaveAttribute('aria-valuenow', '480');
  });

  it('keeps the collapsed desktop sidebar narrow without an active resize separator', () => {
    storeState.isSidebarCollapsed = true;
    try {
      const { container } = renderSidebar([categorizedRepo]);
      expect(container.querySelector('.linear-sidebar')).toHaveClass('w-14');
      expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    } finally {
      storeState.isSidebarCollapsed = false;
    }
  });
});
