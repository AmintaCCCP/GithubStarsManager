import { describe, expect, it } from 'vitest';
import type { TreeEntry } from './retrieval';
import { rankedCandidatePaths } from './retrieval';

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
