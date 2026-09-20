import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalChatHistorySheet } from './GlobalChatHistorySheet';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import type { Repository } from '../types';
import type { RepositoryChatSession } from '../types/repositoryChat';

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: 'zh' }) => unknown) => selector({ language: 'zh' }),
}));

const createRepository = (id: number, fullName: string): Repository => ({
  id,
  name: fullName.split('/')[1],
  full_name: fullName,
  owner: { login: fullName.split('/')[0], avatar_url: 'https://example.com/avatar.png' },
} as unknown as Repository);

const createSession = (id: string, repoId: number, repoFullName: string, updatedAt: string): RepositoryChatSession => ({
  id,
  repoId,
  repoFullName,
  sourceRefSha: 'abcdef1234567890',
  title: `title-${id}`,
  createdAt: updatedAt,
  updatedAt,
});

const repositories = [createRepository(1, 'owner/repo-one'), createRepository(2, 'owner/repo-two')];

describe('GlobalChatHistorySheet', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
  });

  it('在移动端保留可触及的搜索和会话操作', async () => {
    await repositoryChatStorage.saveSession(createSession('mobile', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen repositories={repositories} onClose={() => {}} onSelectSession={() => {}} />);

    expect(screen.getByLabelText('搜索问答历史')).toHaveClass('h-11', 'text-base', 'sm:h-8', 'sm:text-xs');
    const session = await screen.findByTitle('进入 owner/repo-one 的会话');
    expect(session).toHaveClass('min-h-11', 'max-w-full', 'sm:min-h-0');
    expect(within(session.closest('li') as HTMLElement).getByRole('button', { name: /删除会话/ })).toHaveClass('h-11', 'w-11', 'sm:h-7', 'sm:w-7');
  });

  it('按更新时间倒序列出跨仓会话', async () => {
    await repositoryChatStorage.saveSession(createSession('older', 1, 'owner/repo-one', '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('newer', 2, 'owner/repo-two', '2026-08-26T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen repositories={repositories} onClose={() => {}} onSelectSession={() => {}} />);

    const items = await screen.findAllByTitle(/进入 owner\//);
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('title-newer'),
      expect.stringContaining('title-older'),
    ]);
  });

  it('按标题或仓库名过滤并进入对应仓库会话', async () => {
    await repositoryChatStorage.saveSession(createSession('s1', 1, 'owner/repo-one', '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('s2', 2, 'owner/repo-two', '2026-08-26T00:00:00.000Z'));
    const onSelectSession = vi.fn();

    render(<GlobalChatHistorySheet isOpen repositories={repositories} onClose={() => {}} onSelectSession={onSelectSession} />);
    await screen.findByTitle('进入 owner/repo-one 的会话');

    fireEvent.change(screen.getByLabelText('搜索问答历史'), { target: { value: 'repo-two' } });
    expect(screen.queryByTitle('进入 owner/repo-one 的会话')).toBeNull();

    fireEvent.click(screen.getByTitle('进入 owner/repo-two 的会话'));
    expect(onSelectSession).toHaveBeenCalledWith(repositories[1], 's2');
  });

  it('删除会话后从列表移除', async () => {    await repositoryChatStorage.saveSession(createSession('doomed', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen repositories={repositories} onClose={() => {}} onSelectSession={() => {}} />);
    await screen.findByTitle('进入 owner/repo-one 的会话');

    const item = screen.getByTitle('进入 owner/repo-one 的会话').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: /删除会话/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }));

    expect(await screen.findByText('还没有保存的问答会话。')).toBeTruthy();
  });

  it('读取失败时显示错误与重试，恢复后可重载', async () => {
    const listSpy = vi.spyOn(repositoryChatStorage, 'listRecentSessions');
    listSpy.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    render(<GlobalChatHistorySheet isOpen repositories={repositories} onClose={() => {}} onSelectSession={() => {}} />);
    expect(await screen.findByText('历史加载失败，请重试。')).toBeTruthy();

    listSpy.mockResolvedValueOnce([createSession('recovered', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z')]);
    const retryButtons = await screen.findAllByRole('button', { name: '重试' });
    fireEvent.click(retryButtons[0]);

    expect(await screen.findByTitle('进入 owner/repo-one 的会话')).toBeTruthy();
    listSpy.mockRestore();
  });
});
