



import { makeT, useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { AIService } from '../../../services/aiService';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';
import { DEFAULT_CHAT_TITLES } from './useRepositoryChatSessions';
import { createSecureId } from '../../../utils/cryptoRandom';
import { accountIdKey } from '../../../store/helpers/accountWorkspace';

/**
 * Generates a unique repository chat entity ID with the specified prefix.
 *
 * @param prefix - The prefix indicating the entity type (e.g. 'message', 'tool-event').
 * @returns A cryptographically secure unique identifier string.
 */
const createId = (prefix: string): string => createSecureId(prefix);

export const repositoryChatErrorMessage = (unknownError: unknown, language: AppLanguage): string => {
  const t = makeT(language, 'chat');
  const rawMessage = unknownError instanceof Error ? unknownError.message : String(unknownError ?? '');
  const isTemporaryServiceFailure = /\b(?:5\d\d|429)\b|upstream|timeout|timed?\s*out|network|fetch|do_request_failed|temporarily unavailable/i.test(rawMessage);
  if (isTemporaryServiceFailure) {
    return t('useRepositoryChat.the-ai-service-is-temporarily-unavailable-your-q');
  }
  return t('useRepositoryChat.answer-generation-failed-check-the-ai-configurat');
};

interface UseRepositoryChatOptions {
  repository: Repository | null;
  session: RepositoryChatSession | null;
  messages: RepositoryChatMessage[];
  onMessagesChange: (messages: RepositoryChatMessage[]) => void;
  onSessionChange: (
    session: RepositoryChatSession,
    options?: { titleIfCurrent?: string },
  ) => Promise<void>;
}

export const useRepositoryChat = ({
  repository,
  session,
  messages,
  onMessagesChange,
  onSessionChange,
}: UseRepositoryChatOptions) => {
  const t = useT('chat');
  const {
    language,
    user,
    githubToken,
    aiConfigs,
    activeAIConfig,
    repositoryChatSettings,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    user: state.user,
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
  const [feedbackById, setFeedbackById] = useState<Record<string, 'up' | 'down'>>({});
  const evidenceByIdRef = useRef<Record<string, ToolEvidence>>({});
  const feedbackByIdRef = useRef<Record<string, 'up' | 'down'>>({});
  const feedbackSubmissionIdsRef = useRef<Record<string, number>>({});
  const submittedFeedbackIdsRef = useRef<Set<string>>(new Set());
  const feedbackWriteChainsRef = useRef<Map<string, Promise<void>>>(new Map());
  const feedbackLoadKeyRef = useRef('');
  const sessionRef = useRef(session);
  const accountId = accountIdKey(user);
  const accountLogin = user?.login ?? null;
  const accountScope = useMemo(() => ({ accountId, accountLogin }), [accountId, accountLogin]);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const retainNewestSession = useCallback((candidate: RepositoryChatSession) => {
    const current = sessionRef.current;
    const sameSession = current?.id === candidate.id;
    const currentWasRenamed = sameSession
      && current.title !== candidate.title
      && Date.parse(current.updatedAt) >= Date.parse(candidate.updatedAt);
    sessionRef.current = sameSession
      && (Date.parse(current.updatedAt) > Date.parse(candidate.updatedAt) || currentWasRenamed)
      ? current
      : candidate;
  }, []);
  useEffect(() => {
    evidenceByIdRef.current = evidenceById;
  }, [evidenceById]);

  const loadEvidence = useCallback(async (ids: string[]) => {
    const missingIds = Array.from(new Set(ids)).filter((id) => !evidenceByIdRef.current[id]);
    if (missingIds.length === 0) return evidenceByIdRef.current;
    const evidences = await repositoryChatStorage.listEvidence(missingIds);
    const next = {
      ...evidenceByIdRef.current,
      ...Object.fromEntries(evidences.map((evidence) => [evidence.id, evidence])),
    };
    evidenceByIdRef.current = next;
    setEvidenceById(next);
    return next;
  }, []);

  const loadedEvidenceKeyRef = useRef('');
  useEffect(() => {
    evidenceByIdRef.current = {};
    loadedEvidenceKeyRef.current = '';
    setEvidenceById({});
  }, [session?.id]);
  useEffect(() => {
    // 流式回答会让 messages 每 ~60ms 变化一次，但证据集合只在回合完成时变化；
    // 用 key 去重，避免流式期间反复查询 IndexedDB。
    const evidenceKey = messages.map((message) => message.evidenceIds.join('|')).join(',');
    if (evidenceKey === loadedEvidenceKeyRef.current) return;
    loadedEvidenceKeyRef.current = evidenceKey;
    const evidenceIds = Array.from(new Set(messages.flatMap((message) => message.evidenceIds)));
    if (evidenceIds.length === 0) return;
    const missingIds = evidenceIds.filter((id) => !evidenceByIdRef.current[id]);
    if (missingIds.length === 0) return;
    let active = true;
    void repositoryChatStorage.listEvidence(missingIds).then((evidences) => {
      if (!active) return;
      setEvidenceById((previous) => ({
        ...previous,
        ...Object.fromEntries(evidences.map((evidence) => [evidence.id, evidence])),
      }));
    }).catch((readError) => {
      if (!active) return;
      loadedEvidenceKeyRef.current = '';
      console.warn('[repository-chat] unable to load evidence', readError);
    });
    return () => { active = false; };
  }, [messages]);

  useEffect(() => {
    if (!session) {
      setToolEvents([]);
      return;
    }
    let active = true;
    void repositoryChatStorage.listToolEvents(session.id, accountScope).then((events) => {
      if (active) setToolEvents(events);
    }).catch((readError) => {
      if (!active) return;
      setToolEvents([]);
      console.warn('[repository-chat] unable to load tool events', readError);
    });
    return () => { active = false; };
  }, [accountScope, session]);

  const activeSessionId = session?.id ?? null;
  useEffect(() => {
    if (!activeSessionId || !accountScope.accountId) {
      feedbackLoadKeyRef.current = '';
      submittedFeedbackIdsRef.current.clear();
      feedbackSubmissionIdsRef.current = {};
      feedbackByIdRef.current = {};
      setFeedbackById({});
      return;
    }
    const loadKey = `${accountScope.accountId}:${activeSessionId}`;
    if (feedbackLoadKeyRef.current !== loadKey) {
      feedbackLoadKeyRef.current = loadKey;
      submittedFeedbackIdsRef.current.clear();
      feedbackSubmissionIdsRef.current = {};
      feedbackByIdRef.current = {};
      setFeedbackById({});
    }
    let active = true;
    void repositoryChatStorage.listFeedback(activeSessionId, accountScope).then((feedback) => {
      if (!active) return;
      const next = Object.fromEntries(feedback.map((item) => [item.messageId, item.rating])) as Record<string, 'up' | 'down'>;
      submittedFeedbackIdsRef.current.forEach((messageId) => {
        const localRating = feedbackByIdRef.current[messageId];
        if (localRating) next[messageId] = localRating;
        else delete next[messageId];
      });
      feedbackByIdRef.current = next;
      setFeedbackById(next);
    }).catch((readError) => {
      if (!active) return;
      feedbackLoadKeyRef.current = '';
      console.warn('[repository-chat] unable to load feedback', readError);
    });
    return () => { active = false; };
  }, [accountScope, activeSessionId]);

  const resolvedConfigId = repositoryChatSettings.chatConfigId ?? activeAIConfig;
  const aiConfig = aiConfigs.find((config) => config.id === resolvedConfigId) ?? null;
  const unavailableReason = !repositoryChatSettings.enabled
    ? (t('useRepositoryChat.repository-chat-is-disabled-in-ai-settings'))
    : !githubToken
      ? (t('useRepositoryChat.configure-a-github-token-first'))
      : !aiConfig
        ? (t('useRepositoryChat.configure-an-active-ai-service-first'))
        : null;

  const persistToolEvent = useCallback(async (
    event: Omit<RepositoryChatToolEvent, 'id' | 'sessionId' | 'messageId' | 'createdAt'> & { toolName: string },
    activeMessageId: string,
    targetSession: RepositoryChatSession,
  ) => {
    // A tool's running and terminal event share one identity, while repeated
    // actions in later Agent rounds must remain distinct timeline entries.
    const eventKey = `${activeMessageId}:${event.stage ?? 'other'}:${event.round ?? 'global'}:${event.toolName}:${event.paramSummary}`;
    const existing = toolEventIdsRef.current.get(eventKey);
    const createdAt = existing?.createdAt ?? nextTimelineTimestamp();
    const toolEvent: RepositoryChatToolEvent = {
      id: existing?.id ?? createId('tool-event'),
      sessionId: targetSession.id,
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
      await repositoryChatStorage.saveToolEvent(toolEvent);
    });
    toolEventWriteChainsRef.current.set(toolEvent.id, write);
    try {
      await write;
    } finally {
      if (toolEventWriteChainsRef.current.get(toolEvent.id) === write) {
        toolEventWriteChainsRef.current.delete(toolEvent.id);
      }
    }
  }, []);

  const send = useCallback(async (
    question: string,
    baseMessages = messages,
    isRetry = false,
    sessionOverride?: RepositoryChatSession,
  ) => {
    const activeSession = sessionOverride ?? session;
    if (!repository || !activeSession || !aiConfig || unavailableReason || isSending || (!isRetry && retryInFlightRef.current)) {
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
    const userCreatedAt = nextTimelineTimestamp();
    const assistantCreatedAt = nextTimelineTimestamp();
    const userMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: activeSession.id,
      role: 'user',
      content: normalizedQuestion,
      status: 'complete',
      evidenceIds: [],
      // Keep a strict chronological order even after a persistence reload.
      createdAt: userCreatedAt,
    };
    const assistantMessage: RepositoryChatMessage = {
      id: createId('message'),
      sessionId: activeSession.id,
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
    let liveEvidence: ToolEvidence[] = [];
    const withLiveEvidence = (message: RepositoryChatMessage, content = message.content): RepositoryChatMessage => ({
      ...message,
      content,
      evidenceIds: liveEvidence.map((evidence) => evidence.id),
    });
    try {
      await Promise.all([
        repositoryChatStorage.saveMessage(userMessage),
        repositoryChatStorage.saveMessage(assistantMessage),
      ]);
      let streamFlushTimer: ReturnType<typeof setTimeout> | null = null;
      const flushStreamedContent = (content: string) => {
        if (streamFlushTimer) {
          globalThis.clearTimeout(streamFlushTimer);
          streamFlushTimer = null;
        }
        onMessagesChange([...baseMessages, userMessage, withLiveEvidence(assistantMessage, content)]);
      };
      const scheduleStreamedFlush = () => {
        if (streamFlushTimer) return;
        streamFlushTimer = globalThis.setTimeout(() => {
          streamFlushTimer = null;
          onMessagesChange([...baseMessages, userMessage, withLiveEvidence(assistantMessage, streamedContent)]);
        }, 60);
      };
      try {
        const result = await runRepositoryChatTurn({
          repository,
          session: activeSession,
          messages: [...baseMessages, userMessage],
          question: normalizedQuestion,
          githubToken: githubToken ?? '',
          aiConfig,
          language,
          maxToolsPerTurn: repositoryChatSettings.maxToolsPerTurn,
          agentBudget: repositoryChatSettings.agentBudget,
          enableAgentToolLoop: repositoryChatSettings.enableAgentToolLoop,
          taskDepth: repositoryChatSettings.taskDepth,
          fastPath: repositoryChatSettings.fastPath,
          streaming: repositoryChatSettings.streamingMode !== 'off',
          signal: controller.signal,
          onToolEvent: (event) => {
            void persistToolEvent(event, assistantMessage.id, activeSession);
          },
          onEvidence: (evidences) => {
            const known = new Set(liveEvidence.map((evidence) => evidence.id));
            const additions = evidences.filter((evidence) => !known.has(evidence.id));
            if (additions.length === 0) return;
            liveEvidence = [...liveEvidence, ...additions];
            setEvidenceById((previous) => ({
              ...previous,
              ...Object.fromEntries(additions.map((evidence) => [evidence.id, evidence])),
            }));
            scheduleStreamedFlush();
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
        const finalEvidences = Array.from(new Map(
          [...liveEvidence, ...result.evidences].map((evidence) => [evidence.id, evidence]),
        ).values());
        await Promise.all(finalEvidences.map((evidence) => repositoryChatStorage.saveEvidence(evidence)));
        const completedAssistant: RepositoryChatMessage = {
          ...assistantMessage,
          content: result.content,
          status: 'complete',
          evidenceIds: finalEvidences.map((evidence) => evidence.id),
        };
        await repositoryChatStorage.saveMessage(completedAssistant);
        onMessagesChange([...baseMessages, userMessage, completedAssistant]);
        const latestSession = sessionRef.current?.id === activeSession.id
          ? sessionRef.current
          : activeSession;
        const fallbackTitle = DEFAULT_CHAT_TITLES.has(latestSession.title)
            ? normalizedQuestion.slice(0, 72)
            : latestSession.title;
        const updatedSession = {
          ...latestSession,
          title: fallbackTitle,
          modelConfigId: aiConfig.id,
          modelLabelAtTime: `${aiConfig.name} · ${aiConfig.model}`,
          updatedAt: new Date().toISOString(),
        };
        try {
          await onSessionChange(updatedSession, { titleIfCurrent: latestSession.title });
          retainNewestSession(updatedSession);
        } catch (persistenceError) {
          // The completed transcript is still valid even when only its metadata
          // write fails; never replace a verified answer with a storage error.
          console.warn('[repository-chat] unable to persist session metadata', persistenceError);
        }
        if (fallbackTitle !== latestSession.title) {
          void new AIService(aiConfig, language).generateChatText({
            system: language === 'zh'
              ? '为仓库问答会话生成一个不超过 16 个汉字、不加引号和标点的标题。只输出标题。'
              : 'Write a repository-chat title of at most 8 words. Output only the title, without quotes or punctuation.',
            user: `Question: ${normalizedQuestion}\nAnswer: ${result.content.slice(0, 1200)}`,
            temperature: 0,
            maxTokens: 64,
          }).then(async (generated) => {
            const title = generated.replace(/^["'“”‘’]|["'“”‘’]$/g, '').replace(/\s+/g, ' ').trim().slice(0, 48);
            const currentSession = sessionRef.current;
            if (
              !title
              || currentSession?.id !== updatedSession.id
              || currentSession.title !== fallbackTitle
            ) return;
            const titledSession = { ...currentSession, title, updatedAt: new Date().toISOString() };
            await onSessionChange(titledSession, { titleIfCurrent: fallbackTitle });
            retainNewestSession(titledSession);
          }).catch(() => undefined);
        }
      } finally {
        if (streamFlushTimer) globalThis.clearTimeout(streamFlushTimer);
      }
    } catch (unknownError) {
      const aborted = controller.signal.aborted;
      const failedAssistant: RepositoryChatMessage = {
        ...withLiveEvidence(assistantMessage),
        content: aborted
          ? (streamedContent || (t('useRepositoryChat.generation-stopped')))
          : (t('useRepositoryChat.answer-generation-failed-please-retry')),
        status: aborted ? 'aborted' : 'error',
      };
      // The visible transcript must always settle, even if the persistence backend
      // is unavailable and cannot record the terminal failure state.
      onMessagesChange([...baseMessages, userMessage, failedAssistant]);
      try {
        await Promise.all(liveEvidence.map((evidence) => repositoryChatStorage.saveEvidence(evidence)));
        await repositoryChatStorage.saveMessage(failedAssistant);
      } catch {
        // The original error is already represented in the transcript and banner.
      }
      if (!aborted) setError(repositoryChatErrorMessage(unknownError, language));
    } finally {
      abortControllerRef.current = null;
      setIsSending(false);
    }
  }, [aiConfig, githubToken, isSending, language, messages, onMessagesChange, onSessionChange, persistToolEvent, repository, repositoryChatSettings.agentBudget, repositoryChatSettings.enableAgentToolLoop, repositoryChatSettings.fastPath, repositoryChatSettings.maxToolsPerTurn, repositoryChatSettings.streamingMode, repositoryChatSettings.taskDepth, retainNewestSession, session, unavailableReason, t]);

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
      await repositoryChatStorage.permanentlyDeleteMessages([lastUser.id, lastAssistant.id]);
      onMessagesChange(baseMessages);
      await send(lastUser.content, baseMessages, true);
    } catch (unknownError) {
      setError(repositoryChatErrorMessage(unknownError, language));
    } finally {
      retryInFlightRef.current = false;
    }
  }, [isSending, language, messages, onMessagesChange, send]);

  const retry = useCallback(() => resendLastPair(true), [resendLastPair]);

  /** 以同一问题、当前深度重跑最后一轮（ChatGPT 式“重新生成”）。 */
  const regenerate = useCallback(() => resendLastPair(false), [resendLastPair]);

  const editAndResend = useCallback(async (userMessageId: string, content: string): Promise<boolean> => {
    if (!session || isSending || retryInFlightRef.current) return false;
    const normalized = content.trim();
    const index = messages.findIndex((message) => message.id === userMessageId && message.role === 'user');
    if (!normalized || index < 0) return false;
    const baseMessages = messages.slice(0, index);
    retryInFlightRef.current = true;
    try {
      await repositoryChatStorage.deleteMessagesAfter(session.id, messages[index]!.createdAt, accountScope);
      onMessagesChange(baseMessages);
      await send(normalized, baseMessages, true);
      return true;
    } catch (unknownError) {
      setError(repositoryChatErrorMessage(unknownError, language));
      return false;
    } finally {
      retryInFlightRef.current = false;
    }
  }, [accountScope, isSending, language, messages, onMessagesChange, send, session]);

  const submitFeedback = useCallback(async (messageId: string, rating: 'up' | 'down') => {
    const accountId = accountScope.accountId;
    if (!session || !accountId) return;
    const previousRating = feedbackByIdRef.current[messageId];
    const submissionId = (feedbackSubmissionIdsRef.current[messageId] ?? 0) + 1;
    feedbackSubmissionIdsRef.current[messageId] = submissionId;
    submittedFeedbackIdsRef.current.add(messageId);
    const optimistic = { ...feedbackByIdRef.current, [messageId]: rating };
    feedbackByIdRef.current = optimistic;
    setFeedbackById(optimistic);
    const previousWrite = feedbackWriteChainsRef.current.get(messageId) ?? Promise.resolve();
    const write = previousWrite.catch(() => undefined).then(async () => {
      await repositoryChatStorage.saveFeedback({
        id: messageId,
        messageId,
        sessionId: session.id,
        accountId,
        rating,
        createdAt: new Date().toISOString(),
      }, accountScope);
    });
    feedbackWriteChainsRef.current.set(messageId, write);
    try {
      await write;
    } catch (unknownError) {
      if (feedbackSubmissionIdsRef.current[messageId] === submissionId) {
        const rolledBack = { ...feedbackByIdRef.current };
        if (previousRating) rolledBack[messageId] = previousRating;
        else delete rolledBack[messageId];
        submittedFeedbackIdsRef.current.delete(messageId);
        feedbackByIdRef.current = rolledBack;
        setFeedbackById(rolledBack);
        setError(repositoryChatErrorMessage(unknownError, language));
      }
    } finally {
      if (feedbackWriteChainsRef.current.get(messageId) === write) {
        feedbackWriteChainsRef.current.delete(messageId);
      }
    }
  }, [accountScope, language, session]);

  return {
    canChat: !unavailableReason,
    unavailableReason,
    isSending,
    error,
    toolEvents,
    evidenceById,
    feedbackById,
    loadEvidence,
    send,
    stop,
    retry,
    regenerate,
    editAndResend,
    submitFeedback,
  };
};
