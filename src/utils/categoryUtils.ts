import { Category, Repository } from '../types';

/**
 * 获取AI推断的分类
 * 基于AI标签匹配分类关键词
 */
export const getAICategory = (repo: Repository, allCategories: Category[]): string => {
  if (!repo.ai_tags || repo.ai_tags.length === 0) return '';

  for (const category of allCategories) {
    if (category.id === 'all') continue;

    const hasMatch = repo.ai_tags.some(tag =>
      category.keywords.some(keyword =>
        tag.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(tag.toLowerCase())
      )
    );

    if (hasMatch) {
      return category.name;
    }
  }
  return '';
};

/**
 * 获取默认分类（基于仓库信息传统匹配）
 */
export const getDefaultCategory = (repo: Repository, allCategories: Category[]): string => {
  for (const category of allCategories) {
    if (category.id === 'all') continue;

    const repoText = [
      repo.name,
      repo.description || '',
      repo.language || '',
      ...(repo.topics || []),
      repo.ai_summary || ''
    ].join(' ').toLowerCase();

    const hasMatch = category.keywords.some(keyword =>
      repoText.includes(keyword.toLowerCase())
    );

    if (hasMatch) {
      return category.name;
    }
  }
  return '';
};

/**
 * 计算应该保存的自定义分类值
 * 核心逻辑：当设置的分类与AI推断或默认匹配一致时，清除自定义分类标记
 *
 * @param categoryName - 要设置的分类名称
 * @param aiCategory - AI推断的分类名称
 * @param defaultCategory - 默认匹配的分类名称
 * @returns 应该保存的自定义分类值：undefined（清除自定义标记）、空字符串（明确清空）或分类名称
 */
export const computeCustomCategory = (
  categoryName: string,
  aiCategory: string | undefined,
  defaultCategory: string | undefined
): string | undefined => {
  // 如果分类为空，保存为空字符串（明确清空）
  if (categoryName === '') {
    return '';
  }
  // 如果与AI分类一致，清除自定义分类（移除自定义标记）
  if (categoryName === aiCategory) {
    return undefined;
  }
  // 如果与默认分类一致，清除自定义分类（移除自定义标记）
  if (categoryName === defaultCategory) {
    return undefined;
  }
  // 否则保存为自定义分类
  return categoryName;
};

export const resolveCategoryAssignment = (
  repository: Repository,
  aiTags: string[] | undefined,
  allCategories: Category[]
): string | undefined => {
  // 验证分类是否仍然有效（存在于当前分类列表中）
  const isValidCategory = (categoryName: string | undefined): boolean => {
    if (!categoryName) return false;
    return allCategories.some(cat => cat.name === categoryName);
  };

  // 如果分类被锁定且自定义分类仍然有效，保持当前分类
  if (repository.category_locked && isValidCategory(repository.custom_category)) {
    return repository.custom_category;
  }

  const normalizedTags = Array.isArray(aiTags) ? aiTags.filter(Boolean) : [];
  if (normalizedTags.length === 0) {
    // 如果没有AI标签，但分类被锁定且自定义分类有效，保持当前分类
    return (repository.category_locked && isValidCategory(repository.custom_category))
      ? repository.custom_category
      : undefined;
  }

  const customCategories = allCategories.filter(category => category.id !== 'all' && category.isCustom);
  const defaultCategories = allCategories.filter(category => category.id !== 'all' && !category.isCustom);

  const matchCategory = (categories: Category[]) => categories.find(category =>
    normalizedTags.some(tag =>
      category.name.toLowerCase() === tag.toLowerCase() ||
      category.keywords.some(keyword =>
        tag.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(tag.toLowerCase())
      )
    )
  );

  const customMatch = matchCategory(customCategories);
  if (customMatch) return customMatch.name;

  const defaultMatch = matchCategory(defaultCategories);
  if (defaultMatch) return undefined;

  // 如果没有匹配到任何分类，但分类被锁定且自定义分类有效，保持当前分类
  return (repository.category_locked && isValidCategory(repository.custom_category))
    ? repository.custom_category
    : undefined;
};
