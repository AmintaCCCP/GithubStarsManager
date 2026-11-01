
import { useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { resolveRepositoryChatHeadSha } from '../../../services/repositoryChatService';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
import { repositoryChatStorage } from '../../../services/repositoryChatStorage';
import { createSecureId } from '../../../utils/cryptoRandom';
import { accountIdKey } from '../../../store/helpers/accountWorkspace';

/**
 * Generates a unique repository chat session ID.
 *
 * @returns A cryptographically secure session ID prefixed with 'repository-chat'.
 */
const createId = (): string => createSecureId('repository-chat');

/** 会话默认标题集合：历史会话可能以任意语言创建，判断是否默认标题用集合比较 */
export const DEFAULT_CHAT_TITLES = new Set([
  '新对话', 'New conversation', '新しい会話', 'Nueva conversación', 'Nova conversa',
  'Новый диалог', '新對話', 'Nouvelle conversation', 'Neue Unterhaltung', '새 대화',
]);
const DEFAULT_TITLE_BY_LANGUAGE: Record<AppLanguage, string> = {
  zh: '新对话', en: 'New conversation', ja: '新しい会話', es: 'Nueva conversación', 'pt-BR': 'Nova conversa',
  ru: 'Новый диалог', 'zh-TW': '新對話', fr: 'Nouvelle conversation', de: 'Neue Unterhaltung', ko: '새 대화',
};
const defaultTitle = (language: AppLanguage) => DEFAULT_TITLE_BY_LANGUAGE[language] ?? 'New conversation';

/** 通知全局问答历史入口（SearchBar 徽标、历史抽屉）刷新。 */
const notifyGlobalHistoryChanged = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gsm:global-chat-history-changed'));
  }
};

export interface UseRepositoryChatSessionsOptions {
  repository: Repository | null;
  language: AppLanguage;
  resolveSourceRefSha?: (repository: Repository, signal?: AbortSignal) => Promise<string>;
}

