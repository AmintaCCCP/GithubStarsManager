import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../../../types';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
const mocks = vi.hoisted(() => ({
  runRepositoryChatTurn: vi.fn(),
  listEvidence: vi.fn(),
  listToolEvents: vi.fn(),
  saveMessage: vi.fn(),
  saveToolEvent: vi.fn(),
  appState: {} as Record<string, unknown>,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.appState),
}));

vi.mock('../../../services/repositoryChatService', () => ({
  runRepositoryChatTurn: mocks.runRepositoryChatTurn,
}));

vi.mock('../repositories/sessionRepository', () => ({
  repositoryChatSessionRepository: {
    listEvidence: mocks.listEvidence,
    listToolEvents: mocks.listToolEvents,
    saveMessage: mocks.saveMessage,
    saveToolEvent: mocks.saveToolEvent,
  },
}));

import { repositoryChatErrorMessage, useRepositoryChat } from './useRepositoryChat';

const repository: Repository = {
  id: 1,
  name: 'example',
  full_name: 'owner/example',
  description: 'Example repository',
  html_url: 'https://github.com/owner/example',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  pushed_at: '2026-08-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
};

const session: RepositoryChatSession = {
  id: 'session-1',
  repoId: repository.id,
  repoFullName: repository.full_name,
  sourceRefSha: 'abcdef1234567890',
  title: 'New conversation',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};

const aiConfig: AIConfig = {
  id: 'ai-1',
  name: 'Test AI',
  apiType: 'openai-compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  isActive: true,
};

const repositoryChatSettings = {
  enabled: true,
  chatConfigId: aiConfig.id,
  retainSessionDays: 90,
  maxToolsPerTurn: 6,
  enableWebTools: false,
  streamingMode: 'off' as const,
};

describe('repositoryChatErrorMessage', () => {
  it('turns transient upstream failures into a safe, actionable Chinese retry message', () => {
    const message = repositoryChatErrorMessage(
      new Error('AI API error: 500 - {"error":{"message":"upstream error: do_request_failed"}}'),
      'zh'
    );

    expect(message).toContain('AI 服务暂时不可用');
    expect(message).toContain('请稍后重试');
    expect(message).not.toContain('do_request_failed');
    expect(message).not.toContain('500');
  });

  it('keeps non-transient failures actionable without exposing provider details', () => {
    const message = repositoryChatErrorMessage(new Error('provider-specific validation payload'), 'en');

    expect(message).toBe('Answer generation failed. Check the AI configuration and retry.');
    expect(message).not.toContain('provider-specific');
  });
});

describe('useRepositoryChat persistence failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listEvidence.mockResolvedValue([]);
    mocks.listToolEvents.mockResolvedValue([]);
    mocks.appState = {
      language: 'en',
      githubToken: 'github-token',
      aiConfigs: [aiConfig],
      activeAIConfig: aiConfig.id,
      repositoryChatSettings,
    };
  });

  it('settles the transcript and sending state when initial message persistence fails', async () => {
    mocks.saveMessage.mockRejectedValue(new Error('local persistence unavailable'));
    const onSessionChange = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
      const chat = useRepositoryChat({
        repository,
        session,
        messages,
        onMessagesChange: setMessages,
        onSessionChange,
      });
      return { chat, messages };
    });

    await act(async () => {
      await result.current.chat.send('How do I use this project?');
    });

    await waitFor(() => expect(result.current.chat.isSending).toBe(false));
    expect(result.current.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', status: 'complete' }),
      expect.objectContaining({ role: 'assistant', status: 'error', content: 'Answer generation failed. Please retry.' }),
    ]));
    expect(result.current.chat.error).toBe('Answer generation failed. Check the AI configuration and retry.');
    expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
    expect(mocks.saveMessage).toHaveBeenCalledTimes(3);
  });
});
