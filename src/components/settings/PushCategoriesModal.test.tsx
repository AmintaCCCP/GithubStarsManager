import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PushCategoriesModal } from './PushCategoriesModal';
import type { Category } from '../../types';

const categories: Category[] = [
  { id: 'a', name: '分类A', icon: '📦', keywords: [] },
  { id: 'b', name: '分类B', icon: '🧪', keywords: [], isCustom: true },
  { id: 'c', name: '分类C', icon: '🛠', keywords: [], isCustom: true },
];

const renderModal = (onConfirm = vi.fn()) => {
  render(<PushCategoriesModal isOpen onClose={vi.fn()} categories={categories} onConfirm={onConfirm} />);
  return onConfirm;
};

describe('PushCategoriesModal', () => {
  it('打开时默认全选', () => {
    renderModal();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    boxes.forEach(box => expect(box).toBeChecked());
    expect(screen.getByRole('button', { name: '推送选中的 3 个分类' })).toBeEnabled();
  });

  it('全不选后确认按钮禁用', async () => {
    renderModal();

    await userEvent.click(screen.getByRole('button', { name: '全不选' }));

    screen.getAllByRole('checkbox').forEach(box => expect(box).not.toBeChecked());
    expect(screen.getByRole('button', { name: '推送选中的 0 个分类' })).toBeDisabled();
  });

  it('取消勾选一项后确认返回剩余 id', async () => {
    const onConfirm = renderModal();

    await userEvent.click(screen.getByRole('checkbox', { name: /分类B/ }));
    await userEvent.click(screen.getByRole('button', { name: '推送选中的 2 个分类' }));

    expect(onConfirm).toHaveBeenCalledWith(['a', 'c']);
  });

  it('关闭后重新打开恢复全选', async () => {
    const props = { onClose: vi.fn(), categories, onConfirm: vi.fn() };
    const { rerender } = render(<PushCategoriesModal isOpen {...props} />);

    await userEvent.click(screen.getByRole('checkbox', { name: /分类B/ }));
    expect(screen.getByRole('checkbox', { name: /分类B/ })).not.toBeChecked();

    rerender(<PushCategoriesModal isOpen={false} {...props} />);
    rerender(<PushCategoriesModal isOpen {...props} />);

    screen.getAllByRole('checkbox').forEach(box => expect(box).toBeChecked());
  });

  it('全不选后再全选，确认返回全部 id', async () => {
    const onConfirm = renderModal();

    await userEvent.click(screen.getByRole('button', { name: '全不选' }));
    await userEvent.click(screen.getByRole('button', { name: '全选' }));
    await userEvent.click(screen.getByRole('button', { name: '推送选中的 3 个分类' }));

    expect(onConfirm).toHaveBeenCalledWith(['a', 'b', 'c']);
  });
});
