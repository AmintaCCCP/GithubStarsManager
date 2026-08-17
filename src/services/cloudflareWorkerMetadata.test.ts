import { describe, expect, it } from 'vitest';
import {
  compactUpsertVectors,
  compactVectorMetadata,
  VECTORIZE_METADATA_LIMIT_BYTES,
} from '../../cloudflare-worker/src/metadata';

const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

const baseMetadata = {
  full_name: 'owner/repository',
  description: 'A short description',
  language: 'TypeScript',
  stars: 42,
  tags: ['vector-search', 'cloudflare'],
  license: 'MIT',
};

type TestMetadata = {
  full_name: string;
  description: string;
  language: string;
  stars: number;
  tags: string[];
  license?: string;
  [key: string]: unknown;
};

const compact = (input: unknown): TestMetadata => compactVectorMetadata(input) as TestMetadata;

describe('Cloudflare Worker Vectorize metadata compaction', () => {
  it('leaves metadata unchanged when it is within the budget', () => {
    expect(compact(baseMetadata)).toEqual(baseMetadata);
  });

  it('truncates a long UTF-8 description while retaining small tags', () => {
    const metadata = compact({
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
    const metadata = compact({
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
    const metadata = compact({
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

  it('preserves unknown metadata fields when the payload is within budget', () => {
    const input = {
      ...baseMetadata,
      url: 'https://github.com/owner/repository',
      source_id: 'abc-123',
      custom: 123,
    };

    expect(compact(input)).toEqual(input);
  });

  it('reduces oversized description first while keeping unknown fields', () => {
    const metadata = compact({
      ...baseMetadata,
      description: 'x'.repeat(20_000),
      url: 'https://github.com/owner/repository',
    });

    expect(jsonBytes(metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(metadata.description.length).toBeLessThan(20_000);
    expect(metadata.url).toBe('https://github.com/owner/repository');
  });

  it('drops unknown fields only in the final fallback when they cannot fit', () => {
    const metadata = compact({
      full_name: baseMetadata.full_name,
      description: '',
      language: baseMetadata.language,
      stars: baseMetadata.stars,
      tags: [],
      license: baseMetadata.license,
      url: 'u'.repeat(100_000),
    });

    expect(jsonBytes(metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(metadata.full_name).toBe(baseMetadata.full_name);
    expect(metadata).not.toHaveProperty('url');
  });

  it('applies compaction to each vector at the upsert boundary', () => {
    const vectors = [
      { id: '1', values: [0.1, 0.2], namespace: 'a', metadata: baseMetadata },
      {
        id: '2',
        values: [0.3],
        namespace: 'b',
        metadata: { ...baseMetadata, description: 'x'.repeat(20_000), url: 'https://example.com' },
      },
    ];

    const compacted = compactUpsertVectors(vectors);

    // vector identity / top-level fields are preserved untouched
    expect(compacted[0].id).toBe('1');
    expect(compacted[0].values).toEqual([0.1, 0.2]);
    expect(compacted[0].namespace).toBe('a');
    // within-budget metadata is passed through byte-for-byte
    expect(compacted[0].metadata).toEqual(baseMetadata);

    // oversized metadata is compacted but keeps unknown fields
    expect(jsonBytes(compacted[1].metadata)).toBeLessThanOrEqual(VECTORIZE_METADATA_LIMIT_BYTES);
    expect(compacted[1].metadata.url).toBe('https://example.com');
    expect((compacted[1].metadata.description as string).length).toBeLessThan(20_000);
    expect(compacted[1].namespace).toBe('b');
  });

  it('keeps metadata omitted when a vector has no metadata property', () => {
    const compacted = compactUpsertVectors([
      { id: '3', values: [0.9], namespace: 'c' },
      { id: '4', values: [0.8], namespace: 'd', metadata: undefined },
    ]);

    expect(compacted[0]).not.toHaveProperty('metadata');
    expect(compacted[0].id).toBe('3');
    expect(compacted[0].namespace).toBe('c');
    expect(compacted[1].metadata).toBeUndefined();
    expect(compacted[1].id).toBe('4');
  });
});
