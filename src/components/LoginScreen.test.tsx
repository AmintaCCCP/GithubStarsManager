import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { TooltipProvider } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';

const mocks = vi.hoisted(() => ({
  safeReadText: vi.fn(),
  restoreBackendSession: vi.fn(),
  setupBackendGitHubToken: vi.fn(),
  syncBackendData: vi.fn(),
  configuredBackendUrl: null as string | null,
  getBackendUrl: vi.fn(() => null as string | null),
  rollbackBackendConnection: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/clipboardUtils', () => ({ safeReadText: mocks.safeReadText }));
vi.mock('../features/lifecycle/hooks/useLoginActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/lifecycle/hooks/useLoginActions')>();
  return {
    ...actual,
    useLoginActions: () => ({
      authenticateWithGitHub: vi.fn(),
      syncTokenToBackend: vi.fn().mockResolvedValue({ ok: true }),
      configuredBackendUrl: mocks.configuredBackendUrl,
      restoreBackendSession: mocks.restoreBackendSession,
      setupBackendGitHubToken: mocks.setupBackendGitHubToken,
      syncBackendData: mocks.syncBackendData,
      getBackendUrl: mocks.getBackendUrl,
      rollbackBackendConnection: mocks.rollbackBackendConnection,
    }),
  };
});

// 恢复真实 Store（与 useBackupActions.multiAccount.test.tsx 同一模式）：
// 回滚断言必须驱动真实的工作区与账号状态——选择器桩（无 getState）无法
// 观察回滚后 repositories 等顶层工作区字段是否已被清空。
vi.mock('../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/useAppStore')>();
  return actual;
});

import { LoginScreen } from './LoginScreen';

// 真实 Store 的界面语言来自 navigator 探测（jsdom 默认 en-US）：本文件的
// 断言文案为中文，统一在用例前固定为 zh
beforeEach(() => {
  useAppStore.setState({ language: 'zh' });
});

const repoOf = (id: number): Repository => ({
  id,
  name: `repo-${id}`,
  full_name: `owner/repo-${id}`,
  description: null,
  html_url: `https://github.com/owner/repo-${id}`,
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
});

const enterBackendMode = async () => {
  render(
    <TooltipProvider>
      <LoginScreen />
    </TooltipProvider>
  );
  fireEvent.click(screen.getByRole('button', { name: /已有后端数据/ }));
  return {
    urlInput: await screen.findByLabelText('后端 URL'),
    apiKeyInput: screen.getByLabelText('API Key'),
  };
};

