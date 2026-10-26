import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingConfig, Repository } from '../types';
import { buildCrossEncoderDocument, CrossEncoderReranker, deriveRepoKind } from './crossEncoderReranker';

const config = (overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig => ({
  id: 'emb',
  name: 'siliconflow',
  apiType: 'siliconflow',
  baseUrl: 'https://api.siliconflow.cn',
  apiKey: 'secret',
  model: 'embedding',
  dimensions: 2,
  isActive: true,
  ...overrides,
});

const makeRepo = (): Repository => ({
  id: 1,
  name: 'readme-skill',
  full_name: 'acme/readme-skill',
  description: 'Improve GitHub README files',
  html_url: 'https://github.com/acme/readme-skill',
  stargazers_count: 1200,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  pushed_at: '2026-01-03T00:00:00Z',
  owner: { login: 'acme', avatar_url: '' },
  topics: ['readme'],
  ai_tags: ['skill'],
  ai_summary: 'An agent skill for README optimization',
  license: 'MIT',
});

describe('CrossEncoderReranker', () => {
  beforeEach(() => {
    (window.fetch as ReturnType<typeof vi.fn>).mockReset();
  });

  it.each([
    'https://api.siliconflow.cn',
    'https://api.siliconflow.cn/',
  ])('posts to /v1/rerank with the ordinary model for base URL %s', async (baseUrl) => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({
      results: [
        { index: 1, relevance_score: 0.3 },
        { index: 0, relevance_score: 0.9 },
      ],
    }), { status: 200 }));
    const reranker = new CrossEncoderReranker(config({ baseUrl }));
    const result = await reranker.rerank('readme skill', [
      { id: '1', text: 'first' },
      { id: '2', text: 'second' },
    ]);

    const [url, init] = (window.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(url).toBe('https://api.siliconflow.cn/v1/rerank');
    expect(body.model).toBe('BAAI/bge-reranker-v2-m3');
    expect(body.return_documents).toBe(false);
    expect(result?.map(item => item.id)).toEqual(['1', '2']);
  });

  it('keeps the highest score for duplicate indexes and returns only scored candidates', async () => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response(JSON.stringify({
      results: [
        { index: 0, relevance_score: 0.2 },
        { index: 0, relevance_score: 0.8 },
      ],
    }), { status: 200 }));
    const result = await new CrossEncoderReranker(config()).rerank('query', [
      { id: '1', text: 'first' },
      { id: '2', text: 'second' },
    ]);

    expect(result).toEqual([{ id: '1', score: 0.8, rank: 1 }]);
  });

  it.each([
    ['empty results', { results: [] }],
    ['invalid index', { results: [{ index: 9, relevance_score: 0.5 }] }],
    ['non-numeric score', { results: [{ index: 0, relevance_score: '0.5' }] }],
    ['invalid shape', { items: [] }],
  ])('returns null on %s', async (_label, body) => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200 }),
    );
    await expect(new CrossEncoderReranker(config()).rerank('query', [
      { id: '1', text: 'first' },
    ])).resolves.toBeNull();
  });

  it.each([429, 500])('returns null on HTTP %s', async (status) => {
    (window.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(new Response('nope', { status }));
    await expect(new CrossEncoderReranker(config()).rerank('query', [
      { id: '1', text: 'first' },
    ])).resolves.toBeNull();
  });

  it('rethrows an outer abort', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new CrossEncoderReranker(config()).rerank('query', [
      { id: '1', text: 'first' },
    ], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not call the network for non-SiliconFlow or incomplete configs', async () => {
    const document = [{ id: '1', text: 'first' }];
    await expect(new CrossEncoderReranker(config({ apiType: 'openai' })).rerank('q', document)).resolves.toBeNull();
    await expect(new CrossEncoderReranker(config({ apiKey: '' })).rerank('q', document)).resolves.toBeNull();
    expect(window.fetch).not.toHaveBeenCalled();
  });

  it('derives library only from compound Chinese terms, not 仓库/数据库', () => {
    const neutral = { ...makeRepo(), name: 'toolkit', full_name: 'acme/toolkit', ai_tags: [], topics: [] };
    expect(deriveRepoKind({ ...neutral, ai_summary: '这是一个GitHub仓库管理工具', description: '' })).not.toBe('library');
    expect(deriveRepoKind({ ...neutral, ai_summary: '一个常用的函数库', description: '' })).toBe('library');
    expect(deriveRepoKind({ ...neutral, description: 'A database toolkit', ai_summary: '' })).not.toBe('library');
    expect(deriveRepoKind({ ...neutral, ai_summary: '这是一个分类库整理项目', description: '' })).not.toBe('library');
    expect(deriveRepoKind({ ...neutral, ai_summary: '一个类库集合', description: '' })).toBe('library');
  });

  it('builds bounded documents from local metadata without stars or README', () => {
    const document = buildCrossEncoderDocument(makeRepo());
    expect(document).toContain('acme/readme-skill');
    expect(document).toContain('Kind: skill');
    expect(document).toContain('License: MIT');
    expect(document).not.toContain('1200');
    expect(document).not.toContain('README:');
    expect(document.length).toBeLessThanOrEqual(1200);
  });

  it('keeps an ai summary when description is empty', () => {
    const document = buildCrossEncoderDocument({
      ...makeRepo(),
      description: '',
    });

    expect(document).toContain('Summary: An agent skill for README optimization');
  });
});
