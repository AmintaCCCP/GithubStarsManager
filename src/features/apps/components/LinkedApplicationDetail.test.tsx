import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedApplicationDetail } from './LinkedApplicationDetail';
import type { LinkedApplication } from '../../../types/linkedApplication';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  confirm: vi.fn(),
  releaseState: {
    latestRelease: null as null | { tag_name: string; html_url: string; body: string | null; published_at: string },
    updateStatus: 'unknown' as 'update-available' | 'up-to-date' | 'unknown',
    isLoading: false,
    error: null as string | null,
    assetNames: [] as string[],
  },
}));

vi.mock('../hooks/useLinkedApplicationRelease', () => ({
  useLinkedApplicationRelease: () => ({
    latestRelease: mocks.releaseState.latestRelease,
    updateStatus: mocks.releaseState.updateStatus,
    isLoading: mocks.releaseState.isLoading,
    error: mocks.releaseState.error,
    assetNames: mocks.releaseState.assetNames,
    refresh: mocks.refresh,
  }),
}));

vi.mock('../hooks/useLinkedApplicationLabels', () => ({
  useLinkedApplicationLabels: () => ({
    platform: { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', unknown: 'Unknown' },
    architecture: { x64: 'x64', arm64: 'arm64', x86: 'x86', universal: 'Universal' },
    linkSource: { manual: '手动关联', detected: '本机检测' },
    updateStatus: { 'update-available': '有新版本', 'up-to-date': '已是最新', unknown: '未知' },
  }),
}));

vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ confirm: mocks.confirm, toast: vi.fn() }),
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ language: 'zh' }),
}));

const application = (overrides: Partial<LinkedApplication> = {}): LinkedApplication => ({
  id: 'app-1',
  repositoryFullName: 'owner/tool',
  displayName: 'Tool',
  installedVersion: '1.0.0',
  platform: 'windows',
  linkSource: 'manual',
  includePrereleases: false,
  repositorySourceUrl: 'https://github.com/owner/tool',
  linkedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('LinkedApplicationDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.releaseState.latestRelease = null;
    mocks.releaseState.updateStatus = 'unknown';
    mocks.releaseState.isLoading = false;
    mocks.releaseState.error = null;
    mocks.releaseState.assetNames = [];
  });

  it('shows the update status coming from the release hook', () => {
    mocks.releaseState.updateStatus = 'update-available';
    mocks.releaseState.latestRelease = {
      tag_name: 'v2.0.0',
      html_url: 'https://github.com/owner/tool/releases/tag/v2.0.0',
      body: 'Fixes',
      published_at: '2026-02-01T00:00:00.000Z',
    };
    render(<LinkedApplicationDetail application={application()} onUpdate={vi.fn()} onUnlink={vi.fn()} />);

    expect(screen.getByTestId('update-status')).toHaveTextContent('有新版本');
    expect(screen.getByTestId('latest-release-tag')).toHaveTextContent('v2.0.0');
  });

  it('reports "unknown" instead of guessing when there is no comparable release', () => {
    mocks.releaseState.updateStatus = 'unknown';
    render(<LinkedApplicationDetail application={application({ installedVersion: null })} onUpdate={vi.fn()} onUnlink={vi.fn()} />);

    expect(screen.getByTestId('update-status')).toHaveTextContent('未知');
    expect(screen.getByTestId('latest-release-none')).toBeInTheDocument();
  });

  it('saves the edited installed version and clears it when emptied', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<LinkedApplicationDetail application={application()} onUpdate={onUpdate} onUnlink={vi.fn()} />);

    const input = screen.getByLabelText('已安装版本');
    await user.clear(input);
    await user.type(input, '3.1.4');
    await user.click(screen.getByRole('button', { name: '保存' }));
    expect(onUpdate).toHaveBeenCalledWith('app-1', { installedVersion: '3.1.4' });

    onUpdate.mockClear();
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: '保存' }));
    // 留空表示"没记录版本"，不是空字符串
    expect(onUpdate).toHaveBeenCalledWith('app-1', { installedVersion: null });
  });

  it('toggles prereleases through the same update action', async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn();
    render(<LinkedApplicationDetail application={application()} onUpdate={onUpdate} onUnlink={vi.fn()} />);

    await user.click(screen.getByRole('switch', { name: '纳入预发布版本' }));
    expect(onUpdate).toHaveBeenCalledWith('app-1', { includePrereleases: true });
  });

  it('only unlinks after the user confirms, and never touches anything else', async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    mocks.confirm.mockResolvedValue(true);
    render(<LinkedApplicationDetail application={application()} onUpdate={vi.fn()} onUnlink={onUnlink} />);

    await user.click(screen.getByTestId('unlink-application'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(onUnlink).toHaveBeenCalledWith('app-1');
  });

  it('keeps the record when the confirmation is dismissed', async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    mocks.confirm.mockResolvedValue(false);
    render(<LinkedApplicationDetail application={application()} onUpdate={vi.fn()} onUnlink={onUnlink} />);

    await user.click(screen.getByTestId('unlink-application'));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
    expect(onUnlink).not.toHaveBeenCalled();
  });
});
