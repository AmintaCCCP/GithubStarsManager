import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentlyViewedStrip } from './RecentlyViewedStrip';
import type { Repository } from '../../../types';

const mocks = vi.hoisted(() => ({
  clearRecentlyViewed: vi.fn(),
  entries: [] as Array<{ repository: unknown; viewedAt: string }>,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    recentlyViewed: mocks.entries,
    language: 'en',
    clearRecentlyViewed: mocks.clearRecentlyViewed,
  }),
}));

vi.mock('../../../components/ReadmeModal', () => ({
  ReadmeModal: ({ repository, isOpen }: { repository: Repository; isOpen: boolean }) => (
    <div data-testid="readme-modal">{isOpen ? repository.full_name : ''}</div>
  ),
}));

const repository = (id: number, fullName: string): Repository => ({
  id,
  name: fullName.split('/')[1] ?? fullName,
  full_name: fullName,
  description: null,
  html_url: `https://github.com/${fullName}`,
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
});

describe('RecentlyViewedStrip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.entries = [];
  });

  it('renders nothing when there is no history', () => {
    const { container } = render(<RecentlyViewedStrip />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists the most recent repositories newest first and clears them on demand', async () => {
    const user = userEvent.setup();
    mocks.entries = [
      { repository: repository(2, 'owner/newer'), viewedAt: '2026-09-21T03:00:00.000Z' },
      { repository: repository(1, 'owner/older'), viewedAt: '2026-09-20T03:00:00.000Z' },
    ];
    render(<RecentlyViewedStrip />);

    const names = screen.getAllByTitle(/owner\//).map((node) => node.textContent);
    expect(names).toEqual(['owner/newer', 'owner/older']);

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(mocks.clearRecentlyViewed).toHaveBeenCalledOnce();
  });

  it('opens the README modal for the clicked entry', async () => {
    const user = userEvent.setup();
    mocks.entries = [{ repository: repository(3, 'owner/target'), viewedAt: '2026-09-21T03:00:00.000Z' }];
    render(<RecentlyViewedStrip />);

    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();

    await user.click(screen.getByTitle('owner/target'));
    expect(screen.getByTestId('readme-modal')).toHaveTextContent('owner/target');
  });
});
