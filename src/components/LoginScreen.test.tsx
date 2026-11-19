import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Repository } from '../types';
import { TooltipProvider } from './ui/tooltip';
import { DialogProvider } from '../hooks/useDialog';
import { useAppStore } from '../store/useAppStore';

const mocks = vi.hoisted(() => ({
  safeReadText: vi.fn(),
  authenticateWithGitHub: vi.fn(),
  syncTokenToBackend: vi.fn(),
  restoreBackendSession: vi.fn(),
  setupBackendGitHubToken: vi.fn(),
  syncBackendData: vi.fn(),
  configuredBackendUrl: null as string | null,
  getBackendUrl: vi.fn(() => null as string | null),
  getPersistedUrl: vi.fn(() => null as string | null),
  persistUrl: vi.fn(),
  rememberActiveBackendUrl: vi.fn(),
  rollbackBackendConnection: vi.fn().mockResolvedValue(undefined),
  drainInFlightBackendPulls: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/clipboardUtils', () => ({ safeReadText: mocks.safeReadText }));
vi.mock('../features/lifecycle/hooks/useLoginActions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../features/lifecycle/hooks/useLoginActions')>();
  return {
    ...actual,
    useLoginActions: () => ({
      authenticateWithGitHub: mocks.authenticateWithGitHub,
      syncTokenToBackend: mocks.syncTokenToBackend,
      configuredBackendUrl: mocks.configuredBackendUrl,
      restoreBackendSession: mocks.restoreBackendSession,
      setupBackendGitHubToken: mocks.setupBackendGitHubToken,
      syncBackendData: mocks.syncBackendData,
      getBackendUrl: mocks.getBackendUrl,
      getPersistedUrl: mocks.getPersistedUrl,
      persistUrl: mocks.persistUrl,
      rememberActiveBackendUrl: mocks.rememberActiveBackendUrl,
      rollbackBackendConnection: mocks.rollbackBackendConnection,
      drainInFlightBackendPulls: mocks.drainInFlightBackendPulls,
    }),
  };
});

// App 级测试避免真实更新检查发起网络请求
vi.mock('../hooks/useAutoUpdateCheck', () => ({ useAutoUpdateCheck: vi.fn() }));

// 恢复真实 Store（与 useBackupActions.multiAccount.test.tsx 同一模式）：
// 回滚断言必须驱动真实的工作区与账号状态——选择器桩（无 getState）无法
// 观察回滚后 repositories 等顶层工作区字段是否已被清空。
vi.mock('../store/useAppStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/useAppStore')>();
  return actual;
});

