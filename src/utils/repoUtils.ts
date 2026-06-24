import { Repository, Category } from '../types';
import { getAICategory, getDefaultCategory } from './categoryUtils';

/**
 * 判断仓库是否被用户自定义编辑过
 * 逻辑与编辑页面一致：描述、标签、分类任一被修改即视为已编辑
 * 注意：分类锁定不算编辑
 */
export function isRepoCustomized(repo: Repository, allCategories: Category[]): boolean {
  // 描述：有自定义描述标记（包括明确清空），且内容与AI/原始不同
  const hasCustomDesc = repo.custom_description !== undefined;
  const repoDesc = (repo.description || '').trim();
  const aiDesc = (repo.ai_summary || '').trim();
  const customDesc = (repo.custom_description || '').trim();
  const isDescEdited = hasCustomDesc &&
    (customDesc === '' || (customDesc !== repoDesc && customDesc !== aiDesc));

  // 标签：有自定义标签标记（包括明确清空），且内容与AI/Topics不同
  const hasCustomTags = repo.custom_tags !== undefined;
  const aiTags = repo.ai_tags || [];
  const topics = repo.topics || [];
  const customTags = repo.custom_tags || [];
  const isTagsEdited = hasCustomTags &&
    (customTags.length === 0 || (
      JSON.stringify([...customTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
      JSON.stringify([...customTags].sort()) !== JSON.stringify([...topics].sort())
    ));

  // 分类：有自定义分类标记（包括明确清空），且与AI/默认不一致
  const aiCat = getAICategory(repo, allCategories);
  const defaultCat = getDefaultCategory(repo, allCategories);
  const customCat = repo.custom_category;
  const isCategoryEdited = customCat !== undefined &&
    (customCat === '' || (customCat !== aiCat && customCat !== defaultCat));

  return isDescEdited || isTagsEdited || isCategoryEdited;
}
