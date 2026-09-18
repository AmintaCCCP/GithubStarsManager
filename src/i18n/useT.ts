import { useMemo } from 'react';
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
