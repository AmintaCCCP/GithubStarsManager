import type { EmbeddingApiType } from '../types';

/**
 * Embedding 模型来源（设置页「模型来源」按钮组）。放在 constants 层的原因与
 * aiCapabilities.ts 一致：设置页视图组件与 i18n 字典键覆盖测试共用同一份
 * 来源，新增来源却漏配展示文案时测试立刻失败，避免界面露出 raw key。
 * （ADR 0001：视图组件不直接依赖 services。）
 */
export const EMBEDDING_API_TYPES: readonly EmbeddingApiType[] = [
  'openai',
  'openai-compatible',
  'siliconflow',
  'gemini',
  'cohere',
  'ollama',
];

/** 各来源的默认向量维度，切换来源时预填，必须与 Vectorize 索引维度一致。 */
export const DEFAULT_EMBEDDING_DIMENSIONS: Record<EmbeddingApiType, number> = {
  openai: 1536,
  'openai-compatible': 1536,
  siliconflow: 1024,
  gemini: 768,
  cohere: 1024,
  ollama: 768,
};

/**
 * 展示文案的字典键（app 命名空间）：后缀与 EmbeddingApiType 取值一一对应，
 * 例如 'siliconflow' → 'vectorSearchSettings.api-type-siliconflow'。
 */
export const embeddingApiTypeLabelKey = (apiType: EmbeddingApiType): string =>
  `vectorSearchSettings.api-type-${apiType}`;
