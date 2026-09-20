import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MyAppsView } from './MyAppsView';
import type { LinkedApplication } from '../../../types/linkedApplication';
import type { Repository } from '../../../types';

const mocks = vi.hoisted(() => ({
  linkApplication: vi.fn(),
  updateApplication: vi.fn(),
  unlinkApplication: vi.fn(),
  state: {
    linkedApplications: [] as LinkedApplication[],
    linkableRepositories: [] as Repository[],
    defaultPlatform: 'windows' as const,
  },
}));

vi.mock('../hooks/useLinkedApplications', () => ({
  useLinkedApplications: () => ({
    linkedApplications: mocks.state.linkedApplications,
    linkableRepositories: mocks.state.linkableRepositories,
    defaultPlatform: mocks.state.defaultPlatform,
    linkApplication: mocks.linkApplication,
    updateApplication: mocks.updateApplication,
    unlinkApplication: mocks.unlinkApplication,
  }),
}));

vi.mock('../hooks/useLinkedApplicationLabels', () => ({
  useLinkedApplicationLabels: () => ({
    platform: { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', unknown: 'Unknown' },
    architecture: { x64: 'x64', arm64: 'arm64', x86: 'x86', universal: 'Universal' },
    linkSource: { manual: 'Manual', detected: 'Detected' },
    updateStatus: { 'update-available': 'Update available', 'up-to-date': 'Up to date', unknown: 'Unknown' },
  }),
}));

// 详情组件自己会去查 Release，这里只验证视图的接线，细节在它自己的测试里覆盖
vi.mock('./LinkedApplicationDetail', () => ({
  LinkedApplicationDetail: ({ application }: { application: LinkedApplication }) => (
    <div data-testid="detail">{application.displayName}</div>
  ),
}));

vi.mock('./LinkApplicationDialog', () => ({
  LinkApplicationDialog: ({
    open,
    onSubmit,
    repositories,
  }: { open: boolean; onSubmit: (input: { repositoryFullName: string }) => void; repositories: Repository[] }) => (
    <div data-testid="link-dialog" data-open={String(open)} data-count={String(repositories.length)}>
      <button type="button" onClick={() => onSubmit({ repositoryFullName: 'owner/other' })}>submit-link</button>
    </div>
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
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
});

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

describe('MyAppsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.linkedApplications = [];
    mocks.state.linkableRepositories = [repository(2, 'owner/other')];
  });

  it('shows the empty state and lets the user open the link dialog', async () => {
    const user = userEvent.setup();
    render(<MyAppsView />);

    expect(screen.getByTestId('my-apps-empty')).toBeInTheDocument();
    expect(screen.getByTestId('link-dialog')).toHaveAttribute('data-open', 'false');

    await user.click(screen.getByTestId('open-link-dialog'));
    expect(screen.getByTestId('link-dialog')).toHaveAttribute('data-open', 'true');
  });

  it('disables linking when every starred repository is already linked', () => {
    mocks.state.linkableRepositories = [];
    render(<MyAppsView />);

    expect(screen.getByTestId('open-link-dialog')).toBeDisabled();
  });

  it('renders the list with installed version and platform, and selects the first record by default', async () => {
    const user = userEvent.setup();
    mocks.state.linkedApplications = [
      application({ id: 'app-1', displayName: 'Tool', installedVersion: '1.0.0', platform: 'windows' }),
      application({ id: 'app-2', displayName: 'Other', repositoryFullName: 'owner/other', installedVersion: null, platform: 'linux' }),
    ];
    render(<MyAppsView />);

    const first = screen.getByTestId('linked-application-app-1');
    expect(first).toHaveTextContent('Tool');
    expect(first).toHaveTextContent('1.0.0');
    expect(first).toHaveTextContent('Windows');
    expect(first).toHaveAttribute('aria-current', 'true');

    // 未记录版本时给出明确的占位而不是空字符串
    expect(screen.getByTestId('linked-application-app-2')).toHaveTextContent('未记录');
    expect(screen.getByTestId('detail')).toHaveTextContent('Tool');

    await user.click(screen.getByTestId('linked-application-app-2'));
    expect(screen.getByTestId('detail')).toHaveTextContent('Other');
  });

  it('passes the linkable repositories to the dialog and forwards a submission to the Store action', async () => {
    const user = userEvent.setup();
    render(<MyAppsView />);

    expect(screen.getByTestId('link-dialog')).toHaveAttribute('data-count', '1');

    await user.click(screen.getByRole('button', { name: 'submit-link' }));
    expect(mocks.linkApplication).toHaveBeenCalledWith({ repositoryFullName: 'owner/other' });
  });
});
