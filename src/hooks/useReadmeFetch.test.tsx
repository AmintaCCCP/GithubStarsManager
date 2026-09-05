import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_README_VARIANT, type ReadmeVariant } from '../utils/readmeVariants';
import { pickReadmeCandidate, useReadmeFetch } from './useReadmeFetch';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  backend: {
    isAvailable: true,
    getRepositoryReadme: vi.fn(),
    getRepositoryReadmeByPath: vi.fn(),
    listRepositoryReadmeCandidates: vi.fn(),
  },
  getRepositoryReadme: vi.fn(),
  getRepositoryReadmeByPath: vi.fn(),
  listRepositoryReadmeCandidates: vi.fn(),
  shouldBypassBackend: vi.fn(() => false),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../services/backendAdapter', () => ({ backend: mocks.backend }));

vi.mock('../services/githubApi', () => ({
  GitHubApiService: class {
    getRepositoryReadme = mocks.getRepositoryReadme;
    getRepositoryReadmeByPath = mocks.getRepositoryReadmeByPath;
    listRepositoryReadmeCandidates = mocks.listRepositoryReadmeCandidates;
  },
}));

vi.mock('../services/routeMode', () => ({
  shouldBypassBackend: mocks.shouldBypassBackend,
}));

const createStoreState = () => ({
  githubToken: 'github-token' as string | null,
  language: 'zh' as const,
});

let storeState = createStoreState();
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: typeof storeState) => unknown) =>
  selector ? selector(storeState) : storeState);
(mockUseAppStore as unknown as { getState: () => typeof storeState }).getState = () => storeState;

const defaultVariant: ReadmeVariant = { ...DEFAULT_README_VARIANT };

describe('useReadmeFetch.fetchReadmeContent', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mocks.shouldBypassBackend.mockReturnValue(false);
    mocks.backend.isAvailable = true;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('goes through the backend when available and does not touch GitHub', async () => {
    mocks.backend.getRepositoryReadme.mockResolvedValue('# Backend readme');
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(defaultVariant)).resolves.toBe('# Backend readme');
    });
    expect(mocks.backend.getRepositoryReadme).toHaveBeenCalledWith('owner', 'repo', expect.any(AbortSignal));
    expect(mocks.getRepositoryReadme).not.toHaveBeenCalled();
  });

  it('bypasses the backend in browser route mode and fetches from GitHub', async () => {
    mocks.shouldBypassBackend.mockReturnValue(true);
    mocks.getRepositoryReadme.mockResolvedValue('# Direct readme');
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(defaultVariant)).resolves.toBe('# Direct readme');
    });
    expect(mocks.backend.getRepositoryReadme).not.toHaveBeenCalled();
    expect(mocks.getRepositoryReadme).toHaveBeenCalledWith('owner', 'repo', expect.any(AbortSignal));
  });

  it('falls back to GitHub after a backend failure and warns', async () => {
    mocks.backend.getRepositoryReadme.mockRejectedValue(new Error('backend boom'));
    mocks.getRepositoryReadme.mockResolvedValue('# Fallback readme');
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(defaultVariant)).resolves.toBe('# Fallback readme');
    });
    expect(warnSpy).toHaveBeenCalledWith('Falling back to direct GitHub README fetch after backend failure:', expect.any(Error));
    expect(mocks.getRepositoryReadme).toHaveBeenCalledTimes(1);
  });

  it('throws the verbatim message when neither backend nor token is available', async () => {
    mocks.backend.isAvailable = false;
    storeState.githubToken = null;
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(defaultVariant)).rejects.toThrow('未登录且后端不可用，无法加载 README');
    });
    expect(mocks.getRepositoryReadme).not.toHaveBeenCalled();
  });

  it('uses the path variant against the backend and GitHub respectively', async () => {
    const pathVariant: ReadmeVariant = { ...DEFAULT_README_VARIANT, key: 'readme-zh', path: 'README.zh.md', isDefault: false };
    mocks.backend.getRepositoryReadmeByPath.mockResolvedValueOnce('# backend path');
    mocks.getRepositoryReadmeByPath.mockResolvedValueOnce('# github path');

    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(pathVariant)).resolves.toBe('# backend path');
    });
    expect(mocks.backend.getRepositoryReadmeByPath).toHaveBeenCalledWith('owner', 'repo', 'README.zh.md', expect.any(AbortSignal));

    mocks.backend.getRepositoryReadmeByPath.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await expect(result.current.fetchReadmeContent(pathVariant)).resolves.toBe('# github path');
    });
    expect(mocks.getRepositoryReadmeByPath).toHaveBeenCalledWith('owner', 'repo', 'README.zh.md', expect.any(AbortSignal));
  });

  it('rejects with an AbortError-named error when cancelled after the backend resolves', async () => {
    let resolveBackend!: (value: string) => void;
    mocks.backend.getRepositoryReadme.mockImplementation(() => new Promise<string>((resolve) => {
      resolveBackend = resolve;
    }));
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));

    let pending!: Promise<string>;
    act(() => {
      pending = result.current.fetchReadmeContent(defaultVariant);
    });
    act(() => {
      result.current.cancel();
    });
    resolveBackend('# stale');
    await act(async () => {
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
  });

  it('aborts the previous content request when a new one starts', async () => {
    const signals: AbortSignal[] = [];
    mocks.backend.getRepositoryReadme.mockImplementation((_owner: string, _name: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<string>(() => undefined);
    });
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));

    act(() => {
      void result.current.fetchReadmeContent(defaultVariant);
    });
    act(() => {
      void result.current.fetchReadmeContent(defaultVariant);
    });

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});

