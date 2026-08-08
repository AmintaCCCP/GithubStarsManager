import { Category, CategoryMatchMode, Repository } from '../types';

/**
 * 归一化标签数组：去除前后空白并过滤空白项，避免空白标签匹配任意分类
 */
const normalizeTags = (tags: string[] | undefined): string[] => {
  return (tags || []).map(tag => tag.trim()).filter(tag => tag.length > 0);
};

/**
 * 获取用于分类匹配的有效标签
 * 优先级与卡片展示一致：自定义标签 > AI标签 > Topics。
 * 自定义标签显式清空（空数组）时不视为命中，回落 AI 标签/ Topics。
 */
export const getEffectiveTags = (repo: Repository): string[] => {
  const customTags = normalizeTags(repo.custom_tags);
  if (customTags.length > 0) {
    return customTags;
  }
  const aiTags = normalizeTags(repo.ai_tags);
  if (aiTags.length > 0) {
    return aiTags;
  }
  return normalizeTags(repo.topics);
};

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

/**
 * 归一化分类关键词：去除前后空白并过滤空串，避免空白关键词匹配任意仓库
 */
const getCategoryKeywords = (category: Category): string[] => {
  return (category.keywords || []).map(k => k.trim()).filter(k => k.length > 0);
};

/**
 * 判断某个标签是否命中分类
 * @param matchCategoryName - 是否参与分类名匹配（effective 模式开启，保证自定义标签等于分类名时也能命中）
 */
const tagMatchesCategory = (
  tag: string,
  category: Category,
  matchCategoryName: boolean
): boolean => {
  const tagLower = tag.toLowerCase();
  const keywordMatch = getCategoryKeywords(category).some(keyword =>
    tagLower.includes(keyword.toLowerCase()) ||
    keyword.toLowerCase().includes(tagLower)
  );
  if (keywordMatch) return true;

  if (matchCategoryName) {
    const nameLower = category.name.toLowerCase();
    return nameLower === tagLower ||
      nameLower.includes(tagLower) ||
      tagLower.includes(nameLower);
  }

  return false;
};

export const matchesCategory = (
  repo: Repository,
  category: Category,
  mode: CategoryMatchMode = 'legacy'
): boolean => {
  if (category.id === 'all') return true;

  if (repo.custom_category != null) {
    if (repo.custom_category === '') {
      return false;
    }
    return repo.custom_category === category.name;
  }

  const tags = mode === 'effective' ? getEffectiveTags(repo) : normalizeTags(repo.ai_tags);
  if (tags.length > 0) {
    return tags.some(tag => tagMatchesCategory(tag, category, mode === 'effective' && !!category.isCustom));
  }

  const repoText = [
    repo.name,
    repo.description || '',
    repo.language || '',
    ...(repo.topics || []),
    repo.ai_summary || ''
  ].join(' ').toLowerCase();

  return getCategoryKeywords(category).some(keyword =>
    repoText.includes(keyword.toLowerCase())
  );
};

/**
 * 聚合仓库元数据文本，用于自定义分类的 metadata 兜底匹配
 * 与 matchesCategory 的 repoText 兜底一致，可命中无 AI tags 或 tags 未覆盖的场景
 */
const getRepoText = (repo: Pick<Repository, 'name' | 'description' | 'language' | 'topics' | 'ai_summary' | 'full_name'>): string => {
  return [
    repo.name,
    repo.full_name,
    repo.description || '',
    repo.language || '',
    ...(repo.topics || []),
    repo.ai_summary || '',
  ].join(' ').toLowerCase();
};

/**
 * 构建用于 AI 提示词的自定义分类关键词提示行
 * 格式形如：`skills（Skills,技能）\n命令行工具（cli,CLI）`
 * 让模型在仓库无 topics 时也能识别自定义分类
 */
export const buildCategoryHints = (customCategories: Category[]): string => {
  const lines = customCategories
    .filter(category => category.id !== 'all' && category.isCustom)
    .map(category => {
      const keywords = getCategoryKeywords(category);
      const kwText = keywords.length > 0 ? keywords.join(',') : `(no keywords, match by name: ${category.name})`;
      return `${category.name}（${kwText}）`;
    });
  return lines.join('\n');
};

/**
 * 按仓库元数据（名称/描述/语言/topics/AI摘要）匹配自定义分类
 * 仅针对自定义分类，关键词命中即返回；关键词为空时回退到分类名包含匹配
 */
const matchCustomCategoryByMetadata = (
  customCategories: Category[],
  repository: Pick<Repository, 'name' | 'description' | 'language' | 'topics' | 'ai_summary' | 'full_name'>
): Category | undefined => {
  if (customCategories.length === 0) return undefined;
  const repoText = getRepoText(repository);
  return customCategories.find(category => {
    const keywords = getCategoryKeywords(category);
    const keywordMatch = keywords.length > 0 && keywords.some(keyword => repoText.includes(keyword.toLowerCase()));
    // 无有效关键词时才回退到分类名包含匹配，并保留现有语义
    const nameFallback = keywordMatch === false && keywords.length === 0 && repoText.includes(category.name.toLowerCase());
    return keywordMatch || nameFallback;
  });
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

  // 保留用户已手动设置的分类归属（含显式清空），不被 AI 分析覆盖
  if (repository.custom_category === '' || isValidCategory(repository.custom_category)) {
    return repository.custom_category;
  }

  const normalizedTags = Array.isArray(aiTags) ? normalizeTags(aiTags) : [];

  const customCategories = allCategories.filter(category => category.id !== 'all' && category.isCustom);
  const defaultCategories = allCategories.filter(category => category.id !== 'all' && !category.isCustom);

  // 无 AI 标签时：自定义分类按 metadata 兜底，仍可归类
  if (normalizedTags.length === 0) {
    const customMetaMatch = matchCustomCategoryByMetadata(customCategories, repository);
    if (customMetaMatch) return customMetaMatch.name;
    // 如果没有AI标签，但分类被锁定且自定义分类有效，保持当前分类
    return (repository.category_locked && isValidCategory(repository.custom_category))
      ? repository.custom_category
      : undefined;
  }

  const matchCustomCategory = (categories: Category[]) => categories.find(category => {
    const keywords = getCategoryKeywords(category);
    return normalizedTags.some(tag =>
      category.name.toLowerCase() === tag.toLowerCase() ||
      category.name.toLowerCase().includes(tag.toLowerCase()) ||
      tag.toLowerCase().includes(category.name.toLowerCase()) ||
      keywords.some(keyword =>
        tag.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(tag.toLowerCase())
      )
    );
  });

  const matchDefaultCategory = (categories: Category[]) => categories.find(category => {
    const keywords = getCategoryKeywords(category);
    return normalizedTags.some(tag =>
      category.name.toLowerCase() === tag.toLowerCase() ||
      keywords.some(keyword =>
        tag.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(tag.toLowerCase())
      )
    );
  });

  const customMatch = matchCustomCategory(customCategories);
  if (customMatch) return customMatch.name;

  // metadata 兜底：AI 标签未直接命中自定义分类时，改用仓库元数据匹配自定义分类
  // （自定义分类优先级高于默认分类）
  const customMetaMatch = matchCustomCategoryByMetadata(customCategories, repository);
  if (customMetaMatch) return customMetaMatch.name;

  const defaultMatch = matchDefaultCategory(defaultCategories);
  if (defaultMatch) return undefined;

  // 如果没有匹配到任何分类，但分类被锁定且自定义分类有效，保持当前分类
  return (repository.category_locked && isValidCategory(repository.custom_category))
    ? repository.custom_category
    : undefined;
};
