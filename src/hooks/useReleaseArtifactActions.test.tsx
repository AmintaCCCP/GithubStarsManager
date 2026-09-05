import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '../types';
import { computeRpcDownloadKey, useReleaseArtifactActions } from './useReleaseArtifactActions';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  sendToRpcDownload: vi.fn(),
  analyzeReleaseSummary: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: vi.fn() }),
}));

vi.mock('../services/rpcDownloadService', () => ({
  sendToRpcDownload: mocks.sendToRpcDownload,
}));

vi.mock('../services/aiService', () => ({
  AIService: class {
    analyzeReleaseSummary = mocks.analyzeReleaseSummary;
  },
}));

const createStoreState = () => ({
  language: 'zh' as const,
  backendApiSecret: 'secret-1' as string | null,
  aiConfigs: [{
    id: 'ai-config',
    name: 'Test AI',
    baseUrl: 'https://example.com/v1',
    apiKey: 'ai-key',
    model: 'ai-model',
  }],
  activeAIConfig: 'ai-config' as string | null,
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;

const release: Release = {
  id: 100,
  tag_name: 'v1.0.0',
  name: 'Version 1.0.0',
  body: 'Notes body',
  published_at: '2026-01-02T00:00:00.000Z',
  html_url: 'https://github.com/owner/repo/releases/tag/v1.0.0',
  assets: [],
  prerelease: false,
  repository: { id: 9, full_name: 'owner/repo', name: 'repo' },
};

describe('computeRpcDownloadKey', () => {
  it('versions the key with updatedAt', () => {
    expect(computeRpcDownloadKey({ url: 'https://x/a.zip', updatedAt: '2026-01-01T00:00:00.000Z' }))
      .toBe('https://x/a.zip@2026-01-01T00:00:00.000Z');
    expect(computeRpcDownloadKey({ url: 'https://x/a.zip' })).toBe('https://x/a.zip@');
    expect(computeRpcDownloadKey({ url: 'https://x/a.zip', updatedAt: undefined })).toBe('https://x/a.zip@');
  });
});

describe('useReleaseArtifactActions.sendRpcDownload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('passes url, name and the backend secret through and records the sent state', async () => {
    mocks.sendToRpcDownload.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip', updatedAt: '2026-01-01T00:00:00.000Z' });
    });
    expect(mocks.sendToRpcDownload).toHaveBeenCalledWith('https://x/a.zip', 'a.zip', 'secret-1');
    expect(result.current.rpcDownloadStates['https://x/a.zip@2026-01-01T00:00:00.000Z']).toBe('sent');
    expect(mocks.toast).toHaveBeenCalledWith('已发送到远程下载器', 'success');
  });

  it('omits the secret when the store has none', async () => {
    storeState.backendApiSecret = null;
    mocks.sendToRpcDownload.mockResolvedValue({ success: true });
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip' });
    });
    expect(mocks.sendToRpcDownload).toHaveBeenCalledWith('https://x/a.zip', 'a.zip', undefined);
  });

  it('shows the dedicated toast when the RPC service is not running and resets the state', async () => {
    mocks.sendToRpcDownload.mockResolvedValue({ success: false, error: 'RPC service not running' });
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip' });
    });
    expect(mocks.toast).toHaveBeenCalledWith('远程下载服务未运行，请检查配置', 'error');
    expect(result.current.rpcDownloadStates['https://x/a.zip@']).toBe('idle');
  });

  it('falls back to the raw error or a generic message on other failures', async () => {
    mocks.sendToRpcDownload.mockResolvedValue({ success: false, error: 'quota exceeded' });
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip' });
    });
    expect(mocks.toast).toHaveBeenCalledWith('quota exceeded', 'error');

    mocks.sendToRpcDownload.mockResolvedValue({ success: false });
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/b.zip', name: 'b.zip' });
    });
    expect(mocks.toast).toHaveBeenLastCalledWith('发送失败', 'error');
  });

  it('toasts the not-running message on a thrown error', async () => {
    mocks.sendToRpcDownload.mockRejectedValue(new Error('socket hang up'));
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip' });
    });
    expect(mocks.toast).toHaveBeenCalledWith('远程下载服务未运行，请检查配置', 'error');
    expect(result.current.rpcDownloadStates['https://x/a.zip@']).toBe('idle');
  });

  it('short-circuits while sending and clears the sent state on retry', async () => {
    let resolveSend!: (value: { success: boolean }) => void;
    mocks.sendToRpcDownload.mockImplementation(() => new Promise<{ success: boolean }>((resolve) => {
      resolveSend = resolve;
    }));

    const { result } = renderHook(() => useReleaseArtifactActions());
    const link = { url: 'https://x/a.zip', name: 'a.zip' };
    let first!: Promise<void>;
    act(() => {
      first = result.current.sendRpcDownload(link);
    });
    expect(result.current.rpcDownloadStates['https://x/a.zip@']).toBe('sending');

    // 发送中重复点击被短路：第二次调用不会发起新请求
    await act(async () => {
      await result.current.sendRpcDownload(link);
    });
    expect(mocks.sendToRpcDownload).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSend({ success: true });
      await first;
    });
    expect(result.current.rpcDownloadStates['https://x/a.zip@']).toBe('sent');

    // 重试：清除旧的成功态再发送
    mocks.sendToRpcDownload.mockResolvedValue({ success: true });
    await act(async () => {
      await result.current.sendRpcDownload(link);
    });
    expect(mocks.sendToRpcDownload).toHaveBeenCalledTimes(2);
    expect(result.current.rpcDownloadStates['https://x/a.zip@']).toBe('sent');
  });
});

