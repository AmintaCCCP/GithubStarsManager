/**
 * 仓库卡片可见字段（开发守则 §14）。
 *
 * 只保存"哪些字段显示"这一份声明式数据；卡片渲染时按它决定是否渲染对应片段，
 * 不涉及任何 HTML / JS / React 组件的注入。
 */

export type RepositoryCardFieldId =
  | 'description'
  | 'tags'
  | 'language'
  | 'stars'
  | 'license'
  | 'lastUpdated';

export const REPOSITORY_CARD_FIELD_IDS: readonly RepositoryCardFieldId[] = [
  'description',
  'tags',
  'language',
  'stars',
  'license',
  'lastUpdated',
];

export type RepositoryCardFields = Record<RepositoryCardFieldId, boolean>;

/** 默认全开：升级上来的用户看到的东西不该变。 */
export const DEFAULT_REPOSITORY_CARD_FIELDS: RepositoryCardFields = {
  description: true,
  tags: true,
  language: true,
  stars: true,
  license: true,
  lastUpdated: true,
};
