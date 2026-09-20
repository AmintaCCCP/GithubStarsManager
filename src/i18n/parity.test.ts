import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_LANGUAGES } from './languages';

/**
 * 翻译键集一致性检查：zh ↔ en 键集必须严格相等（两者的值是迁移源头，
 * 缺键会直接暴露给用户）；其余语言允许暂缺（运行时回退 en），但存在的
 * 键不得超出 zh/en 键集（孤儿键说明源字典改了名）。
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

  it('zh 与 en 键集严格相等', () => {
    const zhKeys = [...keys.zh].sort();
    const enKeys = [...keys.en].sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it.each(APP_LANGUAGES.filter((language) => language.code !== 'zh' && language.code !== 'en'))(
    '$code 不包含 zh/en 之外的孤儿键',
    (language) => {
      const extra = [...keys[language.code]].filter((key) => !keys.zh.has(key));
      expect(extra).toEqual([]);
    },
  );
});
