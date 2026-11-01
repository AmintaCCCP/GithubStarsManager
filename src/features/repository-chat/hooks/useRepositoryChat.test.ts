import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIConfig, Repository } from '../../../types';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
const mocks = vi.hoisted(() => ({
  runRepositoryChatTurn: vi.fn(),
  listEvidence: vi.fn(),
  listToolEvents: vi.fn(),
  listFeedback: vi.fn(),
  saveMessage: vi.fn(),
  saveToolEvent: vi.fn(),
  saveEvidence: vi.fn(),
  saveFeedback: vi.fn(),
  permanentlyDeleteMessages: vi.fn(),
  deleteMessagesAfter: vi.fn(),
  generateChatText: vi.fn(),
  appState: {} as Record<string, unknown>,
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: Record<string, unknown>) => unknown) => selector(mocks.appState),
}));

vi.mock('../../../services/repositoryChatRunner', () => ({
  runRepositoryChatTurn: mocks.runRepositoryChatTurn,
}));

vi.mock('../../../services/repositoryChatStorage', () => ({
  repositoryChatStorage: {
    listEvidence: mocks.listEvidence,
    listToolEvents: mocks.listToolEvents,
    listFeedback: mocks.listFeedback,
    saveMessage: mocks.saveMessage,
    saveToolEvent: mocks.saveToolEvent,
    saveEvidence: mocks.saveEvidence,
    saveFeedback: mocks.saveFeedback,
    permanentlyDeleteMessages: mocks.permanentlyDeleteMessages,
    deleteMessagesAfter: mocks.deleteMessagesAfter,
  },
}));

