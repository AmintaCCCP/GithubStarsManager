import { describe, expect, it } from 'vitest';
import { inferGistCodeLanguage } from './gistUtils';

describe('inferGistCodeLanguage', () => {
  it('uses plaintext for files without an extension', () => {
    expect(inferGistCodeLanguage('mnist1')).toBe('plaintext');
  });

  it('keeps known extensionless filenames', () => {
    expect(inferGistCodeLanguage('Dockerfile')).toBe('dockerfile');
  });

  it('normalizes GitHub Text language to highlight.js plaintext', () => {
    expect(inferGistCodeLanguage('notes', 'Text')).toBe('plaintext');
  });
});
