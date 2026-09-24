import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CONCURRENT_TRANSLATIONS, useTranslatedDescription } from './useTranslatedDescription';

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

// 更深的微任务冲刷：覆盖 排队→唤醒→发请求→结算 的多跳链路。
const drain = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
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

  it('does not flash the previous text\'s translation during the re-render commit', async () => {
    setStore({ autoTranslateRepoDescription: true });
    mocks.translateText.mockImplementation(async ({ text }: { text: string }) => ({
      translatedText: `译文:${text}`,
      detectedLanguage: 'en',
    }));

    // 渲染期探针：记录每次 render 返回的值（act 冲刷 effect 前的那次渲染
    // 也在其中），从而能观测到「旧译文短暂显示给新 key」的缺陷。
    const seen: Array<string | undefined> = [];
    const { result, rerender } = renderHook(({ text }) => {
      const value = useTranslatedDescription(text);
      seen.push(value);
      return value;
    }, { initialProps: { text: 'First repository description' } });
    await flushTranslation();
    expect(result.current).toBe('译文:First repository description');

    seen.length = 0;
    rerender({ text: 'Second repository description' });
    // 旧译文不允许出现在换文后的任何渲染帧中
    expect(seen).not.toContain('译文:First repository description');
    await flushTranslation();
    expect(result.current).toBe('译文:Second repository description');
  });

  it('deduplicates concurrent mounts of the same text into a single request', async () => {
    setStore({ autoTranslateRepoDescription: true });
    let resolveTranslation: (r: { translatedText: string; detectedLanguage: string }) => void = () => {};
    mocks.translateText.mockImplementation(
      () => new Promise((resolve) => {
        resolveTranslation = resolve;
      }));

    const first = renderHook(() => useTranslatedDescription('Duplicated description text'));
    const second = renderHook(() => useTranslatedDescription('Duplicated description text'));
    await drain();

    expect(mocks.translateText).toHaveBeenCalledTimes(1);

    resolveTranslation({ translatedText: '去重后的译文', detectedLanguage: 'en' });
    await drain();
    expect(first.result.current).toBe('去重后的译文');
    expect(second.result.current).toBe('去重后的译文');
  });

  it('keeps translating new texts after a full queue wave (no concurrency-slot leak)', async () => {
    setStore({ autoTranslateRepoDescription: true });
    const resolvers: Array<() => void> = [];
    mocks.translateText.mockImplementation((options: { text: string }) =>
      new Promise<{ translatedText: string; detectedLanguage: string }>((resolve) => {
        resolvers.push(() => resolve({ translatedText: `译文:${options.text}`, detectedLanguage: 'en' }));
      }));

    const total = MAX_CONCURRENT_TRANSLATIONS * 2;
    const hooks = Array.from({ length: total }, (_, i) =>
      renderHook(() => useTranslatedDescription(`Batch description number ${i}`)));

    await drain();
    expect(mocks.translateText).toHaveBeenCalledTimes(MAX_CONCURRENT_TRANSLATIONS);

    // 释放首批，槽位转交给排队中的请求
    resolvers.splice(0).forEach((resolve) => resolve());
    await drain();
    resolvers.splice(0).forEach((resolve) => resolve());
    await drain();

    expect(mocks.translateText).toHaveBeenCalledTimes(total);
    hooks.forEach((hook, i) => {
      expect(hook.result.current).toBe(`译文:Batch description number ${i}`);
    });

    // 整波完成后新原文仍能获得翻译（槽位计数泄漏会导致这里永久卡死）
    const next = renderHook(() => useTranslatedDescription('Brand new description after the wave'));
    await drain();
    expect(mocks.translateText).toHaveBeenCalledTimes(total + 1);
    resolvers.splice(0).forEach((resolve) => resolve());
    await drain();
    await waitFor(() => {
      expect(next.result.current).toBe('译文:Brand new description after the wave');
    });
  });
});
