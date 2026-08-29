import type { AIApiType } from '../types';

/**
 * 原生工具调用目前仅覆盖 OpenAI chat completions 线格式的一族协议
 * （其余协议走编排式循环）。常量放在 constants 层：aiService 的运行时
 * 能力判定与设置页 UI 的勾选项展示共用同一份来源，避免两处漂移，同时
 * 满足视图组件禁止直接依赖 services 的分层规则（ADR 0001）。
 */
export const CHAT_TOOL_CALL_API_TYPES: ReadonlySet<AIApiType> = new Set<AIApiType>(['openai', 'deepseek', 'mimo', 'openai-compatible']);

/** 协议族本身是否属于可支持工具调用的一族（仅用于 UI 展示勾选项）。 */
export function isToolCallCapableApiType(apiType?: AIApiType): boolean {
  return CHAT_TOOL_CALL_API_TYPES.has(apiType || 'openai');
}
