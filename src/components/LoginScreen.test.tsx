import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './ui/tooltip';

const mocks = vi.hoisted(() => ({
  safeReadText: vi.fn(),
  restoreBackendSession: vi.fn(),
  setupBackendGitHubToken: vi.fn(),
  syncBackendData: vi.fn(),
  configuredBackendUrl: null as string | null,
  store: {
    setUser: vi.fn(),
    setGitHubToken: vi.fn(),
    setBackendApiSecret: vi.fn(),
    backendApiSecret: null as string | null,
  },
}));

vi.mock('../utils/clipboardUtils', () => ({ safeReadText: mocks.safeReadText }));
vi.mock('../features/lifecycle/hooks/useLoginActions', () => ({
  useLoginActions: () => ({
    authenticateWithGitHub: vi.fn(),
    syncTokenToBackend: vi.fn().mockResolvedValue({ ok: true }),
    configuredBackendUrl: mocks.configuredBackendUrl,
    restoreBackendSession: mocks.restoreBackendSession,
    setupBackendGitHubToken: mocks.setupBackendGitHubToken,
    syncBackendData: mocks.syncBackendData,
  }),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setUser: mocks.store.setUser,
      setGitHubToken: mocks.store.setGitHubToken,
      setBackendApiSecret: mocks.store.setBackendApiSecret,
      backendApiSecret: mocks.store.backendApiSecret,
      repositories: [],
      lastSync: null,
      language: 'zh',
      setLanguage: vi.fn(),
      theme: 'light',
      setTheme: vi.fn(),
    }),
}));

import { LoginScreen } from './LoginScreen';

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

describe('LoginScreen 后端登录', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.safeReadText.mockResolvedValue({ success: false, error: 'empty' });
    mocks.syncBackendData.mockReset().mockResolvedValue(undefined);
    mocks.store.backendApiSecret = null;
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

  it('后端数据同步失败时不提交登录状态', async () => {
    mocks.restoreBackendSession.mockResolvedValue({
      status: 'connected',
      githubToken: 'ghp_restored',
      user: { id: 1, login: 'octocat' },
    });
    mocks.syncBackendData.mockRejectedValueOnce(new Error('sync failed'));
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sync failed');
    expect(mocks.store.setUser).not.toHaveBeenCalled();
    expect(mocks.store.setGitHubToken).not.toHaveBeenCalled();
    expect(mocks.store.setBackendApiSecret).toHaveBeenLastCalledWith(null);
  });

  it('令牌配置流程同步失败时不提交登录状态', async () => {
    mocks.restoreBackendSession.mockResolvedValue({ status: 'github-token-required' });
    mocks.setupBackendGitHubToken.mockResolvedValue({ id: 1, login: 'octocat' });
    mocks.syncBackendData.mockRejectedValueOnce(new Error('sync failed'));
    const { urlInput, apiKeyInput } = await enterBackendMode();

    fireEvent.change(urlInput, { target: { value: 'https://backend.example.com' } });
    fireEvent.change(apiKeyInput, { target: { value: 'secret' } });
    fireEvent.click(screen.getByRole('button', { name: '连接并恢复数据' }));

    const tokenInput = await screen.findByLabelText('GitHub Personal Access Token');
    fireEvent.change(tokenInput, { target: { value: 'ghp_new' } });
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('sync failed');
    expect(mocks.store.setUser).not.toHaveBeenCalled();
    expect(mocks.store.setGitHubToken).not.toHaveBeenCalled();
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
