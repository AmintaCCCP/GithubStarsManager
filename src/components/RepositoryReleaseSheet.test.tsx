import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release, Repository } from '../types';
import { RepositoryReleaseSheet } from './RepositoryReleaseSheet';

const hookMocks = vi.hoisted(() => ({
  loadReleases: vi.fn(),
  sendAssetToRpc: vi.fn(),
  downloadAsset: vi.fn(),
  generateSummary: vi.fn(),
  cancelPendingRequests: vi.fn(),
  state: {
    releases: [] as Release[],
    isLoading: false,
    error: null as string | null,
    summaries: {} as Record<number, { status: 'idle' | 'loading' | 'done' | 'error'; content?: string; error?: string }>,
    downloadStates: {} as Record<string, 'idle' | 'sending' | 'sent'>,
    isRpcEnabled: false,
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { language: 'zh' }) => unknown) => selector({ language: 'zh' }),
}));

vi.mock('../features/repositories/hooks/useRepositoryReleaseSheet', () => ({
  useRepositoryReleaseSheet: () => ({
    ...hookMocks.state,
    loadReleases: hookMocks.loadReleases,
    sendAssetToRpc: hookMocks.sendAssetToRpc,
    downloadAsset: hookMocks.downloadAsset,
    generateSummary: hookMocks.generateSummary,
    cancelPendingRequests: hookMocks.cancelPendingRequests,
  }),
}));

vi.mock('./MarkdownRenderer', () => ({
  default: ({ content, fontSize }: { content: string; fontSize?: string }) => (
    <div data-testid="markdown" data-font-size={fontSize}>{content}</div>
  ),
}));

const repository: Repository = {
  id: 1,
  name: 'example-repository',
  full_name: 'owner/example-repository',
  description: 'Repository description',
  html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 128,
  forks_count: 3,
  forks: 3,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  pushed_at: '2026-01-03T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
};

const createRelease = (id: number, assetCount = 0): Release => ({
  id,
  tag_name: `v${id}`,
  name: `Release ${id}`,
  body: `# Release ${id}\n\nChanges for release ${id}.`,
  published_at: `2026-01-${String(Math.min(id, 28)).padStart(2, '0')}T00:00:00.000Z`,
  html_url: `https://github.com/owner/example-repository/releases/tag/v${id}`,
  assets: Array.from({ length: assetCount }, (_, index) => ({
    id: id * 100 + index,
    name: `asset-${id}-${index + 1}.zip`,
    size: 1024 * (index + 1),
    download_count: 0,
    browser_download_url: `https://example.com/asset-${id}-${index + 1}.zip`,
    content_type: 'application/zip',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  })),
  zipball_url: `https://api.github.com/repos/owner/example-repository/zipball/v${id}`,
  tarball_url: `https://api.github.com/repos/owner/example-repository/tarball/v${id}`,
  prerelease: false,
  repository: { id: repository.id, name: repository.name, full_name: repository.full_name },
});

const renderSheet = () => render(
  <RepositoryReleaseSheet
    isOpen
    onClose={vi.fn()}
    repository={repository}
  />
);

describe('RepositoryReleaseSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hookMocks.state.releases = Array.from({ length: 11 }, (_, index) => createRelease(index + 1, index === 0 ? 7 : 0));
    hookMocks.state.isLoading = false;
    hookMocks.state.error = null;
    hookMocks.state.summaries = {};
    hookMocks.state.downloadStates = {};
    hookMocks.state.isRpcEnabled = false;
  });

  it('paginates releases and assets while including source code ZIP/TAR downloads', async () => {
    const user = userEvent.setup();
    renderSheet();

    expect(hookMocks.loadReleases).toHaveBeenCalledOnce();
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.queryByText('v11')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Release 分页 next page' }));
    expect(screen.getByText('v11')).toBeInTheDocument();
    expect(screen.queryByText('v1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Release 分页 previous page' }));
    await user.click(screen.getByText('v1').closest('button')!);

    expect(screen.getByText('Source code (v1.zip)')).toBeInTheDocument();
    const zipRow = screen.getByText('Source code (v1.zip)').closest('tr');
    expect(zipRow).not.toBeNull();
    await user.click(within(zipRow!).getByRole('button', { name: '下载' }));
    expect(hookMocks.downloadAsset).toHaveBeenCalledWith(expect.objectContaining({
      authenticatedUrl: 'https://api.github.com/repos/owner/example-repository/zipball/v1',
    }));
    expect(screen.queryByText('Source code (v1.tar.gz)')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'v1 资产分页 next page' }));
    expect(screen.getByText('Source code (v1.tar.gz)')).toBeInTheDocument();
  });

  it('renders small Markdown notes and lazily requests an AI summary on its tab', async () => {
    const user = userEvent.setup();
    renderSheet();

    await user.click(screen.getByText('v1').closest('button')!);
    await user.click(screen.getByRole('tab', { name: '更新日志' }));
    expect(screen.getByTestId('markdown')).toHaveAttribute('data-font-size', 'small');

    await user.click(screen.getByRole('tab', { name: '总结' }));
    expect(hookMocks.generateSummary).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it('delegates asset download to the authenticated hook action when RPC is enabled', async () => {
    const user = userEvent.setup();
    hookMocks.state.isRpcEnabled = true;
    renderSheet();

    await user.click(screen.getByText('v1').closest('button')!);
    await user.click(screen.getAllByRole('button', { name: '下载' })[0]);

    expect(hookMocks.downloadAsset).toHaveBeenCalledWith(expect.objectContaining({
      name: 'asset-1-1.zip',
      url: 'https://example.com/asset-1-1.zip',
    }));
  });
});
