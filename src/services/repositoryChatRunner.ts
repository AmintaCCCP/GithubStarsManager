import { isAIToolCallUnsupportedError, supportsChatToolCalls } from './aiService';
import {
  runEvidenceDrivenRepositoryChatTurn,
  type RepositoryChatTurnInput,
  type RepositoryChatTurnResult,
} from './repositoryChatService';
import { runToolLoopRepositoryChatTurn } from './agentToolLoop';

/**
 * 仓库问答的执行入口：按设置与 AI 配置能力在两个执行循环间分派。
 * 独立成模块以保持依赖单向——repositoryChatService（编排式循环与共享
 * 取证底座）与 agentToolLoop（受控工具循环）互不引用。
 */

/** 后端代理通道不保留 AIToolCallUnsupportedError 类型：以 4xx 配置类状态码兜底识别端点拒绝。 */
const isEndpointRejectionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const carrier = error as { status?: unknown; statusCode?: unknown };
  const status = carrier.status ?? carrier.statusCode;
  return status === 400 || status === 404 || status === 422;
};

export const runRepositoryChatTurn = async (input: RepositoryChatTurnInput): Promise<RepositoryChatTurnResult> => {
  // 受控工具循环（实验性）：仅在设置开启、AI 配置协议族支持且用户显式勾选
  // “支持工具调用”时启用；端点不支持工具调用时本轮自动落回编排式循环。
  if (input.enableAgentToolLoop && supportsChatToolCalls(input.aiConfig)) {
    try {
      return await runToolLoopRepositoryChatTurn(input);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (!isAIToolCallUnsupportedError(error) && !isEndpointRejectionError(error)) throw error;
    }
  }
  return await runEvidenceDrivenRepositoryChatTurn(input);
};
