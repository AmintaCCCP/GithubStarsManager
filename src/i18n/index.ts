import i18next, { type i18n as I18nInstance } from 'i18next';
import {
  APP_LANGUAGES,
  FALLBACK_LANGUAGE,
  isAppLanguage,
  languageDefinition,
  type AppLanguage,
} from './languages';

/**
 * i18next 初始化。语言包经 import.meta.glob 懒加载（每个语言独立 chunk，
 * 不占主包预算）；zustand 的 `language` 是唯一事实源，本模块只负责资源
 * 装载与语言切换副作用。
 */
export const I18N_NAMESPACES = [
  'common',
  'app',
  'login',
  'repositories',
  'gists',
  'releases',
  'discovery',
  'chat',
  'search',
  'plugins',
  'settings',
  'ai',
  'services',
  'errors',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

const localeModules = import.meta.glob<{ default: Record<string, unknown> }>('../locales/*/*.json');

const loadedLanguages = new Set<AppLanguage>();

void i18next.init({
  lng: FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  resources: {},
  partialBundledLanguages: true,
  interpolation: { escapeValue: false },
  returnEmptyString: false,
});

/** 装载某语言的全部命名空间资源（幂等）。 */
export async function ensureLanguageLoaded(language: AppLanguage): Promise<void> {
  if (loadedLanguages.has(language)) return;
  const prefix = `/locales/${language}/`;
  const entries = Object.entries(localeModules).filter(([filePath]) => filePath.includes(prefix));
  await Promise.all(
    entries.map(async ([filePath, loader]) => {
      const namespace = filePath.slice(filePath.lastIndexOf('/') + 1).replace(/\.json$/, '');
      if (!(I18N_NAMESPACES as readonly string[]).includes(namespace)) return;
      const module = await loader();
      i18next.addResourceBundle(language, namespace, module.default, true, true);
    }),
  );
  loadedLanguages.add(language);
}

/** 同步读取当前已装载语言（供 React 外的调用方使用）。 */
export function getCurrentAppLanguage(): AppLanguage {
  const current = i18next.language;
  return isAppLanguage(current) ? current : FALLBACK_LANGUAGE;
}

/**
 * 切换应用语言：装载目标语言与回退语言包 → 切换 i18next → 更新 <html lang>。
 * 由 App 的 language 副作用调用；zustand 仍是事实源。
 */
let languageSwitchSeq = 0;

export async function changeAppLanguage(language: AppLanguage): Promise<void> {
  const requestId = ++languageSwitchSeq;
  await Promise.all([ensureLanguageLoaded(language), ensureLanguageLoaded(FALLBACK_LANGUAGE)]);
  // 快速连续切换时仅应用最后一次请求，避免旧请求晚到覆盖新语言
  if (requestId !== languageSwitchSeq) return;
  await i18next.changeLanguage(language);
  if (requestId !== languageSwitchSeq) return;
  document.documentElement.lang = languageDefinition(language).intlLocale;
}

export const i18n: I18nInstance = i18next;

export { APP_LANGUAGES };
export * from './languages';