describe('useReleaseArtifactActions.generateSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
  });

  it('toasts without writing state when no AI config is active', async () => {
    storeState.aiConfigs = [];
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => { await result.current.generateSummary(release); });
    expect(mocks.toast).toHaveBeenCalledWith('请先在设置中配置 AI 服务。', 'error');
    expect(result.current.summaries[100]).toBeUndefined();
    expect(mocks.analyzeReleaseSummary).not.toHaveBeenCalled();
  });

  it('stores loading → done with the generated content', async () => {
    mocks.analyzeReleaseSummary.mockResolvedValue('# Summary');
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => { await result.current.generateSummary(release); });
    expect(mocks.analyzeReleaseSummary).toHaveBeenCalledWith(
      'Notes body',
      { repoName: 'owner/repo', tagName: 'v1.0.0', releaseName: 'Version 1.0.0' },
      expect.any(AbortSignal),
    );
    expect(result.current.summaries[100]).toEqual({ status: 'done', content: '# Summary' });
  });

  it('skips regeneration while loading or when a done summary exists', async () => {
    mocks.analyzeReleaseSummary.mockResolvedValue('# Summary');
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => { await result.current.generateSummary(release); });

    await act(async () => { await result.current.generateSummary(release); });
    expect(mocks.analyzeReleaseSummary).toHaveBeenCalledTimes(1);

    // loading 态同样短路
    let resolveSummary!: (value: string) => void;
    mocks.analyzeReleaseSummary.mockImplementation(() => new Promise<string>((resolve) => {
      resolveSummary = resolve;
    }));
    const second: Release = { ...release, id: 101 };
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.generateSummary(second);
    });
    await act(async () => { await result.current.generateSummary(second); });
    expect(result.current.summaries[101]?.status).toBe('loading');
    resolveSummary('# late');
    await act(async () => { await pending; });
  });

  it('stores the error state and toasts on failure', async () => {
    mocks.analyzeReleaseSummary.mockRejectedValue(new Error('model offline'));
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => { await result.current.generateSummary(release); });
    expect(result.current.summaries[100]).toEqual({ status: 'error', error: 'model offline' });
    expect(mocks.toast).toHaveBeenCalledWith('总结生成失败：model offline', 'error');
  });

  it('stays silent on AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    mocks.analyzeReleaseSummary.mockRejectedValue(abortError);
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => { await result.current.generateSummary(release); });
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(result.current.summaries[100]).toEqual({ status: 'loading' });
  });

  it('aborts all in-flight summary requests on unmount', async () => {
    const signals: AbortSignal[] = [];
    mocks.analyzeReleaseSummary.mockImplementation((_body: string, _meta: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    });
    const { result, unmount } = renderHook(() => useReleaseArtifactActions());
    act(() => {
      void result.current.generateSummary(release);
    });
    expect(signals[0].aborted).toBe(false);
    unmount();
    expect(signals[0].aborted).toBe(true);
  });

  it('cancelSummaryRequests aborts in-flight requests without unmounting', async () => {
    const signals: AbortSignal[] = [];
    mocks.analyzeReleaseSummary.mockImplementation((_body: string, _meta: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    });
    const { result } = renderHook(() => useReleaseArtifactActions());
    act(() => {
      void result.current.generateSummary(release);
    });
    act(() => {
      result.current.cancelSummaryRequests();
    });
    expect(signals[0].aborted).toBe(true);
  });

  it('reset cancels in-flight summaries so they cannot write back after clearing', async () => {
    // abort 感知 mock：真实 fetch 在 signal 中止时会以 AbortError 拒绝
    const resolvers: Array<(value: string) => void> = [];
    mocks.analyzeReleaseSummary.mockImplementation((_b: string, _m: unknown, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        resolvers.push((value: string) => {
          if (signal.aborted) {
            const abortError = new Error('Aborted');
            abortError.name = 'AbortError';
            reject(abortError);
          } else {
            resolve(value);
          }
        });
      }));
    const { result } = renderHook(() => useReleaseArtifactActions());

    act(() => {
      void result.current.generateSummary(release);
    });
    expect(result.current.summaries[100]?.status).toBe('loading');

    act(() => {
      result.current.reset();
    });
    expect(result.current.summaries).toEqual({});

    // 模拟迟到的完成：请求已被 reset 取消，结果不得回写
    resolvers[0]('# stale');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.summaries).toEqual({});
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('reset discards late results even when the service ignores the abort signal', async () => {
    // H1 回归：resolve 型 mock（忽略 signal，不抛 AbortError）——修复前会把迟到
    // 的 done 回写进刚清空的状态；修复后由 post-await aborted 守卫丢弃。
    let resolveSummary!: (value: string) => void;
    mocks.analyzeReleaseSummary.mockImplementation(() => new Promise<string>((resolve) => {
      resolveSummary = resolve;
    }));
    const { result } = renderHook(() => useReleaseArtifactActions());

    act(() => {
      void result.current.generateSummary(release);
    });
    expect(result.current.summaries[100]?.status).toBe('loading');

    act(() => {
      result.current.reset();
    });
    expect(result.current.summaries).toEqual({});

    resolveSummary('# stale');
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(result.current.summaries).toEqual({});
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('reset clears summaries and rpc download states', async () => {
    mocks.sendToRpcDownload.mockResolvedValue({ success: true });
    mocks.analyzeReleaseSummary.mockResolvedValue('# Summary');
    const { result } = renderHook(() => useReleaseArtifactActions());
    await act(async () => {
      await result.current.sendRpcDownload({ url: 'https://x/a.zip', name: 'a.zip' });
      await result.current.generateSummary(release);
    });
    expect(result.current.summaries[100]).toEqual({ status: 'done', content: '# Summary' });
    act(() => {
      result.current.reset();
    });
    expect(result.current.summaries).toEqual({});
    expect(result.current.rpcDownloadStates).toEqual({});
  });
});