import { LoginScreen } from './LoginScreen';
import App from '../App';

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
    mocks.authenticateWithGitHub.mockReset().mockResolvedValue({ id: 5, login: 'octo-pat', name: 'Octo Pat', avatar_url: '', email: null });
    mocks.syncTokenToBackend.mockReset().mockResolvedValue({ ok: true });
    mocks.getBackendUrl.mockReset().mockReturnValue(null);
    mocks.getPersistedUrl.mockReset().mockReturnValue(null);
    mocks.persistUrl.mockReset();
    mocks.rememberActiveBackendUrl.mockReset();
    mocks.rollbackBackendConnection.mockReset().mockResolvedValue(undefined);
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

  it('连接已有后端成功后以显式账号拉取，拉取成功才提交登录态', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 1, login: 'octocat' },
    });
    // 捕获拉取发起时的登录态：恢复流程不再提前 setUser（B13）——拉取以显式
    // targetAccountId 固定请求头，登录态在拉取成功后统一提交。
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
    expect(mocks.syncBackendData).toHaveBeenCalledWith({ targetAccountId: '1' });
    expect(useAppStore.getState().githubToken).toBe('ghp_restored');
    // 审计修复（B13）：拉取期间登录态尚未提交（请求头由显式账号 ID 提供），
    // 拉取完成后凭证与用户身份才一起落地。
    expect(loginAtPull).toBeNull();
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
    // 同步失败不提交登录状态：拉取失败发生在登录态提交之前（B13），错误留在登录页
    expect(state.user).toBeNull();
    expect(state.githubToken).toBeNull();
    // 审计修复：账号 B 的部分同步结果不得残留到下一次登录——顶层工作区已
    // 重置为空，且未完成同步的数据绝不能被归档为账号 B 的快照
    expect(state.repositories).toEqual([]);
    expect(state.accountWorkspaces['2']?.repositories ?? []).toEqual([]);
    // 登录态未提交：账号 B 的凭证尚未登记进 savedAccounts（重新连接即可恢复）
    expect(state.savedAccounts['2']).toBeUndefined();
    expect(state.backendApiSecret).toBeNull();
    // 审计修复（R2-B7/B12）：拉取失败保留原持久化 URL（本用例原值为空，
    // 不得移除/写入持久化键），登录提交前绝不持久化候选 URL。
    expect(mocks.persistUrl).not.toHaveBeenCalled();
    expect(mocks.rememberActiveBackendUrl).not.toHaveBeenCalled();
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
    // 登录态未提交：凭证尚未登记进 savedAccounts（B13）
    expect(state.savedAccounts['2']).toBeUndefined();
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
    // 覆盖确认后后端返回空快照：提交登录态时不得回退到目标账号旧归档
    expect(useAppStore.getState().customCategories).toEqual([]);
  });

  // 审计修复（R2-B9）：候选 API Key 在候选 URL 提交后才写入 Store
  //（restoreBackendSession 的 apiSecret 选项）——/health 探测阶段不得把候选
  // Key 发给尚未切换的原后端。
  it('候选 API Key 不提前写入 Store，登录提交后才持久化候选 URL', async () => {
    const secretAtRestoreCall: Array<string | undefined> = [];
    const storeSecretAtRestoreCall: Array<string | null> = [];
    mocks.restoreBackendSession.mockImplementation(async (_url: string, options?: { apiSecret?: string }) => {
      secretAtRestoreCall.push(options?.apiSecret);
      storeSecretAtRestoreCall.push(useAppStore.getState().backendApiSecret);
      return { status: 'connected', githubToken: 'ghp_restored', user: { id: 3, login: 'octo-3' } };
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    await waitFor(() => expect(useAppStore.getState().user?.login).toBe('octo-3'));
    // 候选密钥经 apiSecret 选项传入，并显式省略账号头
    expect(mocks.restoreBackendSession).toHaveBeenLastCalledWith('https://backend.example.com', {
      omitAccountHeader: true,
      apiSecret: 'secret',
      deferPersist: true,
    });
    // R2-B9：调用 restoreBackendSession 时 Store 仍是原密钥（null），探测阶段
    // 请求不会携带候选 Key。
    expect(storeSecretAtRestoreCall).toEqual([null]);
    expect(secretAtRestoreCall).toEqual(['secret']);
    // R2-B12：登录提交完成后才持久化候选 URL。
    expect(mocks.rememberActiveBackendUrl).toHaveBeenCalledOnce();
  });

  // 审计修复（R2-B5/B11）：取消候选后端设置时成对恢复原 URL 与原 API Key。
  it('取消令牌配置时成对恢复候选之前的 URL 与 API Key', async () => {
    let activeBackendUrl: string | null = 'https://original.example/api';
    mocks.getBackendUrl.mockImplementation(() => activeBackendUrl);
    useAppStore.setState({ backendApiSecret: 'original-secret' });
    mocks.restoreBackendSession.mockImplementation(async (url: string, options?: { apiSecret?: string }) => {
      activeBackendUrl = `${url.replace(/\/+$/, '')}/api`;
      if (options?.apiSecret !== undefined) {
        useAppStore.setState({ backendApiSecret: options.apiSecret });
      }
      return { status: 'github-token-required' };
    });
    mocks.rollbackBackendConnection.mockImplementation(async (url: string | null, secret?: string | null) => {
      activeBackendUrl = url;
      if (secret !== undefined) {
        useAppStore.setState({ backendApiSecret: secret });
      }
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    // 进入令牌配置步骤：候选连接与候选密钥均已写入供设置使用
    await screen.findByLabelText('GitHub Personal Access Token');
    expect(mocks.getBackendUrl()).toBe('https://backend.example.com/api');
    expect(useAppStore.getState().backendApiSecret).toBe('secret');

    // 回到 GitHub 模式 = 取消候选设置：URL 与密钥必须成对恢复为原值
    fireEvent.click(screen.getByRole('button', { name: '使用 GitHub Token 登录' }));
    await waitFor(() => expect(mocks.rollbackBackendConnection).toHaveBeenCalledWith(
      'https://original.example/api',
      'original-secret',
    ));
    expect(mocks.getBackendUrl()).toBe('https://original.example/api');
    expect(useAppStore.getState().backendApiSecret).toBe('original-secret');
  });

  it('目标账号已有旧归档但后端返回空快照时，覆盖确认后最终工作区为空', async () => {
    const parkedRepo = {
      id: 901,
      name: 'stale-repo',
      full_name: 'octo-3/stale-repo',
      description: null,
      html_url: 'https://github.com/octo-3/stale-repo',
      stargazers_count: 1,
      language: 'TypeScript',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      pushed_at: '2026-01-01T00:00:00Z',
      owner: { login: 'octo-3', avatar_url: 'https://avatars.example.com/3' },
      topics: [],
    };
    useAppStore.setState({
      user: null,
      repositories: [],
      accountWorkspaces: {
        '3': {
          repositories: [parkedRepo],
          lastSync: '2026-01-01T00:00:00Z',
          gists: [],
          starredGists: [],
          selectedGistCategory: 'all',
          releases: [],
          releaseSubscriptions: [],
          releaseSourceSettings: {
            trackedStarredRepoIds: [],
            customRepos: [],
            includePrereleases: false,
            includeDrafts: false,
          },
          readReleases: [],
          forks: [],
          readForks: [],
          customCategories: [],
          hiddenDefaultCategoryIds: [],
          defaultCategoryOverrides: {},
          categoryOrder: [],
          categoryListIdMap: {},
          syncMode: 'manual',
          syncModeConfigured: true,
        },
      },
    });
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_empty_snapshot',
      user: { id: 3, login: 'octo-3', name: 'Octo 3', avatar_url: 'https://avatars.example.com/3', email: null },
    });
    // 后端成功返回空快照（repositories 为空）
    mocks.syncBackendData.mockImplementation(async () => {
      useAppStore.setState({ repositories: [] });
    });

    const { urlInput, apiKeyInput } = await enterBackendMode();
    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    // 触发覆盖确认弹窗并选择使用后端数据
    const confirmBtn = await screen.findByRole('button', { name: '使用后端数据' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(useAppStore.getState().user?.login).toBe('octo-3'));
    expect(useAppStore.getState().repositories).toEqual([]);
    expect(useAppStore.getState().accountWorkspaces['3']?.repositories).toEqual([]);
  });

  // 审计修复（R2-B8）：回滚完成前阻止 PAT 提交（按钮、Enter 全部纳入约束）。
  it('回滚完成前阻止 PAT 提交，回滚完成后恢复', async () => {
    mocks.getBackendUrl.mockReturnValue('https://candidate.example/api');
    mocks.restoreBackendSession.mockResolvedValue({ status: 'github-token-required' });
    let resolveRollback: () => void = () => {};
    mocks.rollbackBackendConnection.mockImplementation(() => new Promise<void>((resolve) => {
      resolveRollback = resolve;
    }));
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));
    await screen.findByLabelText('GitHub Personal Access Token');

    // 取消候选设置：回滚请求在后台执行
    fireEvent.click(screen.getByRole('button', { name: '使用 GitHub Token 登录' }));
    const patInput = await screen.findByLabelText('GitHub Personal Access Token');
    fireEvent.change(patInput, { target: { value: 'ghp_pat' } });

    // 回滚进行中：连接按钮禁用，Enter 也不得提交 PAT（否则 syncTokenToBackend
    // 会把 PAT 发给仍活动的候选后端 B）
    await waitFor(() => expect(screen.getByRole('button', { name: '连接到GitHub' })).toBeDisabled());
    fireEvent.keyDown(patInput, { key: 'Enter' });
    expect(mocks.syncTokenToBackend).not.toHaveBeenCalled();

    // 回滚完成：提交入口恢复
    await act(async () => {
      resolveRollback();
    });
    await waitFor(() => expect(screen.getByRole('button', { name: '连接到GitHub' })).toBeEnabled());
    fireEvent.keyDown(patInput, { key: 'Enter' });
    await waitFor(() => expect(mocks.syncTokenToBackend).toHaveBeenCalledOnce());
  });

  // 审计修复（R2-B6）：缓存只属于其他账号（A）而目标 B 无本地数据时，
  // 先归档 A，再直接拉取 B 远端数据——不弹冲突对话框，也不因「保留本地」
  // 跳过 B 的拉取。
  it('缓存只属于其他账号而目标无本地数据时直接拉取不询问覆盖', async () => {
    // 账号 A（id 7）处于登录残留态（持久化 user + 顶层实时数据）
    useAppStore.setState({
      user: { id: 7, login: 'alice', name: 'Alice', avatar_url: '', email: null },
      isAuthenticated: false,
      repositories: [repoOf(701)],
    });
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_b',
      user: { id: 8, login: 'bob' },
    });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    await waitFor(() => expect(useAppStore.getState().user?.login).toBe('bob'));
    // 不询问覆盖：实时工作区不属于目标账号，目标也没有归档数据
    expect(screen.queryByText('本地数据冲突')).not.toBeInTheDocument();
    // 直接拉取目标账号的远端数据（「保留本地」不再跳过 B 的拉取）
    expect(mocks.syncBackendData).toHaveBeenCalledWith({ targetAccountId: '8' });
    // 先归档 A：账号 A 的实时工作区安全进入 accountWorkspaces
    expect(useAppStore.getState().accountWorkspaces['7']?.repositories ?? []).toHaveLength(1);
    // R2-B12：登录提交完成后才持久化候选 URL
    expect(mocks.rememberActiveBackendUrl).toHaveBeenCalledOnce();
  });

  // 审计修复（R2-B10）：拉取尚未开始（候选返回 unauthorized 在归档前抛错）
  // 时不执行丢弃——顶层可能是未归档的旧版顶层缓存或活跃账号实时工作区。
  it('拉取尚未开始失败时不丢弃顶层工作区', async () => {
    useAppStore.setState({ repositories: [repoOf(702)], user: null });
    mocks.restoreBackendSession.mockResolvedValue({ status: 'unauthorized' });
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('API Key 无效');
    // 顶层数据原样保留（不得被 discardPartialLoginWorkspace 清空）
    expect(useAppStore.getState().repositories).toHaveLength(1);
    expect(mocks.rememberActiveBackendUrl).not.toHaveBeenCalled();
  });

  // 审计修复（R2-B10）：拉取已开始且 park 未能归档（无主残留）时，丢弃拉取
  // 残留后按拉取前快照恢复——只清理本次拉取写入的数据。
  it('拉取失败只清理拉取写入的数据，无主残留按拉取前快照恢复', async () => {
    useAppStore.setState({ repositories: [repoOf(703)], user: null });
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 9, login: 'octo-9' },
    });
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
    // 拉取写入的数据（repo 501）已被丢弃……
    expect(state.repositories.some((repo) => repo.id === 501)).toBe(false);
    // ……而 park 无法归档的无主残留（repo 703）按拉取前快照恢复，未被误清
    expect(state.repositories.some((repo) => repo.id === 703)).toBe(true);
    // 登录态未提交，拉取数据绝不归档为账号快照
    expect(state.user).toBeNull();
    expect(state.accountWorkspaces['9']?.repositories ?? []).toEqual([]);
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

