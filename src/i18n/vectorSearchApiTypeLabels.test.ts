import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES } from './languages';
import {
  DEFAULT_EMBEDDING_DIMENSIONS,
  EMBEDDING_API_TYPES,
  embeddingApiTypeLabelKey,
} from '../constants/embeddingApiTypes';

/**
 * 设置页「模型来源」按钮文案走动态键（`vectorSearchSettings.api-type-*`），
 * scripts/check-i18n.cjs 只校验字面量 t('key')，模板键不在其覆盖范围。
 * 这里补上这段保护：任一语言漏配就会露出 raw key，新增来源也会被拦下。
 */
const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');

const loadLabelStrings = (language: string): Record<string, unknown> => {
  const content = JSON.parse(
    readFileSync(path.join(localesDir, language, 'app.json'), 'utf8'),
  ) as { vectorSearchSettings?: Record<string, unknown> };
  return content.vectorSearchSettings ?? {};
};

const localLabelKey = (apiType: (typeof EMBEDDING_API_TYPES)[number]): string =>
  embeddingApiTypeLabelKey(apiType).replace(/^vectorSearchSettings\./, '');

describe('向量搜索「模型来源」文案覆盖', () => {
  it.each(APP_LANGUAGES)('$code 覆盖全部 EmbeddingApiType 且不是 raw key', (language) => {
    const strings = loadLabelStrings(language.code);
    const missing = EMBEDDING_API_TYPES.map(localLabelKey).filter(
      (key) => typeof strings[key] !== 'string' || (strings[key] as string).trim() === '',
    );
    expect(missing).toEqual([]);
    const rawKeyValues = EMBEDDING_API_TYPES.map(localLabelKey).filter(
      (key) => strings[key] === `vectorSearchSettings.${key}`,
    );
    expect(rawKeyValues).toEqual([]);
  });

  it('来源列表无重复且与默认维度表一一对应', () => {
    expect([...EMBEDDING_API_TYPES].sort()).toEqual(
      Object.keys(DEFAULT_EMBEDDING_DIMENSIONS).sort(),
    );
    expect(new Set(EMBEDDING_API_TYPES).size).toBe(EMBEDDING_API_TYPES.length);
  });
});
