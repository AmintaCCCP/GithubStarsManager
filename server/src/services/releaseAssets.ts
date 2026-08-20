const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value > 0;

export function serializeUpdatedAssetIds(value: unknown): string {
  let candidate: unknown = value;
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value);
    } catch {
      candidate = [];
    }
  }
  if (!Array.isArray(candidate)) return '[]';

  const ids = candidate.filter(isPositiveInteger);
  return JSON.stringify([...new Set(ids)]);
}

export function parseUpdatedAssetIds(value: unknown): number[] {
  if (typeof value !== 'string' || !value) return [];

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isPositiveInteger) : [];
  } catch {
    return [];
  }
}