// 审计修复（B15）：覆盖「真实 App 切换路径」——直接挂载 LoginScreen 的测试
// 发现不了恢复流程与 App 装载边界（isAuthenticated 提交时机）的交互。这里经
// 真实 App 渲染（真实 Store），只 mock 服务层与重依赖视图。
describe('LoginScreen 经 App 渲染的恢复路径', () => {
  const appUser = { id: 9, login: 'octo-app', name: 'Octo App', avatar_url: '', email: null };

  const renderAppOnLoginScreen = async () => {
    useAppStore.setState({
      user: null,
      githubToken: null,
      isAuthenticated: false,
      hasHydrated: true,
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
    render(
      <DialogProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </DialogProvider>
    );
    // App 因 isAuthenticated=false 渲染 LoginScreen：进入后端模式并填好候选后端
    fireEvent.click(await screen.findByRole('button', { name: /已有后端数据/ }));
    fireEvent.change(await screen.findByLabelText('后端 URL'), { target: { value: 'https://backend.example.com' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.safeReadText.mockResolvedValue({ success: false, error: 'empty' });
    mocks.syncBackendData.mockReset().mockResolvedValue(undefined);
    mocks.authenticateWithGitHub.mockReset().mockResolvedValue({ id: 5, login: 'octo-pat', name: 'Octo Pat', avatar_url: '', email: null });
    mocks.syncTokenToBackend.mockReset().mockResolvedValue({ ok: true });
    mocks.getBackendUrl.mockReset().mockReturnValue(null);
    mocks.getPersistedUrl.mockReset().mockReturnValue(null);
    mocks.persistUrl.mockReset();
    mocks.rememberActiveBackendUrl.mockReset();
    mocks.rollbackBackendConnection.mockReset().mockResolvedValue(undefined);
    mocks.configuredBackendUrl = null;
  });

  it('恢复拉取期间登录页保持挂载，拉取成功后才提交登录态', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: appUser,
    });
    // 拉取挂起：观察拉取在途时 App 的装载边界
    let resolvePull: () => void = () => {};
    mocks.syncBackendData.mockImplementation(() => new Promise<void>((resolve) => {
      resolvePull = resolve;
    }));

    await renderAppOnLoginScreen();

    // 拉取已发起（显式账号恢复，B13）但尚未结束：登录页保持挂载、登录态未提交
    await waitFor(() => expect(mocks.syncBackendData).toHaveBeenCalledOnce());
    expect(mocks.syncBackendData).toHaveBeenCalledWith({ targetAccountId: '9' });
    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().isAuthenticated).toBe(false);
    expect(screen.getByRole('button', { name: '连接中…' })).toBeInTheDocument();

    // 拉取成功 → 工作区与登录态一起提交 → LoginScreen 卸载（主界面接管）
    await act(async () => {
      resolvePull();
    });
    await waitFor(() => expect(useAppStore.getState().isAuthenticated).toBe(true));
    expect(useAppStore.getState().user?.login).toBe('octo-app');
    expect(useAppStore.getState().githubToken).toBe('ghp_restored');
    // Radix 模态（首次登录的「选择同步范围」）会把主界面标记为 aria-hidden，
    // 角色查询会忽略被遮罩内容——这里用文本断言验证装载边界。
    // 审计修复（R2-B16）：卸载断言检查后端登录表单的 API Key 输入框已从 DOM
    // 移除——「连接已有后端」入口在 GitHub 模式才渲染，后端模式本就不显示，
    // 旧断言证明不了卸载。
    await waitFor(() => expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument());
    expect(screen.getByText('选择同步范围')).toBeInTheDocument();
  });

  it('恢复拉取失败时错误提示仍显示在登录页，登录态不提交且顶层工作区被丢弃', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: appUser,
    });
    // 模拟部分同步：拉取在失败前已把账号数据写入顶层工作区
    mocks.syncBackendData.mockImplementation(async () => {
      useAppStore.setState({ repositories: [repoOf(601)] });
      throw new Error('restore pull failed');
    });

    await renderAppOnLoginScreen();

    // 失败提示留在当前登录页（App 未切换到主界面）
    expect(await screen.findByRole('alert')).toHaveTextContent('restore pull failed');
    expect(useAppStore.getState().user).toBeNull();
    expect(useAppStore.getState().githubToken).toBeNull();
    expect(useAppStore.getState().isAuthenticated).toBe(false);
    // 审计修复（B13）：拉取写入顶层的部分同步结果必须一并丢弃（不归档）
    expect(useAppStore.getState().repositories).toEqual([]);
    expect(useAppStore.getState().accountWorkspaces['9']?.repositories ?? []).toEqual([]);
  });
});
