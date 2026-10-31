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
  onSelectSession: (repository: Repository, sessionId: string) => void;
}

const HISTORY_CHANGE_EVENT = 'gsm:global-chat-history-changed';
const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

type DateGroupKey = 'today' | 'yesterday' | 'last-7-days' | 'last-30-days' | 'earlier';

const DATE_GROUP_KEYS: DateGroupKey[] = ['today', 'yesterday', 'last-7-days', 'last-30-days', 'earlier'];

const dateGroupKey = (value: string, now: number): DateGroupKey => {
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'earlier';
  const startOfDay = (timestamp: number) => {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  const dayDiff = Math.round((startOfDay(now) - startOfDay(time)) / DAY_MS);
  if (dayDiff <= 0) return 'today';
  if (dayDiff === 1) return 'yesterday';
  if (dayDiff < 7) return 'last-7-days';
  if (dayDiff < 30) return 'last-30-days';
  return 'earlier';
};

const msUntilNextLocalMidnight = (): number => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now.getTime();
};

export const GlobalChatHistorySheet: React.FC<GlobalChatHistorySheetProps> = ({
  isOpen,
  onClose,
  onSelectSession,
}) => {
  const language = useAppStore((state) => state.language);
  const allRepositories = useAppStore((state) => state.repositories ?? []);
  const user = useAppStore((state) => state.user);
  const t = useT('chat');
  const [sessions, setSessions] = useState<RepositoryChatSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [dateNow, setDateNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [pendingDeletion, setPendingDeletion] = useState<RepositoryChatSession | null>(null);
  // 重叠刷新只允许最新请求提交，避免旧结果覆盖新状态。
  const requestIdRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // 分页偏移跟随已加载数量，删除会话后下一页仍从列表末尾继续。
  const loadedCountRef = useRef(0);

  const repositoryById = useMemo(() => {
    const map = new Map<number, Repository>();
    allRepositories.forEach((repository) => map.set(repository.id, repository));
    return map;
  }, [allRepositories]);

  const buildFallbackRepository = useCallback((session: RepositoryChatSession): Repository => {
    const [ownerLogin = 'github', repoName = session.repoFullName] = session.repoFullName.split('/');
    return {
      id: session.repoId,
      name: repoName,
      full_name: session.repoFullName,
      description: session.repoSnapshot?.description ?? null,
      html_url: session.repoSnapshot?.htmlUrl ?? `https://github.com/${session.repoFullName}`,
      stargazers_count: 0,
      forks_count: 0,
      forks: 0,
      language: session.repoSnapshot?.language ?? null,
      topics: [],
      created_at: session.createdAt,
      updated_at: session.updatedAt,
      pushed_at: session.updatedAt,
      owner: {
        login: session.repoSnapshot?.ownerLogin ?? ownerLogin,
        avatar_url: session.repoSnapshot?.ownerAvatarUrl ?? `https://github.com/${ownerLogin}.png?size=64`,
      },
    };
  }, []);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const nextSessions = await repositoryChatStorage.listRecentSessions(PAGE_SIZE + 1);
      if (requestId !== requestIdRef.current) return;
      setHasMore(nextSessions.length > PAGE_SIZE);
      setSessions(nextSessions.slice(0, PAGE_SIZE));
    } catch {
      if (requestId !== requestIdRef.current) return;
      setLoadError(t('globalChatHistorySheet.failed-to-load-history-please-retry'));
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    const generation = requestIdRef.current;
    setIsLoadingMore(true);
    try {
      const nextSessions = await repositoryChatStorage.listRecentSessions(PAGE_SIZE + 1, loadedCountRef.current);
      if (generation !== requestIdRef.current) return;
      setHasMore(nextSessions.length > PAGE_SIZE);
      setSessions((previous) => [...previous, ...nextSessions.slice(0, PAGE_SIZE)]);
    } catch {
      if (generation !== requestIdRef.current) return;
      setLoadError(t('globalChatHistorySheet.failed-to-load-history-please-retry'));
    } finally {
      if (generation === requestIdRef.current) setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, t]);

  useEffect(() => {
    loadedCountRef.current = sessions.length;
  }, [sessions]);

  useEffect(() => {
    if (!isOpen) return;
    setDateNow(Date.now());
    const timer = setTimeout(() => setDateNow(Date.now()), msUntilNextLocalMidnight());
    return () => clearTimeout(timer);
  }, [isOpen, dateNow]);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      void refresh();
    }
  }, [isOpen, refresh]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: '80px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore]);

  const handleDelete = useCallback(async (sessionId: string) => {
    await repositoryChatStorage.permanentlyDeleteSession(sessionId);
    setSessions((previous) => previous.filter((session) => session.id !== sessionId));
    window.dispatchEvent(new CustomEvent(HISTORY_CHANGE_EVENT));
  }, []);

  const visibleSessions = useMemo(() => {
    // 新会话带账号标记；旧会话无标记，为兼容继续展示。
    const accountSessions = user?.login
      ? sessions.filter((session) => !session.accountLogin || session.accountLogin === user.login)
      : sessions.filter((session) => !session.accountLogin);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return accountSessions;
    return accountSessions.filter((session) =>
      session.title.toLocaleLowerCase().includes(normalizedQuery) ||
      session.repoFullName.toLocaleLowerCase().includes(normalizedQuery),
    );
  }, [query, sessions, user]);

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

  const groupedSessions = useMemo(() => {
    const groups = new Map<DateGroupKey, RepositoryChatSession[]>();
    visibleSessions.forEach((session) => {
      const key = dateGroupKey(session.updatedAt, dateNow);
      const group = groups.get(key);
      if (group) group.push(session);
      else groups.set(key, [session]);
    });
    return DATE_GROUP_KEYS
      .filter((key) => groups.has(key))
      .map((key) => ({ key, sessions: groups.get(key) as RepositoryChatSession[] }));
  }, [visibleSessions, dateNow]);

  const dateGroupLabel = useCallback((key: DateGroupKey) => t(`globalChatHistorySheet.group-${key}`), [t]);

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
            {!isLoading && !loadError && <span className="text-sm font-normal text-muted-foreground">({sessions.length})</span>}
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
            <div className="space-y-2 py-2" role="status" aria-label={t('globalChatHistorySheet.loading-history')}>
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="flex items-center gap-2.5 px-2 py-2">
                  <div className="h-7 w-7 shrink-0 animate-pulse rounded-md bg-muted" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : loadError && visibleSessions.length === 0 ? (
            <div className="flex min-h-28 flex-col items-center justify-center gap-3 rounded-md border border-destructive/40 px-4 text-center text-sm" role="alert">
              <p className="text-destructive">{loadError}</p>
              <Button type="button" variant="secondary" size="sm" onClick={() => void refresh()}>
                {t('globalChatHistorySheet.retry')}
              </Button>
            </div>
          ) : visibleSessions.length === 0 && sessions.length > 0 && hasMore ? (
            <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground" role="status">
              {isLoadingMore ? t('globalChatHistorySheet.loading-history') : ''}
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
              {groupedSessions.map((group) => (
                <li key={group.key} className="list-none">
                  <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{dateGroupLabel(group.key)}</p>
                  <ul className="space-y-1">
                    {group.sessions.map((session) => {
                      const repository = repositoryById.get(session.repoId);
                      const isUnstarred = !repository;
                      const targetRepository = repository ?? buildFallbackRepository(session);
                      const avatarUrl = session.repoSnapshot?.ownerAvatarUrl
                        ?? repository?.owner.avatar_url
                        ?? `https://github.com/${session.repoFullName.split('/')[0]}.png?size=64`;
                      return (
                        <li key={session.id} className="flex items-center gap-1 rounded-md border border-transparent hover:border-border">
                          <Button
                            type="button"
                            variant="ghost"
                            className="h-auto min-w-0 flex-1 items-center justify-start gap-2.5 px-2 py-2 text-left"
                            onClick={() => onSelectSession(targetRepository, session.id)}
                            title={t('globalChatHistorySheet.open-conversation-in-v1', { v1: session.repoFullName })}
                          >
                            <img src={avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-md border border-border" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-foreground">{session.title}</span>
                              <span className="block truncate text-xs text-muted-foreground">{session.repoFullName} · {formatTime(session.updatedAt)}</span>
                            </span>
                          </Button>
                          {isUnstarred && (
                            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {t('globalChatHistorySheet.unstarred-repository')}
                            </span>
                          )}
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
                </li>
              ))}
              </ul>
              {hasMore && (
                <div ref={sentinelRef} className="py-3 text-center text-xs text-muted-foreground" role="status">
                  {isLoadingMore ? t('globalChatHistorySheet.loading-history') : ''}
                </div>
              )}
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
