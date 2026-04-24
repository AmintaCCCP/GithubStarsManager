import { describe, it, expect } from 'vitest';
import { stripMarkdownFormatting } from '../utils/markdownUtils';

describe('stripMarkdownFormatting', () => {
  it('should remove bold formatting', () => {
    expect(stripMarkdownFormatting('**bold text**')).toBe('bold text');
  });

  it('should remove italic formatting', () => {
    expect(stripMarkdownFormatting('*italic text*')).toBe('italic text');
  });

  it('should remove inline code formatting', () => {
    expect(stripMarkdownFormatting('`code`')).toBe('code');
  });

  it('should remove link formatting but keep text', () => {
    expect(stripMarkdownFormatting('[link text](https://example.com)')).toBe('link text');
  });

  it('should remove strikethrough formatting', () => {
    expect(stripMarkdownFormatting('~~strikethrough~~')).toBe('strikethrough');
  });

  it('should remove image formatting but keep alt text', () => {
    expect(stripMarkdownFormatting('![alt text](https://example.com/image.png)')).toBe('alt text');
  });

  it('should handle multiple formatting in one line', () => {
    expect(stripMarkdownFormatting('**bold** and *italic* and `code`')).toBe('bold and italic and code');
  });

  it('should handle nested formatting', () => {
    expect(stripMarkdownFormatting('**bold with *italic* inside**')).toBe('bold with italic inside');
  });

  it('should collapse multiple spaces', () => {
    expect(stripMarkdownFormatting('text   with   multiple   spaces')).toBe('text with multiple spaces');
  });

  it('should trim whitespace', () => {
    expect(stripMarkdownFormatting('  trimmed text  ')).toBe('trimmed text');
  });

  it('should handle empty string', () => {
    expect(stripMarkdownFormatting('')).toBe('');
  });

  it('should handle plain text without formatting', () => {
    expect(stripMarkdownFormatting('plain text')).toBe('plain text');
  });

  it('should handle complex markdown heading', () => {
    const input = '## **Installation** Guide';
    expect(stripMarkdownFormatting(input)).toBe('## Installation Guide');
  });

  it('should handle link with formatting inside', () => {
    const input = '[**bold link**](https://example.com)';
    expect(stripMarkdownFormatting(input)).toBe('bold link');
  });

  it('should handle Chinese characters', () => {
    expect(stripMarkdownFormatting('**中文加粗**')).toBe('中文加粗');
    expect(stripMarkdownFormatting('[链接文本](https://example.com)')).toBe('链接文本');
  });
});
