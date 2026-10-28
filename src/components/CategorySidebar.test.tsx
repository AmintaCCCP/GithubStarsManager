import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CategorySidebar } from './CategorySidebar';
import { useAppStore } from '../store/useAppStore';
import { useRepositoryDragStore } from '../store/useRepositoryDragStore';
import type { Repository } from '../types';

vi.mock('./CategoryEditModal', () => ({
  CategoryEditModal: (props: {
    isOpen: boolean;
    onClose: () => void;
    category: unknown;
    isCreating: boolean;
  }) => {
    modalSpy.props = props;
    return props.isOpen ? <div data-testid="category-edit-modal" /> : null;
  },
}));

const modalSpy = vi.hoisted(() => ({
  props: null as null | {
    isOpen: boolean;
    onClose: () => void;
    category: unknown;
    isCreating: boolean;
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: () => [
    { id: 'all', name: '全部分类', icon: '📁', keywords: [] },
    { id: 'cat-b', name: '分类B', icon: '📦', keywords: [], isCustom: true },
    { id: 'cat-c', name: '分类C', icon: '🧪', keywords: [], isCustom: true },
  ],
  sortCategoriesByOrder: (categories: { id: string }[]) => categories,
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(true) }),
}));

vi.mock('../features/repositories/hooks/useCategorySyncActions', () => ({
  useCategorySyncActions: () => ({ forceSyncToBackend: vi.fn().mockResolvedValue(undefined) }),
}));

const storeState = {
  customCategories: [] as unknown[],
  hiddenDefaultCategoryIds: [] as string[],
  defaultCategoryOverrides: {} as Record<string, string>,
  categoryOrder: [] as string[],
  collapsedSidebarCategoryCount: 6,
  categoryMatchMode: 'effective' as const,
  deleteCustomCategory: vi.fn(),
  hideDefaultCategory: vi.fn(),
  showDefaultCategory: vi.fn(),
  language: 'zh' as const,
  updateRepository: vi.fn(),
  isSidebarCollapsed: false,
  setSidebarCollapsed: vi.fn(),
  releaseSubscriptions: new Set<number>(),
  searchFilters: {},
  setSearchFilters: vi.fn(),
  lastSync: '2026-10-28T00:00:00.000Z',
};

const mockUseAppStore = vi.mocked(useAppStore);

const renderSidebar = (repositories: Repository[] = []) => {
  const utils = render(
    <CategorySidebar
      repositories={repositories}
      selectedCategory="cat-b"
      onCategorySelect={vi.fn()}
    />
  );
  return utils;
};

const stubViewport = (width: number) => {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
};

const originalInnerWidth = window.innerWidth;

beforeEach(() => {
  vi.clearAllMocks();
  useRepositoryDragStore.getState().endDrag();
  storeState.isSidebarCollapsed = false;
  mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
    selector ? selector(storeState) : storeState
  )) as typeof useAppStore);
});

afterEach(() => {
  stubViewport(originalInnerWidth);
});

