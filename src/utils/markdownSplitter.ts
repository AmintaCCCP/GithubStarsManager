export const cleanTranslatedText = (text: string): string => {
  if (!text) return text;

  let cleaned = text;

  cleaned = cleaned.replace(/\u200B/g, '');
  cleaned = cleaned.replace(/\u200C/g, '');
  cleaned = cleaned.replace(/\u200D/g, '');
  cleaned = cleaned.replace(/\uFEFF/g, '');
  cleaned = cleaned.replace(/\u00A0/g, ' ');

  cleaned = cleaned.replace(/[\uFF08\uFF09]/g, (match) =>
    match === '\uFF08' ? '(' : ')'
  );
  cleaned = cleaned.replace(/[\uFF3B\uFF3D]/g, (match) =>
    match === '\uFF3B' ? '[' : ']'
  );
  cleaned = cleaned.replace(/\uFF1A/g, ':');
  cleaned = cleaned.replace(/\uFF0C/g, ',');
  cleaned = cleaned.replace(/\uFF1B/g, ';');
  cleaned = cleaned.replace(/\uFF01/g, '!');
  cleaned = cleaned.replace(/\uFF1F/g, '?');
  cleaned = cleaned.replace(/\u3001/g, ',');

  return cleaned;
};

export type DetectedLanguage =
  | 'zh'
  | 'en'
  | 'ja'
  | 'ko'
  | 'fr'
  | 'de'
  | 'es'
  | 'ru'
  | 'pt'
  | 'unknown';

const LANGUAGE_PATTERNS: { lang: DetectedLanguage; regex: RegExp }[] = [
  { lang: 'zh', regex: /[\u4e00-\u9fa5]/g },
  { lang: 'ja', regex: /[\u3040-\u309F\u30A0-\u30FF]/g },
  { lang: 'ko', regex: /[\uAC00-\uD7AF\u1100-\u11FF]/g },
  { lang: 'ru', regex: /[\u0400-\u04FF]/g },
  { lang: 'en', regex: /[a-zA-Z]/g },
];

const LANGUAGE_NAMES: Record<DetectedLanguage, string> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  fr: 'Français',
  de: 'Deutsch',
  es: 'Español',
  ru: 'Русский',
  pt: 'Português',
  unknown: 'Unknown',
};

export const getLanguageName = (lang: DetectedLanguage): string =>
  LANGUAGE_NAMES[lang];

export const detectLanguage = (content: string): DetectedLanguage => {
  const scores: { lang: DetectedLanguage; count: number }[] = [];

  for (const { lang, regex } of LANGUAGE_PATTERNS) {
    const matches = content.match(regex);
    scores.push({ lang, count: matches ? matches.length : 0 });
  }

  scores.sort((a, b) => b.count - a.count);

  const top = scores[0];
  if (!top || top.count === 0) {
    return 'unknown';
  }

  return top.lang;
};

export const isEnglishText = (text: string): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const latinChars = trimmed.match(/[a-zA-Z]/g);
  const cyrillicChars = trimmed.match(/[\u0400-\u04FF]/g);
  const cjkChars = trimmed.match(
    /[\u4e00-\u9fa5\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u1100-\u11FF]/g
  );

  const latinCount = latinChars ? latinChars.length : 0;
  const nonLatinCount =
    (cyrillicChars ? cyrillicChars.length : 0) +
    (cjkChars ? cjkChars.length : 0);

  if (latinCount === 0 && nonLatinCount === 0) return true;
  return latinCount > nonLatinCount;
};

export const getTranslateDirection = (
  detected: DetectedLanguage,
  target: 'zh' | 'en'
): { from?: string; to: string } => {
  if (detected === 'unknown') {
    return { to: target };
  }
  return {
    from: detected,
    to: target,
  };
};
