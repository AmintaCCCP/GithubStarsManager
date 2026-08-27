import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import type { Repository } from '../../../types';
import type {
  RepositoryChatMessage,
  RepositoryChatSession,
  RepositoryChatToolEvent,
  ToolEvidence,
} from '../../../types/repositoryChat';
import { runRepositoryChatTurn } from '../../../services/repositoryChatService';
import { repositoryChatSessionRepository } from '../repositories/sessionRepository';

const createId = (prefix: string): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export const repositoryChatErrorMessage = (unknownError: unknown, language: 'zh' | 'en'): string => {
  const rawMessage = unknownError instanceof Error ? unknownError.message : String(unknownError ?? '');
  const isTemporaryServiceFailure = /\b(?:5\d\d|429)\b|upstream|timeout|timed?\s*out|network|fetch|do_request_failed|temporarily unavailable/i.test(rawMessage);
  if (isTemporaryServiceFailure) {
    return language === 'zh'
      ? 'AI 服务暂时不可用。问题和已读取的仓库证据已保留，请稍后重试。'
      : 'The AI service is temporarily unavailable. Your question and retrieved repository evidence have been preserved; please retry shortly.';
  }
  return language === 'zh'
    ? '回答生成失败。请检查 AI 配置后重试。'
    : 'Answer generation failed. Check the AI configuration and retry.';
};

interface UseRepositoryChatOptions {
  repository: Repository | null;
  session: RepositoryChatSession | null;
  messages: RepositoryChatMessage[];
  onMessagesChange: (messages: RepositoryChatMessage[]) => void;
  onSessionChange: (session: RepositoryChatSession) => Promise<void>;
}

