import { describe, expect, it } from 'vitest';
import type { TreeEntry } from './retrieval';
import {
  collapseCandidateDirectories,
  detectResearchFocus,
  isCreativeRequest,
  makeMarkdownHeadings,
  parseQueryUnderstanding,
  parseStandaloneQuestion,
  rankedCandidatePaths,
  sectionSegments,
} from './retrieval';

const treeEntry = (path: string): TreeEntry => ({ path, type: 'blob' } as TreeEntry);

describe('rankedCandidatePaths', () => {
  it('keeps the full ranked list instead of truncating to 80 paths', () => {
    const entries = Array.from({ length: 120 }, (_, i) => treeEntry(`docs/guide-${i}.md`));
    entries.push(treeEntry('README.md'));

    const paths = rankedCandidatePaths(entries, 'guide', 'general');

    expect(paths.length).toBeGreaterThan(80);
    expect(paths[0]).toBe('README.md');
  });
});

describe('collapseCandidateDirectories', () => {
  it('collapses same-directory same-type groups beyond the threshold but keeps the top 2 representatives', () => {
    const paths = [
      'README.md',
      ...Array.from({ length: 12 }, (_, i) => `gallery/source/file-${i}.md`),
      'gallery/source/notes.txt',
    ];
    const collapsed = collapseCandidateDirectories(paths, { threshold: 8 });
    expect(collapsed.filter((path) => path === 'gallery/source/file-0.md' || path === 'gallery/source/file-1.md')).toHaveLength(2);
    expect(collapsed).toContain('gallery/source/*.md (12 files)');
    expect(collapsed).not.toContain('gallery/source/file-5.md');
    expect(collapsed).toContain('gallery/source/notes.txt');
    expect(collapsed).toContain('README.md');
  });

  it('keeps groups at or below the threshold untouched and preserves order', () => {
    const paths = ['a.md', 'docs/one.md', 'docs/two.md'];
    expect(collapseCandidateDirectories(paths)).toEqual(paths);
  });
});

describe('detectResearchFocus', () => {
  it('treats project scaffolding questions as usage', () => {
    expect(detectResearchFocus('How do I create a new Astro project?')).toBe('usage');
    expect(detectResearchFocus('如何创建一个新项目？')).toBe('usage');
  });

  it('keeps implementation questions that happen to use “create” out of usage', () => {
    expect(detectResearchFocus('How do I create a custom store module?')).toBe('implementation');
    expect(detectResearchFocus('How do I create a plugin in code?')).toBe('implementation');
    expect(detectResearchFocus('如何创建自定义插件？')).not.toBe('usage');
  });

  it('prefers implementation when a scaffolding question also asks how it works internally', () => {
    expect(detectResearchFocus('How does the create a new project API work internally?')).toBe('implementation');
    expect(detectResearchFocus('创建项目时内部是如何实现的？')).toBe('implementation');
  });
});

describe('sectionSegments', () => {
  it('selects a short heading that appears as a standalone word in the request', () => {
    const content = ['# Docs', '', '## API', 'GET /items', '', '## Reference', 'Full list.'].join('\n');
    const document = { path: 'docs.md', content, headings: makeMarkdownHeadings(content), linkedDocumentationPaths: [] };

    expect(sectionSegments(document, ['API reference']).map((segment) => segment.label)).toEqual(['API', 'Reference']);
  });

  it('selects a short heading when the request uses a hyphenated form', () => {
    const content = ['# Docs', '', '## API', 'GET /items', '', '## Reference', 'Full list.'].join('\n');
    const document = { path: 'docs.md', content, headings: makeMarkdownHeadings(content), linkedDocumentationPaths: [] };

    expect(sectionSegments(document, ['API-reference']).map((segment) => segment.label)).toEqual(['API', 'Reference']);
  });
});

describe('rankedCandidatePaths entry-file bonus', () => {
  it('keeps a keyword-matched implementation file ahead of generic entry files', () => {
    const entries = [
      ...Array.from({ length: 60 }, (_, i) => treeEntry(`packages/pkg-${i}/src/index.ts`)),
      treeEntry('src/webhook/signature.ts'),
    ];

    const paths = rankedCandidatePaths(entries, 'Where is the webhook signature verified?', 'implementation');
    const firstUnmatchedEntry = paths.findIndex((path) => /packages\/pkg-\d+\/src\/index\.ts$/.test(path));

    expect(paths.indexOf('src/webhook/signature.ts')).toBeLessThan(firstUnmatchedEntry);
  });
});

describe('isCreativeRequest', () => {
  it('recognizes poem and compose requests without treating docker compose as creative', () => {
    expect(isCreativeRequest('Compose a poem about this project')).toBe(true);
    expect(isCreativeRequest('Write a story about the maintainers')).toBe(true);
    expect(isCreativeRequest('讲个故事介绍这个项目')).toBe(true);
    expect(isCreativeRequest('写一首诗介绍这个项目')).toBe(true);
    expect(isCreativeRequest('创作一首诗介绍这个项目')).toBe(true);
    expect(isCreativeRequest('写一篇关于用户故事的文章')).toBe(true);
    expect(isCreativeRequest('How do I use docker compose?')).toBe(false);
    expect(isCreativeRequest('How do I create postgres schema?')).toBe(false);
    expect(isCreativeRequest('How do I generate a post request using this API?')).toBe(false);
    expect(isCreativeRequest('generate copyright headers')).toBe(false);
    expect(isCreativeRequest('How do I generate a post endpoint?')).toBe(false);
    expect(isCreativeRequest('How should the API store a user story?')).toBe(false);
    expect(isCreativeRequest('如何存储用户故事？')).toBe(false);
  });
});

describe('standalone question parsing', () => {
  it('does not truncate rewritten follow-ups used for retrieval', () => {
    const question = `How do I install this project on Windows? ${'Keep every detail. '.repeat(30)}`.trim();
    const parsed = parseStandaloneQuestion(JSON.stringify({ standalone_question: question }), 'fallback');
    const understanding = parseQueryUnderstanding(JSON.stringify({ standalone_question: question }), {
      intent: 'general',
      standaloneQuestion: 'fallback',
      entities: [],
      searchConcepts: [],
      likelyDocumentTopics: [],
      informationScope: 'both',
      answerRequirements: [],
      optionalEnrichment: [],
      initialTargets: [],
      target: '',
    }, new Set());

    expect(parsed).toBe(question);
    expect(understanding.standaloneQuestion).toBe(question);
  });
});
