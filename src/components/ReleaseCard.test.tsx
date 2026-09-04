import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const buildCardProps = (props: Partial<Parameters<typeof ReleaseCard>[0]> = {}): Parameters<typeof ReleaseCard>[0] => ({
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
  ...props,
});

const renderCard = (props: Partial<Parameters<typeof ReleaseCard>[0]> = {}) => {
  return render(<ReleaseCard {...buildCardProps(props)} />);
};

describe('ReleaseCard asset updated indicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows container-level and per-asset indicators from the same source (updated_asset_ids)', () => {
    renderCard({ isUnread: true });
    // 容器级与资产级标识都会展示
    expect(screen.getAllByText('资产已更新')).toHaveLength(2);
  });

  it('shows no indicator once updated_asset_ids is cleared (release marked read)', () => {
    renderCard({
      isUnread: false,
      release: makeRelease(1, { updated_asset_ids: [] }),
    });
    expect(screen.queryByText('资产已更新')).not.toBeInTheDocument();
  });

  it('regression: asset updated_at newer than published_at alone shows no indicator', () => {
    // makeRelease 的资产 updated_at 晚于 published_at，但没有 updated_asset_ids
    // （即资产相对上次拉取未变化）时不得出现任何“资产已更新”标识。
    renderCard({
      isUnread: true,
      release: makeRelease(1, { updated_asset_ids: undefined }),
    });
    expect(screen.queryByText('资产已更新')).not.toBeInTheDocument();
  });

  it('does not show the indicator for assets without an asset id (source code links)', () => {
    renderCard({
      isUnread: true,
      release: makeRelease(1, { updated_asset_ids: [101] }),
      downloadLinks: [
        { name: 'Source code (v1.zip)', url: 'https://example.com/v1.zip', size: 0, downloadCount: 0 },
      ],
    });
    // 容器级标识仍展示（updated_asset_ids 非空），但源码行没有 assetId，不展示资产级标识
    expect(screen.getAllByText('资产已更新')).toHaveLength(1);
  });

  it('marks only the clicked asset as read via onMarkAssetAsRead', () => {
    const onMarkAssetAsRead = vi.fn();
    renderCard({ onMarkAssetAsRead });

    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    fireEvent.click(assetRow);

    expect(onMarkAssetAsRead).toHaveBeenCalledTimes(1);
    expect(onMarkAssetAsRead).toHaveBeenCalledWith(101);
  });

  it('regression: an RPC asset can be clicked again after a successful send', async () => {
    const { sendToRpcDownload } = await import('../services/rpcDownloadService');
    vi.mocked(sendToRpcDownload).mockResolvedValue({ success: true });

    renderCard({});
    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    fireEvent.click(assetRow);

    await waitFor(() => expect(sendToRpcDownload).toHaveBeenCalledTimes(1));
    // 成功后按钮必须保持可点（仅下载进行中才禁用）
    await waitFor(() => expect(assetRow).not.toBeDisabled());

    fireEvent.click(assetRow);
    await waitFor(() => expect(sendToRpcDownload).toHaveBeenCalledTimes(2));
  });

  it('regression: a failed RPC retry clears the previous success check', async () => {
    const { sendToRpcDownload } = await import('../services/rpcDownloadService');
    const mocked = vi.mocked(sendToRpcDownload);
    mocked.mockReset();
    mocked.mockResolvedValueOnce({ success: true });
    mocked.mockResolvedValueOnce({ success: false, error: 'boom' });

    renderCard({});
    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    fireEvent.click(assetRow);
    // 首次成功后显示 ✓（CheckCircle2 带 text-success）
    await waitFor(() => expect(assetRow.querySelector('.text-success')).not.toBeNull());

    fireEvent.click(assetRow);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
    // 重试失败后不得残留 ✓
    await waitFor(() => expect(assetRow.querySelector('.text-success')).toBeNull());
  });

  it('regression: a new asset version (same URL, new updatedAt) drops the stale success check', async () => {
    const { sendToRpcDownload } = await import('../services/rpcDownloadService');
    const mocked = vi.mocked(sendToRpcDownload);
    mocked.mockReset();
    mocked.mockResolvedValue({ success: true });
    const linkV1 = { name: 'app.dmg', url: 'https://example.com/app.dmg', size: 1000, downloadCount: 5, assetId: 101, updatedAt: '2026-01-02T00:00:00.000Z' };
    const linkV2 = { ...linkV1, updatedAt: '2026-02-01T00:00:00.000Z' };

    const view = renderCard({ downloadLinks: [linkV1] });
    fireEvent.click(screen.getByRole('button', { name: /app\.dmg/ }));
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.dmg/ }).querySelector('.text-success')).not.toBeNull());

    // 同 URL 新版本：不得沿用旧 key 的 ✓，且仍可发送
    view.rerender(<ReleaseCard {...buildCardProps({ downloadLinks: [linkV2] })} />);
    const v2Row = screen.getByRole('button', { name: /app\.dmg/ });
    expect(v2Row.querySelector('.text-success')).toBeNull();

    fireEvent.click(v2Row);
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: /app\.dmg/ }).querySelector('.text-success')).not.toBeNull());
  });

  it('renders all five English header controls when body and download links exist', () => {
    renderCard({
      language: 'en',
      release: makeRelease(1, { body: 'release notes', updated_asset_ids: [101] }),
    });
    expect(screen.getByRole('button', { name: 'Hide Assets' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show Changelog' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI Summary of this update' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unsubscribe from releases' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toBeInTheDocument();
  });

  it('renders relative times in Chinese (release header and asset row) when language is zh', () => {
    // 资产 updated_at 为 2026-01-02，早于当前时间；头部 effectiveTime 同理，
    // 相对时间必然以 “…前” 结尾
    renderCard({
      downloadLinks: [
        {
          name: 'app.dmg',
          url: 'https://example.com/app.dmg',
          size: 1000,
          downloadCount: 5,
          assetId: 101,
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    // 头部（effectiveReleaseTime）与资产行各渲染一条中文相对时间
    expect(screen.getAllByText(/个月前|周前|天前|小时前|分钟前|年前/).length).toBe(2);
    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    expect(within(assetRow).getByText(/前$/)).toBeInTheDocument();
  });

  it('hides the asset updated time when updated_at is missing', () => {
    renderCard({
      downloadLinks: [
        { name: 'app.dmg', url: 'https://example.com/app.dmg', size: 1000, downloadCount: 5, assetId: 101 },
      ],
    });
    // 头部仍有中文相对时间，只能断言资产行内没有
    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    expect(within(assetRow).queryByText(/前$/)).not.toBeInTheDocument();
  });

  it('hides the asset updated time when updated_at is invalid', () => {
    renderCard({
      downloadLinks: [
        { name: 'app.dmg', url: 'https://example.com/app.dmg', size: 1000, downloadCount: 5, assetId: 101, updatedAt: 'not-a-date' },
      ],
    });
    const assetRow = screen.getByRole('button', { name: /app\.dmg/ });
    expect(within(assetRow).queryByText(/前$/)).not.toBeInTheDocument();
  });
});