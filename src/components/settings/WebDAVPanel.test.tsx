import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDAVPanel } from './WebDAVPanel';
import { useAppStore } from '../../store/useAppStore';

vi.mock('../../store/useAppStore', async (importOriginal) => importOriginal());

vi.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock('../../features/settings/hooks/useWebDAVActions', () => ({
  useWebDAVActions: () => ({ testingId: null, save: vi.fn().mockReturnValue(false), test: vi.fn() }),
}));

const t = (key: string) => key;

// 弹窗不是由 DialogTrigger 打开的，Radix 关闭时会把焦点丢到 body；这里锁住"还给打开按钮"。
describe('WebDAVPanel dialog focus', () => {
  beforeEach(() => {
    useAppStore.setState({ webdavConfigs: [], activeWebDAVConfig: null });
  });

  it('returns focus to the Add button after the dialog is dismissed with Escape', async () => {
    const user = userEvent.setup();
    render(<WebDAVPanel t={t} />);

    const addButton = screen.getByRole('button', { name: /webDAVPanel.add-webdav/ });
    await user.click(addButton);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(addButton);
  });
});
