import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTranslatedDescription } from './useTranslatedDescription';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  translateText: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../services/translateService', () => ({
  translateText: mocks.translateText,
}));

interface StoreState {
  autoTranslateRepoDescription: boolean;
  language: string;
}

let storeState: StoreState;
const mockUseAppStore = vi.mocked(mocks.useAppStore);
mockUseAppStore.mockImplementation((selector?: (state: StoreState) => unknown) =>
  selector ? selector(storeState) : storeState);

const setStore = (patch?: Partial<StoreState>) => {
  storeState = { autoTranslateRepoDescription: false, language: 'zh', ...patch };
};

// hook 使用模块级缓存，各用例用不同原文避免相互污染。
const flushTranslation = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  // clearAllMocks 不清除实现，显式 reset 翻译 mock 保证用例互不污染。
  mocks.translateText.mockReset();
  vi.clearAllMocks();
  setStore();
});

describe('useTranslatedDescription', () => {
  it('returns undefined (show original) when the toggle is off', () => {
    setStore({ autoTranslateRepoDescription: false });
    const { result } = renderHook(() => useTranslatedDescription('A fast build tool'));
    expect(result.current).toBeUndefined();
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it('returns undefined for empty descriptions even when enabled', () => {
    setStore({ autoTranslateRepoDescription: true });
    const { result } = renderHook(() => useTranslatedDescription(''));
    expect(result.current).toBeUndefined();
    expect(mocks.translateText).not.toHaveBeenCalled();
  });

  it('translates a description that differs from the interface language', async () => {
    setStore({ autoTranslateRepoDescription: true });
    mocks.translateText.mockResolvedValue({ translatedText: '一个快速的构建工具', detectedLanguage: 'en' });

    const { result } = renderHook(() => useTranslatedDescription('A fast build tool'));
    // 翻译完成前先显示原文（undefined = 回退原文）。
    expect(result.current).toBeUndefined();

    await flushTranslation();
    expect(mocks.translateText).toHaveBeenCalledWith({
      text: 'A fast build tool',
      to: 'zh',
      textType: 'plain',
    });
    expect(result.current).toBe('一个快速的构建工具');
  });

  it('keeps the original text when translation fails', async () => {
    setStore({ autoTranslateRepoDescription: true });
    mocks.translateText.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useTranslatedDescription('A failing build tool'));
    await flushTranslation();
    expect(mocks.translateText).toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it('never calls the engine for descriptions already in the interface language', async () => {
    setStore({ autoTranslateRepoDescription: true });
    const { result } = renderHook(() => useTranslatedDescription('一个基于 React 的状态管理库'));
    await flushTranslation();
    expect(mocks.translateText).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });

  it('reuses the cached translation for repeated texts without new requests', async () => {
    setStore({ autoTranslateRepoDescription: true });
    mocks.translateText.mockResolvedValue({ translatedText: '一个快速的构建工具', detectedLanguage: 'en' });

    const first = renderHook(() => useTranslatedDescription('A cached build tool'));
    await flushTranslation();
    expect(first.result.current).toBe('一个快速的构建工具');

    const second = renderHook(() => useTranslatedDescription('A cached build tool'));
    expect(second.result.current).toBe('一个快速的构建工具');
    expect(mocks.translateText).toHaveBeenCalledTimes(1);
  });

  it('falls back to the original text immediately after the toggle is switched off', async () => {
    setStore({ autoTranslateRepoDescription: true });
    mocks.translateText.mockResolvedValue({ translatedText: '一个快速的构建工具', detectedLanguage: 'en' });

    const { result, rerender } = renderHook(({ text }) => useTranslatedDescription(text), {
      initialProps: { text: 'A toggled build tool' },
    });
    await flushTranslation();
    expect(result.current).toBe('一个快速的构建工具');

    setStore({ autoTranslateRepoDescription: false });
    rerender({ text: 'A toggled build tool' });
    expect(result.current).toBeUndefined();
  });

  it('re-translates when the interface language changes', async () => {
    setStore({ autoTranslateRepoDescription: true, language: 'zh' });
    mocks.translateText.mockImplementation(async ({ to }: { to: string }) => ({
      translatedText: to === 'zh' ? '一个快速的构建工具' : '高速ビルドツール',
      detectedLanguage: 'en',
    }));

    const { result, rerender } = renderHook(({ text }) => useTranslatedDescription(text), {
      initialProps: { text: 'A localized build tool' },
    });
    await flushTranslation();
    expect(result.current).toBe('一个快速的构建工具');

    setStore({ autoTranslateRepoDescription: true, language: 'ja' });
    rerender({ text: 'A localized build tool' });
    await flushTranslation();
    expect(result.current).toBe('高速ビルドツール');
    expect(mocks.translateText).toHaveBeenCalledTimes(2);
  });
});
