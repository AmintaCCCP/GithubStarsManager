import { describe, expect, it } from 'vitest';
import {
  compactVectorMetadata,
  VECTORIZE_METADATA_LIMIT_BYTES,
} from '../../cloudflare-worker/src/index';

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const baseMetadata = {
  full_name: 'owner/repository',
  description: 'A short description',
  language: 'TypeScript',
  stars: 42,
  tags: ['vector-search', 'cloudflare'],
  license: 'MIT',
};

describe('Cloudflare Worker Vectorize metadata compaction', () => {
  it('leaves metadata unchanged when it is within the budget', () => {
    expect(compactVectorMetadata(baseMetadata)).toEqual(baseMetadata);
  });

  it('truncates a long UTF-8 description while retaining small tags', () => {
    const metadata = compactVectorMetadata({
      ...baseMetadata,
      description: '中文描述'.repeat(7_000),
      tags: ['semantic-search'],
    });

    expect(jsonBytes(metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(metadata.description).not.toBe('中文描述'.repeat(7_000));
    expect(metadata.description).toContain('中文描述');
    expect(metadata.tags).toEqual(['semantic-search']);
    expect(metadata.description).not.toContain('\uFFFD');
  });

  it('compresses both description and tags when both fields are oversized', () => {
    const description = 'd'.repeat(20_000);
    const tag = '标签'.repeat(8_000);
    const metadata = compactVectorMetadata({
      ...baseMetadata,
      description,
      tags: [tag],
    });

    expect(jsonBytes(metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(metadata.description.length).toBeLessThan(description.length);
    expect(metadata.tags[0]?.length ?? 0).toBeLessThan(tag.length);
    expect(metadata.full_name).toBe(baseMetadata.full_name);
    expect(metadata.language).toBe(baseMetadata.language);
    expect(metadata.stars).toBe(baseMetadata.stars);
  });

  it('protects the limit from a malformed oversized license field', () => {
    const metadata = compactVectorMetadata({
      ...baseMetadata,
      description: '',
      tags: [],
      license: 'license'.repeat(20_000),
    });

    expect(jsonBytes(metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(metadata.full_name).toBe(baseMetadata.full_name);
    expect(metadata.language).toBe(baseMetadata.language);
    expect(metadata.stars).toBe(baseMetadata.stars);
  });
});
