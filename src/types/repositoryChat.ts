export interface RepositoryChatRepoSnapshot {
  ownerLogin: string;
  ownerAvatarUrl: string;
  htmlUrl: string;
  description?: string;
  language?: string;
}

export interface RepositoryChatSession {
  id: string;
  repoId: number;
  /** Stable GitHub numeric account id. Legacy sessions may only have accountLogin. */
  accountId?: string;
  accountLogin?: string;
  repoFullName: string;
  sourceRefSha: string;
  title: string;
  summary?: string;
  modelConfigId?: string | null;
  modelLabelAtTime?: string;
  repoSnapshot?: RepositoryChatRepoSnapshot;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface RepositoryChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  status: 'complete' | 'streaming' | 'error' | 'aborted';
  evidenceIds: string[];
  createdAt: string;
}

export type RepositoryChatExecutionStage =
  | 'understanding'
  | 'context'
  | 'planning'
  | 'retrieval'
  | 'verification'
  | 'replanning'
  | 'escalation'
  | 'answer';

export interface RepositoryChatToolEvent {
  id: string;
  sessionId: string;
  messageId: string;
  toolName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  paramSummary: string;
  stage?: RepositoryChatExecutionStage;
  round?: number;
  detail?: string;
  durationMs?: number;
  resultSize?: number;
  evidenceId?: string;
  createdAt: string;
}

export interface RepositoryChatFeedback {
  id: string;
  messageId: string;
  sessionId: string;
  accountId: string;
  rating: 'up' | 'down';
  createdAt: string;
}

export interface RepositoryChatAccountScope {
  accountId: string | null;
  accountLogin?: string | null;
}

export interface ToolEvidence {
  id: string;
  source: 'github' | 'existing-vector' | 'web';
  repoFullName: string;
  refSha?: string;
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  url: string;
  contentHash?: string;
  excerpt: string;
  retrievedAt: string;
}

export interface RepositoryChatAgentBudget {
  maxTurns: number;
  maxToolCalls: number;
  maxReadFiles: number;
  maxCodeReads: number;
  /** Consecutive rounds that add no new cited evidence before bounded stop. */
  maxNoProgressRounds: number;
  maxDurationMs: number;
}

/**
 * 聊天窗口里的任务深度档位。'default' 完全沿用设置页配置的 agentBudget；
 * 其余档位使用固定预设覆盖预算（见 TASK_DEPTH_PRESETS）。
 */
export type RepositoryChatTaskDepth = 'default' | 'quick' | 'deep' | 'unlimited';

export interface RepositoryChatTaskDepthPreset {
  budget: RepositoryChatAgentBudget;
  answerMaxTokens: number;
}

/** 每个非默认档位的预算预设；maxTurns 均不低于 2（实测 1 轮取证不足以回答）。 */
export const TASK_DEPTH_PRESETS: Record<Exclude<RepositoryChatTaskDepth, 'default'>, RepositoryChatTaskDepthPreset> = {
  quick: {
    budget: { maxTurns: 2, maxToolCalls: 8, maxReadFiles: 4, maxCodeReads: 1, maxNoProgressRounds: 1, maxDurationMs: 60_000 },
    answerMaxTokens: 2_000,
  },
  deep: {
    budget: { maxTurns: 5, maxToolCalls: 32, maxReadFiles: 12, maxCodeReads: 6, maxNoProgressRounds: 3, maxDurationMs: 180_000 },
    answerMaxTokens: 6_000,
  },
  unlimited: {
    budget: { maxTurns: 8, maxToolCalls: 96, maxReadFiles: 24, maxCodeReads: 16, maxNoProgressRounds: 4, maxDurationMs: 600_000 },
    answerMaxTokens: 8_000,
  },
};

/** 回答阶段默认的 max_tokens（'default' 档使用）。 */
export const DEFAULT_ANSWER_MAX_TOKENS = 4_000;

/**
 * 可观测性（优化方案 §5.5）：单轮问答结束时的汇总指标，随 toolEvents 的
 * `turn_metrics` 汇总事件持久化（detail 为本结构的 JSON）。
 */
export interface RepositoryChatTurnMetrics {
  /** 本轮真实模型调用次数（理解/规划/校验/回答/修复，含流式回答）。 */
  llmCalls: number;
  toolCalls: number;
  /** 取证循环轮数；README 快速路径为 0。 */
  rounds: number;
  /** 首个流式回答 token 的耗时（毫秒，自本轮开始计）；未走流式时缺省。 */
  ttftMs?: number;
  /** 本轮总耗时（毫秒）。 */
  totalMs: number;
  /** 供应商回传 usage 时才有值；当前 AIService 未透出，缺省。 */
  promptTokens?: number;
  /** 供应商回传 usage 时才有值；当前 AIService 未透出，缺省。 */
  completionTokens?: number;
  /** 最终回答是否由 README 快速路径直接生成。 */
  fastPath: boolean;
  /** 本轮结束原因（fast_path / requirements_verified / no_progress_limit / …）。 */
  endReason: string;
}

export interface RepositoryChatSettings {
  enabled: boolean;
  chatConfigId: string | null;
  streamingMode: 'auto' | 'off';
  taskDepth: RepositoryChatTaskDepth;
  enableWebTools: boolean;
  retainSessionDays: number;
  /**
   * README 快速路径（优化方案 §1.1）：简单 usage/general/deployment 首问直接
   * 读取根 README 命中章节作答，跳过理解/规划/校验的 LLM 调用。默认开启；
   * deep/unlimited 档位自动关闭。
   */
  fastPath: boolean;
  /**
   * 实验性：问答取证改用模型原生 function calling 的受控工具循环。
   * 仅当问答模型的 AI 配置勾选"支持工具调用"时实际生效，否则自动沿用
   * 编排式循环。默认关闭。
   */
  enableAgentToolLoop: boolean;
  /** Thread presentation preference; defaults to the resizable right sheet. */
  layout: 'sheet' | 'fullscreen';
  /**
   * Kept for persisted configurations created before the evidence-driven loop.
   * New callers should use agentBudget.maxToolCalls.
   */
  maxToolsPerTurn: number;
  agentBudget: RepositoryChatAgentBudget;
}

export const defaultRepositoryChatAgentBudget: RepositoryChatAgentBudget = {
  maxTurns: 4,
  maxToolCalls: 20,
  maxReadFiles: 8,
  maxCodeReads: 3,
  maxNoProgressRounds: 2,
  maxDurationMs: 90_000,
};

export const defaultRepositoryChatSettings: RepositoryChatSettings = {
  enabled: true,
  chatConfigId: null,
  streamingMode: 'auto',
  taskDepth: 'default',
  enableWebTools: false,
  fastPath: true,
  enableAgentToolLoop: false,
  layout: 'sheet',
  retainSessionDays: 90,
  maxToolsPerTurn: defaultRepositoryChatAgentBudget.maxToolCalls,
  agentBudget: { ...defaultRepositoryChatAgentBudget },
};
