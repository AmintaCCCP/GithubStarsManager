import { describe, expect, it } from 'vitest';
import type { Category, Repository } from '../../types';
import { defaultCategories } from '../schema';
import { getAllCategories, getCategoryNameVariants, translateCategoryName } from '../helpers/categoryHelpers';
import { computeCustomCategory, matchesCategory, resolveCategoryAssignment } from '../../utils/categoryUtils';
import { fixturePath, readFixture, shouldUpdateFixtures, writeFixture } from '../../test/fixtureIo';

/**
 * i18n 迁移保障网：固化内置分类在 language=zh/en 下的显示名、变体集合与归类匹配行为。
 * 迁移后 zh/en 列必须逐值相等；锁定分类跨语言匹配基线记录了现状（切语言丢失归类），
 * 提交 4 引入变体匹配后该基线会随行为改进**有意更新**。
 * 重新生成：UPDATE_I18N_FIXTURES=1 npx vitest run src/store/__fixtures__/categoryLanguage.test.ts
 */
const FIXTURE_FILE = fixturePath(import.meta.url, 'category-language.snapshot.json');

const makeRepo = (partial: Partial<Repository>): Repository => ({
  id: 1,
  name: 'sample-app',
  full_name: 'acme/sample-app',
  description: 'A sample repository',
  html_url: 'https://github.com/acme/sample-app',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-06-01T00:00:00Z',
  pushed_at: '2024-06-01T00:00:00Z',
  owner: { login: 'acme', avatar_url: '' },
  topics: [],
  ...partial,
}) as Repository;

const categoryIn = (language: 'zh' | 'en', id: string): Category => {
  const found = getAllCategories([], language).find((category) => category.id === id);
  if (!found) throw new Error(`category ${id} not found`);
  return found;
};

const customDeploymentCategory: Category = {
  id: 'custom-deploy',
  name: '部署',
  icon: '🚀',
  keywords: ['deploy', '部署'],
  isCustom: true,
};

const buildSnapshot = () => {
  const zhNames = getAllCategories([], 'zh').map((category) => category.name);
  const zhCategories = getAllCategories([], 'zh');
  const enCategories = getAllCategories([], 'en');
  const catsWithCustom = [...zhCategories, customDeploymentCategory];

  return {
    defaultCategoryIds: defaultCategories.map((category) => category.id),
    getAllCategories: {
      zh: zhCategories,
      en: enCategories,
    },
    translateCategoryName: {
      inputs: zhNames,
      outputs: zhNames.map((name) => translateCategoryName(name)),
    },
    categoryNameVariants: {
      devtools: getCategoryNameVariants('开发工具'),
      web: getCategoryNameVariants('Web应用'),
      untouchedCustomName: getCategoryNameVariants('My Tools'),
      withOverride: getCategoryNameVariants('开发工具', 'My Tools'),
    },
    matchesCategory: {
      lockedZhName_vs_zhWeb: matchesCategory(makeRepo({ custom_category: 'Web应用', category_locked: true }), categoryIn('zh', 'web'), 'effective'),
      lockedZhName_vs_enWeb: matchesCategory(makeRepo({ custom_category: 'Web应用', category_locked: true }), categoryIn('en', 'web'), 'effective'),
      lockedEnName_vs_enWeb: matchesCategory(makeRepo({ custom_category: 'Web Apps', category_locked: true }), categoryIn('en', 'web'), 'effective'),
      lockedEnName_vs_zhWeb: matchesCategory(makeRepo({ custom_category: 'Web Apps', category_locked: true }), categoryIn('zh', 'web'), 'effective'),
      lockedCustomExactName: matchesCategory(makeRepo({ custom_category: 'My Tools', category_locked: true }), { id: 'c1', name: 'My Tools', icon: 'x', keywords: [], isCustom: true }, 'effective'),
      emptyCustomCategory_vs_zhWeb: matchesCategory(makeRepo({ custom_category: '', category_locked: true }), categoryIn('zh', 'web'), 'effective'),
      zhAiTags_vs_zhDevtools: matchesCategory(makeRepo({ ai_tags: ['开发工具', 'cli'] }), categoryIn('zh', 'devtools')),
      enAiTags_vs_enDevtools: matchesCategory(makeRepo({ ai_tags: ['development tools'] }), categoryIn('en', 'devtools')),
      enAiTags_vs_zhDevtools: matchesCategory(makeRepo({ ai_tags: ['development tools'] }), categoryIn('zh', 'devtools')),
      effectiveCustomTagsBeatAiTags: matchesCategory(makeRepo({ custom_tags: ['database'], ai_tags: ['game'] }), categoryIn('zh', 'database'), 'effective'),
      repoTextFallback_vs_enDesktop: matchesCategory(makeRepo({ ai_tags: [], description: 'A desktop app built with electron' }), categoryIn('en', 'desktop')),
    },
    resolveCategoryAssignment: {
      zhDefaultHit_returnsUndefined: resolveCategoryAssignment(makeRepo({ ai_tags: ['开发工具', 'cli'] }), ['开发工具', 'cli'], zhCategories),
      enDefaultHit_returnsUndefined: resolveCategoryAssignment(makeRepo({ ai_tags: ['development tools'] }), ['development tools'], enCategories),
      customHit_returnsName: resolveCategoryAssignment(makeRepo({ ai_tags: ['deploy'] }), ['deploy'], catsWithCustom),
      lockedKept_whenValid: resolveCategoryAssignment(makeRepo({ ai_tags: ['game'], custom_category: '部署', category_locked: true }), ['game'], catsWithCustom),
      emptyCleared_kept: resolveCategoryAssignment(makeRepo({ ai_tags: ['game'], custom_category: '' }), ['game'], zhCategories),
      noMatch_returnsUndefined: resolveCategoryAssignment(makeRepo({ ai_tags: ['zzzunmatched'] }), ['zzzunmatched'], zhCategories),
    },
    computeCustomCategory: {
      empty: computeCustomCategory('', 'Web应用', 'Web应用'),
      equalsAiCategory: computeCustomCategory('Web应用', 'Web应用', undefined),
      equalsDefaultCategory: computeCustomCategory('Web应用', undefined, 'Web应用'),
      otherwise: computeCustomCategory('My Tools', 'Web应用', 'Web应用'),
    },
  };
};

describe('内置分类语言行为 fixture（zh/en 基线）', () => {
  it('matches the frozen category fixture', () => {
    const snapshot = buildSnapshot();
    if (shouldUpdateFixtures()) {
      writeFixture(FIXTURE_FILE, snapshot);
      expect(snapshot).not.toBeNull();
      return;
    }
    expect(snapshot).toEqual(readFixture(FIXTURE_FILE));
  });
});
