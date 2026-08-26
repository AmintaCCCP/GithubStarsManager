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

export interface RepositoryChatToolEvent {
  id: string;
  sessionId: string;
  messageId: string;
  toolName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  paramSummary: string;
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

export interface RepositoryChatSettings {
  enabled: boolean;
  chatConfigId: string | null;
  streamingMode: 'auto' | 'off';
  enableWebTools: boolean;
  retainSessionDays: number;
  maxToolsPerTurn: number;
}

export const defaultRepositoryChatSettings: RepositoryChatSettings = {
  enabled: true,
  chatConfigId: null,
  streamingMode: 'auto',
  enableWebTools: false,
  retainSessionDays: 90,
  maxToolsPerTurn: 6,
};
