import { describe, expect, it } from 'vitest';
import type { ToolEvidence } from '../../types/repositoryChat';
import { ensureVerifiableSources, extractReferenceToken, groupMarkdownBlocks, hasCompleteSourceReferences, pruneUnverifiableSections } from './citations';

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
  it('groups code blocks, tables, and lists with the preceding cited paragraph', () => {
    const content = [
      `Install with the package manager. ${citation}`,
      '',
      '```bash',
      'npm install',
      '```',
      '',
      '- Node.js is required',
      '- ffmpeg is optional',
      '',
      '| Tool | Purpose |',
      '| --- | --- |',
      '| npm | install |',
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(true);
  });

  it('requires at least 70% of factual blocks to be covered by their section', () => {
    const sections = Array.from({ length: 10 }, (_, index) => {
      const reference = index < 7 ? ` \`/README.md - ${index + 1}-${index + 1}\`` : '';
      return `## Topic ${index + 1}\n\nVersion ${index + 1} is documented.${reference}`;
    });
    const sectionEvidences = Array.from({ length: 10 }, (_, index) => evidence('README.md', index + 1, index + 1));
    expect(hasCompleteSourceReferences(sections.join('\n\n'), sectionEvidences)).toBe(true);
    expect(hasCompleteSourceReferences(sections.slice(0, 9).join('\n\n'), sectionEvidences.slice(0, 9))).toBe(true);
    expect(hasCompleteSourceReferences(sections.slice(0, 8).join('\n\n'), sectionEvidences.slice(0, 8))).toBe(true);
    const belowThreshold = [...sections.slice(0, 4), ...sections.slice(7, 9)].join('\n\n');
    expect(hasCompleteSourceReferences(belowThreshold, sectionEvidences)).toBe(false);
  });

  it('counts ordinary prose claims and does not let one citation cover a whole section', () => {
    const content = [
      '## Runtime',
      '',
      `The service starts with Docker. ${citation}`,
      '',
      'This project stores data locally.',
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(false);
  });

  it('does not let a tab-indented fence hide later citations', () => {
    const content = [
      '\t```',
      '',
      'Facts:',
      '',
      `Version 2 is available. ${citation}`,
    ].join('\n');
    expect(hasCompleteSourceReferences(content, evidences)).toBe(true);
  });
});

describe('groupMarkdownBlocks', () => {
  it('attaches fenced code and lists to the preceding prose block', () => {
    const blocks = groupMarkdownBlocks([
      'Install with npm.',
      '',
      '```bash',
      'npm install',
      '```',
      '',
      '- Node.js',
    ].join('\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('prose');
    expect(blocks[0]?.text).toContain('npm install');
    expect(blocks[0]?.text).toContain('- Node.js');
  });
});

describe('pruneUnverifiableSections', () => {
  it('keeps cited sections with their code blocks and demotes uncited factual sections', () => {
    const content = [
      '## Setup',
      '',
      `Run the installer. ${citation}`,
      '',
      '```bash',
      'npm install',
      '```',
      '',
      '## Extra',
      '',
      'Version 2.0 has an uncited fact.',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'zh');
    if (!pruned) throw new Error('expected a pruned answer');
    expect(pruned).toContain('Run the installer.');
    expect(pruned).toContain('npm install');
    expect(pruned).toContain('Version 2.0 has an uncited fact.');
    expect(pruned).toContain('未证实或缺失的信息');
    expect(pruned).toContain(citation);
    const citedPart = pruned.split('未证实或缺失的信息')[0];
    expect(citedPart).toContain('Run the installer.');
    expect(citedPart).not.toContain('Version 2.0 has an uncited fact.');
  });

  it('demotes only the uncited factual paragraphs in a mixed section', () => {
    const content = [
      '## Runtime',
      '',
      `The service starts with Docker. ${citation}`,
      '',
      'This project stores data locally.',
      '',
      'Optional background:',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'en');
    if (!pruned) throw new Error('expected a pruned answer');
    const [verified, unverified] = pruned.split('## Unverified or missing information');
    expect(verified).toContain('The service starts with Docker.');
    expect(verified).toContain('Optional background:');
    expect(unverified).toContain('This project stores data locally.');
    expect(unverified).not.toContain('The service starts with Docker.');
  });

  it('demotes uncited short prose claims', () => {
    const content = [
      '## Security',
      '',
      `The service uses TLS. ${citation}`,
      '',
      'Data is encrypted',
      '',
      '数据已加密',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'en');
    if (!pruned) throw new Error('expected a pruned answer');
    const [verified, unverified] = pruned.split('## Unverified or missing information');
    expect(verified).toContain('The service uses TLS.');
    expect(unverified).toContain('Data is encrypted');
    expect(unverified).toContain('数据已加密');
  });

  it('demotes a factual heading that has no body or citation', () => {
    const content = [
      '## Setup',
      '',
      `Run the installer. ${citation}`,
      '',
      '## Version 2.0 is available',
      '',
      '## Data is encrypted',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'en');
    if (!pruned) throw new Error('expected a pruned answer');
    const [verified, unverified] = pruned.split('## Unverified or missing information');
    expect(verified).not.toContain('## Version 2.0 is available');
    expect(verified).not.toContain('## Data is encrypted');
    expect(unverified).toContain('## Version 2.0 is available');
    expect(unverified).toContain('## Data is encrypted');
  });

  it('keeps the missing-answer note out of the unverified section', () => {
    const content = [
      '## Setup',
      '',
      `Run the installer. ${citation}`,
      '',
      '## Missing',
      '',
      '> Not found in the files read: license terms',
    ].join('\n');
    const pruned = pruneUnverifiableSections(content, evidences, 'en');
    if (!pruned) throw new Error('expected a pruned answer');
    expect(pruned).toContain('## Missing');
    expect(pruned).toContain('> Not found in the files read: license terms');
    expect(pruned).not.toContain('Unverified or missing information');
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
