import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalChatHistorySheet } from './GlobalChatHistorySheet';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import type { Repository } from '../types';
import type { RepositoryChatSession } from '../types/repositoryChat';

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: 'zh'; repositories: Repository[]; user: { login: string } | null }) => unknown) =>
    selector({ language: 'zh', repositories: storeRepositories, user: storeUser }),
}));

const createRepository = (id: number, fullName: string): Repository => ({
  id,
  name: fullName.split('/')[1],
  full_name: fullName,
  owner: { login: fullName.split('/')[0], avatar_url: 'https://example.com/avatar.png' },
} as unknown as Repository);

const createSession = (id: string, repoId: number, repoFullName: string, updatedAt: string, accountLogin?: string): RepositoryChatSession => ({
  id,
  repoId,
  repoFullName,
  sourceRefSha: 'abcdef1234567890',
  title: `title-${id}`,
  createdAt: updatedAt,
  updatedAt,
  ...(accountLogin ? { accountLogin } : {}),
});

const repositories = [createRepository(1, 'owner/repo-one'), createRepository(2, 'owner/repo-two')];

// 模拟“搜索结果为子集”的场景：全局历史不再依赖传入的仓库列表。
let storeRepositories: Repository[] = repositories;
let storeUser: { login: string } | null = null;

describe('GlobalChatHistorySheet', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: undefined });
    storeRepositories = repositories;
    storeUser = null;
  });

  it('按更新时间倒序列出跨仓会话', async () => {
    await repositoryChatStorage.saveSession(createSession('older', 1, 'owner/repo-one', '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('newer', 2, 'owner/repo-two', '2026-08-26T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={() => {}} />);

    const items = await screen.findAllByTitle(/进入 owner\//);
    expect(screen.getByRole('heading', { name: /问答历史\s*\(2\)/ })).toBeInTheDocument();
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining('title-newer'),
      expect.stringContaining('title-older'),
    ]);
  });

  it('按标题或仓库名过滤并进入对应仓库会话', async () => {
    await repositoryChatStorage.saveSession(createSession('s1', 1, 'owner/repo-one', '2026-08-24T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('s2', 2, 'owner/repo-two', '2026-08-26T00:00:00.000Z'));
    const onSelectSession = vi.fn();

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={onSelectSession} />);
    await screen.findByTitle('进入 owner/repo-one 的会话');

    fireEvent.change(screen.getByLabelText('搜索问答历史'), { target: { value: 'repo-two' } });
    expect(screen.queryByTitle('进入 owner/repo-one 的会话')).toBeNull();

    fireEvent.click(screen.getByTitle('进入 owner/repo-two 的会话'));
    expect(onSelectSession).toHaveBeenCalledWith(repositories[1], 's2');
  });

  it('删除会话后从列表移除', async () => {    await repositoryChatStorage.saveSession(createSession('doomed', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={() => {}} />);
    await screen.findByTitle('进入 owner/repo-one 的会话');

    const item = screen.getByTitle('进入 owner/repo-one 的会话').closest('li') as HTMLElement;
    fireEvent.click(within(item).getByRole('button', { name: /删除会话/ }));
    fireEvent.click(screen.getByRole('button', { name: '删除会话' }));

    expect(await screen.findByText('还没有保存的问答会话。')).toBeTruthy();
  });

  it('读取失败时显示错误与重试，恢复后可重载', async () => {
    const listSpy = vi.spyOn(repositoryChatStorage, 'listRecentSessions');
    listSpy.mockRejectedValueOnce(new Error('IndexedDB unavailable'));

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={() => {}} />);
    expect(await screen.findByText('历史加载失败，请重试。')).toBeTruthy();

    listSpy.mockResolvedValueOnce([createSession('recovered', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z')]);
    const retryButtons = await screen.findAllByRole('button', { name: '重试' });
    fireEvent.click(retryButtons[0]);

    expect(await screen.findByTitle('进入 owner/repo-one 的会话')).toBeTruthy();
    listSpy.mockRestore();
  });

  it('搜索处于激活状态（searchResults 为子集）时，所有会话都可点击', async () => {
    storeRepositories = [repositories[0]];
    const onSelectSession = vi.fn();
    await repositoryChatStorage.saveSession(createSession('s1', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z'));
    await repositoryChatStorage.saveSession(createSession('s2', 2, 'owner/repo-two', '2026-08-24T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={onSelectSession} />);

    fireEvent.click(await screen.findByTitle('进入 owner/repo-one 的会话'));
    fireEvent.click(screen.getByTitle('进入 owner/repo-two 的会话'));

    expect(onSelectSession).toHaveBeenCalledTimes(2);
    expect(onSelectSession).toHaveBeenNthCalledWith(1, repositories[0], 's1');
    expect(onSelectSession).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 2, full_name: 'owner/repo-two' }), 's2');
  });

  it('仓库已取消 Star 时显示灰色标签，且可通过快照兜底打开会话', async () => {
    const onSelectSession = vi.fn();
    const session = {
      ...createSession('orphan', 3, 'owner/repo-gone', '2026-08-26T00:00:00.000Z'),
      repoSnapshot: {
        ownerLogin: 'owner',
        ownerAvatarUrl: 'https://example.com/gone-avatar.png',
        htmlUrl: 'https://github.com/owner/repo-gone',
        description: 'gone description',
        language: 'Rust',
      },
    };
    await repositoryChatStorage.saveSession(session);

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={onSelectSession} />);

    expect(await screen.findByText('已取消 Star')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('进入 owner/repo-gone 的会话'));

    expect(onSelectSession).toHaveBeenCalledTimes(1);
    const [fallbackRepository] = onSelectSession.mock.calls[0];
    expect(fallbackRepository).toMatchObject({
      id: 3,
      full_name: 'owner/repo-gone',
      html_url: 'https://github.com/owner/repo-gone',
      description: 'gone description',
      language: 'Rust',
      owner: { login: 'owner', avatar_url: 'https://example.com/gone-avatar.png' },
    });
  });

  it('按当前登录账号过滤带标记的会话，无标记的旧会话始终可见', async () => {
    storeUser = { login: 'current-user' };
    await repositoryChatStorage.saveSession(createSession('mine', 1, 'owner/repo-one', '2026-08-26T00:00:00.000Z', 'current-user'));
    await repositoryChatStorage.saveSession(createSession('theirs', 2, 'owner/repo-two', '2026-08-25T00:00:00.000Z', 'other-user'));
    await repositoryChatStorage.saveSession(createSession('legacy', 3, 'owner/repo-three', '2026-08-24T00:00:00.000Z'));

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={() => {}} />);

    expect(await screen.findByTitle('进入 owner/repo-one 的会话')).toBeTruthy();
    expect(screen.getByTitle('进入 owner/repo-three 的会话')).toBeTruthy();
    expect(screen.queryByTitle('进入 owner/repo-two 的会话')).toBeNull();
  });

  it('搜索无结果但还有更多分页时，加载下一页直到命中', async () => {
    const observers: Array<{ cb: IntersectionObserverCallback }> = [];
    class MockIntersectionObserver {
      cb: IntersectionObserverCallback;
      constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        observers.push(this);
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
    Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: MockIntersectionObserver });

    for (let i = 0; i < 55; i += 1) {
      await repositoryChatStorage.saveSession(createSession(`s${i}`, 1, 'owner/repo-one', `2026-08-24T00:00:${String(i % 60).padStart(2, '0')}.${String(i).padStart(3, '0')}Z`));
    }
    const deep = createSession('deep', 1, 'owner/repo-one', '2026-01-01T00:00:00.000Z');
    deep.title = 'deep-buried-target';
    await repositoryChatStorage.saveSession(deep);

    render(<GlobalChatHistorySheet isOpen onClose={() => {}} onSelectSession={() => {}} />);
    await screen.findAllByTitle('进入 owner/repo-one 的会话');

    fireEvent.change(screen.getByLabelText('搜索问答历史'), { target: { value: 'deep-buried-target' } });
    expect(screen.queryByTitle('进入 owner/repo-one 的会话')).toBeNull();

    // 深层会话不在前 50 条里：搜索为空但仍有更多分页，哨兵必须能继续加载。
    await waitFor(() => expect(observers.length).toBeGreaterThan(0));
    // 深层会话不在前 50 条里：搜索为空但仍有更多分页，哨兵必须能继续加载。
    for (let round = 0; round < 3 && screen.queryByTitle('进入 owner/repo-one 的会话') === null; round += 1) {
      const observer = observers[observers.length - 1];
      observer.cb([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      await screen.findByTitle('进入 owner/repo-one 的会话', {}, { timeout: 3000 });
    }
    expect(screen.queryByTitle('进入 owner/repo-one 的会话')).not.toBeNull();
    Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: undefined });
  });
});
