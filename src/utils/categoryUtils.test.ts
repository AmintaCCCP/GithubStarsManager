import { describe, expect, it } from 'vitest';
import type { Category, Repository } from '../types';
import { getEffectiveTags, matchesCategory, resolveCategoryAssignment } from './categoryUtils';

const aiCategory: Category = {
  id: 'ai',
  name: 'AI/机器学习',
  icon: 'bot',
  keywords: ['AI', '机器学习'],
};

const webCategory: Category = {
  id: 'web',
  name: 'Web应用',
  icon: 'globe',
  keywords: ['Web'],
};

const baseRepository: Repository = {
  id: 1,
  name: 'demo',
  full_name: 'owner/demo',
  description: null,
  html_url: 'https://github.com/owner/demo',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  pushed_at: '2026-01-01T00:00:00Z',
  owner: {
    login: 'owner',
    avatar_url: 'https://example.com/avatar.png',
  },
  topics: [],
  ai_tags: ['AI/机器学习'],
};

describe('getEffectiveTags', () => {
  it('prioritizes non-empty custom tags', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['我的项目'],
      ai_tags: ['AI/机器学习'],
      topics: ['web'],
    };
    expect(getEffectiveTags(repository)).toEqual(['我的项目']);
  });

  it('falls back to AI tags when custom tags are empty', () => {
    const repository = {
      ...baseRepository,
      custom_tags: [],
      ai_tags: ['AI/机器学习'],
      topics: ['web'],
    };
    expect(getEffectiveTags(repository)).toEqual(['AI/机器学习']);
  });

  it('falls back to topics when custom and AI tags are empty', () => {
    const repository = {
      ...baseRepository,
      custom_tags: [],
      ai_tags: [],
      topics: ['machine-learning'],
    };
    expect(getEffectiveTags(repository)).toEqual(['machine-learning']);
  });
});

describe('matchesCategory', () => {
  it('uses AI tags when custom_category is undefined', () => {
    expect(matchesCategory(baseRepository, aiCategory)).toBe(true);
  });

  it('uses AI tags when legacy backend data has custom_category null', () => {
    const legacyRepository = {
      ...baseRepository,
      custom_category: null,
    } as unknown as Repository;

    expect(matchesCategory(legacyRepository, aiCategory)).toBe(true);
  });

  it('does not match any category when custom_category is explicitly empty', () => {
    const repository = {
      ...baseRepository,
      custom_category: '',
    };

    expect(matchesCategory(repository, aiCategory)).toBe(false);
  });

  it('honors non-empty custom_category over AI tags', () => {
    const repository = {
      ...baseRepository,
      custom_category: 'Web应用',
    };

    expect(matchesCategory(repository, aiCategory)).toBe(false);
    expect(matchesCategory(repository, webCategory)).toBe(true);
  });

  it.each(['legacy', 'effective'] as const)(
    'keeps legacy behavior for AI tags in %s mode when no custom tags',
    (mode) => {
      expect(matchesCategory(baseRepository, aiCategory, mode)).toBe(true);
    }
  );

  it('does not match in legacy mode when execute effective custom tags do not overlap', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['我的项目'],
      ai_tags: ['AI/机器学习'],
    };
    expect(matchesCategory(repository, aiCategory, 'legacy')).toBe(true);
  });

  it('matches via custom tags in effective mode', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['前端'],
      ai_tags: ['AI/机器学习'],
    };
    const frontendCategory: Category = {
      id: 'frontend',
      name: '前端',
      icon: 'code',
      keywords: ['前端'],
    };
    expect(matchesCategory(repository, frontendCategory, 'effective')).toBe(true);
    expect(matchesCategory(repository, aiCategory, 'effective')).toBe(false);
  });

  it('uses custom tags even without AI tags in effective mode', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['前端'],
      ai_tags: undefined,
    };
    const frontendCategory: Category = {
      id: 'frontend',
      name: '前端',
      icon: 'code',
      keywords: ['前端'],
    };
    expect(matchesCategory(repository, frontendCategory, 'effective')).toBe(true);
  });

  it('matches a custom category with empty keywords by name in effective mode', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['我的项目'],
      ai_tags: ['AI/机器学习'],
    };
    const myProjects: Category = {
      id: 'custom-1',
      name: '我的项目',
      icon: '📁',
      keywords: [],
      isCustom: true,
    };
    expect(matchesCategory(repository, myProjects, 'effective')).toBe(true);
  });

  it('does not match default categories by name in effective mode', () => {
    const repository = {
      ...baseRepository,
      custom_tags: ['AI'],
      ai_tags: ['AI/机器学习'],
    };
    // 自定义标签只按关键词匹配默认分类，默认分类名不参与匹配
    expect(matchesCategory(repository, aiCategory, 'effective')).toBe(true);
    expect(matchesCategory(repository, webCategory, 'effective')).toBe(false);
  });
});

describe('resolveCategoryAssignment', () => {
  const customCategory: Category = {
    id: 'custom-1',
    name: '我的项目',
    icon: '📁',
    keywords: [],
    isCustom: true,
  };

  const categories: Category[] = [aiCategory, webCategory, customCategory];

  it('preserves an existing valid custom_category', () => {
    const repository = {
      ...baseRepository,
      custom_category: '我的项目',
      custom_tags: ['我的项目'],
    };
    expect(resolveCategoryAssignment(repository, ['AI/机器学习'], categories)).toBe('我的项目');
  });

  it('preserves an explicitly empty custom_category', () => {
    const repository = {
      ...baseRepository,
      custom_category: '',
    };
    expect(resolveCategoryAssignment(repository, ['AI/机器学习'], categories)).toBe('');
  });

  it('does not clear custom_category when locked even without tags', () => {
    const repository = {
      ...baseRepository,
      custom_category: '我的项目',
      category_locked: true,
    };
    expect(resolveCategoryAssignment(repository, [], categories)).toBe('我的项目');
  });

  it('assigns a custom category when AI tag contains the category name', () => {
    const repository = {
      ...baseRepository,
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['我的项目'], categories)).toBe('我的项目');
  });

  it('assigns a custom category when the category name contains the AI tag', () => {
    const repository = {
      ...baseRepository,
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['项目'], categories)).toBe('我的项目');
  });

  it('returns undefined when AI tags match a default category and no custom assignment exists', () => {
    const repository = {
      ...baseRepository,
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['Web应用'], categories)).toBe(undefined);
  });

  it('does not match by name substring for default categories', () => {
    const repository = {
      ...baseRepository,
      custom_category: undefined,
    };
    // "应用" 是默认分类 "Web应用" 的子串，但默认分类仅精确匹配名称
    expect(resolveCategoryAssignment(repository, ['应用'], categories)).toBe(undefined);
  });
});