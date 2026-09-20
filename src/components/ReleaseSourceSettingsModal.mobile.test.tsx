import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleaseSourceSettingsModal } from './ReleaseSourceSettingsModal';
import { useAppStore } from '../store/useAppStore';
import { useWatchedSourcesSync } from '../features/releases/hooks/useWatchedSourcesSync';
import { CUSTOM_RELEASE_SOURCE_ID, WATCH_CUSTOM_RELEASE_SOURCE_ID } from '../utils/releaseSources';

vi.mock('../store/useAppStore', () => ({ useAppStore: vi.fn() }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: vi.fn() }) }));
vi.mock('../features/releases/hooks/useWatchedSourcesSync', () => ({ useWatchedSourcesSync: vi.fn() }));

const repositories = Array.from({ length: 9 }, (_, index) => ({
  full_name: `a-very-long-owner-name/repository-with-a-long-name-${index}`,
  html_url: `https://github.com/a-very-long-owner-name/repository-with-a-long-name-${index}`,
  release_hidden: false,
}));

const state = {
  language: 'en',
  githubToken: 'token',
  releaseSubscriptions: new Map(),
  releaseSourceSettings: {
    enabledSourceIds: [WATCH_CUSTOM_RELEASE_SOURCE_ID, CUSTOM_RELEASE_SOURCE_ID],
    watchCustomReleaseRepos: repositories,
    customReleaseRepos: repositories,
  },
  toggleReleaseSource: vi.fn(),
  addReleaseSourceRepository: vi.fn(),
  removeReleaseSourceRepository: vi.fn(),
  updateReleaseSourceRepository: vi.fn(),
};

beforeEach(() => {
  vi.mocked(useAppStore).mockImplementation(((selector: (value: typeof state) => unknown) => selector(state)) as typeof useAppStore);
  vi.mocked(useWatchedSourcesSync).mockReturnValue({ syncWatchedSources: vi.fn(), isSyncingWatchedSources: false } as never);
});

describe('ReleaseSourceSettingsModal mobile layout', () => {
  it('uses touch-sized pagination and icon controls while preserving names and disabled states', () => {
    render(<ReleaseSourceSettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: 'Previous page' })[0]).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    expect(screen.getAllByRole('button', { name: 'Previous page' })[0]).toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Next page' })[0]).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    expect(screen.getAllByRole('button', { name: 'Next page' })[0]).not.toBeDisabled();
    expect(screen.getAllByRole('button', { name: 'Remove repository' })[0]).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    expect(screen.getAllByRole('button', { name: 'Hide and skip release checks' })[0]).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
  });

  it('wraps narrow groups and uses readable editable text without overflowing long sources', () => {
    render(<ReleaseSourceSettingsModal isOpen onClose={vi.fn()} />);

    expect(screen.getAllByText('Page 1/2')[0].parentElement).toHaveClass('flex-wrap');
    expect(screen.getByLabelText('Repository name')).toHaveClass('text-base', 'sm:text-sm');
    expect(screen.getByLabelText('Repository name').parentElement).toHaveClass('flex-wrap');
    expect(screen.getByRole('button', { name: /Watch repositories/ })).toHaveClass('flex-wrap');
    expect(screen.getByRole('button', { name: 'Sync' }).parentElement).toHaveClass('flex-col', 'sm:flex-row');
    expect(screen.getAllByText(repositories[0].full_name)[0]).toHaveClass('truncate');
    expect(screen.getAllByText(repositories[0].html_url)[0]).toHaveClass('truncate');
  });
});
