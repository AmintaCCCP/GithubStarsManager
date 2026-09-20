import type { RepositoryCardFieldId, RepositoryCardFields } from '../types/repositoryCardFields';
import {
  DEFAULT_REPOSITORY_CARD_FIELDS,
  REPOSITORY_CARD_FIELD_IDS,
} from '../types/repositoryCardFields';

/**
 * 把偏好收敛成完整的字段开关表。
 *
 * 缺失或非布尔值一律回落到默认（显示）——旧快照、手改的 localStorage、以后新增的字段都走
 * 同一条路径，不需要为每个新字段单独写迁移。
 */
export const normalizeRepositoryCardFields = (value: unknown): RepositoryCardFields => {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const normalized = { ...DEFAULT_REPOSITORY_CARD_FIELDS };
  for (const id of REPOSITORY_CARD_FIELD_IDS) {
    if (typeof record[id] === 'boolean') normalized[id] = record[id] as boolean;
  }
  return normalized;
};

/** 单个字段是否可见；未提供的表按默认处理。 */
export const isRepositoryCardFieldVisible = (
  fields: RepositoryCardFields | undefined,
  id: RepositoryCardFieldId,
): boolean => (fields ? fields[id] !== false : DEFAULT_REPOSITORY_CARD_FIELDS[id]);