vi.mock('../../../services/aiService', () => ({
  AIService: class {
    generateChatText = mocks.generateChatText;
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
  accountId: '42',
  repoFullName: repository.full_name,
  sourceRefSha: 'abcdef1234567890',
  title: 'Existing title',
  createdAt: '2026-08-26T00:00:00.000Z',
  updatedAt: '2026-08-26T00:00:00.000Z',
};
const defaultTitleSession: RepositoryChatSession = { ...session, title: 'New conversation' };

const aiConfig: AIConfig = {
  id: 'ai-1',
  name: 'Test AI',
  apiType: 'openai-compatible',
  baseUrl: 'https://example.com/v1',
  apiKey: 'test-key',
  model: 'test-model',
  isActive: true,
};
const emptyMessages: RepositoryChatMessage[] = [];

const repositoryChatSettings = {
  enabled: true,
  chatConfigId: aiConfig.id,
  retainSessionDays: 90,
  maxToolsPerTurn: 6,
  enableWebTools: false,
  fastPath: true,
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
    mocks.listFeedback.mockResolvedValue([]);
    mocks.generateChatText.mockResolvedValue('Generated title');
    mocks.appState = {
      language: 'en',
      user: { id: 42, login: 'test-user' },
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

  it('passes persisted evidence from the previous assistant turn into the next turn', async () => {
    const evidence = {
      id: 'evidence-prior',
      source: 'github' as const,
      repoFullName: repository.full_name,
      refSha: session.sourceRefSha,
      path: 'README.md',
      lineStart: 1,
      lineEnd: 2,
      url: 'https://github.com/owner/example/blob/abcdef/README.md#L1-L2',
      excerpt: 'README',
      retrievedAt: '2026-08-26T00:00:00.000Z',
    };
    const previousMessages: RepositoryChatMessage[] = [
      { id: 'user-1', sessionId: session.id, role: 'user', content: 'How do I install this?', status: 'complete', evidenceIds: [], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'assistant-1', sessionId: session.id, role: 'assistant', content: 'Run the installer. `/README.md - 1-2`', status: 'complete', evidenceIds: [evidence.id], createdAt: '2026-08-26T00:00:02.000Z' },
    ];
    mocks.listEvidence.mockResolvedValue([evidence]);
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.runRepositoryChatTurn.mockResolvedValue({ content: 'Same answer. `/README.md - 1-2`', evidences: [] });
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: previousMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.send('Can you repeat that?', previousMessages);
    });

    expect(mocks.listEvidence).toHaveBeenCalledWith([evidence.id]);
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledWith(expect.objectContaining({
      priorEvidence: [evidence],
    }));
  });

  it('keeps completed activity visible while the next turn is running', async () => {
    const previousEvent = {
      id: 'previous-event',
      sessionId: session.id,
      messageId: 'previous-message',
      toolName: 'read_repo_file',
      status: 'success' as const,
      paramSummary: 'README.md',
      createdAt: '2026-08-26T00:00:00.000Z',
    };
    mocks.listToolEvents.mockResolvedValue([previousEvent]);
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.runRepositoryChatTurn.mockImplementation(async (input: { onToolEvent?: (event: Record<string, unknown>) => void }) => {
      input.onToolEvent?.({ toolName: 'read_repo_file', status: 'success', paramSummary: 'docs/usage.md', stage: 'retrieval', round: 1 });
      return { content: 'Verified answer.', evidences: [] };
    });
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
      return useRepositoryChat({
        repository,
        session,
        messages,
        onMessagesChange: setMessages,
        onSessionChange: vi.fn().mockResolvedValue(undefined),
      });
    });
    await waitFor(() => expect(result.current.toolEvents).toHaveLength(1));

    await act(async () => {
      await result.current.send('What changed?');
    });

    await waitFor(() => expect(result.current.toolEvents).toHaveLength(2));
    expect(result.current.toolEvents[0]?.id).toBe('previous-event');
    expect(result.current.toolEvents[1]).toMatchObject({ paramSummary: 'docs/usage.md', status: 'success' });
  });

  it('makes newly retrieved evidence available while the answer is still streaming', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    const evidence = {
      id: 'evidence-live',
      source: 'github' as const,
      repoFullName: repository.full_name,
      refSha: session.sourceRefSha,
      path: 'README.md',
      lineStart: 1,
      lineEnd: 2,
      url: 'https://github.com/owner/example/blob/abcdef/README.md#L1-L2',
      excerpt: 'README',
      retrievedAt: '2026-08-26T00:00:00.000Z',
    };
    let resolveTurn!: (value: { content: string; evidences: never[] }) => void;
    mocks.runRepositoryChatTurn.mockImplementation((input: {
      onEvidence?: (items: typeof evidence[]) => void;
      onAnswerChunk?: (text: string) => void;
    }) => new Promise((resolve) => {
      resolveTurn = resolve;
      input.onEvidence?.([evidence]);
      input.onAnswerChunk?.('Answer `/README.md - 1-2`');
    }));
    const { result } = renderHook(() => {
      const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
      return {
        chat: useRepositoryChat({
          repository,
          session,
          messages,
          onMessagesChange: setMessages,
          onSessionChange: vi.fn().mockResolvedValue(undefined),
        }),
        messages,
      };
    });

    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.chat.send('How do I use this?');
      await Promise.resolve();
    });

    await waitFor(() => expect(mocks.runRepositoryChatTurn).toHaveBeenCalled());
    await waitFor(() => expect(result.current.chat.evidenceById['evidence-live']).toBeDefined());
    await waitFor(() => expect(result.current.messages.at(-1)).toMatchObject({
      status: 'streaming',
      evidenceIds: ['evidence-live'],
    }));

    await act(async () => {
      resolveTurn({ content: 'Answer `/README.md - 1-2`', evidences: [] });
      await sending;
    });
    expect(result.current.chat.evidenceById['evidence-live']).toBeDefined();
    expect(mocks.saveEvidence).toHaveBeenCalledWith(evidence);
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      evidenceIds: ['evidence-live'],
    });
  });

  it('keeps a verified answer complete when evidence persistence fails', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveEvidence.mockRejectedValue(new Error('evidence store unavailable'));
    const evidence = {
      id: 'evidence-unpersisted',
      source: 'github' as const,
      repoFullName: repository.full_name,
      refSha: session.sourceRefSha,
      path: 'README.md',
      lineStart: 1,
      lineEnd: 2,
      url: 'https://github.com/owner/example/blob/abcdef/README.md#L1-L2',
      excerpt: 'README',
      retrievedAt: '2026-08-26T00:00:00.000Z',
    };
    mocks.runRepositoryChatTurn.mockResolvedValue({
      content: 'Verified answer. `/README.md - 1-2`',
      evidences: [evidence],
    });
    const onMessagesChange = vi.fn();
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: emptyMessages,
      onMessagesChange,
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.send('How do I use this project?');
    });

    expect(result.current.error).toBeNull();
    expect(mocks.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      evidenceIds: [],
    }));
    expect(onMessagesChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ role: 'user' }),
      expect.objectContaining({
        role: 'assistant',
        status: 'complete',
        content: 'Verified answer. `/README.md - 1-2`',
        evidenceIds: [evidence.id],
      }),
    ]);
  });

  it('keeps prior evidence ids when rewriting that evidence fails', async () => {
    const priorEvidence = {
      id: 'evidence-prior',
      source: 'github' as const,
      repoFullName: repository.full_name,
      refSha: session.sourceRefSha,
      path: 'README.md',
      lineStart: 1,
      lineEnd: 2,
      url: 'https://github.com/owner/example/blob/abcdef/README.md#L1-L2',
      excerpt: 'README',
      retrievedAt: '2026-08-26T00:00:00.000Z',
    };
    const previousMessages: RepositoryChatMessage[] = [
      { id: 'user-1', sessionId: session.id, role: 'user', content: 'How do I install this?', status: 'complete', evidenceIds: [], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'assistant-1', sessionId: session.id, role: 'assistant', content: 'Run the installer.', status: 'complete', evidenceIds: [priorEvidence.id], createdAt: '2026-08-26T00:00:02.000Z' },
    ];
    mocks.listEvidence.mockResolvedValue([priorEvidence]);
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveEvidence.mockRejectedValue(new Error('evidence store unavailable'));
    mocks.runRepositoryChatTurn.mockResolvedValue({
      content: 'Same answer. `/README.md - 1-2`',
      evidences: [priorEvidence],
    });
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: previousMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.send('Can you repeat that?', previousMessages);
    });

    expect(mocks.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      evidenceIds: [priorEvidence.id],
    }));
  });

  it('blocks a second send while prior evidence is still loading', async () => {
    let resolveEvidence!: (value: never[]) => void;
    mocks.listEvidence.mockReturnValue(new Promise((resolve) => {
      resolveEvidence = resolve;
    }));
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.runRepositoryChatTurn.mockResolvedValue({ content: 'Verified answer.', evidences: [] });
    const previousMessages: RepositoryChatMessage[] = [
      { id: 'user-1', sessionId: session.id, role: 'user', content: 'How do I install this?', status: 'complete', evidenceIds: [], createdAt: '2026-08-26T00:00:01.000Z' },
      { id: 'assistant-1', sessionId: session.id, role: 'assistant', content: 'Run the installer.', status: 'complete', evidenceIds: ['evidence-prior'], createdAt: '2026-08-26T00:00:02.000Z' },
    ];
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: emptyMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    let firstSend!: Promise<void>;
    let secondSend!: Promise<void>;
    act(() => {
      firstSend = result.current.send('First question', previousMessages);
      secondSend = result.current.send('Second question', previousMessages);
    });
    await waitFor(() => expect(result.current.isSending).toBe(true));
    expect(mocks.listEvidence).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveEvidence([]);
      await Promise.all([firstSend, secondSend]);
    });

    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledTimes(1);
    expect(mocks.runRepositoryChatTurn).toHaveBeenCalledWith(expect.objectContaining({ question: 'First question' }));
  });

  it('does not overwrite a rename made while the answer is streaming', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    let resolveTurn!: (value: { content: string; evidences: never[] }) => void;
    mocks.runRepositoryChatTurn.mockReturnValue(new Promise((resolve) => {
      resolveTurn = resolve;
    }));
    const onSessionChange = vi.fn().mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ currentSession }: { currentSession: RepositoryChatSession }) => {
        const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
        const chat = useRepositoryChat({
          repository,
          session: currentSession,
          messages,
          onMessagesChange: setMessages,
          onSessionChange,
        });
        return { chat, messages };
      },
      { initialProps: { currentSession: { ...session, title: 'New conversation' } } },
    );

    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.chat.send('How do I use this?');
      await waitFor(() => expect(mocks.runRepositoryChatTurn).toHaveBeenCalled());
    });
    await act(async () => {
      rerender({ currentSession: { ...session, title: 'Renamed while streaming' } });
    });
    await act(async () => {
      resolveTurn({ content: 'Verified answer.', evidences: [] });
      await sending;
    });

    expect(onSessionChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed while streaming' }),
      { titleIfCurrent: 'Renamed while streaming' },
    );
  });

  it('writes a generated title after completing a default-titled session', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    let resolveTurn!: (value: { content: string; evidences: never[] }) => void;
    let resolveTitle!: (title: string) => void;
    mocks.runRepositoryChatTurn.mockReturnValue(new Promise((resolve) => {
      resolveTurn = resolve;
    }));
    mocks.generateChatText.mockReturnValue(new Promise((resolve) => {
      resolveTitle = resolve;
    }));
    const onSessionChange = vi.fn().mockResolvedValue(undefined);
    const onMessagesChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentSession }: { currentSession: RepositoryChatSession }) => useRepositoryChat({
        repository,
        session: currentSession,
        messages: emptyMessages,
        onMessagesChange,
        onSessionChange,
      }),
      { initialProps: { currentSession: defaultTitleSession } },
    );

    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.send('How do I use this?');
    });
    await waitFor(() => expect(mocks.runRepositoryChatTurn).toHaveBeenCalled());
    await act(async () => {
      resolveTurn({ content: 'Verified answer.', evidences: [] });
      await sending;
    });
    await waitFor(() => expect(mocks.generateChatText).toHaveBeenCalled());
    expect(onSessionChange).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'How do I use this?' }),
      { titleIfCurrent: 'New conversation' },
    );
    await act(async () => {
      rerender({
        currentSession: {
          ...defaultTitleSession,
          title: 'How do I use this?',
          modelConfigId: 'latest-config',
          modelLabelAtTime: 'Latest model',
        },
      });
    });
    await act(async () => {
      resolveTitle('Generated title');
      await Promise.resolve();
    });

    await waitFor(() => expect(onSessionChange).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Generated title',
        modelConfigId: 'latest-config',
        modelLabelAtTime: 'Latest model',
      }),
      { titleIfCurrent: 'How do I use this?' },
    ));
  });

  it('does not overwrite a rename made after fallback title persistence starts', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.runRepositoryChatTurn.mockResolvedValue({ content: 'Verified answer.', evidences: [] });
    let resolveTitle!: (title: string) => void;
    mocks.generateChatText.mockReturnValue(new Promise((resolve) => {
      resolveTitle = resolve;
    }));
    const onSessionChange = vi.fn().mockResolvedValue(undefined);
    const onMessagesChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ currentSession }: { currentSession: RepositoryChatSession }) => useRepositoryChat({
        repository,
        session: currentSession,
        messages: emptyMessages,
        onMessagesChange,
        onSessionChange,
      }),
      { initialProps: { currentSession: defaultTitleSession } },
    );

    await act(async () => {
      await result.current.send('How do I use this?');
    });
    await waitFor(() => expect(mocks.generateChatText).toHaveBeenCalled());
    await act(async () => {
      rerender({ currentSession: { ...session, title: 'Renamed after send' } });
    });
    await act(async () => {
      resolveTitle('Stale generated title');
      await Promise.resolve();
    });

    expect(onSessionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stale generated title' }),
    );
  });

  it('keeps a rename made while fallback title persistence is pending', async () => {
    mocks.saveMessage.mockResolvedValue(undefined);
    mocks.saveToolEvent.mockResolvedValue(undefined);
    mocks.saveEvidence.mockResolvedValue(undefined);
    mocks.generateChatText.mockResolvedValue('Stale generated title');
    mocks.runRepositoryChatTurn.mockResolvedValue({ content: 'Verified answer.', evidences: [] });
    let resolvePersistence!: () => void;
    const onSessionChange = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolvePersistence = resolve;
      }))
      .mockResolvedValue(undefined);
    const { result, rerender } = renderHook(
      ({ currentSession }: { currentSession: RepositoryChatSession }) => useRepositoryChat({
        repository,
        session: currentSession,
        messages: emptyMessages,
        onMessagesChange: vi.fn(),
        onSessionChange,
      }),
      { initialProps: { currentSession: defaultTitleSession } },
    );

    let sending!: Promise<void>;
    await act(async () => {
      sending = result.current.send('How do I use this?');
    });
    await waitFor(() => expect(onSessionChange).toHaveBeenCalledTimes(1));
    await act(async () => {
      rerender({
        currentSession: {
          ...session,
          title: 'Renamed during persistence',
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        },
      });
    });
    await act(async () => {
      resolvePersistence();
      await sending;
    });
    await waitFor(() => expect(mocks.generateChatText).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });

    expect(onSessionChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Stale generated title' }),
    );
  });

  it('loads persisted feedback and saves new ratings within the account scope', async () => {
    mocks.listFeedback.mockResolvedValue([{
      id: 'message-1',
      messageId: 'message-1',
      sessionId: session.id,
      accountId: '42',
      rating: 'down',
      createdAt: '2026-08-26T00:00:00.000Z',
    }]);
    const { result } = renderHook(() => {
      const [messages] = useState<RepositoryChatMessage[]>([]);
      return useRepositoryChat({
        repository,
        session,
        messages,
        onMessagesChange: vi.fn(),
        onSessionChange: vi.fn().mockResolvedValue(undefined),
      });
    });

    await waitFor(() => expect(result.current.feedbackById['message-1']).toBe('down'));
    await act(async () => {
      await result.current.submitFeedback('message-2', 'up');
    });

    expect(result.current.feedbackById['message-2']).toBe('up');
    expect(mocks.saveFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'message-2', accountId: '42', rating: 'up' }),
      { accountId: '42', accountLogin: 'test-user' },
    );
  });

  it('preserves a newly submitted rating while an earlier feedback snapshot is still loading', async () => {
    let resolveFeedback!: (items: never[]) => void;
    mocks.listFeedback.mockReturnValue(new Promise((resolve) => {
      resolveFeedback = resolve;
    }));
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: emptyMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.submitFeedback('message-1', 'up');
    });
    expect(result.current.feedbackById['message-1']).toBe('up');

    await act(async () => {
      resolveFeedback([]);
      await Promise.resolve();
    });

    expect(result.current.feedbackById['message-1']).toBe('up');
  });

  it('keeps a newer successful rating when an earlier feedback write fails', async () => {
    let rejectFirst!: (error: Error) => void;
    mocks.saveFeedback
      .mockImplementationOnce(() => new Promise((_, reject) => {
        rejectFirst = reject;
      }))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: emptyMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));
    await waitFor(() => expect(mocks.listFeedback).toHaveBeenCalled());

    let first!: Promise<void>;
    let second!: Promise<void>;
    await act(async () => {
      first = result.current.submitFeedback('message-1', 'up');
      second = result.current.submitFeedback('message-1', 'down');
      await Promise.resolve();
    });
    expect(result.current.feedbackById['message-1']).toBe('down');
    expect(mocks.saveFeedback).toHaveBeenCalledTimes(1);

    await act(async () => {
      rejectFirst(new Error('feedback unavailable'));
      await first;
      await second;
    });

    expect(result.current.feedbackById['message-1']).toBe('down');
    expect(mocks.saveFeedback).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
  });

  it('rolls back and reports the latest failed feedback submission', async () => {
    mocks.saveFeedback
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('feedback unavailable'));
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages: emptyMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));
    await waitFor(() => expect(mocks.listFeedback).toHaveBeenCalled());

    await act(async () => {
      await result.current.submitFeedback('message-1', 'up');
      await result.current.submitFeedback('message-1', 'down');
    });

    expect(result.current.feedbackById['message-1']).toBe('up');
    expect(result.current.error).toBe('Answer generation failed. Check the AI configuration and retry.');
  });

  it('always scopes reads to the active account, not a stale session marker', async () => {
    const staleSession = { ...session, accountId: 'other-account', accountLogin: 'other-user' };
    renderHook(() => useRepositoryChat({
      repository,
      session: staleSession,
      messages: emptyMessages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await waitFor(() => expect(mocks.listToolEvents).toHaveBeenCalledWith(
      staleSession.id,
      { accountId: '42', accountLogin: 'test-user' },
    ));
    expect(mocks.listFeedback).toHaveBeenCalledWith(
      staleSession.id,
      { accountId: '42', accountLogin: 'test-user' },
    );
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

  it('reports retry persistence failures instead of leaving an unhandled rejection', async () => {
    mocks.permanentlyDeleteMessages.mockRejectedValue(new Error('storage unavailable'));
    const messages: RepositoryChatMessage[] = [
      {
        id: 'failed-user',
        sessionId: session.id,
        role: 'user',
        content: 'What changed?',
        status: 'complete',
        evidenceIds: [],
        createdAt: '2026-08-26T00:00:01.000Z',
      },
      {
        id: 'failed-assistant',
        sessionId: session.id,
        role: 'assistant',
        content: 'Answer generation failed. Please retry.',
        status: 'error',
        evidenceIds: [],
        createdAt: '2026-08-26T00:00:02.000Z',
      },
    ];
    const { result } = renderHook(() => useRepositoryChat({
      repository,
      session,
      messages,
      onMessagesChange: vi.fn(),
      onSessionChange: vi.fn().mockResolvedValue(undefined),
    }));

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.error).toBe('Answer generation failed. Check the AI configuration and retry.');
    expect(mocks.runRepositoryChatTurn).not.toHaveBeenCalled();
  });
});
