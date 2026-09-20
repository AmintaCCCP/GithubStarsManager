import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeepLinkHandler } from './DeepLinkHandler';
import type { Repository } from '../types';

const mocks = vi.hoisted(() => ({
  repositories: [] as Repository[],
  setCurrentView: vi.fn(),
  consumePending: vi.fn(),
  onOpen: vi.fn(),
  emit: null as ((url: string) => void) | null,
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    repositories: mocks.repositories,
    setCurrentView: mocks.setCurrentView,
  }),
}));

vi.mock('./ReadmeModal', () => ({
  ReadmeModal: ({ repository }: { repository: Repository }) => (
    <div data-testid="readme-modal">{repository.full_name}</div>
  ),
}));

vi.mock('./RepositoryReleaseSheet', () => ({
  RepositoryReleaseSheet: ({ repository }: { repository: Repository }) => (
    <div data-testid="release-sheet">{repository.full_name}</div>
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

const installBridge = (pending: string | null = null) => {
  mocks.consumePending.mockResolvedValue(pending);
  mocks.onOpen.mockImplementation((listener: (url: string) => void) => {
    mocks.emit = listener;
    return () => { mocks.emit = null; };
  });
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    deepLink: { consumePending: mocks.consumePending, onOpen: mocks.onOpen },
  };
};

describe('DeepLinkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.repositories = [];
    mocks.emit = null;
    sessionStorage.removeItem('gsm:pending-settings-tab');
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
  });

  it('does nothing outside the desktop client', () => {
    const { container } = render(<DeepLinkHandler />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.onOpen).not.toHaveBeenCalled();
  });

  it('opens the README for a repository link that is already in the library', async () => {
    mocks.repositories = [repository(1, 'owner/repo')];
    installBridge('githubstarsmanager://repo/owner/repo');
    render(<DeepLinkHandler />);

    await waitFor(() => expect(screen.getByTestId('readme-modal')).toHaveTextContent('owner/repo'));
  });

  it('opens the release sheet for a release link of a known repository', async () => {
    mocks.repositories = [repository(1, 'owner/repo')];
    installBridge(null);
    render(<DeepLinkHandler />);

    await waitFor(() => expect(mocks.onOpen).toHaveBeenCalledOnce());
    mocks.emit?.('githubstarsmanager://release/owner/repo/v1.0.0');

    await waitFor(() => expect(screen.getByTestId('release-sheet')).toHaveTextContent('owner/repo'));
  });

  it('falls back to the browser for repositories the user has not starred', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    installBridge('githubstarsmanager://repo/owner/unknown');
    render(<DeepLinkHandler />);

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://github.com/owner/unknown', '_blank', 'noopener,noreferrer'));
    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
    openSpy.mockRestore();
  });

  it('sends developer links to the browser and plugin links to the settings view', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    installBridge(null);
    render(<DeepLinkHandler />);

    await waitFor(() => expect(mocks.onOpen).toHaveBeenCalledOnce());
    mocks.emit?.('githubstarsmanager://developer/torvalds');
    await waitFor(() => expect(openSpy).toHaveBeenCalledWith('https://github.com/torvalds', '_blank', 'noopener,noreferrer'));

    mocks.emit?.('githubstarsmanager://plugins/com.example.plugin');
    await waitFor(() => expect(mocks.setCurrentView).toHaveBeenCalledWith('settings'));
    expect(sessionStorage.getItem('gsm:pending-settings-tab')).toBe('plugins');

    openSpy.mockRestore();
  });

  it('ignores malformed or foreign links instead of guessing', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    installBridge(null);
    render(<DeepLinkHandler />);

    await waitFor(() => expect(mocks.onOpen).toHaveBeenCalledOnce());
    for (const url of [
      'githubstarsmanager://repo/owner',
      'githubstarsmanager://developer/settings',
      'https://github.com/owner/repo',
      'githubstarsmanager://',
    ]) {
      mocks.emit?.(url);
    }

    expect(openSpy).not.toHaveBeenCalled();
    expect(mocks.setCurrentView).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it('keeps a live link when an older pending lookup resolves later', async () => {
    mocks.repositories = [repository(1, 'owner/repo')];
    let resolvePending!: (value: string | null) => void;
    mocks.consumePending.mockReturnValue(new Promise<string | null>((resolve) => { resolvePending = resolve; }));
    mocks.onOpen.mockImplementation((listener: (url: string) => void) => {
      mocks.emit = listener;
      return () => { mocks.emit = null; };
    });
    (window as unknown as { electronAPI?: unknown }).electronAPI = {
      deepLink: { consumePending: mocks.consumePending, onOpen: mocks.onOpen },
    };
    render(<DeepLinkHandler />);

    await waitFor(() => expect(mocks.onOpen).toHaveBeenCalledOnce());
    act(() => { mocks.emit?.('githubstarsmanager://release/owner/repo/v2.0.0'); });
    await waitFor(() => expect(screen.getByTestId('release-sheet')).toBeInTheDocument());
    await act(async () => { resolvePending('githubstarsmanager://repo/owner/repo'); });

    expect(screen.queryByTestId('readme-modal')).not.toBeInTheDocument();
    expect(screen.getByTestId('release-sheet')).toBeInTheDocument();
  });
});
