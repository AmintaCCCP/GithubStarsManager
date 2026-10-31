import { describe, expect, it } from 'vitest';
import type { ToolEvidence } from '../../types/repositoryChat';
import { hasCompleteSourceReferences, pruneUnverifiableSections } from './citations';

const evidence = (path: string, lineStart: number, lineEnd: number): ToolEvidence => ({
  id: `evidence-${path}-${lineStart}`,
  path,
  lineStart,
  lineEnd,
  excerpt: 'content',
  retrievedAt: '2026-01-01T00:00:00.000Z',
} as ToolEvidence);

const evidences = [evidence('README.md', 94, 119)];
const citation = '`/README.md - 94-119`';

describe('hasCompleteSourceReferences', () => {
  it('fails when a list item lacks its own reference even if the section has one', () => {
    const content = [
      `- Node.js is required ${citation}`,
      '- ffmpeg is optional',
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(false);
  });

  it('passes when every list item is cited', () => {
    const content = [
      `- Node.js is required ${citation}`,
      `- ffmpeg is optional ${citation}`,
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(true);
  });

  it('skips table header and separator rows', () => {
    const content = [
      '| Tool | Purpose |',
      '| --- | --- |',
      `| skills | install ${citation} |`,
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(true);
  });
});

describe('pruneUnverifiableSections', () => {
  it('moves only uncited list items into the unverified block', () => {
    const content = [
      `- Node.js is required ${citation}`,
      '- ffmpeg is optional',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'zh');
    if (!pruned) throw new Error('expected a pruned answer');
    expect(pruned).toContain('Node.js is required');
    expect(pruned).toContain('ffmpeg is optional');
    expect(pruned).toContain('未证实或缺失的信息');
    expect(pruned).toContain(citation);
    const citedPart = pruned.split('未证实或缺失的信息')[0];
    expect(citedPart).toContain('Node.js is required');
    expect(citedPart).not.toContain('ffmpeg is optional');
  });
});
