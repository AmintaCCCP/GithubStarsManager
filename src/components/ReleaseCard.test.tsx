import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReleaseCard from './ReleaseCard';
import type { Release } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(() => ({
    rpcDownloadConfig: { enabled: true, host: '', port: 6800 },
    backendApiSecret: null,
    aiConfigs: [],
    activeAIConfig: null,
  })),
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: vi.fn(), confirm: vi.fn() }),
}));

vi.mock('../services/rpcDownloadService', () => ({
  // 永不 resolve，避免异步 setState 触发 act() 警告；点击行为本身是同步的
  sendToRpcDownload: vi.fn(() => new Promise(() => {})),
}));

vi.mock('./MarkdownRenderer', () => ({
  default: () => null,
}));

vi.mock('../services/aiService', () => ({
  AIService: vi.fn(),
}));

const makeRelease = (id: number, overrides: Partial<Release> = {}): Release => ({
  id,
  tag_name: `v${id}`,
  name: `Release ${id}`,
  body: null,
  published_at: '2026-01-01T00:00:00.000Z',
  html_url: `https://github.com/owner/repo/releases/tag/v${id}`,
  assets: [
    {
      id: 101,
      name: 'app.dmg',
      size: 1000,
      download_count: 5,
      browser_download_url: 'https://example.com/app.dmg',
      content_type: 'application/octet-stream',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
    },
  ],
  repository: { id: 1, full_name: 'owner/repo', name: 'repo' },
  ...overrides,
});

const renderCard = (props: Partial<Parameters<typeof ReleaseCard>[0]> = {}) => {
  const defaults: Parameters<typeof ReleaseCard>[0] = {
    release: makeRelease(1, { updated_asset_ids: [101] }),
    downloadLinks: [
      { name: 'app.dmg', url: 'https://example.com/app.dmg', size: 1000, downloadCount: 5, assetId: 101 },
    ],
    isUnread: true,
    isAssetsExpanded: true,
    isReleaseNotesExpanded: false,
    isFullContent: false,
    truncatedBody: '',
    matchesActiveFilters: () => true,
    selectedFilters: [],
    onToggleAssets: () => {},
    onToggleReleaseNotes: () => {},
    onToggleFullContent: () => {},
    onUnsubscribe: () => {},
    onMarkAsRead: () => {},
    onMarkAssetAsRead: () => {},
    language: 'zh',
    formatFileSize: (bytes: number) => `${bytes} B`,
  };
  return render(<ReleaseCard {...defaults} {...props} />);
};

describe('ReleaseCard asset updated indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the per-asset indicator even when the release is already read (expand must not clear it)', () => {
    renderCard({ isUnread: false });
    expect(screen.getByText('资产已更新')).toBeInTheDocument();
  });

  it('shows the per-asset indicator while the release is unread', () => {
    renderCard({ isUnread: true });
    // 容器级与资产级标识都会展示
    expect(screen.getAllByText('资产已更新')).toHaveLength(2);
  });

  it('does not show the indicator for assets without an asset id (source code links)', () => {
    renderCard({
      isUnread: false,
      release: makeRelease(1, { updated_asset_ids: [101] }),
      downloadLinks: [
        { name: 'Source code (v1.zip)', url: 'https://example.com/v1.zip', size: 0, downloadCount: 0 },
      ],
    });
    expect(screen.queryByText('资产已更新')).not.toBeInTheDocument();
  });

  it('marks only the clicked asset as read via onMarkAssetAsRead', () => {
    const onMarkAssetAsRead = vi.fn();
    renderCard({ onMarkAssetAsRead });

    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    fireEvent.click(assetRow);

    expect(onMarkAssetAsRead).toHaveBeenCalledTimes(1);
    expect(onMarkAssetAsRead).toHaveBeenCalledWith(101);
  });

  it('does not propagate the asset click to the release-level mark-as-read handler', () => {
    const onMarkAsRead = vi.fn();
    const onMarkAssetAsRead = vi.fn();
    renderCard({ onMarkAsRead, onMarkAssetAsRead });

    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    fireEvent.click(assetRow);

    expect(onMarkAsRead).not.toHaveBeenCalled();
    expect(onMarkAssetAsRead).toHaveBeenCalledWith(101);
  });
});