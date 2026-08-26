import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
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
  } = useAppStore((state) => ({
    language: state.language,
    githubToken: state.githubToken,
    aiConfigs: state.aiConfigs,
    activeAIConfig: state.activeAIConfig,
    repositoryChatSettings: state.repositoryChatSettings,
  }));
  const abortControllerRef = useRef<AbortController | null>(null);
  const toolEventIdsRef = useRef<Map<string, string>>(new Map());
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
    const eventKey = `${activeMessageId}:${event.toolName}:${event.paramSummary}`;
    const existingId = toolEventIdsRef.current.get(eventKey);
    const toolEvent: RepositoryChatToolEvent = {
      id: existingId ?? createId('tool-event'),
      sessionId: session.id,
      messageId: activeMessageId,
      toolName: event.toolName,
      status: event.status,
      paramSummary: event.paramSummary,
      durationMs: event.durationMs,
      resultSize: event.resultSize,
      evidenceId: event.evidenceId,
      createdAt: new Date().toISOString(),
    };
    toolEventIdsRef.current.set(eventKey, toolEvent.id);
    setToolEvents((previous) => existingId
      ? previous.map((item) => item.id === existingId ? toolEvent : item)
      : [...previous, toolEvent]);
    await repositoryChatSessionRepository.saveToolEvent(toolEvent);
  }, [session]);

  const send = useCallback(async (question: string) => {
    if (!repository || !session || !aiConfig || unavailableReason || isSending) {
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
    const now = new Date().toISOString();
    const userMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: session.id,
      role: 'user',
      content: normalizedQuestion,
      status: 'complete',
      evidenceIds: [],
      createdAt: now,
    };
    const assistantMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: session.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      evidenceIds: [],
      createdAt: now,
    };
    const nextMessages = [...messages, userMessage, assistantMessage];
    onMessagesChange(nextMessages);
    await Promise.all([
      repositoryChatSessionRepository.saveMessage(userMessage),
      repositoryChatSessionRepository.saveMessage(assistantMessage),
    ]);

    try {
      const result = await runRepositoryChatTurn({
        repository,
        session,
        messages: [...messages, userMessage],
        question: normalizedQuestion,
        githubToken: githubToken ?? '',
        aiConfig,
        language,
        maxToolsPerTurn: repositoryChatSettings.maxToolsPerTurn,
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
      onMessagesChange([...messages, userMessage, completedAssistant]);
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
      await repositoryChatSessionRepository.saveMessage(failedAssistant);
      onMessagesChange([...messages, userMessage, failedAssistant]);
      if (!aborted) setError(unknownError instanceof Error ? unknownError.message : (language === 'zh' ? '回答生成失败。' : 'Answer generation failed.'));
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
    }
  }, [aiConfig, githubToken, isSending, language, messages, onMessagesChange, onSessionChange, persistToolEvent, repository, repositoryChatSettings.maxToolsPerTurn, session, unavailableReason]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const retry = useCallback(async () => {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (latestUserMessage) await send(latestUserMessage.content);
  }, [messages, send]);

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
