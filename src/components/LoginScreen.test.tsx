import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './ui/tooltip';

const mocks = vi.hoisted(() => ({
  safeReadText: vi.fn(),
  restoreBackendSession: vi.fn(),
}));

vi.mock('../utils/clipboardUtils', () => ({ safeReadText: mocks.safeReadText }));
vi.mock('../features/lifecycle/hooks/useLoginActions', () => ({
  useLoginActions: () => ({
    authenticateWithGitHub: vi.fn(),
    syncTokenToBackend: vi.fn().mockResolvedValue({ ok: true }),
    configuredBackendUrl: null,
    restoreBackendSession: mocks.restoreBackendSession,
    setupBackendGitHubToken: vi.fn().mockResolvedValue(undefined),
    syncBackendData: vi.fn().mockResolvedValue(undefined),
  }),
}));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      setUser: vi.fn(),
      setGitHubToken: vi.fn(),
      setBackendApiSecret: vi.fn(),
      backendApiSecret: null,
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
});
