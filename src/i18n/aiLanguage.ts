import { FALLBACK_LANGUAGE, isAppLanguage, languageDefinition, type AppLanguage } from './languages';

/**
 * AI prompt 语言策略（业务约束：AI 生成内容与用户设置的 UI 语言一致）。
 *
 * - zh 永远走 zh 模板，其余语言统一走 en 模板：zh/en 的 prompt 字节不变，
 *   新语言的行为与今天 en 用户完全一致（fixture 快照锁定）。
 * - 生成型 prompt（仓库分析/Gist/Release/仓库对话回答）在非 zh/en 语言下追加
 *   输出语言指令，使 AI 产物跟随 UI 语言。
 * - HyDE/rerank/精选搜索/工具循环等内部检索与结构化 prompt 不注入指令——
 *   强制目标语言会改变 embedding 查询与搜索排序行为。
 */
export type PromptTemplateLanguage = 'zh' | 'en';

export const resolvePromptTemplateLang = (language: AppLanguage | string): PromptTemplateLanguage =>
  language === 'zh' ? 'zh' : 'en';

/** 面向用户输出的语言指令；zh/en 返回空串（保持既有 prompt 逐字节不变）。 */
export const getOutputLanguageDirective = (language: AppLanguage | string): string => {
  // 先规范化：aiService 的 language 是自由 string，非法值（如旧数据）统一按英文回退处理
  const normalized = isAppLanguage(language) ? language : FALLBACK_LANGUAGE;
  if (normalized === 'zh' || normalized === 'en') return '';
  const definition = languageDefinition(normalized);
  return `IMPORTANT: Write ALL user-facing output in ${definition.englishName} (${definition.nativeName}). Keep code, identifiers, and technical terms in their original form.`;
};