export const useRepositoryChat = ({
  repository,
  session,
  messages,
  onMessagesChange,
  onSessionChange,
}: UseRepositoryChatOptions) => {
  const {
    language,
    githubToken,
    aiConfigs,
    activeAIConfig,
    repositoryChatSettings,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    githubToken: state.githubToken,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    repositoryChatSettings: state.repositoryChatSettings,
  })));
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryInFlightRef = useRef(false);
  const toolEventIdsRef = useRef<Map<string, { id: string; createdAt: string }>>(new Map());
  const timelineTimestampRef = useRef(0);
  const nextTimelineTimestamp = (): string => {
    const timestamp = Math.max(Date.now(), timelineTimestampRef.current + 1);
    timelineTimestampRef.current = timestamp;
    return new Date(timestamp).toISOString();
  };
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolEvents, setToolEvents] = useState<RepositoryChatToolEvent[]>([]);
  const [evidenceById, setEvidenceById] = useState<Record<string, ToolEvidence>>({});

  useEffect(() => {
    const evidenceIds = Array.from(new Set(messages.flatMap((message) => message.evidenceIds)));
    if (evidenceIds.length === 0) {
      setEvidenceById({});
      return;
    }
    let active = true;
    void repositoryChatSessionRepository.listEvidence(evidenceIds).then((evidences) => {
      if (!active) return;
      setEvidenceById(Object.fromEntries(evidences.map((evidence) => [evidence.id, evidence])));
    });
    return () => { active = false; };
  }, [messages]);

  useEffect(() => {
    if (!session) {
      setToolEvents([]);
      return;
    }
    let active = true;
    void repositoryChatSessionRepository.listToolEvents(session.id).then((events) => {
      if (active) setToolEvents(events);
    });
    return () => { active = false; };
  }, [session]);

  const resolvedConfigId = repositoryChatSettings.chatConfigId ?? activeAIConfig;
  const aiConfig = aiConfigs.find((config) => config.id === resolvedConfigId) ?? null;
  const unavailableReason = !repositoryChatSettings.enabled
    ? (language === 'zh' ? '仓库问答已在 AI 配置中关闭。' : 'Repository chat is disabled in AI settings.')
    : !githubToken
      ? (language === 'zh' ? '请先配置 GitHub token。' : 'Configure a GitHub token first.')
      : !aiConfig
        ? (language === 'zh' ? '请先配置有效的活动 AI 服务。' : 'Configure an active AI service first.')
        : null;

  const persistToolEvent = useCallback(async (event: Omit<RepositoryChatToolEvent, 'id' | 'sessionId' | 'messageId' | 'createdAt'> & { toolName: string }, activeMessageId: string) => {
    if (!session) return;
    // A tool's running and terminal event share one identity, while repeated
    // actions in later Agent rounds must remain distinct timeline entries.
    const eventKey = `${activeMessageId}:${event.stage ?? 'other'}:${event.round ?? 'global'}:${event.toolName}:${event.paramSummary}`;
    const existing = toolEventIdsRef.current.get(eventKey);
    const createdAt = existing?.createdAt ?? nextTimelineTimestamp();
    const toolEvent: RepositoryChatToolEvent = {
      id: existing?.id ?? createId('tool-event'),
      sessionId: session.id,
      messageId: activeMessageId,
      toolName: event.toolName,
      status: event.status,
      paramSummary: event.paramSummary,
      stage: event.stage,
      round: event.round,
      detail: event.detail,
      durationMs: event.durationMs,
      resultSize: event.resultSize,
      evidenceId: event.evidenceId,
      createdAt,
    };
    toolEventIdsRef.current.set(eventKey, { id: toolEvent.id, createdAt });
    setToolEvents((previous) => existing
      ? previous.map((item) => item.id === existing.id ? toolEvent : item)
      : [...previous, toolEvent]);
    await repositoryChatSessionRepository.saveToolEvent(toolEvent);
  }, [session]);

  const send = useCallback(async (question: string, baseMessages = messages, isRetry = false) => {
    if (!repository || !session || !aiConfig || unavailableReason || isSending || (!isRetry && retryInFlightRef.current)) {
      if (unavailableReason) setError(unavailableReason);
      return;
    }
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsSending(true);
    setError(null);
    toolEventIdsRef.current.clear();
    setToolEvents([]);
    const userCreatedAt = nextTimelineTimestamp();
    const assistantCreatedAt = nextTimelineTimestamp();
    const userMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: session.id,
      role: 'user',
      content: normalizedQuestion,
      status: 'complete',
      evidenceIds: [],
      // Keep a strict chronological order even after a persistence reload.
      createdAt: userCreatedAt,
    };
    const assistantMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: session.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      evidenceIds: [],
      createdAt: assistantCreatedAt,
    };
    const nextMessages = [...baseMessages, userMessage, assistantMessage];
    onMessagesChange(nextMessages);

    try {
      await Promise.all([
        repositoryChatSessionRepository.saveMessage(userMessage),
        repositoryChatSessionRepository.saveMessage(assistantMessage),
      ]);
      const result = await runRepositoryChatTurn({
        repository,
        session,
        messages: [...baseMessages, userMessage],
        question: normalizedQuestion,
        githubToken: githubToken ?? '',
        aiConfig,
        language,
        maxToolsPerTurn: repositoryChatSettings.maxToolsPerTurn,
        agentBudget: repositoryChatSettings.agentBudget,
        signal: controller.signal,
        onToolEvent: (event) => {
          void persistToolEvent(event, assistantMessage.id);
        },
      });
      await Promise.all(result.evidences.map((evidence) => repositoryChatSessionRepository.saveEvidence(evidence)));
      const completedAssistant: RepositoryChatMessage = {
        ...assistantMessage,
        content: result.content,
        status: 'complete',
        evidenceIds: result.evidences.map((evidence) => evidence.id),
      };
      await repositoryChatSessionRepository.saveMessage(completedAssistant);
      onMessagesChange([...baseMessages, userMessage, completedAssistant]);
      await onSessionChange({
        ...session,
        title: session.title === (language === 'zh' ? '新对话' : 'New conversation')
          ? normalizedQuestion.slice(0, 72)
          : session.title,
        modelConfigId: aiConfig.id,
        modelLabelAtTime: `${aiConfig.name} · ${aiConfig.model}`,
        updatedAt: new Date().toISOString(),
      });
    } catch (unknownError) {
      const aborted = controller.signal.aborted;
      const failedAssistant: RepositoryChatMessage = {
        ...assistantMessage,
        content: aborted
          ? (language === 'zh' ? '已停止生成。' : 'Generation stopped.')
          : (language === 'zh' ? '回答生成失败，请重试。' : 'Answer generation failed. Please retry.'),
        status: aborted ? 'aborted' : 'error',
      };
      // The visible transcript must always settle, even if the persistence backend
      // is unavailable and cannot record the terminal failure state.
      onMessagesChange([...baseMessages, userMessage, failedAssistant]);
      try {
        await repositoryChatSessionRepository.saveMessage(failedAssistant);
      } catch {
        // The original error is already represented in the transcript and banner.
      }
      if (!aborted) setError(repositoryChatErrorMessage(unknownError, language));
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
    }
  }, [aiConfig, githubToken, isSending, language, messages, onMessagesChange, onSessionChange, persistToolEvent, repository, repositoryChatSettings.agentBudget, repositoryChatSettings.maxToolsPerTurn, session, unavailableReason]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const retry = useCallback(async () => {
    if (retryInFlightRef.current) return;
    const failedAssistantIndex = [...messages].map((message) => message.role === 'assistant' && (message.status === 'error' || message.status === 'aborted')).lastIndexOf(true);
    if (failedAssistantIndex !== messages.length - 1) return;
    const failedAssistant = failedAssistantIndex >= 0 ? messages[failedAssistantIndex] : undefined;
    const failedUser = failedAssistantIndex > 0 ? messages[failedAssistantIndex - 1] : undefined;
    if (!failedAssistant || !failedUser || failedUser.role !== 'user') return;
    const baseMessages = messages.slice(0, failedAssistantIndex - 1);
    retryInFlightRef.current = true;
    try {
      await repositoryChatSessionRepository.permanentlyDeleteMessages([failedUser.id, failedAssistant.id]);
      onMessagesChange(baseMessages);
      await send(failedUser.content, baseMessages, true);
    } finally {
      retryInFlightRef.current = false;
    }
  }, [messages, onMessagesChange, send]);

  return {
    canChat: !unavailableReason,
    unavailableReason,
    isSending,
    error,
    toolEvents,
    evidenceById,
    send,
    stop,
    retry,
  };
};
