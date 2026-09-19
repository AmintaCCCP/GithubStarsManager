import { getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Search, Trash2 } from 'lucide-react';
import type { Repository } from '../types';
import type { RepositoryChatSession } from '../types/repositoryChat';
import { useAppStore } from '../store/useAppStore';
import { repositoryChatStorage } from '../services/repositoryChatStorage';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';

interface GlobalChatHistorySheetProps {
  isOpen: boolean;
  onClose: () => void;
  repositories: Repository[];
  onSelectSession: (repository: Repository, sessionId: string) => void;
}

const HISTORY_CHANGE_EVENT = 'gsm:global-chat-history-changed';

export const GlobalChatHistorySheet: React.FC<GlobalChatHistorySheetProps> = ({
  isOpen,
  onClose,
  repositories,
  onSelectSession,
}) => {
  const language = useAppStore((state) => state.language);
  const t = useT('chat');
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingDeletion, setPendingDeletion] = useState<RepositoryChatSession | null>(null);
  // 重叠刷新只允许最新请求提交，避免旧结果覆盖新状态。
  const requestIdRef = useRef(0);

  const repositoryById = useMemo(() => {
    const map = new Map<number, Repository>();
    repositories.forEach((repository) => map.set(repository.id, repository));
    return map;
  }, [repositories]);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const nextSessions = await repositoryChatStorage.listRecentSessions(50);
      if (requestId !== requestIdRef.current) return;
      setSessions(nextSessions);
    } catch {
      if (requestId !== requestIdRef.current) return;
      setLoadError(t('globalChatHistorySheet.failed-to-load-history-please-retry'));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      void refresh();
    }
  }, [isOpen, refresh]);

  const handleDelete = useCallback(async (sessionId: string) => {
    await repositoryChatStorage.permanentlyDeleteSession(sessionId);
    setSessions((previous) => previous.filter((session) => session.id !== sessionId));
    window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT));
  }, []);

  const visibleSessions = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sessions;
    return sessions.filter((session) =>
      session.title.toLocaleLowerCase().includes(normalizedQuery) ||
      session.repoFullName.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, sessions]);

  const formatTime = useCallback((value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString(getIntlLocale(language), {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }, [language]);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(100vw-1rem,32rem)] sm:max-w-none"
        closeLabel={t('globalChatHistorySheet.close-chat-history')}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          window.setTimeout(onClose, 0);
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 shrink-0" aria-hidden="true" />
            {t('globalChatHistorySheet.chat-history')}
          </SheetTitle>
          <SheetDescription>
            {t('globalChatHistorySheet.conversations-across-repositories-select-one-to')}
          </SheetDescription>
        </SheetHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-8 pl-8 text-xs"
            placeholder={t('globalChatHistorySheet.search-title-or-repository')}
            aria-label={t('globalChatHistorySheet.search-chat-history')}
          />
        </div>

        <section aria-label={t('globalChatHistorySheet.chat-history-list')} className="min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <p className="py-10 text-center text-sm text-muted-foreground" role="status">{t('globalChatHistorySheet.loading-history')}</p>
          ) : loadError && visibleSessions.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 px-4 text-center text-sm" role="alert">
              <p className="text-destructive">{loadError}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()}>
                {t('globalChatHistorySheet.retry')}
              </Button>
            </div>
          ) : visibleSessions.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
              <History className="h-5 w-5" aria-hidden="true" />
              <p>{sessions.length === 0
                ? t('globalChatHistorySheet.no-saved-conversations-yet')
                : t('globalChatHistorySheet.no-matching-conversations-found')}</p>
            </div>
          ) : (
            <>
              {loadError && (
                <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-destructive/40 px-3 py-2 text-xs text-destructive" role="alert">
                  <span>{loadError}</span>
                  <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => void refresh()}>
                    {t('globalChatHistorySheet.retry')}
                  </Button>
                </div>
              )}
              <ul className="space-y-1">
              {visibleSessions.map((session) => {
                const repository = repositoryById.get(session.repoId);
                return (
                  <li key={session.id} className="flex items-center gap-1 rounded-md border border-transparent hover:border-border">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-w-0 flex-1 items-center justify-start gap-2.5 px-2 py-2 text-left"
                      onClick={() => {
                        if (repository) onSelectSession(repository, session.id);
                      }}
                      disabled={!repository}
                      title={repository ? t('globalChatHistorySheet.open-conversation-in-v1', { v1: session.repoFullName }) : t('globalChatHistorySheet.the-repository-is-no-longer-in-the-list')}
                    >
                      {repository && (
                        <img src={repository.owner.avatar_url} alt="" className="h-7 w-7 shrink-0 rounded-md border border-border" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{session.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{session.repoFullName} · {formatTime(session.updatedAt)}</span>
                      </span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDeletion(session)}
                      aria-label={t('globalChatHistorySheet.delete-conversation-v1', { v1: session.title })}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                );
              })}
              </ul>
            </>
          )}
        </section>

        <AlertDialog open={Boolean(pendingDeletion)} onOpenChange={(open) => !open && setPendingDeletion(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('globalChatHistorySheet.delete-this-conversation')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('globalChatHistorySheet.this-only-deletes-the-conversation-and-tool-trac')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('globalChatHistorySheet.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (pendingDeletion) void handleDelete(pendingDeletion.id);
                  setPendingDeletion(null);
                }}
              >
                {t('globalChatHistorySheet.delete-conversation')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
};
