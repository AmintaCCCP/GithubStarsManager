import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategoryEditModal } from './CategoryEditModal';
import { useAppStore } from '../store/useAppStore';
import type { Category } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
  getAllCategories: () => [],
}));

vi.mock('../i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

const mocks = vi.hoisted(() => ({
  pushCategoriesToLists: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}));

vi.mock('../features/settings/hooks/useStarSyncActions', () => ({
  useStarSyncActions: () => ({ pushCategoriesToLists: mocks.pushCategoriesToLists }),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn().mockResolvedValue(true) }),
}));

const category: Category = { id: 'cat-1', name: '分类A', icon: '📦', keywords: ['a'], isCustom: true };

const storeState = {
  addCustomCategory: vi.fn(),
  updateCustomCategory: vi.fn(),
  updateDefaultCategory: vi.fn(),
  resetDefaultCategory: vi.fn(),
  resetDefaultCategoryNameIcon: vi.fn(),
  resetDefaultCategoryKeywords: vi.fn(),
  defaultCategoryOverrides: {},
  language: 'zh' as const,
  customCategories: [category],
  listsPush: { isRunning: false },
};

const pushLabel = 'categoryEditModal.push-to-github-list';

beforeEach(() => {
  vi.clearAllMocks();
  storeState.listsPush.isRunning = false;
  vi.mocked(useAppStore).mockImplementation(((
    selector?: (state: typeof storeState) => unknown,
  ) => (selector ? selector(storeState) : storeState)) as typeof useAppStore);
});

describe('CategoryEditModal push to GitHub list', () => {
  it('shows the push button in edit mode only', () => {
    const { unmount } = render(<CategoryEditModal isOpen onClose={vi.fn()} category={category} />);
    expect(screen.getByText(pushLabel)).toBeTruthy();
    unmount();
    render(<CategoryEditModal isOpen onClose={vi.fn()} category={null} isCreating />);
    expect(screen.queryByText(pushLabel)).toBeNull();
  });

  it('closes the modal and pushes the saved category on click', () => {
    const onClose = vi.fn();
    render(<CategoryEditModal isOpen onClose={onClose} category={category} />);
    fireEvent.click(screen.getByText(pushLabel));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.pushCategoriesToLists).toHaveBeenCalledWith(['cat-1']);
  });

  it('disables the push button once the form has unsaved changes', () => {
    render(<CategoryEditModal isOpen onClose={vi.fn()} category={category} />);
    const button = screen.getByText(pushLabel).closest('button') as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/categoryEditModal.category-name/), { target: { value: '分类A2' } });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('categoryEditModal.save-changes-before-push');
  });

  it('disables the push button while a lists push is running', async () => {
    storeState.listsPush.isRunning = true;
    const onClose = vi.fn();
    render(<CategoryEditModal isOpen onClose={onClose} category={category} />);
    const button = screen.getByText(pushLabel).closest('button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    // user-event 模拟真实用户点击：对禁用按钮不会派发 click，比 fireEvent 更接近浏览器行为
    await userEvent.click(button);
    expect(onClose).not.toHaveBeenCalled();
    expect(mocks.pushCategoriesToLists).not.toHaveBeenCalled();
  });

  it('shows a hint when the name is longer than 32 characters', () => {
    render(<CategoryEditModal isOpen onClose={vi.fn()} category={category} />);
    const hint = 'categoryEditModal.name-too-long-for-github-list';
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.change(screen.getByLabelText(/categoryEditModal.category-name/), { target: { value: 'a'.repeat(33) } });
    expect(screen.getByText(hint)).toBeTruthy();
  });
});
