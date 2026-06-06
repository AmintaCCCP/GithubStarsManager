export interface GitHubReadmeCandidateItem {
  name?: string;
  path: string;
  type?: string;
}

export interface ReadmeVariant {
  key: string;
  name: string;
  path: string | null;
  label: string;
  languageCode?: string;
  isDefault: boolean;
}

const README_FILE_REGEX = /^README(?:[._-]([A-Za-z]{2,3}(?:[-_][A-Za-z0-9]+)?))?\.(md|markdown|mdown|mkdn)$/i;

const LANGUAGE_LABELS: Record<string, { zh: string; en: string }> = {
  ar: { zh: '阿拉伯语', en: 'Arabic' },
  bg: { zh: '保加利亚语', en: 'Bulgarian' },
  cs: { zh: '捷克语', en: 'Czech' },
  da: { zh: '丹麦语', en: 'Danish' },
  de: { zh: '德语', en: 'German' },
  el: { zh: '希腊语', en: 'Greek' },
  en: { zh: '英语', en: 'English' },
  es: { zh: '西班牙语', en: 'Spanish' },
  fi: { zh: '芬兰语', en: 'Finnish' },
  fr: { zh: '法语', en: 'French' },
  he: { zh: '希伯来语', en: 'Hebrew' },
  hi: { zh: '印地语', en: 'Hindi' },
  hu: { zh: '匈牙利语', en: 'Hungarian' },
  id: { zh: '印尼语', en: 'Indonesian' },
  it: { zh: '意大利语', en: 'Italian' },
  ja: { zh: '日语', en: 'Japanese' },
  ko: { zh: '韩语', en: 'Korean' },
  nl: { zh: '荷兰语', en: 'Dutch' },
  no: { zh: '挪威语', en: 'Norwegian' },
  pl: { zh: '波兰语', en: 'Polish' },
  pt: { zh: '葡萄牙语', en: 'Portuguese' },
  'pt-br': { zh: '葡萄牙语（巴西）', en: 'Portuguese (Brazil)' },
  ro: { zh: '罗马尼亚语', en: 'Romanian' },
  ru: { zh: '俄语', en: 'Russian' },
  sv: { zh: '瑞典语', en: 'Swedish' },
  th: { zh: '泰语', en: 'Thai' },
  tr: { zh: '土耳其语', en: 'Turkish' },
  uk: { zh: '乌克兰语', en: 'Ukrainian' },
  vi: { zh: '越南语', en: 'Vietnamese' },
  zh: { zh: '中文', en: 'Chinese' },
  cn: { zh: '中文', en: 'Chinese' },
  'zh-cn': { zh: '简体中文', en: 'Simplified Chinese' },
  'zh-hans': { zh: '简体中文', en: 'Simplified Chinese' },
  'zh-tw': { zh: '繁体中文', en: 'Traditional Chinese' },
  'zh-hant': { zh: '繁体中文', en: 'Traditional Chinese' },
};

const COMMON_LANGUAGE_ORDER = [
  'en', 'zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'pt-br', 'ru', 'it', 'tr', 'vi', 'id',
];

export const DEFAULT_README_VARIANT: ReadmeVariant = {
  key: 'default',
  name: 'README',
  path: null,
  label: 'Default README',
  isDefault: true,
};

const getFileName = (path: string, fallback?: string): string => {
  if (fallback) return fallback;
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
};

const normalizeLanguageCode = (code: string): string => code.toLowerCase().replace(/_/g, '-');

const getLanguageLabel = (languageCode: string, uiLanguage: 'zh' | 'en'): string => {
  const normalized = normalizeLanguageCode(languageCode);
  const exact = LANGUAGE_LABELS[normalized];
  if (exact) return exact[uiLanguage];

  const baseCode = normalized.split('-')[0];
  const base = LANGUAGE_LABELS[baseCode];
  if (base) {
    const region = normalized.split('-').slice(1).join('-').toUpperCase();
    return region ? `${base[uiLanguage]} (${region})` : base[uiLanguage];
  }

  return normalized;
};

const getLanguagePriority = (languageCode: string | undefined, uiLanguage: 'zh' | 'en'): number => {
  if (!languageCode) return 999;
  const normalized = normalizeLanguageCode(languageCode);
  const currentLanguagePriority = uiLanguage === 'zh'
    ? ['zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'cn', 'en']
    : ['en', 'zh', 'zh-cn', 'zh-hans', 'zh-tw', 'zh-hant', 'cn'];

  const currentIndex = currentLanguagePriority.indexOf(normalized);
  if (currentIndex >= 0) return currentIndex;

  const commonIndex = COMMON_LANGUAGE_ORDER.indexOf(normalized);
  if (commonIndex >= 0) return currentLanguagePriority.length + commonIndex;

  const baseIndex = COMMON_LANGUAGE_ORDER.indexOf(normalized.split('-')[0]);
  if (baseIndex >= 0) return currentLanguagePriority.length + COMMON_LANGUAGE_ORDER.length + baseIndex;

  return 998;
};

export const isReadmeCandidateItem = (item: GitHubReadmeCandidateItem): boolean => {
  const type = item.type?.toLowerCase();
  if (type && type !== 'file' && type !== 'blob') return false;
  return README_FILE_REGEX.test(getFileName(item.path, item.name));
};

export const buildReadmeVariants = (
  items: GitHubReadmeCandidateItem[],
  uiLanguage: 'zh' | 'en'
): ReadmeVariant[] => {
  const defaultVariant: ReadmeVariant = {
    ...DEFAULT_README_VARIANT,
    label: uiLanguage === 'zh' ? '默认 README' : 'Default README',
  };

  const seenPaths = new Set<string>();
  const variants = items
    .filter(isReadmeCandidateItem)
    .map((item): ReadmeVariant | null => {
      const name = getFileName(item.path, item.name);
      const match = name.match(README_FILE_REGEX);
      const languageCode = match?.[1] ? normalizeLanguageCode(match[1]) : undefined;

      if (!languageCode) return null;

      const path = item.path;
      const pathKey = path.toLowerCase();
      if (seenPaths.has(pathKey)) return null;
      seenPaths.add(pathKey);

      const languageLabel = getLanguageLabel(languageCode, uiLanguage);
      return {
        key: path,
        name,
        path,
        label: `${languageLabel} · ${path}`,
        languageCode,
        isDefault: false,
      };
    })
    .filter((variant): variant is ReadmeVariant => variant !== null)
    .sort((a, b) => {
      const priorityDiff = getLanguagePriority(a.languageCode, uiLanguage) - getLanguagePriority(b.languageCode, uiLanguage);
      if (priorityDiff !== 0) return priorityDiff;
      return a.path!.localeCompare(b.path!, undefined, { sensitivity: 'base' });
    });

  return [defaultVariant, ...variants];
};
