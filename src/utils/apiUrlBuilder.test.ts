import { describe, expect, it } from 'vitest';
import { buildFinalApiUrl } from './apiUrlBuilder';

describe('buildFinalApiUrl', () => {
  it('preserves the Atlas Cloud version prefix', () => {
    expect(buildFinalApiUrl('https://api.atlascloud.ai/v1', 'atlascloud'))
      .toBe('https://api.atlascloud.ai/v1/chat/completions');
  });

  it('handles a trailing slash in the Atlas Cloud base URL', () => {
    expect(buildFinalApiUrl('https://api.atlascloud.ai/v1/', 'atlascloud'))
      .toBe('https://api.atlascloud.ai/v1/chat/completions');
  });
});
