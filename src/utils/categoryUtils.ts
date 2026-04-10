import { Category, Repository } from '../types';

export const resolveCategoryAssignment = (
  repository: Repository,
  aiTags: string[] | undefined,
  allCategories: Category[]
): string | undefined => {
  if (repository.category_locked && repository.custom_category) {
    return repository.custom_category;
  }

  const normalizedTags = Array.isArray(aiTags) ? aiTags.filter(Boolean) : [];
  if (normalizedTags.length === 0) {
    return repository.category_locked ? repository.custom_category : undefined;
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

  return repository.category_locked ? repository.custom_category : undefined;
};
