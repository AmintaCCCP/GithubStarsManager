import type { AppLanguage } from '../i18n/languages';

/**
 * 内置分类的多语言显示名（按稳定 id 键）。`zh` 是规范身份名（schema.defaultCategories
 * 与 GitHub list 历史名一致）；`en` 与旧 translateCategoryName 逐值相等（fixture 锁定）。
 * 其余语言由 AI 初稿生成，欢迎社区校对。
 */
export const CATEGORY_NAMES: Record<string, { zh: string } & Partial<Record<AppLanguage, string>>> = {
  all: { zh: '全部分类', en: 'All Categories' },
  web: { zh: 'Web应用', en: 'Web Apps' },
  mobile: { zh: '移动应用', en: 'Mobile Apps' },
  desktop: { zh: '桌面应用', en: 'Desktop Apps' },
  database: { zh: '数据库', en: 'Database' },
  ai: { zh: 'AI/机器学习', en: 'AI/Machine Learning' },
  devtools: { zh: '开发工具', en: 'Development Tools' },
  security: { zh: '安全工具', en: 'Security Tools' },
  game: { zh: '游戏', en: 'Games' },
  design: { zh: '设计工具', en: 'Design Tools' },
  productivity: { zh: '效率工具', en: 'Productivity Tools' },
  education: { zh: '教育学习', en: 'Education' },
  social: { zh: '社交网络', en: 'Social Network' },
  analytics: { zh: '数据分析', en: 'Data Analytics' },
};

/** 内置分类在某语言的显示名；缺译文回退 en，再回退中文规范名。 */
export const categoryName = (id: string, language: AppLanguage): string => {
  const entry = CATEGORY_NAMES[id];
  if (!entry) return id;
  if (language === 'zh') return entry.zh;
  return entry[language] ?? entry.en ?? entry.zh;
};

/**
 * 内置分类的扩展关键词（按语言补充）。zh/en 关键词已在 schema.defaultCategories
 * 内置，这里只为新语言补充，保证新语言 AI tags 能归入内置分类。
 */
export const CATEGORY_EXTRA_KEYWORDS: Record<string, Partial<Record<AppLanguage, string[]>>> = {
  // commit 5 填充 8 种语言的关键词；zh/en 保持 schema 现值一字不动
};

/** 某内置分类在指定语言下的附加关键词（追加在 schema 关键词之后）。 */
export const categoryExtraKeywords = (id: string, language: AppLanguage): string[] =>
  CATEGORY_EXTRA_KEYWORDS[id]?.[language] ?? [];
