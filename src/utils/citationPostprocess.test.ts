import { describe, expect, it } from 'vitest';
import {
  collapseCitationRuns,
  fenceMarker,
  isClosingFence,
  liftStandaloneCitationLines,
  postprocessCitationLayout,
} from './citationPostprocess';

const count = (value: string, token: string): number => value.split(token).length - 1;

describe('liftStandaloneCitationLines', () => {
  it('moves a citation after a code block onto the introducing sentence', () => {
    const content = [
      'Install with one command:',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
      '',
      '`/README.md - 94-119`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result).toBe([
      'Install with one command: `/README.md - 94-119`',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
    ].join('\n'));
  });

  it('moves a citation after consecutive code blocks onto the introducing sentence', () => {
    const content = [
      'Install with one command:',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
      '',
      '```bash',
      'npx skills list',
      '```',
      '',
      '`/README.md - 94-119`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result).toBe([
      'Install with one command: `/README.md - 94-119`',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
      '',
      '```bash',
      'npx skills list',
      '```',
    ].join('\n'));
  });

  it('keeps a Setext underline intact when lifting a citation after a code block', () => {
    for (const underline of ['---', '===']) {
      const content = [
        'Installation',
        underline,
        '',
        '```bash',
        'npx skills add owner/repo',
        '```',
        '',
        '`/README.md - 94-119`',
      ].join('\n');
      const result = liftStandaloneCitationLines(content);
      expect(result).toBe([
        'Installation `/README.md - 94-119`',
        underline,
        '',
        '```bash',
        'npx skills add owner/repo',
        '```',
      ].join('\n'));
    }
  });

  it('skips a thematic break when lifting a citation after a code block', () => {
    const content = [
      'Runtime requirements:',
      '',
      '---',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
      '',
      '`/README.md - 94-119`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result).toBe([
      'Runtime requirements: `/README.md - 94-119`',
      '',
      '---',
      '',
      '```bash',
      'npx skills add owner/repo',
      '```',
    ].join('\n'));
  });

  it('moves citations after tables onto the introducing sentence', () => {
    const content = [
      'Runtime requirements:',
      '',
      '| Tool | Purpose |',
      '| --- | --- |',
      '| npm | install |',
      '',
      '`/README.md - 1-5`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result.startsWith('Runtime requirements: `/README.md - 1-5`')).toBe(true);
  });

  it('moves citations after a table onto an introducing sentence containing a pipe', () => {
    const content = [
      'Compare a || b:',
      '',
      '| Left | Right |',
      '| --- | --- |',
      '| a | b |',
      '',
      '`/README.md - 1-5`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result.startsWith('Compare a || b: `/README.md - 1-5`')).toBe(true);
  });

  it('attaches a citation after a list to the list instead of the preceding fence', () => {
    const content = [
      'Run this:',
      '',
      '```bash',
      'npm install',
      '```',
      '',
      '- Node.js',
      '- ffmpeg',
      '',
      '`/README.md - 1-5`',
    ].join('\n');
    const result = liftStandaloneCitationLines(content);
    expect(result).toBe([
      'Run this:',
      '',
      '```bash',
      'npm install',
      '```',
      '',
      '- Node.js',
      '- ffmpeg `/README.md - 1-5`',
    ].join('\n'));
  });
});

describe('fence parsing', () => {
  it('does not treat a tab-indented fence as a fenced code block', () => {
    expect(fenceMarker('\t```')).toBeNull();
    expect(isClosingFence('\t```', { char: '`', length: 3 })).toBe(false);
    expect(fenceMarker('   ```')).toEqual({ char: '`', length: 3 });
  });
});

describe('collapseCitationRuns', () => {
  it('deduplicates adjacent citations and keeps at most three distinct sources', () => {
    const result = collapseCitationRuns(
      'Answer `/README.md - 1` `/README.md - 1` `/docs/a.md - 2` `/docs/b.md - 3` `/docs/c.md - 4`.',
    );
    expect(result).toBe('Answer `/README.md - 1` `/docs/a.md - 2` `/docs/b.md - 3`.');
  });
});

describe('postprocessCitationLayout', () => {
  it('keeps only the last copy of the same source within a paragraph', () => {
    const result = postprocessCitationLayout(
      'First fact `/README.md - 1`. Second fact `/README.md - 1`.',
    );
    expect(count(result, '`/README.md - 1`')).toBe(1);
    expect(result).toContain('Second fact `/README.md - 1`.');
  });

  it('preserves list indentation and internal spacing while deduplicating', () => {
    const result = postprocessCitationLayout([
      'Root fact `/README.md - 1`',
      '  - child fact `/README.md - 1`',
      '  - other   spaced',
    ].join('\n'));
    expect(result).toBe([
      'Root fact',
      '  - child fact `/README.md - 1`',
      '  - other   spaced',
    ].join('\n'));
  });

  it('does not rewrite citation-like text inside fenced code blocks', () => {
    const content = [
      '```text',
      '`/README.md - 1`',
      '`/README.md - 1`',
      '```',
      '',
      'Outside `/README.md - 1` `/README.md - 1`.',
    ].join('\n');
    const result = postprocessCitationLayout(content);
    expect(count(result, '`/README.md - 1`')).toBe(3);
  });

  it('preserves whitespace and citation-like lines inside fenced code blocks', () => {
    const content = [
      'Example:',
      '',
      '```text',
      'line  1',
      '',
      '',
      '`/README.md - 1`',
      '```',
      '',
      'Outside `/README.md - 1` `/README.md - 1`.',
    ].join('\n');
    const result = postprocessCitationLayout(content);
    expect(result).toContain('line  1\n\n\n`/README.md - 1`');
    expect(count(result, '`/README.md - 1`')).toBe(2);
  });

  it('repairs a malformed citation range and removes an empty parenthesis', () => {
    const result = postprocessCitationLayout('Runs on TTYs () and shipped in `/release.md - 1-以24`.');

    expect(result).toBe('Runs on TTYs and shipped in `/release.md - 1-24`.');
  });

  it('keeps empty parentheses that are part of inline code', () => {
    const result = postprocessCitationLayout('Call `initialize()` before use ().');

    expect(result).toBe('Call `initialize()` before use.');
  });

  it('does not rewrite hyphenated paths inside inline code', () => {
    const result = postprocessCitationLayout('Requests go to `/api/v1-1-rc2`.');

    expect(result).toBe('Requests go to `/api/v1-1-rc2`.');
  });

  it('keeps empty parentheses inside markdown link targets', () => {
    const result = postprocessCitationLayout('See [API](https://example.com/run()) docs.');

    expect(result).toBe('See [API](https://example.com/run()) docs.');
  });
});
