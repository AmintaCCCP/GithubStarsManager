const STORAGE_KEY = 'gsm:readme-translations:v1';
const MAX_CHARS = 1_000_000;
interface Entry { key: string; texts: string[] }
// Store the exact source in the identity: no hash collisions or stale README reuse.
export const translationCacheKey = (markdown: string, language: string, baseUrl = '') =>
  JSON.stringify([baseUrl, language, markdown]);
function entries(): Entry[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((e): e is Entry =>
      e && typeof e.key === 'string' && Array.isArray(e.texts) && e.texts.every((t: unknown) => typeof t === 'string')) : [];
  } catch { return []; }
}
export function readTranslationCache(key: string, count: number): string[] | undefined {
  const entry = entries().find(e => e.key === key);
  return entry?.texts.length === count && entry.texts.every(t => t.trim()) ? entry.texts : undefined;
}
export function writeTranslationCache(key: string, texts: string[]): void {
  if (!texts.length || texts.some(t => !t.trim())) return;
  let next = [{ key, texts }, ...entries().filter(e => e.key !== key)].slice(0, 30);
  while (next.length && JSON.stringify(next).length > MAX_CHARS) next.pop();
  if (!next.length) return;
  // Quota/disabled storage must never break translation. Evict older entries first.
  while (next.length) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); return; }
    catch { next = next.slice(0, -1); }
  }
}
