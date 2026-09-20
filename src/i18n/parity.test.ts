import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES } from './languages';

/**
 * 翻译键集一致性检查：内置语言必须与 zh 键集完全相等。
 * 缺键会露出 raw key 或回退英文；孤儿键说明源字典改了名却没清干净。
 * 值是否各自翻译由 scripts/check-i18n.cjs 在 PR diff 上检查。
 */
const localesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'locales');

const collectKeys = (value: unknown, prefix = ''): string[] => {
  if (value === null || typeof value !== 'object') return prefix ? [prefix] : [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
};

const loadLanguageKeys = (): Record<string, Set<string>> => {
  const result: Record<string, Set<string>> = {};
  for (const language of APP_LANGUAGES) {
    const dir = path.join(localesDir, language.code);
    const keys = new Set<string>();
    if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const namespace = file.replace(/\.json$/, '');
        const content = JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as Record<string, unknown>;
        for (const key of collectKeys(content)) keys.add(`${namespace}:${key}`);
      }
    }
    result[language.code] = keys;
  }
  return result;
};

describe('i18n 字典键集一致性', () => {
  const keys = loadLanguageKeys();

  it.each(APP_LANGUAGES)('$code 与 zh 键集严格相等', (language) => {
    const zhKeys = [...keys.zh].sort();
    const current = [...keys[language.code]].sort();
    expect(current).toEqual(zhKeys);
  });
});
