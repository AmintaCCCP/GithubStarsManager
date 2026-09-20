
import type { AppLanguage } from '../../i18n/languages';
import type { Category } from '../../types';
import { builtinCategoryNameVariants, categoryExtraKeywords, categoryName } from '../../constants/categoryI18n';
import { defaultCategories } from '../schema';

export const sortCategoriesByOrder = (
  categories: Category[],
  categoryOrder: string[]
): Category[] => {
  if (!categoryOrder || categoryOrder.length === 0) {
    return categories;
  }

  const orderMap = new Map(categoryOrder.map((id, index) => [id, index]));

  return [...categories].sort((a, b) => {
    const orderA = orderMap.get(a.id);
    const orderB = orderMap.get(b.id);

    // 如果两个都有顺序，按顺序排序
    if (orderA !== undefined && orderB !== undefined) {
      return orderA - orderB;
    }
    // 如果只有a有顺序，a排在前面
    if (orderA !== undefined) return -1;
    // 如果只有b有顺序，b排在前面
    if (orderB !== undefined) return 1;
    // 都没有顺序，保持原顺序
    return 0;
  });
};

// Helper function to get all categories (default + custom)
export const getAllCategories = (
  customCategories: Category[],
  language: AppLanguage = 'zh',
  hiddenDefaultCategoryIds: string[] = [],
  defaultCategoryOverrides: Record<string, Partial<Category>> = {}
): Category[] => {
  const translatedDefaults = defaultCategories
    .filter(cat => !hiddenDefaultCategoryIds.includes(cat.id))
    .map(cat => {
      const override = defaultCategoryOverrides[cat.id];
      const baseName = language === 'zh' ? cat.name : categoryName(cat.id, language);
      const baseKeywords = [...(cat.keywords ?? []), ...categoryExtraKeywords(cat.id, language)];
      return {
        ...cat,
        name: baseName,
        keywords: baseKeywords,
        ...(override ? { name: override.name ?? baseName, icon: override.icon ?? cat.icon, keywords: override.keywords ?? baseKeywords } : {})
      };
    });

  return [...translatedDefaults, ...customCategories];
};

// Helper function to translate category names
export const translateCategoryName = (zhName: string): string => {
  const translations: Record<string, string> = {
    '全部分类': 'All Categories',
    'Web应用': 'Web Apps',
    '移动应用': 'Mobile Apps',
    '桌面应用': 'Desktop Apps',
    '数据库': 'Database',
    'AI/机器学习': 'AI/Machine Learning',
    '开发工具': 'Development Tools',
    '安全工具': 'Security Tools',
    '游戏': 'Games',
    '设计工具': 'Design Tools',
    '效率工具': 'Productivity Tools',
    '教育学习': 'Education',
    '社交网络': 'Social Network',
    '数据分析': 'Data Analytics'
  };

  return translations[zhName] || zhName;
};

// Helper function to get all possible name variants for a category (original + translated)
export const getCategoryNameVariants = (originalName: string, overrideName?: string): string[] => {
  const variants = new Set<string>([originalName]);

  // 内置分类：加入全部语言的显示名（GitHub List 名称随语言切换自动改名）
  const builtinVariants = builtinCategoryNameVariants(originalName, overrideName);
  for (const variant of builtinVariants) {
    variants.add(variant);
  }

  // Add override name if provided and different
  if (overrideName && overrideName !== originalName) {
    variants.add(overrideName);
  }

  return Array.from(variants);
};
