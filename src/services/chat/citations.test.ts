import { describe, expect, it } from 'vitest';
import type { ToolEvidence } from '../../types/repositoryChat';
import { ensureVerifiableSources, extractReferenceToken, hasCompleteSourceReferences, pruneUnverifiableSections } from './citations';

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

  it('checks indented nested list items individually', () => {
    const content = [
      `- Node.js is required ${citation}`,
      '  - ffmpeg is optional',
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(false);
  });

  it('checks pipe-less table rows individually', () => {
    const content = [
      'Tool | Purpose',
      '--- | ---',
      `skills | install ${citation}`,
      'ffmpeg | render',
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(false);
  });

  it('passes when every pipe-less table row is cited', () => {
    const content = [
      'Tool | Purpose',
      '--- | ---',
      `skills | install ${citation}`,
      `ffmpeg | render ${citation}`,
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

describe('ensureVerifiableSources', () => {
  it('keeps bare filenames of read files but drops unread source paths', () => {
    const content = `Details are in \`README.md\`, not \`missing.md\`. ${citation}`;
    const cleaned = ensureVerifiableSources(content, evidences, 'zh');
    expect(cleaned).toContain('`README.md`');
    expect(cleaned).not.toContain('missing.md');
  });
});

describe('extractReferenceToken', () => {
  it('extracts the reference from an annotated evidence string (HAR R2 shape)', () => {
    expect(extractReferenceToken('/README.md - 94-119（## Install：Install dependencies with pnpm install）')).toBe('/README.md - 94-119');
  });

  it('strips wrapping backticks and tolerates annotations before the reference', () => {
    expect(extractReferenceToken('`/docs/setup.md - 3-9`')).toBe('/docs/setup.md - 3-9');
    expect(extractReferenceToken('See （## Usage：/docs/usage.md - 10-12）')).toBe('/docs/usage.md - 10-12');
  });

  it('passes plain references through unchanged', () => {
    expect(extractReferenceToken('/README.md - 94-119')).toBe('/README.md - 94-119');
  });
});
