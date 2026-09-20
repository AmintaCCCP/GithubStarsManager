import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClipboardLinkBanner } from './ClipboardLinkBanner';
import type { GitHubClipboardTarget } from '../utils/githubClipboard';
import type { Repository } from '../types';

const mocks = vi.hoisted(() => ({
  target: null as GitHubClipboardTarget | null,
  dismiss: vi.fn(),
  repositories: [] as Repository[],
}));

vi.mock('../hooks/useClipboardGitHubDetection', () => ({
  useClipboardGitHubDetection: () => ({ target: mocks.target, dismiss: mocks.dismiss }),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    language: 'zh',
    repositories: mocks.repositories,
  }),
}));

vi.mock('./ReadmeModal', () => ({
  ReadmeModal: ({ repository }: { repository: Repository }) => (
    <div data-testid="readme-modal">{repository.full_name}</div>
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

const target = (overrides: Partial<GitHubClipboardTarget> = {}): GitHubClipboardTarget => ({
  kind: 'repository',
  owner: 'owner',
  name: 'repo',
  url: 'https://github.com/owner/repo',
  label: 'owner/repo',
  ...overrides,
});

describe('ClipboardLinkBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.target = null;
    mocks.repositories = [];
  });

  it('renders nothing without a recognized target', () => {
    const { container } = render(<ClipboardLinkBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the recognized target and can be dismissed', async () => {
    const user = userEvent.setup();
    mocks.target = target();
    render(<ClipboardLinkBanner />);

    expect(screen.getByRole('status')).toHaveTextContent('owner/repo');

    await user.click(screen.getByRole('button', { name: '忽略' }));
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });

  it('opens the local README modal when the repository is already in the library', async () => {
    const user = userEvent.setup();
    mocks.target = target();
    mocks.repositories = [repository(1, 'owner/repo')];
    render(<ClipboardLinkBanner />);

    await user.click(screen.getByRole('button', { name: '打开' }));

    expect(screen.getByTestId('readme-modal')).toHaveTextContent('owner/repo');
    expect(mocks.dismiss).toHaveBeenCalledOnce();
  });

  it('falls back to the browser for a repository that is not in the library', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.target = target({ owner: 'someone', name: 'else', label: 'someone/else', url: 'https://github.com/someone/else' });
    render(<ClipboardLinkBanner />);

    await user.click(screen.getByRole('button', { name: '打开' }));

    expect(openSpy).toHaveBeenCalledWith('https://github.com/someone/else', '_blank', 'noopener,noreferrer');
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
    openSpy.mockRestore();
  });

  it('opens releases and developers externally instead of guessing an in-app view', async () => {
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    mocks.repositories = [repository(1, 'owner/repo')];
    mocks.target = target({ kind: 'release', tag: 'v1.0.0', label: 'owner/repo@v1.0.0', url: 'https://github.com/owner/repo/releases/tag/v1.0.0' });
    render(<ClipboardLinkBanner />);

    await user.click(screen.getByRole('button', { name: '打开' }));

    expect(openSpy).toHaveBeenCalledWith('https://github.com/owner/repo/releases/tag/v1.0.0', '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });
});