describe('LoginScreen token guidance', () => {
  it('explains Star permissions before sign-in and defaults to classic token', () => {
    render(<TooltipProvider><LoginScreen /></TooltipProvider>);
    expect(screen.getByText('GitHub Token 权限')).toBeVisible();
    expect(screen.getByRole('tab', { name: '经典 Token' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('public_repo')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: '细粒度 Token' }));
    expect(screen.getByText('Starring')).toBeVisible();
  });

  it('shows limitation warning on fine-grained tab and allows switching to classic', () => {
    render(<TooltipProvider><LoginScreen /></TooltipProvider>);
    fireEvent.click(screen.getByRole('tab', { name: '细粒度 Token' }));
    expect(screen.getByText('细粒度 Token 限制说明')).toBeVisible();
    expect(screen.getByText(/无法稳定跨组织\/他人仓库 Star 或取消 Star/)).toBeVisible();
    expect(screen.getByText(/不支持 Star 列表（Lists）双向同步/)).toBeVisible();

    const switchBtn = screen.getByRole('button', { name: /经典 Token（点击切换）/ });
    fireEvent.click(switchBtn);

    expect(screen.getByRole('tab', { name: '经典 Token' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('public_repo')).toBeVisible();
  });

  it('adapts GitHub token creation link to the active mode', () => {
    render(<TooltipProvider><LoginScreen /></TooltipProvider>);
    const link = screen.getByRole('link', { name: '在GitHub上创建token →' });
    expect(link).toHaveAttribute('href', 'https://github.com/settings/tokens/new?description=GithubStarsManager&scopes=public_repo,gist,user');

    fireEvent.click(screen.getByRole('tab', { name: '细粒度 Token' }));
    expect(link).toHaveAttribute('href', 'https://github.com/settings/personal-access-tokens/new');
  });
});

describe('LoginScreen 后端登录', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.safeReadText.mockResolvedValue({ success: false, error: 'empty' });
    mocks.syncBackendData.mockReset().mockResolvedValue(undefined);
    mocks.configuredBackendUrl = null;
    // 真实 Store 跨用例共享：重置与本文件相关的账号/工作区/偏好字段
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      backendApiSecret: null,
      savedAccounts: {},
      accountWorkspaces: {},
      repositories: [],
      searchResults: [],
      gists: [],
      starredGists: [],
      releases: [],
      forks: [],
      customCategories: [],
      categoryOrder: [],
      hiddenDefaultCategoryIds: [],
      defaultCategoryOverrides: {},
      categoryListIdMap: {},
      lastSync: null,
      language: 'zh',
      currentView: 'repositories',
      selectedCategory: 'all',
    });
  });

  it('Ctrl+V 粘贴只写入当前聚焦的输入框', async () => {
    mocks.safeReadText.mockResolvedValue({ success: true, text: 'https://backend.example.com' });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.keyDown(urlInput, { key: 'v', ctrlKey: true });

    await waitFor(() => expect(urlInput).toHaveValue('https://backend.example.com'));
    expect(apiKeyInput).toHaveValue('');
    expect(mocks.safeReadText).toHaveBeenCalledOnce();
  });

  it('拒绝远程 HTTP 后端地址，且不发起后端请求', async () => {
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'http://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('后端地址无效');
    expect(mocks.restoreBackendSession).not.toHaveBeenCalled();
  });

  it('后端保存的 GitHub Token 失效时引导到令牌配置步骤', async () => {
    mocks.restoreBackendSession.mockResolvedValue({ status: 'restored-token-invalid' });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByText('后端保存的 GitHub Token 无法使用，请重新配置')).toBeInTheDocument();
    expect(screen.getByLabelText('GitHub Personal Access Token')).toHaveAttribute('id', 'backend-github-token');
  });

  it('连接已有后端成功后先登录再拉取后端数据（拉取固定到已验证账号）', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 1, login: 'octocat' },
    });
    // 捕获拉取发起时的登录态：必须已是已验证账号（请求头携带其账号 ID）
    let loginAtPull: string | null = null;
    mocks.syncBackendData.mockImplementation(async () => {
      loginAtPull = useAppStore.getState().user?.login ?? null;
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    await waitFor(() => expect(useAppStore.getState().user?.login).toBe('octocat'));
    expect(mocks.syncBackendData).toHaveBeenCalledOnce();
    expect(useAppStore.getState().githubToken).toBe('ghp_restored');
    // Issue #611 审计修复：先落登录态再拉取，使全部拉取请求携带已验证账号的
    // X-GitHub-Account-Id，而不是回退到服务端全局 active_account_id 分区。
    expect(loginAtPull).toBe('octocat');
  });

  it('后端数据同步失败时回滚登录状态并清空顶层工作区', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 2, login: 'octocat' },
    });
    // 模拟部分同步：拉取在失败前已把账号 B 的部分数据写入顶层工作区
    mocks.syncBackendData.mockImplementation(async () => {
      useAppStore.setState({ repositories: [repoOf(501)] });
      throw new Error('sync failed');
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sync failed');
    const state = useAppStore.getState();
    // 同步失败不提交登录状态：登录态回滚为未登录
    expect(state.user).toBeNull();
    expect(state.githubToken).toBeNull();
    // 审计修复：账号 B 的部分同步结果不得残留到下一次登录——顶层工作区已
    // 重置为空，且未完成同步的数据绝不能被归档为账号 B 的快照
    expect(state.repositories).toEqual([]);
    expect(state.accountWorkspaces['2']?.repositories ?? []).toEqual([]);
    // 已落地的凭证保留在 savedAccounts 中（下次一键恢复）
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_restored');
    expect(state.backendApiSecret).toBeNull();
  });

  it('令牌配置流程同步失败时回滚登录状态并清空顶层工作区', async () => {
    mocks.restoreBackendSession.mockResolvedValue({ status: 'github-token-required' });
    mocks.setupBackendGitHubToken.mockResolvedValue({ id: 2, login: 'octocat' });
    mocks.syncBackendData.mockImplementation(async () => {
      useAppStore.setState({ repositories: [repoOf(502)] });
      throw new Error('sync failed');
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    const tokenInput = await screen.findByLabelText('GitHub Personal Access Token');
    fireEvent.change(tokenInput, { target: { value: 'ghp_new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sync failed');
    const state = useAppStore.getState();
    expect(state.user).toBeNull();
    expect(state.githubToken).toBeNull();
    // 审计修复：令牌配置流程的回滚分支同样丢弃部分同步结果（不归档）
    expect(state.repositories).toEqual([]);
    expect(state.accountWorkspaces['2']?.repositories ?? []).toEqual([]);
    expect(state.savedAccounts['2']?.githubToken).toBe('ghp_new');
  });

  it('当本地存在已归档的自定义分类时弹出冲突确认对话框并确认覆盖', async () => {
    useAppStore.setState({
      accountWorkspaces: {
        '1': {
          repositories: [],
          lastSync: null,
          gists: [],
          starredGists: [],
          selectedGistCategory: 'all',
          releases: [],
          releaseSubscriptions: [],
          releaseSourceSettings: useAppStore.getState().releaseSourceSettings,
          readReleases: [],
          forks: [],
          readForks: [],
          customCategories: [{ id: 'cat-1', name: 'Cat', icon: '', isCustom: true, keywords: [] }],
          hiddenDefaultCategoryIds: [],
          categoryOrder: [],
          defaultCategoryOverrides: {},
          categoryListIdMap: {},
          syncMode: 'stars',
          syncModeConfigured: false,
        },
      },
    });
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 1, login: 'octocat' },
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByText('本地数据冲突')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '使用后端数据' }));

    await waitFor(() => expect(useAppStore.getState().user?.login).toBe('octocat'));
    expect(mocks.syncBackendData).toHaveBeenCalledOnce();
    expect(useAppStore.getState().githubToken).toBe('ghp_restored');
    // 覆盖确认后登录态落地：归档的自定义分类经工作区恢复进入当前会话
    expect(useAppStore.getState().customCategories).toEqual([
      { id: 'cat-1', name: 'Cat', icon: '', isCustom: true, keywords: [] },
    ]);
  });
});

describe('LoginScreen 后端 URL 预填', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.configuredBackendUrl = null;
  });

  it('桌面端 file:// origin 不预填无效地址', async () => {
    vi.stubGlobal('location', { protocol: 'file:', origin: 'file://' } as unknown as Location);

    const { urlInput } = await enterBackendMode();

    expect(urlInput).toHaveValue('');
  });

  it('Web 部署时预填同源地址', async () => {
    vi.stubGlobal('location', { protocol: 'https:', origin: 'https://app.example.com' } as unknown as Location);

    const { urlInput } = await enterBackendMode();

    expect(urlInput).toHaveValue('https://app.example.com');
  });

  it('记住的后端地址优先于同源地址', async () => {
    mocks.configuredBackendUrl = 'https://stored.example/api';

    const { urlInput } = await enterBackendMode();

    expect(urlInput).toHaveValue('https://stored.example');
  });
});
