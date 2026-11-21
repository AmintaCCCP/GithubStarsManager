import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../../../store/useAppStore';
import { normalizeBackendUrl } from '../../../utils/backendUrl';
import { useBackendSettingsActions } from './useBackendSettingsActions';

const mocks = vi.hoisted(() => ({
  backendInit: vi.fn(),
  backendCheckHealth: vi.fn(),
  backendVerifyAuth: vi.fn(),
  backendRememberActiveUrl: vi.fn(),
  setBackendApiSecret: vi.fn(),
  toast: vi.fn(),
  confirm: vi.fn(),
  syncLocalGitHubTokenToBackend: vi.fn(),
  tryRestoreAuthFromBackend: vi.fn(),
  useAppStore: Object.assign(vi.fn(), { setState: vi.fn() }),
  // R14 finding 26：模拟适配器的连接状态——init 按 real 契约提交地址
  //（手动探测固定目标/漂移判定依赖 backendUrl 反映提交结果）。
  // R15 finding 13：探测失败回滚的所有权校验依赖连接代次——mock 复现真实
  // 适配器的 commitBackendUrl 语义（地址变化时代次 +1，同地址提交不推进）。
  backendState: {
    backendUrl: 'https://stored.example/api' as string | null,
    connectionGeneration: 0,
  },
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../services/backendAdapter', () => ({
  backend: {
    configuredUrl: 'https://stored.example/api',
    get backendUrl() {
      return mocks.backendState.backendUrl;
    },
    get connectionGeneration() {
      return mocks.backendState.connectionGeneration;
    },
    isAvailable: false,
    init: mocks.backendInit,
    checkHealth: mocks.backendCheckHealth,
    verifyAuth: mocks.backendVerifyAuth,
    rememberActiveUrl: mocks.backendRememberActiveUrl,
  },
}));
vi.mock('../../../services/autoSync', () => ({
  syncLocalGitHubTokenToBackend: mocks.syncLocalGitHubTokenToBackend,
  tryRestoreAuthFromBackend: mocks.tryRestoreAuthFromBackend,
  withAccountSwitchFrozen: async <T,>(fn: () => Promise<T>) => fn(),
}));
vi.mock('../../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

const storeState = {
  language: 'zh',
  repositories: [],
  releases: [],
  aiConfigs: [],
  webdavConfigs: [],
  activeAIConfig: null,
  activeWebDAVConfig: null,
  hiddenDefaultCategoryIds: [] as string[],
  categoryOrder: [] as string[],
  customCategories: [],
  assetFilters: [],
  defaultCategoryOverrides: {},
  collapsedSidebarCategoryCount: 0,
  backendApiSecret: null as string | null,
  setBackendApiSecret: mocks.setBackendApiSecret,
  setRepositories: vi.fn(),
  setReleases: vi.fn(),
  setAIConfigs: vi.fn(),
  setWebDAVConfigs: vi.fn(),
  showDefaultCategory: vi.fn(),
  hideDefaultCategory: vi.fn(),
};

const mockUseAppStore = vi.mocked(useAppStore);

describe('useBackendSettingsActions 后端地址配置', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.backendApiSecret = null;
    mocks.backendState.backendUrl = 'https://stored.example/api';
    mocks.backendState.connectionGeneration = 0;
    mocks.backendInit.mockImplementation(async (url?: string) => {
      // 模拟适配器 init 的提交语义：preferredUrl 规整化后提交；留空走
      // 自动探测回退到存储地址（health 失败的提交语义由具体用例另行覆盖）。
      // R15 finding 13：与真实 commitBackendUrl 一致——仅地址变化时推进代次。
      const next = url ? normalizeBackendUrl(url) : 'https://stored.example/api';
      if (mocks.backendState.backendUrl !== next) {
        mocks.backendState.backendUrl = next;
        mocks.backendState.connectionGeneration += 1;
      }
    });
    mocks.backendCheckHealth.mockResolvedValue({ version: '1.0.0', timestamp: '2026-09-05T00:00:00Z' });
    mocks.backendVerifyAuth.mockResolvedValue(true);
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as never);
  });

  const render = () => renderHook(() => useBackendSettingsActions());

  it('urlInput 预填记住的后端地址并自动去掉 /api', () => {
    const { result } = render();
    expect(result.current.urlInput).toBe('https://stored.example');
  });

  it('无效地址直接提示，不向该地址发起探测也不提交密钥', async () => {
    const { result } = render();
    act(() => result.current.setUrlInput('http://127.example.com'));

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('后端地址无效'), 'error');
    expect(mocks.backendInit.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mocks.setBackendApiSecret).not.toHaveBeenCalled();
  });

  it('有效地址按输入探测，成功后记住并提示连接成功', async () => {
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('secret-1');
    });

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.backendInit).toHaveBeenCalledWith('https://new.example.com');
    expect(mocks.setBackendApiSecret).toHaveBeenCalledWith('secret-1');
    expect(mocks.backendVerifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backendRememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith('后端连接成功！', 'success');
  });

  it('认证失败时恢复先前的后端连接且不记住候选地址', async () => {
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('wrong-key');
    });
    mocks.backendVerifyAuth.mockResolvedValue(false);

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('后端连接失败'), 'error');
    expect(mocks.backendInit).toHaveBeenLastCalledWith('https://stored.example/api');
    expect(mocks.backendRememberActiveUrl).not.toHaveBeenCalled();
    // R14 finding 25：失败的探测先恢复原密钥（store 原值为 null）再回滚连接，
    // 错误密钥不得残留到全局状态
    expect(mocks.setBackendApiSecret).toHaveBeenLastCalledWith(null);
    expect(mocks.backendState.backendUrl).toBe('https://stored.example/api');
  });

  it('健康检查失败时同样恢复原密钥并回滚连接（R14 finding 25）', async () => {
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('secret-1');
    });
    mocks.backendCheckHealth.mockResolvedValue(null);

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('后端连接失败'), 'error');
    expect(mocks.setBackendApiSecret).toHaveBeenLastCalledWith(null);
    expect(mocks.backendInit).toHaveBeenLastCalledWith('https://stored.example/api');
    expect(mocks.backendRememberActiveUrl).not.toHaveBeenCalled();
  });

  it('地址留空时保持自动探测（不指定 preferredUrl）', async () => {
    const { result } = render();
    act(() => result.current.setUrlInput('  '));

    await act(async () => {
      await result.current.testConnection();
    });

    expect(mocks.backendInit.mock.calls.every((call) => call[0] === undefined)).toBe(true);
    expect(mocks.toast).toHaveBeenCalledWith('后端连接成功！', 'success');
  });

  it('verifyAuth 等待期间后端目标漂移时丢弃探测结果（R14 finding 26）', async () => {
    const { result } = render();
    act(() => {
      result.current.setUrlInput('https://new.example.com');
      result.current.setSecretInput('secret-1');
    });
    let releaseVerifyAuth!: (value: boolean) => void;
    mocks.backendVerifyAuth.mockImplementation(() => new Promise<boolean>((resolve) => {
      releaseVerifyAuth = resolve;
    }));
    let probePromise!: Promise<void>;
    await act(async () => {
      probePromise = result.current.testConnection();
    });
    // 异步 act 已冲刷微任务：verifyAuth 已被调用且挂起（探测窗口内）
    expect(mocks.backendVerifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backendInit).toHaveBeenLastCalledWith('https://new.example.com');

    await act(async () => {
      // verifyAuth 等待期间另一流程提交了其他后端地址
      mocks.backendState.backendUrl = 'https://other.example/api';
      releaseVerifyAuth(true);
      await probePromise;
    });

    // 结果被丢弃：不写存储、不提示成功、不触发 token 恢复/同步；
    // 暂存的错误密钥恢复为原值
    expect(mocks.backendRememberActiveUrl).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalledWith('后端连接成功！', 'success');
    expect(mocks.tryRestoreAuthFromBackend).not.toHaveBeenCalled();
    expect(mocks.setBackendApiSecret).toHaveBeenLastCalledWith(null);
  });

  it('手动探测进行中挂载探测被门控跳过，不改变后端目标（R14 finding 26）', async () => {
    const first = render();
    act(() => {
      first.result.current.setUrlInput('https://new.example.com');
      first.result.current.setSecretInput('secret-1');
    });
    let releaseVerifyAuth!: (value: boolean) => void;
    mocks.backendVerifyAuth.mockImplementation(() => new Promise<boolean>((resolve) => {
      releaseVerifyAuth = resolve;
    }));
    let probePromise!: Promise<void>;
    await act(async () => {
      probePromise = first.result.current.testConnection();
    });
    expect(mocks.backendVerifyAuth).toHaveBeenCalledOnce();
    expect(mocks.backendInit).toHaveBeenLastCalledWith('https://new.example.com');
    const initCallsBeforeRemount = mocks.backendInit.mock.calls.length;

    // 第二次挂载（如设置面板重开）：挂载探测在手动探测窗口内被跳过，
    // init 不再被调用——不会取代手动探测的 init 或提交另一地址
    render();
    expect(mocks.backendInit.mock.calls.length).toBe(initCallsBeforeRemount);
    expect(mocks.backendState.backendUrl).toBe('https://new.example.com/api');

    await act(async () => {
      releaseVerifyAuth(true);
      await probePromise;
    });
    // 手动探测对固定目标正常提交
    expect(mocks.backendRememberActiveUrl).toHaveBeenCalledOnce();
    expect(mocks.toast).toHaveBeenCalledWith('后端连接成功！', 'success');
  });
});
