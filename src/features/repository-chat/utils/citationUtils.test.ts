import { describe, expect, it } from 'vitest';
import type { ToolEvidence } from '../../../types/repositoryChat';
import {
  citationAnchorUrl,
  parseCitationToken,
  resolveCitation,
  stripCitationsForCopy,
} from './citationUtils';

const evidence = (overrides: Partial<ToolEvidence>): ToolEvidence => ({
  id: overrides.id ?? 'evidence-1',
  source: 'github',
  repoFullName: 'owner/repo',
  refSha: 'abcdef1234567890',
  path: 'README.md',
  lineStart: 3,
  lineEnd: 5,
  url: 'https://github.com/owner/repo/blob/abcdef1234567890/README.md#L3-L5',
  excerpt: 'Example content',
  retrievedAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

describe('parseCitationToken', () => {
  it('parses dash and colon citation formats with and without line ranges', () => {
    expect(parseCitationToken('/docs/deployment.md - 183-201')).toEqual({ path: 'docs/deployment.md', lineStart: 183, lineEnd: 201 });
    expect(parseCitationToken('README.md - 3')).toEqual({ path: 'README.md', lineStart: 3, lineEnd: 3 });
    expect(parseCitationToken('docs/guide.md:12')).toEqual({ path: 'docs/guide.md', lineStart: 12, lineEnd: 12 });
  });

  it('rejects commands, prose, and tokens without path separators', () => {
    expect(parseCitationToken('npm run dev')).toBeNull();
    expect(parseCitationToken('pnpm install')).toBeNull();
    expect(parseCitationToken('some text without line numbers')).toBeNull();
    expect(parseCitationToken('42')).toBeNull();
  });
});

describe('resolveCitation', () => {
  it('prefers path match with line overlap, then path match, then suffix match', () => {
    const evidences = [
      evidence({ id: 'a', path: 'README.md', lineStart: 1, lineEnd: 17 }),
      evidence({ id: 'b', path: 'README.md', lineStart: 9, lineEnd: 11 }),
      evidence({ id: 'c', path: 'docs/nested/README.md', lineStart: 1, lineEnd: 4 }),
    ];
    expect(resolveCitation('/README.md - 9-10', evidences)?.id).toBe('b');
    // 未覆盖行号时回退到同路径证据中最精确（行区间最小）的一条。
    expect(resolveCitation('/README.md - 100-120', evidences)?.id).toBe('b');
    expect(resolveCitation('/nested/README.md - 2-3', evidences)?.id).toBe('c');
  });

  it('returns null for non-citation tokens or empty evidence lists', () => {
    expect(resolveCitation('npm run dev', [evidence({})])).toBeNull();
    expect(resolveCitation('/README.md - 1-2', [])).toBeNull();
  });
});

describe('stripCitationsForCopy', () => {
  it('removes inline citation spans while keeping prose readable', () => {
    expect(stripCitationsForCopy('Install with `pnpm install` /README.md - 9-11'.replace(' /README.md - 9-11', ' `/README.md - 9-11`')))
      .toBe('Install with `pnpm install`');
    expect(stripCitationsForCopy('First run `pnpm dev`.\n\nSee `/README.md - 3-5` for details.'))
      .toBe('First run `pnpm dev`.\n\nSee for details.');
  });

  it('keeps fenced code blocks and normal inline code untouched', () => {
    const content = [
      'Before `/README.md - 1-2`.',
      '',
      '```bash',
      'pnpm install # not a citation - 3-4',
      '```',
      '',
      'After `docs/config.md:5`.',
    ].join('\n');
    const cleaned = stripCitationsForCopy(content);
    expect(cleaned).toContain('pnpm install # not a citation - 3-4');
    expect(cleaned).not.toContain('/README.md - 1-2');
    expect(cleaned).not.toContain('`docs/config.md:5`');
    expect(cleaned).toContain('After .');
  });
});

describe('citationAnchorUrl', () => {
  it('appends the line anchor when missing and keeps existing anchors', () => {
    expect(citationAnchorUrl(evidence({ url: 'https://github.com/o/r/blob/sha/file.md' })))
      .toBe('https://github.com/o/r/blob/sha/file.md#L3-L5');
    expect(citationAnchorUrl(evidence({ url: 'https://github.com/o/r/blob/sha/file.md#L9' })))
      .toBe('https://github.com/o/r/blob/sha/file.md#L9');
  });
});
