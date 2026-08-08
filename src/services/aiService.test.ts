import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Repository } from '../types';
import { AIService } from './aiService';

// Minimal AIConfig that lets AIService construct without a real token.
const makeConfig = () => ({
  id: 'test',
  name: 'test',
  apiType: 'openai' as const,
  baseUrl: 'http://localhost:0',
  apiKey: '',
  model: 'gpt-test',
  isActive: true,
});

function makeRepo(partial: Partial<Repository> & Pick<Repository, 'id' | 'name' | 'full_name'>): Repository {
  return {
    description: null,
    html_url: `https://github.com/${partial.full_name}`,
    stargazers_count: 0,
    forks_count: 0,
    forks: 0,
    language: 'TypeScript',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-06-01T00:00:00Z',
    pushed_at: '2024-06-01T00:00:00Z',
    owner: { login: 'owner', avatar_url: '' },
    topics: [],
    ...partial,
  };
}

describe('AIService.searchRepositoriesWithReranking — enhanced basic search fallback', () => {
  beforeEach(() => {
    // Force the AI request path to fail so we fall back to performEnhancedBasicSearch.
    (window.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('network disabled in test');
    });
  });

  it('ranks a license-matching repo above a higher-star non-matching repo when the query mixes license + other terms', async () => {
    // A matches both the name term ("react") and the license term ("mit").
    const repoA = makeRepo({
      id: 1,
      name: 'react-app',
      full_name: 'acme/react-app',
      stargazers_count: 500,
      license: 'MIT',
    });
    // B has far more stars and matches the name term, but NOT the license term.
    const repoB = makeRepo({
      id: 2,
      name: 'react-lib',
      full_name: 'acme/react-lib',
      stargazers_count: 1000,
      license: 'Apache-2.0',
    });

    const service = new AIService(makeConfig() as never, 'en');
    const results = await service.searchRepositoriesWithReranking([repoA, repoB], 'react mit');

    const ids = results.map((r) => r.id);
    // With the license weight, A's license match outweighs B's popularity edge.
    expect(ids).toEqual([1, 2]);
    expect(results).toHaveLength(2);
  });

  it('does not crash when a repo carries a raw GitHub license object (toLowerCase defensive)', async () => {
    // Regression for "e.toLowerCase is not a function": a repo whose license never passed
    // through toLicenseSpdxId (legacy persisted store / third-party import) keeps a raw
    // GitHub object `{ key, spdx_id, ... }`. performEnhancedBasicSearch must reduce it via
    // normalizeLicense rather than (repo.license || '').toLowerCase().
    const repoA = makeRepo({
      id: 3,
      name: 'react-legacy',
      full_name: 'acme/react-legacy',
      stargazers_count: 10,
      license: { spdx_id: 'MIT', key: 'MIT', name: 'MIT License', url: 'https://api.github.com/licenses/mit' } as never,
    });

    const service = new AIService(makeConfig() as never, 'en');
    // Should resolve the license object to 'MIT' and rank the repo — not throw.
    const results = await service.searchRepositoriesWithReranking([repoA], 'mit');
    expect(results.map((r) => r.id)).toEqual([3]);
  });

  it('finds a repo by its custom tag via static fallback search', async () => {
    const repo = makeRepo({
      id: 4,
      name: 'skill-pack',
      full_name: 'acme/skill-pack',
      description: 'A collection of prompts',
      ai_tags: ['效率工具'],
      custom_tags: ['技能'],
    });

    const results = await AIService.searchRepositories([repo], '技能');
    expect(results.map((r) => r.id)).toEqual([4]);
  });

  it('finds a repo by its custom tag via basic search', async () => {
    const repo = makeRepo({
      id: 5,
      name: 'skill-pack',
      full_name: 'acme/skill-pack',
      description: 'A collection of prompts',
      ai_tags: ['效率工具'],
      custom_tags: ['技能'],
    });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = service['performBasicSearch']([repo], '技能');
    expect(results.map((r) => r.id)).toEqual([5]);
  });

  it('finds a repo matching only through custom_tags via enhanced search', async () => {
    const repo = makeRepo({
      id: 6,
      name: 'skill-pack',
      full_name: 'acme/skill-pack',
      description: 'A collection of prompts',
      ai_tags: ['效率工具'],
      custom_tags: ['技能'],
    });

    const service = new AIService(makeConfig() as never, 'zh');
    const results = service['performEnhancedSearch']([repo], '技能', ['技能']);
    expect(results.map((r) => r.id)).toEqual([6]);
  });
});
