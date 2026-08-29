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
  saveEvidence: vi.fn(),
  appState: {} as Record<string, unknown>,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.appState),
}));

vi.mock('../../../services/repositoryChatRunner', () => ({
  runRepositoryChatTurn: mocks.runRepositoryChatTurn,
}));

vi.mock('../repositories/sessionRepository', () => ({
  repositoryChatSessionRepository: {
    listEvidence: mocks.listEvidence,
    listToolEvents: mocks.listToolEvents,
    saveMessage: mocks.saveMessage,
    saveToolEvent: mocks.saveToolEvent,
    saveEvidence: mocks.saveEvidence,
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

  it('persists distinct events for repeated Agent rounds and orders the user before the assistant', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.runRepositoryChatTurn.mockImplementation(async (input: { onToolEvent?: (event: Record<string, unknown>) => void }) => {
      input.onToolEvent?.({ toolName: 'read_repo_file', status: 'running', paramSummary: 'README.md', stage: 'retrieval', round: 1 });
      input.onToolEvent?.({ toolName: 'read_repo_file', status: 'success', paramSummary: 'README.md', stage: 'retrieval', round: 1, resultSize: 1 });
      input.onToolEvent?.({ toolName: 'read_repo_file', status: 'running', paramSummary: 'docs/usage.md', stage: 'retrieval', round: 2 });
      input.onToolEvent?.({ toolName: 'read_repo_file', status: 'success', paramSummary: 'docs/usage.md', stage: 'retrieval', round: 2, resultSize: 1 });
      return { content: 'Verified answer. `/README.md - 1`', evidences: [] };
    });
    const onSessionChange = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
      const chat = useRepositoryChat({ repository, session, messages, onMessagesChange: setMessages, onSessionChange });
      return { chat, messages };
    });

    await act(async () => {
      await result.current.chat.send('How do I use this project?');
    });
    await waitFor(() => expect(result.current.chat.isSending).toBe(false));

    const [userMessage, assistantMessage] = result.current.messages;
    expect(userMessage.role).toBe('user');
    expect(assistantMessage.role).toBe('assistant');
    expect(userMessage.createdAt < assistantMessage.createdAt).toBe(true);
    await waitFor(() => expect(mocks.saveToolEvent).toHaveBeenCalledTimes(4));
    const savedEvents = mocks.saveToolEvent.mock.calls.map((call: unknown[]) => call[0] as { id: string; round?: number; status: string });
    expect(savedEvents.filter((event) => event.status === 'success').map((event) => event.round)).toEqual([1, 2]);
    expect(new Set(savedEvents.map((event) => event.id)).size).toBe(2);
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
