import { useEffect, useMemo, useReducer } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { i18n } from './index';
import type { I18nNamespace } from './index';

export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

/**
 * 组件级翻译函数：跟随 zustand 的 `language`（唯一事实源）。
 * 替代各组件内自定义的 `t(zh, en)` 局部函数；key 语义见 src/locales。
 */
export function useT(namespace?: I18nNamespace): TranslateFn {
  const language = useAppStore(useShallow((state) => state.language));
  // 语言包懒加载是异步的：store 切换语言时组件会立即重渲染，此时目标语言包
  // 可能尚未装载（临时回退英文）。订阅 i18next 的资源装载/语言切换事件，
  // 语言包就绪后强制重渲染，避免界面停留在回退语言。
  const [, forceUpdate] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const handler = () => forceUpdate();
    i18n.on('languageChanged', handler);
    i18n.store.on('added', handler);
    return () => {
      i18n.off('languageChanged', handler);
      i18n.store.off('added', handler);
    };
  }, []);
  return useMemo(
    () => (key: string, params?: Record<string, unknown>) =>
      i18n.getFixedT(language, namespace ?? 'common')(key, params) as string,
    [language, namespace],
  );
}

/**
 * 非组件环境（services、hooks 之外）按指定语言构造翻译函数。
 * 语言来源由调用方决定（通常是 store.getState().language 或局部语言变量）。
 */
export function makeT(language: string, namespace?: I18nNamespace): TranslateFn {
  return (key: string, params?: Record<string, unknown>) =>
    i18n.getFixedT(language, namespace ?? 'common')(key, params) as string;
}

export type PairTranslateFn = (zh: string, en: string) => string;

/**
 * 过渡期兼容通道：数据驱动的双语标签对（如 labelZh/labelEn 字段、运行时拼装的
 * 消息）暂时无法 key 化，tPair 保持 zh/en 行为不变，非 zh 语言回退英文。
 * 后续把这些标签常量迁入字典后移除。
 */
export function useTPair(): PairTranslateFn {
  const language = useAppStore(useShallow((state) => state.language));
  return useMemo(() => (zh: string, en: string) => (language === 'zh' ? zh : en), [language]);
}

export function makeTPair(language: string): PairTranslateFn {
  return (zh: string, en: string) => (language === 'zh' ? zh : en);
}
