import { describe, expect, it } from 'vitest';
import type { TreeEntry } from './retrieval';
import { collapseCandidateDirectories, rankedCandidatePaths } from './retrieval';

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
