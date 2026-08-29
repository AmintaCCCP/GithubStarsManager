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
import { runRepositoryChatTurn } from '../../../services/repositoryChatRunner';
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
  const toolEventWriteChainsRef = useRef<Map<string, Promise<void>>>(new Map());
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

  const loadedEvidenceKeyRef = useRef('');
  useEffect(() => {
    // 流式回答会让 messages 每 ~60ms 变化一次，但证据集合只在回合完成时变化；
    // 用 key 去重，避免流式期间反复查询 IndexedDB。
    const evidenceKey = messages.map((message) => message.evidenceIds.join('|')).join(',');
    if (evidenceKey === loadedEvidenceKeyRef.current) return;
    loadedEvidenceKeyRef.current = evidenceKey;
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
    // Running and terminal states arrive asynchronously. Serialize writes for
    // one event ID so an older delayed running write cannot overwrite success.
    const previousWrite = toolEventWriteChainsRef.current.get(toolEvent.id) ?? Promise.resolve();
    const write = previousWrite.catch(() => undefined).then(async () => {
      await repositoryChatSessionRepository.saveToolEvent(toolEvent);
    });
    toolEventWriteChainsRef.current.set(toolEvent.id, write);
    try {
      await write;
    } finally {
      if (toolEventWriteChainsRef.current.get(toolEvent.id) === write) {
        toolEventWriteChainsRef.current.delete(toolEvent.id);
      }
    }
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
    toolEventWriteChainsRef.current.clear();
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

    // 流式渲染：增量回调以 ~60ms 节流刷新最后一条助手消息，最终结果仍以经过
    // 引用校验的 result.content 为准。声明在外层以便中止时保留半截回答。
    let streamedContent = '';
    try {
      await Promise.all([
        repositoryChatSessionRepository.saveMessage(userMessage),
        repositoryChatSessionRepository.saveMessage(assistantMessage),
      ]);
      let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushStreamedContent = (content: string) => {
        if (streamFlushTimer) {
          globalThis.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        onMessagesChange([...baseMessages, userMessage, { ...assistantMessage, content }]);
      };
      const scheduleStreamedFlush = () => {
        if (streamFlushTimer) return;
        streamFlushTimer = globalThis.setTimeout(() => {
          streamFlushTimer = null;
          onMessagesChange([...baseMessages, userMessage, { ...assistantMessage, content: streamedContent }]);
        }, 60);
      };
      try {
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
          enableAgentToolLoop: repositoryChatSettings.enableAgentToolLoop,
          taskDepth: repositoryChatSettings.taskDepth,
          streaming: repositoryChatSettings.streamingMode !== 'off',
          signal: controller.signal,
          onToolEvent: (event) => {
            void persistToolEvent(event, assistantMessage.id);
          },
          onAnswerChunk: (fullText) => {
            streamedContent = fullText;
            if (fullText.length === 0) {
              // 流式降级：立即清空已流出的无效内容。
              flushStreamedContent('');
              return;
            }
            scheduleStreamedFlush();
          },
        });
        // 拿到最终结果后立即取消挂起的节流刷新：否则最后一个分片若在
        // saveEvidence/saveMessage 等持久化 await 之前不足 60ms 到达，挂起
        // 定时器会把已完成的回答覆盖回流式状态（status: streaming 且无证据）。
        if (streamFlushTimer) {
          globalThis.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
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
      } finally {
        if (streamFlushTimer) globalThis.clearTimeout(streamFlushTimer);
      }
    } catch (unknownError) {
      const aborted = controller.signal.aborted;
      const failedAssistant: RepositoryChatMessage = {
        ...assistantMessage,
        content: aborted
          ? (streamedContent || (language === 'zh' ? '已停止生成。' : 'Generation stopped.'))
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
  }, [aiConfig, githubToken, isSending, language, messages, onMessagesChange, onSessionChange, persistToolEvent, repository, repositoryChatSettings.agentBudget, repositoryChatSettings.enableAgentToolLoop, repositoryChatSettings.maxToolsPerTurn, repositoryChatSettings.streamingMode, repositoryChatSettings.taskDepth, session, unavailableReason]);

  const stop = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const resendLastPair = useCallback(async (requireFailedStatus: boolean) => {
    if (retryInFlightRef.current || isSending) return;
    if (messages.length < 2) return;
    const lastAssistant = messages[messages.length - 1];
    const lastUser = messages[messages.length - 2];
    if (lastAssistant.role !== 'assistant' || lastUser.role !== 'user') return;
    if (requireFailedStatus && lastAssistant.status !== 'error' && lastAssistant.status !== 'aborted') return;
    const baseMessages = messages.slice(0, messages.length - 2);
    retryInFlightRef.current = true;
    try {
      await repositoryChatSessionRepository.permanentlyDeleteMessages([lastUser.id, lastAssistant.id]);
      onMessagesChange(baseMessages);
      await send(lastUser.content, baseMessages, true);
    } finally {
      retryInFlightRef.current = false;
    }
  }, [isSending, messages, onMessagesChange, send]);

  const retry = useCallback(() => resendLastPair(true), [resendLastPair]);

  /** 以同一问题、当前深度重跑最后一轮（ChatGPT 式“重新生成”）。 */
  const regenerate = useCallback(() => resendLastPair(false), [resendLastPair]);

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
    regenerate,
  };
};