export const useRepositoryChatSessions = ({
  repository,
  language,
  resolveSourceRefSha,
}: UseRepositoryChatSessionsOptions) => {
  const t = useT('chat');
  const githubToken = useAppStore((state) => state.githubToken);
  const user = useAppStore((state) => state.user);
  const retainSessionDays = useAppStore((state) => state.repositoryChatSettings.retainSessionDays);
  const accountId = accountIdKey(user);
  const accountLogin = user?.login ?? null;
  const scope = useMemo(() => ({ accountId, accountLogin }), [accountId, accountLogin]);
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<RepositoryChatSession | null>(null);
  const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationIdRef = useRef(0);
  const deleteFinalizeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const loadSessionMessages = useCallback(async (session: RepositoryChatSession | null, operationId: number) => {
    if (!session) {
      if (operationId === operationIdRef.current) setMessages([]);
      return;
    }
    const nextMessages = await repositoryChatStorage.listMessages(session.id, scope);
    if (operationId === operationIdRef.current) setMessages(nextMessages);
  }, [scope]);

  const refresh = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    // Never leave a previous account's transcript mounted while a scoped read
    // is in flight or after it fails.
    setSessions([]);
    setActiveSession(null);
    setMessages([]);
    setError(null);
    if (!repository || !scope.accountId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      try {
        await repositoryChatStorage.purgeExpiredSessions(repository.id, retainSessionDays, scope);
        await repositoryChatStorage.purgeDeletedSessions(scope);
        await repositoryChatStorage.purgeEmptySessions(scope);
      } catch (cleanupError) {
        console.warn('[repository-chat] session cleanup failed', cleanupError);
      }
      const nextSessions = await repositoryChatStorage.listSessionsByRepository(repository.id, scope);
      if (operationId !== operationIdRef.current) return;
      // Login-only rows are claimed without replacing fields that may have been
      // updated after the scoped list read.
      try {
        await repositoryChatStorage.claimLegacySessions(nextSessions.map((session) => session.id), scope);
      } catch (persistenceError) {
        console.warn('[repository-chat] unable to persist legacy session claim', persistenceError);
      }
      if (operationId !== operationIdRef.current) return;
      setSessions(nextSessions);
      const mostRecent = nextSessions[0] ?? null;
      setActiveSession(mostRecent);
      await loadSessionMessages(mostRecent, operationId);
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to load repository chat sessions');
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [loadSessionMessages, repository, retainSessionDays, scope]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => () => {
    // A closed sheet must not leave a deleted transcript in the device store.
    deleteFinalizeTimersRef.current.forEach((timer, sessionId) => {
      clearTimeout(timer);
      void repositoryChatStorage.permanentlyDeleteSession(sessionId, scope, { onlyIfDeleted: true })
        .catch((error) => console.warn('[repository-chat] permanent deletion failed during unmount', error));
    });
    deleteFinalizeTimersRef.current.clear();
  }, [scope]);

  const createSession = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    if (!repository || !scope.accountId) return null;
    setIsLoading(true);
    setError(null);
    try {
      const accountLogin = scope.accountLogin ?? undefined;
      const resolveSha = resolveSourceRefSha ?? ((targetRepository: Repository) => {
        if (!githubToken) throw new Error(t('useRepositoryChatSessions.configure-a-github-token-before-starting-a-conve'));
        return resolveRepositoryChatHeadSha(targetRepository, githubToken);
      });
      const sourceRefSha = await resolveSha(repository);
      if (operationId !== operationIdRef.current) return null;
      const now = new Date().toISOString();
      const session: RepositoryChatSession = {
        id: createId(),
        repoId: repository.id,
        accountId: scope.accountId,
        accountLogin,
        repoFullName: repository.full_name,
        sourceRefSha,
        title: defaultTitle(language),
        createdAt: now,
        updatedAt: now,
        repoSnapshot: {
          ownerLogin: repository.owner.login,
          ownerAvatarUrl: repository.owner.avatar_url,
          htmlUrl: repository.html_url,
          ...(repository.description ? { description: repository.description } : {}),
          ...(repository.language ? { language: repository.language } : {}),
        },
      };
      await repositoryChatStorage.saveSession(session);
      if (operationId !== operationIdRef.current) return null;
      setSessions((previous) => [session, ...previous]);
      setActiveSession(session);
      setMessages([]);
      notifyGlobalHistoryChanged();
      return session;
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to create a repository chat session');
      return null;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [githubToken, language, repository, resolveSourceRefSha, scope.accountId, scope.accountLogin, t]);

  const selectSession = useCallback(async (sessionId: string): Promise<boolean> => {
    const operationId = ++operationIdRef.current;
    const session = sessions.find((item) => item.id === sessionId) ?? null;
    setActiveSession(session);
    setMessages([]);
    setError(null);
    if (!session) {
      setIsLoading(false);
      return false;
    }
    setIsLoading(true);
    try {
      try {
        await loadSessionMessages(session, operationId);
      } catch {
        if (operationId !== operationIdRef.current) return false;
        // IndexedDB failures normally transition storage to the fallback path;
        // retry once immediately so a completed transition is not lost.
        await loadSessionMessages(session, operationId);
      }
      return true;
    } catch (unknownError) {
      if (operationId === operationIdRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : 'Unable to load repository chat messages');
      }
      return false;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [loadSessionMessages, sessions]);

  const scheduleFinalDelete = useCallback((sessionId: string) => {
    const existingTimer = deleteFinalizeTimersRef.current.get(sessionId);
    if (existingTimer) clearTimeout(existingTimer);
    deleteFinalizeTimersRef.current.set(sessionId, setTimeout(() => {
      deleteFinalizeTimersRef.current.delete(sessionId);
      void repositoryChatStorage.permanentlyDeleteSession(sessionId, scope, { onlyIfDeleted: true })
        .catch((error) => console.warn('[repository-chat] deferred permanent deletion failed', error));
    }, 5000));
  }, [scope]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const operationId = ++operationIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      await repositoryChatStorage.softDeleteSession(sessionId, scope);
      scheduleFinalDelete(sessionId);
      notifyGlobalHistoryChanged();
      if (operationId !== operationIdRef.current) return true;
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      setSessions(nextSessions);
      const nextActive = activeSession?.id === sessionId ? (nextSessions[0] ?? null) : activeSession;
      setActiveSession(nextActive);
      try {
        await loadSessionMessages(nextActive, operationId);
      } catch (loadError) {
        if (operationId === operationIdRef.current) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load repository chat messages');
        }
      }
      return true;
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to delete the repository chat session');
      return false;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [activeSession, loadSessionMessages, scheduleFinalDelete, scope, sessions]);

  const restoreSession = useCallback(async (session: RepositoryChatSession) => {
    const operationId = ++operationIdRef.current;
    const timer = deleteFinalizeTimersRef.current.get(session.id);
    if (timer) clearTimeout(timer);
    deleteFinalizeTimersRef.current.delete(session.id);
    let restored: RepositoryChatSession | null = null;
    try {
      restored = await repositoryChatStorage.restoreSession(session.id, scope);
      if (!restored) {
        scheduleFinalDelete(session.id);
        return false;
      }
      const restoredSession = restored;
      if (operationId !== operationIdRef.current) return false;
      setSessions((previous) => [restoredSession, ...previous.filter((item) => item.id !== restoredSession.id)]
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
      setActiveSession(restoredSession);
      setMessages([]);
      setError(null);
      setIsLoading(true);
      await loadSessionMessages(restoredSession, operationId);
      notifyGlobalHistoryChanged();
      return true;
    } catch (unknownError) {
      if (!restored) scheduleFinalDelete(session.id);
      if (operationId === operationIdRef.current) {
        setError(unknownError instanceof Error ? unknownError.message : 'Unable to restore the repository chat session');
      }
      return false;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [loadSessionMessages, scheduleFinalDelete, scope]);

  const renameSession = useCallback(async (sessionId: string, title: string) => {
    const normalized = title.trim().slice(0, 72);
    if (!normalized) return;
    try {
      const updated = await repositoryChatStorage.renameSession(sessionId, normalized, scope);
      if (!updated) return;
      setSessions((previous) => previous.map((item) => item.id === sessionId ? updated : item));
      setActiveSession((previous) => previous?.id === sessionId ? updated : previous);
      notifyGlobalHistoryChanged();
    } catch (unknownError) {
      setError(unknownError instanceof Error ? unknownError.message : 'Unable to rename the repository chat session');
    }
  }, [scope]);

  const startDraft = useCallback(() => {
    if (isLoading) return;
    operationIdRef.current += 1;
    setActiveSession(null);
    setMessages([]);
    setError(null);
  }, [isLoading]);

  const updateSession = useCallback(async (
    session: RepositoryChatSession,
    options?: { titleIfCurrent?: string },
  ) => {
    const updated = await repositoryChatStorage.updateSessionMetadata(session, scope, options);
    if (!updated) return;
    setSessions((previous) => previous
      .map((item) => item.id === updated.id ? updated : item)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setActiveSession((previous) => previous?.id === updated.id ? updated : previous);
  }, [scope]);

  return {
    sessions,
    activeSession,
    messages,
    isLoading,
    error,
    refresh,
    createSession,
    selectSession,
    deleteSession,
    restoreSession,
    renameSession,
    startDraft,
    updateSession,
    setMessages,
  };
};
