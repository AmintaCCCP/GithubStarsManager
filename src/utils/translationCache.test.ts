import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readTranslationCache, translationCacheKey, writeTranslationCache } from './translationCache';
describe('README translation cache', () => {
  beforeEach(() => localStorage.clear());
  it('persists exact source, repository and target language', () => {
    const key = translationCacheKey('hello', 'zh', 'repo-a');
    writeTranslationCache(key, ['你好']);
    expect(readTranslationCache(key, 1)).toEqual(['你好']);
    expect(readTranslationCache(translationCacheKey('changed', 'zh', 'repo-a'), 1)).toBeUndefined();
    expect(readTranslationCache(translationCacheKey('hello', 'en', 'repo-a'), 1)).toBeUndefined();
    expect(readTranslationCache(translationCacheKey('hello', 'zh', 'repo-b'), 1)).toBeUndefined();
    expect(readTranslationCache(key, 2)).toBeUndefined();
  });
  it('does not save partial or empty translations', () => {
    writeTranslationCache('key', ['good', '']);
    expect(readTranslationCache('key', 2)).toBeUndefined();
  });
  it('tolerates corrupt and unavailable storage', () => {
    localStorage.setItem('gsm:readme-translations:v1', '{bad json');
    expect(readTranslationCache('key', 1)).toBeUndefined();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(() => writeTranslationCache('key', ['text'])).not.toThrow();
    spy.mockRestore();
  });
  it('bounds entry count and replaces existing translations', () => {
    for (let i = 0; i < 35; i++) writeTranslationCache(String(i), ['old']);
    expect(readTranslationCache('0', 1)).toBeUndefined();
    writeTranslationCache('34', ['new']);
    expect(readTranslationCache('34', 1)).toEqual(['new']);
  });
});
