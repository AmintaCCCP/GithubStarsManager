export interface RepositoryChatSession {
  id: string;
  repoId: number;
  repoFullName: string;
  sourceRefSha: string;
  title: string;
  summary?: string;
  modelConfigId?: string | null;
  modelLabelAtTime?: string;
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
  maxDurationMs: number;
}

export interface RepositoryChatSettings {
  enabled: boolean;
  chatConfigId: string | null;
  streamingMode: 'auto' | 'off';
  enableWebTools: boolean;
  retainSessionDays: number;
  /**
   * Kept for persisted configurations created before the evidence-driven loop.
   * New callers should use agentBudget.maxToolCalls.
   */
  maxToolsPerTurn: number;
  agentBudget: RepositoryChatAgentBudget;
}

export const defaultRepositoryChatAgentBudget: RepositoryChatAgentBudget = {
  maxTurns: 4,
  maxToolCalls: 8,
  maxReadFiles: 6,
  maxCodeReads: 3,
  maxDurationMs: 90_000,
};

export const defaultRepositoryChatSettings: RepositoryChatSettings = {
  enabled: true,
  chatConfigId: null,
  streamingMode: 'auto',
  enableWebTools: false,
  retainSessionDays: 90,
  maxToolsPerTurn: defaultRepositoryChatAgentBudget.maxToolCalls,
  agentBudget: { ...defaultRepositoryChatAgentBudget },
};
