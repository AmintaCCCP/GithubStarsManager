/**
 * Vectorize metadata compaction helpers.
 *
 * Kept intentionally free of `@cloudflare/workers-types` so that both the Worker
 * (which sees those globals) and the app's vitest suite (type-checked against
 * tsconfig.app.json) can import it without dragging workers globals into the
 * app's TS program.
 */

export type CompactMetadata = {
  full_name: string;
  description: string;
  language: string;
  stars: number;
  tags: string[];
  license?: string;
};

/** Vectorize's hard per-vector metadata limit (10 KiB). */
export const VECTORIZE_METADATA_LIMIT_BYTES = 10_240;

/**
 * Keep a margin below Vectorize's 10 KiB per-vector metadata limit so that
 * future small fields or JSON escape overhead do not turn a valid payload into
 * a 40016.
 */
export const VECTORIZE_METADATA_SAFE_BYTES = 9_500;

const encoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value) ?? '');
}

/** Truncate on Unicode code-point boundaries, using UTF-8 bytes rather than JS characters. */
export function truncateUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  if (utf8ByteLength(value) <= maxBytes) return value;

  const codePoints = Array.from(value);
  let low = 0;
  let high = codePoints.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (utf8ByteLength(codePoints.slice(0, middle).join('')) <= maxBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return codePoints.slice(0, low).join('');
}

/** Coerce an arbitrary input into the well-typed six-field schema. Only used as a fallback. */
function normalizeMetadata(input: unknown): CompactMetadata {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const metadata: CompactMetadata = {
    full_name: typeof source.full_name === 'string' ? source.full_name : '',
    description: typeof source.description === 'string' ? source.description : '',
    language: typeof source.language === 'string' ? source.language : '',
    stars: typeof source.stars === 'number' && Number.isFinite(source.stars) ? source.stars : 0,
    tags: Array.isArray(source.tags)
      ? source.tags.filter((tag): tag is string => typeof tag === 'string')
      : [],
  };
  if (typeof source.license === 'string') metadata.license = source.license;
  return metadata;
}

function truncateTags(tags: string[], maxBytes: number): string[] {
  if (maxBytes <= 0) return [];
  const result: string[] = [];
  for (const tag of tags) {
    const candidate = [...result, tag];
    if (jsonByteLength(candidate) <= maxBytes) {
      result.push(tag);
      continue;
    }

    // Keep a prefix of the first tag that does not fit, then stop: later tags
    // cannot be more useful than the already retained prefix under this budget.
    const codePoints = Array.from(tag);
    let low = 0;
    let high = codePoints.length;
    let best = '';
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const shortened = codePoints.slice(0, middle).join('');
      if (jsonByteLength([...result, shortened]) <= maxBytes) {
        best = shortened;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    if (best) result.push(best);
    break;
  }
  return result;
}

/**
 * Compact one vector's metadata independently of the rest of its batch.
 *
 * Priority, from least to most destructive:
 * 1. Metadata already within the budget is returned untouched, preserving every
 *    field — including any outside the known schema.
 * 2. Over budget: the variable `description` / `tags` fields are reduced first
 *    (largest field first, then both together) while every other field, known or
 *    unknown, is preserved.
 * 3. Still over budget: fall back to the six-field schema with truncated fixed
 *    fields, protecting against malformed input such as an enormous license or
 *    repository name.
 */
export function compactVectorMetadata(input: unknown): Record<string, unknown> {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : null;
  if (source && jsonByteLength(source) <= VECTORIZE_METADATA_SAFE_BYTES) {
    return { ...source };
  }

  const metadata = normalizeMetadata(input);
  if (jsonByteLength(metadata) <= VECTORIZE_METADATA_SAFE_BYTES) {
    return { ...metadata };
  }

  const variableBytes = Math.max(
    utf8ByteLength(metadata.description),
    jsonByteLength(metadata.tags),
  );
  let low = 0;
  let high = variableBytes;
  let best: Record<string, unknown> = { ...metadata, description: '', tags: [] };

  // A shared cap implements the "largest field first, then both together"
  // policy: a smaller field is untouched until the larger one reaches it.
  while (low <= high) {
    const cap = Math.floor((low + high) / 2);
    const candidate: Record<string, unknown> = {
      ...(source ?? metadata),
      description: truncateUtf8(metadata.description, cap),
      tags: truncateTags(metadata.tags, cap),
    };
    if (jsonByteLength(candidate) <= VECTORIZE_METADATA_SAFE_BYTES) {
      best = candidate;
      low = cap + 1;
    } else {
      high = cap - 1;
    }
  }

  if (jsonByteLength(best) <= VECTORIZE_METADATA_SAFE_BYTES) return best;

  // The known fields are already small; this final fallback protects against
  // malformed input such as an enormous license, repository name, or unknown field.
  const fallback: CompactMetadata = {
    full_name: truncateUtf8(metadata.full_name, 512),
    description: '',
    language: truncateUtf8(metadata.language, 128),
    stars: metadata.stars,
    tags: [],
  };
  if (metadata.license) fallback.license = truncateUtf8(metadata.license, 256);
  if (jsonByteLength(fallback) > VECTORIZE_METADATA_SAFE_BYTES) delete fallback.license;
  return fallback;
}

/**
 * Apply per-vector metadata compaction at the /upsert boundary.
 * Preserves every top-level vector property (id, values, namespace, …) while
 * replacing `metadata` with its compacted form.
 */
export function compactUpsertVectors<T extends { metadata?: unknown }>(
  vectors: readonly T[],
): Array<T & { metadata: Record<string, unknown> }> {
  return vectors.map((vector) => ({
    ...vector,
    metadata: compactVectorMetadata(vector.metadata),
  }));
}