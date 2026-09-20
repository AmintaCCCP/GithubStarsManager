import { de, enUS, es, fr, ja, ko, ptBR, ru, zhCN, zhTW } from 'date-fns/locale';
import type { Locale } from 'date-fns';
import { languageDefinition, type AppLanguage } from './languages';

/** date-fns locale 映射：语言切换时日期相对时间/格式跟随 UI 语言。 */
export function getDateFnsLocale(language: AppLanguage): Locale {
  switch (language) {
    case 'zh':
      return zhCN;
    case 'zh-TW':
      return zhTW;
    case 'en':
      return enUS;
    case 'ja':
      return ja;
    case 'es':
      return es;
    case 'pt-BR':
      return ptBR;
    case 'ru':
      return ru;
    case 'fr':
      return fr;
    case 'de':
      return de;
    case 'ko':
      return ko;
  }
}

/** Intl 用的 BCP 47 tag。 */
export const getIntlLocale = (language: AppLanguage): string => languageDefinition(language).intlLocale;

/** 按当前语言格式化数字（替代无 locale 的裸 toLocaleString）。 */
export const formatNumber = (value: number, language: AppLanguage): string =>
  value.toLocaleString(getIntlLocale(language));

/** 按当前语言格式化日期（替代无 locale 的裸 toLocaleDateString）。 */
export const formatDate = (
  date: Date | number,
  language: AppLanguage,
  options?: Intl.DateTimeFormatOptions,
): string =>
  new Intl.DateTimeFormat(getIntlLocale(language), options ?? { dateStyle: 'medium' }).format(date);
