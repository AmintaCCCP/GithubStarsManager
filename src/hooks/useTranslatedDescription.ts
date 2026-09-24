import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { translateText } from '../services/translateService';
import { isLikelySameLanguage } from '../utils/textLanguage';
import type { AppLanguage } from '../i18n/languages';

/**
 * 卡片仓库描述的自动翻译（设置 - AI 配置 - 翻译引擎 - 自动翻译仓库描述）。
 *
 * 开关开启时，把与界面语言不同的原始描述翻译成界面语言展示；翻译进行中、
 * 翻译失败或描述本就是界面语言时回退显示原文。结果按「目标语言:原文」
 * 做会话级缓存，同一文本整个应用内只翻译一次；开关关闭时返回 undefined，
 * 调用方直接回退原文。
 */

/** 同一时刻最多并发的翻译请求数：列表页几十张卡片同时挂载也不能打满翻译端点。 */
export const MAX_CONCURRENT_TRANSLATIONS = 4;

let activeTranslations = 0;
const waitingQueue: Array<() => void> = [];

const acquireSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeTranslations < MAX_CONCURRENT_TRANSLATIONS) {
      activeTranslations += 1;
      resolve();
      return;
    }
    // 排队等待：回调只负责唤醒；槽位由 releaseSlot 直接转交，不重复计数。
    waitingQueue.push(() => {
      resolve();
    });
  });

const releaseSlot = (): void => {
  const next = waitingQueue.shift();
  if (next) {
    // 槽位转交：结束方与接手方一一对应，activeTranslations 保持不变。
    next();
  } else {
    activeTranslations -= 1;
  }
};

/** 会话级缓存：key 为 `${目标语言}:${原文}`，value 为最终展示文本（同语言/失败时即原文）。 */
const MAX_RESOLVED_CACHE_ENTRIES = 2000;
const resolvedCache = new Map<string, string>();
/** 进行中的请求去重：同一文本的并发挂载卡片共享同一个 Promise。 */
const inflightRequests = new Map<string, Promise<string>>();

const cacheKey = (text: string, language: string): string => `${language}:${text}`;

const requestTranslation = (text: string, language: AppLanguage, key: string): Promise<string> => {
  const promise = (async (): Promise<string> => {
    try {
      await acquireSlot();
      if (isLikelySameLanguage(text, language)) {
        return text;
      }
      const result = await translateText({ text, to: language, textType: 'plain' });
      return result.translatedText?.trim() ? result.translatedText : text;
    } catch {
      // 翻译失败（网络 / 引擎未配置等）回退原文；缓存住避免滚动列表时反复重试。
      return text;
    } finally {
      releaseSlot();
    }
  })();
  inflightRequests.set(key, promise);
  void promise.then((value) => {
    if (!resolvedCache.has(key) && resolvedCache.size >= MAX_RESOLVED_CACHE_ENTRIES) {
      const oldest = resolvedCache.keys().next().value;
      if (oldest !== undefined) resolvedCache.delete(oldest);
    }
    resolvedCache.set(key, value);
    inflightRequests.delete(key);
  });
  return promise;
};

/** 译文与其缓存 key 绑定保存，渲染期校验 key 匹配后才返回译文。 */
interface TranslationState {
  key: string;
  value: string;
}

/**
 * 返回当前应展示的翻译文本；`undefined` 表示本次渲染没有可用的译文，
 * 调用方应显示原始描述。
 */
export const useTranslatedDescription = (
  text: string | null | undefined
): string | undefined => {
  const enabled = useAppStore((state) => state.autoTranslateRepoDescription);
  const language = useAppStore((state) => state.language);

  const shouldTranslate = Boolean(enabled && text && text.trim() !== '');
  const key = shouldTranslate && text ? cacheKey(text, language) : null;

  // 译文绑定 key：key 变化后的首次渲染（effect 尚未重跑）不能把旧 key 的
  // 译文显示给新 key（卡片复用换了仓库、切换界面语言的场景）。
  const [translation, setTranslation] = useState<TranslationState | null>(() => {
    if (!key || !text) return null;
    const cached = resolvedCache.get(key);
    return cached !== undefined && cached !== text ? { key, value: cached } : null;
  });

  useEffect(() => {
    if (!key || !text) {
      setTranslation(null);
      return;
    }
    const cached = resolvedCache.get(key);
    if (cached !== undefined) {
      setTranslation(cached !== text ? { key, value: cached } : null);
      return;
    }
    setTranslation(null);
    let cancelled = false;
    const pending = inflightRequests.get(key) ?? requestTranslation(text, language, key);
    void pending.then((value) => {
      if (!cancelled) {
        setTranslation(value !== text ? { key, value } : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, text, language]);

  return translation && translation.key === key ? translation.value : undefined;
};
