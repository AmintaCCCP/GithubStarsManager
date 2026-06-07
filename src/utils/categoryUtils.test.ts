import { describe, expect, it } from 'vitest';
import type { Category, Repository } from '../types';
import { matchesCategory } from './categoryUtils';

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
});