describe('useReadmeFetch.fetchReadmeCandidates', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    storeState = createStoreState();
    mocks.shouldBypassBackend.mockReturnValue(false);
    mocks.backend.isAvailable = true;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns candidates from the backend when available', async () => {
    const candidates = [{ name: 'README.zh-CN.md', path: 'README.zh-CN.md' }];
    mocks.backend.listRepositoryReadmeCandidates.mockResolvedValue(candidates);
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeCandidates('main')).resolves.toBe(candidates);
    });
    expect(mocks.backend.listRepositoryReadmeCandidates).toHaveBeenCalledWith('owner', 'repo', 'main', expect.any(AbortSignal));
  });

  it('falls back to GitHub after a backend failure and warns with the variant-detection message', async () => {
    mocks.backend.listRepositoryReadmeCandidates.mockRejectedValue(new Error('boom'));
    mocks.listRepositoryReadmeCandidates.mockResolvedValue([]);
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeCandidates('main')).resolves.toEqual([]);
    });
    expect(warnSpy).toHaveBeenCalledWith('Falling back to direct GitHub README variant detection after backend failure:', expect.any(Error));
  });

  it('returns an empty list instead of throwing when tokenless on the GitHub path', async () => {
    mocks.backend.isAvailable = false;
    storeState.githubToken = null;
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));
    await act(async () => {
      await expect(result.current.fetchReadmeCandidates('main')).resolves.toEqual([]);
    });
    expect(mocks.listRepositoryReadmeCandidates).not.toHaveBeenCalled();
  });

  it('cancel aborts the in-flight candidates request', async () => {
    const signals: AbortSignal[] = [];
    mocks.backend.listRepositoryReadmeCandidates.mockImplementation((_o: string, _n: string, _b: string | undefined, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise(() => undefined);
    });
    const { result } = renderHook(() => useReadmeFetch({ owner: 'owner', name: 'repo' }));

    act(() => {
      void result.current.fetchReadmeCandidates('main');
    });
    expect(signals[0].aborted).toBe(false);
    act(() => {
      result.current.cancel();
    });
    expect(signals[0].aborted).toBe(true);
  });
});

describe('pickReadmeCandidate', () => {
  const variantA: ReadmeVariant = { ...DEFAULT_README_VARIANT, key: 'a' };
  const variantB: ReadmeVariant = { ...DEFAULT_README_VARIANT, key: 'b' };

  it('returns the variant matching the selected key', () => {
    expect(pickReadmeCandidate([variantA, variantB], 'b', variantA)).toBe(variantB);
  });

  it('falls back to the default variant for unknown or missing keys', () => {
    expect(pickReadmeCandidate([variantA, variantB], 'missing', variantA)).toBe(variantA);
    expect(pickReadmeCandidate([variantA, variantB], undefined, variantB)).toBe(variantB);
  });
});
