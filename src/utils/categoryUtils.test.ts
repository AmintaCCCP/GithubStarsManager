import { describe, expect, it } from 'vitest';
import type { Category, Repository } from '../types';
import { getEffectiveTags, matchesCategory, resolveCategoryAssignment, buildCategoryHints } from './categoryUtils';

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

describe('resolveCategoryAssignment metadata fallback for custom categories', () => {
  const customSkills: Category = {
    id: 'custom-skills',
    name: 'skills',
    icon: '💡',
    keywords: ['Skills', '技能', 'skill'],
    isCustom: true,
  };

  it('assigns skills category via metadata when AI tags miss the custom name', () => {
    const repository = {
      ...baseRepository,
      full_name: 'Leonxlnx/taste-skill',
      name: 'taste-skill',
      description: 'Taste-Skill - gives your AI good taste',
      language: 'JavaScript',
      topics: ['agent', 'ai', 'skill', 'skills', 'vibecoding'],
      custom_category: undefined,
    };
    // AI 返回通用标签，仅通过 topics 中的 skill/skills 命中自定义分类
    expect(resolveCategoryAssignment(repository, ['AI/机器学习', '开发工具', '效率工具'], [customSkills, aiCategory])).toBe('skills');
  });

  it('assigns skills category for pm-skills repo (topics match keywords)', () => {
    const repository = {
      ...baseRepository,
      full_name: 'phuryn/pm-skills',
      name: 'pm-skills',
      description: 'PM Skills Marketplace: 100+ agentic skills',
      language: '',
      topics: ['agent-skills', 'agentic-skills', 'claude-code-plugins', 'product-management'],
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['开发工具'], [customSkills, aiCategory])).toBe('skills');
  });

  it('assigns custom category via description even without topics', () => {
    const repository = {
      ...baseRepository,
      full_name: 'acme/skill-pack',
      name: 'skill-pack',
      description: '提供 30+ 技能插件库',
      language: 'TypeScript',
      topics: [],
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, [], [customSkills, aiCategory])).toBe('skills');
  });

  it('preserves an existing valid custom_category despite metadata fallback', () => {
    const repository = {
      ...baseRepository,
      full_name: 'phuryn/pm-skills',
      name: 'pm-skills',
      description: 'PM Skills Marketplace',
      language: '',
      topics: ['agent-skills'],
      custom_category: 'Web应用',
      category_locked: false,
    };
    expect(resolveCategoryAssignment(repository, ['AI/机器学习'], [customSkills, aiCategory, webCategory])).toBe('Web应用');
  });

  it('preserves explicitly cleared custom_category despite metadata fallback', () => {
    const repository = {
      ...baseRepository,
      full_name: 'phuryn/pm-skills',
      name: 'pm-skills',
      description: 'PM Skills Marketplace',
      language: '',
      topics: ['agent-skills'],
      custom_category: '',
    };
    expect(resolveCategoryAssignment(repository, [], [customSkills, aiCategory])).toBe('');
  });

  it('keeps default category behavior when no custom metadata matches', () => {
    const repository = {
      ...baseRepository,
      full_name: 'foo/demo-app',
      name: 'demo-app',
      description: 'A web demo',
      language: 'JavaScript',
      topics: ['web'],
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['Web应用'], [customSkills, aiCategory, webCategory])).toBe(undefined);
  });
});

describe('resolveCategoryAssignment with real repositories and other custom categories', () => {
  // 真实仓库元数据（来自 GitHub API 抓取，离线固化防 flaky）
  const customDataAnalysis: Category = {
    id: 'custom-data',
    name: '数据分析',
    icon: '📊',
    keywords: ['data-analysis', '数据分析', 'pandas'],
    isCustom: true,
  };
  const customCli: Category = {
    id: 'custom-cli',
    name: '命令行工具',
    icon: '🖥',
    keywords: ['cli', '命令行', 'terminal'],
    isCustom: true,
  };

  it('classifies pandas-dev/pandas to custom 数据分析 via topics', () => {
    const pandas = {
      ...baseRepository,
      id: 2,
      full_name: 'pandas-dev/pandas',
      name: 'pandas',
      description: 'Flexible and powerful data analysis / manipulation library for Python',
      language: 'Python',
      topics: ['alignment', 'data-analysis', 'data-science', 'flexible', 'pandas', 'python'],
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(pandas, ['AI/机器学习'], [customDataAnalysis, customCli, aiCategory])).toBe('数据分析');
  });

  it('classifies cli/cli to custom 命令行工具 via topics', () => {
    const repository = {
      ...baseRepository,
      id: 3,
      full_name: 'cli/cli',
      name: 'cli',
      description: 'GitHub official command line tool',
      language: 'Go',
      topics: ['cli', 'git', 'github-api-v4', 'golang'],
      custom_category: undefined,
    };
    expect(resolveCategoryAssignment(repository, ['开发工具'], [customCli, customDataAnalysis, aiCategory])).toBe('命令行工具');
  });
});

describe('buildCategoryHints', () => {
  it('builds hint text with keywords', () => {
    const categories: Category[] = [
      { id: 'c1', name: 'skills', icon: '💡', keywords: ['Skill', '技能'], isCustom: true },
      { id: 'c2', name: '数据分析', icon: '📊', keywords: ['pandas'], isCustom: true },
    ];
    expect(buildCategoryHints(categories)).toContain('skills');
    expect(buildCategoryHints(categories)).toContain('技能');
    expect(buildCategoryHints(categories)).toContain('数据分析');
  });

  it('returns empty string when no custom categories', () => {
    expect(buildCategoryHints([aiCategory])).toBe('');
  });

  it('handles categories without keywords', () => {
    const categories: Category[] = [
      { id: 'c1', name: '我的项目', icon: '📁', keywords: [], isCustom: true },
    ];
    expect(buildCategoryHints(categories)).toContain('我的项目');
  });
});