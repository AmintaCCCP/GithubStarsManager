import { describe, expect, it } from 'vitest';
import { buildFinalApiUrl } from './apiUrlBuilder';

describe('buildFinalApiUrl', () => {
  it('completes a pasted version root for openai-compatible endpoints', () => {
    expect(buildFinalApiUrl('https://api.example.com/v1', 'openai-compatible'))
      .toBe('https://api.example.com/v1/chat/completions');
  });

  it('keeps explicit openai-compatible endpoints unchanged', () => {
    expect(buildFinalApiUrl('https://api.example.com/v1/chat/completions', 'openai-compatible'))
      .toBe('https://api.example.com/v1/chat/completions');
    expect(buildFinalApiUrl('https://api.example.com/custom/invoke', 'openai-compatible'))
      .toBe('https://api.example.com/custom/invoke');
  });

  it('keeps query parameters when completing a version root', () => {
    expect(buildFinalApiUrl('https://api.example.com/v1?api-version=2024-01-01', 'openai-compatible'))
      .toBe('https://api.example.com/v1/chat/completions?api-version=2024-01-01');
  });

  it('keeps the openai version path behavior', () => {
    expect(buildFinalApiUrl('https://api.openai.com/v1', 'openai'))
      .toBe('https://api.openai.com/v1/chat/completions');
  });
});
