import { describe, expect, it } from 'vitest';
import { remendStreamingMarkdown } from './streamingMarkdown';

describe('remendStreamingMarkdown', () => {
  it('closes an open code fence before the stream completes', () => {
    expect(remendStreamingMarkdown('Run this:\n\n```bash\nnpm install')).toBe(
      'Run this:\n\n```bash\nnpm install\n```\n\n▍',
    );
  });

  it('withholds an unfinished inline citation token', () => {
    expect(remendStreamingMarkdown('Answer `/README.md - 9')).toBe('Answer ▍');
  });

  it('does not treat an escaped backtick as an unfinished inline code span', () => {
    expect(remendStreamingMarkdown('Use \\`literal\\` backticks')).toBe('Use \\`literal\\` backticks ▍');
  });

  it('keeps multiline emphasis visible while streaming', () => {
    expect(remendStreamingMarkdown('**first line\nsecond line**')).toBe('**first line\nsecond line** ▍');
  });

  it('keeps complete inline tokens and returns an empty cursor for empty output', () => {
    expect(remendStreamingMarkdown('Answer `/README.md - 9-12`')).toBe('Answer `/README.md - 9-12` ▍');
    expect(remendStreamingMarkdown('')).toBe('');
  });

  it('does not drop plain parentheses or complete links after a link', () => {
    expect(remendStreamingMarkdown('See [docs](https://example.com) (partial')).toBe(
      'See [docs](https://example.com) (partial ▍',
    );
    expect(remendStreamingMarkdown('See [docs](')).toBe('See ▍');
  });
});
