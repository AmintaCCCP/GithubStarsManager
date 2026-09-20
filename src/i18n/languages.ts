/**
 * 应用支持的语言注册表。`zh` / `en` 是历史持久化值（保持不变以保证老用户
 * 数据无需迁移），其余为 i18n 扩展语言。语言代码同时作为 i18next 的语言键
 * 与 `src/locales/{code}/` 目录名。
 */
export type AppLanguage = 'zh' | 'en' | 'ja' | 'es' | 'pt-BR' | 'ru' | 'zh-TW' | 'fr' | 'de' | 'ko';

export interface LanguageDefinition {
  code: AppLanguage;
  /** 语言自称，用于语言选择器展示 */
  nativeName: string;
  /** 英文名，用于 AI 输出语言指令等场景 */
  englishName: string;
  /** BCP 47 tag，用于 <html lang> 与 Intl 格式化 */
  intlLocale: string;
}

export const APP_LANGUAGES: LanguageDefinition[] = [
  { code: 'zh', nativeName: '中文', englishName: 'Simplified Chinese', intlLocale: 'zh-CN' },
  { code: 'en', nativeName: 'English', englishName: 'English', intlLocale: 'en' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', intlLocale: 'ja' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', intlLocale: 'es' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)', englishName: 'Brazilian Portuguese', intlLocale: 'pt-BR' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', intlLocale: 'ru' },
  { code: 'zh-TW', nativeName: '繁體中文', englishName: 'Traditional Chinese', intlLocale: 'zh-TW' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', intlLocale: 'fr' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', intlLocale: 'de' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', intlLocale: 'ko' },
];

export const DEFAULT_LANGUAGE: AppLanguage = 'zh';
export const FALLBACK_LANGUAGE: AppLanguage = 'en';

const LANGUAGE_BY_CODE = new Map(APP_LANGUAGES.map((definition) => [definition.code, definition]));

export const isAppLanguage = (value: unknown): value is AppLanguage =>
  typeof value === 'string' && LANGUAGE_BY_CODE.has(value as AppLanguage);

export const languageDefinition = (code: AppLanguage): LanguageDefinition =>
  LANGUAGE_BY_CODE.get(code) ?? LANGUAGE_BY_CODE.get(DEFAULT_LANGUAGE)!;

/**
 * 首次安装（无持久化语言）时的默认语言检测。仅影响新安装，老用户始终读取
 * 持久化值。命中支持列表 → 该语言；未命中（如 it-IT/sv-SE）→ 英文回退，
 * 让非中英文用户首屏即可读。无 navigator 的环境回退简体中文（历史默认）。
 */
const LANGUAGE_MATCHERS: Array<[AppLanguage, RegExp]> = [
  // zh-TW 必须显式带地区/文字后缀；'zh'/'zh-CN'/'zh-Hans' 落到简体
  ['zh-TW', /^zh[-_](?:tw|hk|mo|hant)\b/i],
  ['ja', /^ja\b/i],
  ['ko', /^ko\b/i],
  ['ru', /^ru\b/i],
  ['fr', /^fr\b/i],
  ['de', /^de\b/i],
  ['es', /^es\b/i],
  ['pt-BR', /^pt\b/i],
  ['en', /^en\b/i],
  ['zh', /^zh\b/i],
];

export const detectInitialLanguage = (): AppLanguage => {
  if (typeof navigator === 'undefined') return DEFAULT_LANGUAGE;
  const candidates = [
    navigator.language,
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const matched = LANGUAGE_MATCHERS.find(([, pattern]) => pattern.test(candidate));
    if (matched) return matched[0];
  }
  return FALLBACK_LANGUAGE;
};
