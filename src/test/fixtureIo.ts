import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * i18n 迁移保障网：把迁移前的行为固化为 JSON fixture。
 * 用 UPDATE_I18N_FIXTURES=1 重新生成；默认严格比对，任何字节级差异都会失败。
 */
export const fixturePath = (importMetaUrl: string, relative: string): string =>
  path.join(path.dirname(fileURLToPath(importMetaUrl)), relative);

export const readFixture = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'));

export const writeFixture = (file: string, data: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
};

export const shouldUpdateFixtures = (): boolean => process.env.UPDATE_I18N_FIXTURES === '1';
