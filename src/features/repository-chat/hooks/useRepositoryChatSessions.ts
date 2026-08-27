import { useCallback, useEffect, useRef, useState } from 'react';
import type { Repository } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { resolveRepositoryChatHeadSha } from '../../../services/repositoryChatService';
import type { RepositoryChatMessage, RepositoryChatSession } from '../../../types/repositoryChat';
import { repositoryChatSessionRepository } from '../repositories/sessionRepository';

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `repository-chat-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const defaultTitle = (language: 'zh' | 'en') => language === 'zh' ? '新对话' : 'New conversation';

export interface UseRepositoryChatSessionsOptions {
  repository: Repository | null;
  language: 'zh' | 'en';
  resolveSourceRefSha?: (repository: Repository, signal?: AbortSignal) => Promise<string>;
}

export const useRepositoryChatSessions = ({
  repository,
  language,
  resolveSourceRefSha,
}: UseRepositoryChatSessionsOptions) => {
  const githubToken = useAppStore((state) => state.githubToken);
  const retainSessionDays = useAppStore((state) => state.repositoryChatSettings.retainSessionDays);
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<RepositoryChatSession | null>(null);
  const [messages, setMessages] = useState<RepositoryChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operationIdRef = useRef(0);

  const loadSessionMessages = useCallback(async (session: RepositoryChatSession | null, operationId: number) => {
    if (!session) {
      if (operationId === operationIdRef.current) setMessages([]);
      return;
    }
    const nextMessages = await repositoryChatSessionRepository.listMessages(session.id);
    if (operationId === operationIdRef.current) setMessages(nextMessages);
  }, []);

  const refresh = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    if (!repository) {
      setSessions([]);
      setActiveSession(null);
      setMessages([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      await repositoryChatSessionRepository.purgeExpiredSessions(repository.id, retainSessionDays);
      const nextSessions = await repositoryChatSessionRepository.listSessionsByRepository(repository.id);
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
  }, [loadSessionMessages, repository, retainSessionDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createSession = useCallback(async () => {
    const operationId = ++operationIdRef.current;
    if (!repository) return null;
    setIsLoading(true);
    setError(null);
    try {
      const resolveSha = resolveSourceRefSha ?? ((targetRepository: Repository) => {
        if (!githubToken) throw new Error(language === 'zh' ? '请先配置 GitHub token。' : 'Configure a GitHub token before starting a conversation.');
        return resolveRepositoryChatHeadSha(targetRepository, githubToken);
      });
      const sourceRefSha = await resolveSha(repository);
      if (operationId !== operationIdRef.current) return null;
      const now = new Date().toISOString();
      const session: RepositoryChatSession = {
        id: createId(),
        repoId: repository.id,
        repoFullName: repository.full_name,
        sourceRefSha,
        title: defaultTitle(language),
        createdAt: now,
        updatedAt: now,
      };
      await repositoryChatSessionRepository.saveSession(session);
      if (operationId !== operationIdRef.current) return null;
      setSessions((previous) => [session, ...previous]);
      setActiveSession(session);
      setMessages([]);
      return session;
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to create a repository chat session');
      return null;
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [githubToken, language, repository, resolveSourceRefSha]);

  const selectSession = useCallback(async (sessionId: string) => {
    const operationId = ++operationIdRef.current;
    const session = sessions.find((item) => item.id === sessionId) ?? null;
    setActiveSession(session);
    await loadSessionMessages(session, operationId);
  }, [loadSessionMessages, sessions]);

  const deleteSession = useCallback(async (sessionId: string) => {
    const operationId = ++operationIdRef.current;
    setIsLoading(true);
    setError(null);
    try {
      await repositoryChatSessionRepository.permanentlyDeleteSession(sessionId);
      if (operationId !== operationIdRef.current) return;
      const nextSessions = sessions.filter((session) => session.id !== sessionId);
      setSessions(nextSessions);
      const nextActive = activeSession?.id === sessionId ? (nextSessions[0] ?? null) : activeSession;
      setActiveSession(nextActive);
      await loadSessionMessages(nextActive, operationId);
    } catch (unknownError) {
      if (operationId === operationIdRef.current) setError(unknownError instanceof Error ? unknownError.message : 'Unable to delete the repository chat session');
    } finally {
      if (operationId === operationIdRef.current) setIsLoading(false);
    }
  }, [activeSession, loadSessionMessages, sessions]);

  const updateSession = useCallback(async (session: RepositoryChatSession) => {
    await repositoryChatSessionRepository.saveSession(session);
    setSessions((previous) => previous
      .map((item) => item.id === session.id ? session : item)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
    setActiveSession((previous) => previous?.id === session.id ? session : previous);
  }, []);

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
    updateSession,
    setMessages,
  };
};