describe('CategorySidebar add-category placement (three layouts)', () => {
  it('移动端：添加分类按钮唯一且位于分类集合操作行', () => {
    stubViewport(768);

    renderSidebar();

    const categoryRegion = screen.getByRole('region', { name: '仓库分类' });
    const addButtons = within(categoryRegion).getAllByRole('button', { name: '添加分类' });
    expect(addButtons).toHaveLength(1);
    const collectionRow = addButtons[0].closest('.app-collection-row');
    expect(collectionRow).not.toBeNull();
    expect(within(collectionRow as HTMLElement).getByText('仓库分类')).toBeTruthy();
    expect(within(collectionRow as HTMLElement).getByText('2')).toBeTruthy();
  });

  it('桌面展开态：添加分类按钮唯一且位于分类集合操作行，不在顶部工具行', () => {
    stubViewport(1440);

    renderSidebar();

    const categoryRegion = screen.getByRole('region', { name: '分类' });
    const addButton = within(categoryRegion).getByRole('button', { name: '添加分类' });
    expect(within(categoryRegion).getAllByRole('button', { name: '添加分类' })).toHaveLength(1);

    const sidebar = screen.getByLabelText('仓库分类');
    const sidebarHead = sidebar.querySelector('.context-sidebar-head');
    expect(sidebarHead).not.toBeNull();
    expect((sidebarHead as HTMLElement).contains(addButton)).toBe(false);
    expect(within(sidebarHead as HTMLElement).getByRole('button', { name: '折叠侧栏' })).toBeTruthy();

    const collectionRow = addButton.closest('.app-collection-row');
    expect(collectionRow).not.toBeNull();
    expect(within(collectionRow as HTMLElement).getByText('分类')).toBeTruthy();
    expect(within(collectionRow as HTMLElement).getByText('2')).toBeTruthy();
  });

  it('桌面折叠态：添加分类按钮唯一且位于分类图标列表末尾，展开按钮在其上方', () => {
    stubViewport(1440);
    storeState.isSidebarCollapsed = true;

    renderSidebar();

    const addButtons = screen.getAllByRole('button', { name: '添加分类' });
    expect(addButtons).toHaveLength(1);
    const addButton = addButtons[0];

    // 分类图标集合：添加按钮的前一个兄弟元素，折叠态下分类按钮 aria-label 为分类名
    const iconGroup = addButton.previousElementSibling as HTMLElement | null;
    expect(iconGroup).not.toBeNull();
    expect(within(iconGroup as HTMLElement).getByRole('button', { name: '分类B' })).toBeTruthy();
    expect(within(iconGroup as HTMLElement).getByRole('button', { name: '分类C' })).toBeTruthy();

    // 展开按钮位于分类图标集合之前（顶部），不在分类图标集合内
    const expandButton = screen.getByRole('button', { name: '展开侧栏' });
    expect((iconGroup as HTMLElement).contains(expandButton)).toBe(false);
    expect(
      expandButton.compareDocumentPosition(iconGroup as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('点击添加分类进入原 handleAddCategory 路径', () => {
    stubViewport(1440);

    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '添加分类' }));

    expect(modalSpy.props).not.toBeNull();
    expect(modalSpy.props?.isOpen).toBe(true);
    expect(modalSpy.props?.isCreating).toBe(true);
    expect(modalSpy.props?.category).toBeNull();
    expect(screen.getByTestId('category-edit-modal')).toBeTruthy();
  });
});

describe('CategorySidebar Ctrl/Cmd+B shortcut', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('桌面展开态按 Cmd+B 折叠侧栏', () => {
    stubViewport(1440);
    vi.useFakeTimers();

    renderSidebar();

    act(() => {
      fireEvent.keyDown(window, { key: 'b', metaKey: true });
      vi.advanceTimersByTime(200);
    });

    expect(storeState.setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('移动端按 Cmd+B 不切换侧栏状态', () => {
    stubViewport(768);
    vi.useFakeTimers();

    renderSidebar();

    act(() => {
      fireEvent.keyDown(window, { key: 'b', metaKey: true });
      vi.advanceTimersByTime(200);
    });

    expect(storeState.setSidebarCollapsed).not.toHaveBeenCalled();
  });
});

describe('CategorySidebar quick access', () => {
  it('routes subscribed and needs-review rows through the real search filters', () => {
    stubViewport(1440);

    renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: /已订阅 Release/ }));
    expect(storeState.setSearchFilters).toHaveBeenCalledWith(expect.objectContaining({
      isSubscribed: true,
      isAnalyzed: undefined,
    }));

    fireEvent.click(screen.getByRole('button', { name: /待整理/ }));
    expect(storeState.setSearchFilters).toHaveBeenCalledWith(expect.objectContaining({
      isSubscribed: undefined,
      isAnalyzed: false,
    }));
  });

  it('counts needs-review rows with the same predicate as the filter', () => {
    stubViewport(1440);
    const repositories = [
      { id: 1, full_name: 'owner/pending', analyzed_at: null, analysis_failed: false },
      { id: 2, full_name: 'owner/failed', analyzed_at: '2026-10-28T00:00:00.000Z', analysis_failed: true },
    ] as Repository[];

    renderSidebar(repositories);

    const needsReviewButton = screen.getByRole('button', { name: /待整理/ });
    expect(within(needsReviewButton).getByText('1')).toBeInTheDocument();
  });
});
