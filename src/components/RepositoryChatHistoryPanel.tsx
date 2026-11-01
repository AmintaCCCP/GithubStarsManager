



import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import { useMemo, useState } from 'react';
import { Check, History, Search, Trash2, X } from 'lucide-react';
import type { RepositoryChatSession } from '../types/repositoryChat';
import { Button } from './ui/button';
import { Input } from './ui/input';

interface RepositoryChatHistoryPanelProps {
  sessions: RepositoryChatSession[];
  activeSessionId?: string;
  language: AppLanguage;
  disabled?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onRename: (sessionId: string, title: string) => void;
}

type HistoryGroup = 'today' | 'yesterday' | 'week' | 'month' | 'earlier';

const groupFor = (value: string): HistoryGroup => {
  const now = new Date();
  const date = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30).getTime();
  if (date.getTime() >= today) return 'today';
  if (date.getTime() >= yesterday) return 'yesterday';
  if (date.getTime() >= startOfWeek) return 'week';
  if (date.getTime() >= startOfMonth) return 'month';
  return 'earlier';
};

export const RepositoryChatHistoryPanel: React.FC<RepositoryChatHistoryPanelProps> = ({
  sessions,
  activeSessionId,

  disabled = false,
  onSelect,
  onDelete,
  onRename,
}) => {
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const t = useT('chat');

  const groupedSessions = useMemo(() => {
    const groups: Record<HistoryGroup, RepositoryChatSession[]> = { today: [], yesterday: [], week: [], month: [], earlier: [] };
    const normalizedQuery = query.trim().toLocaleLowerCase();
    sessions
      .filter((session) => !normalizedQuery || session.title.toLocaleLowerCase().includes(normalizedQuery))
      .forEach((session) => groups[groupFor(session.updatedAt)].push(session));
    return groups;
  }, [query, sessions]);

  const hasVisibleSessions = Object.values(groupedSessions).some((group) => group.length > 0);

  const groupLabels: Record<HistoryGroup, string> = {
    today: t('repositoryChatHistoryPanel.today'),
    yesterday: t('globalChatHistorySheet.group-yesterday'),
    week: t('repositoryChatHistoryPanel.last-7-days'),
    month: t('globalChatHistorySheet.group-last-30-days'),
    earlier: t('repositoryChatHistoryPanel.earlier'),
  };

  return (
    <section aria-label={t('repositoryChatHistoryPanel.history-for-this-repository')} className="flex min-h-0 h-full flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 pl-8 text-xs"
          placeholder={t('repositoryChatHistoryPanel.search-this-repository')}
          aria-label={t('repositoryChatHistoryPanel.search-repository-chat-history')}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!hasVisibleSessions ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
            <History className="h-5 w-5" aria-hidden="true" />
            <p>{sessions.length === 0
              ? t('repositoryChatHistoryPanel.there-are-no-saved-conversations-for-this-reposi')
              : t('repositoryChatHistoryPanel.no-matching-conversations-found')}</p>
          </div>
        ) : (
          (Object.keys(groupedSessions) as HistoryGroup[]).map((group) => groupedSessions[group].length > 0 && (
            <div key={group} className="mb-4">
              <h3 className="mb-1 px-1 text-xs font-medium text-muted-foreground">{groupLabels[group]}</h3>
              <ul className="space-y-1">
                {groupedSessions[group].map((session) => (
                  <li key={session.id} className="flex items-center gap-1">
                    {editingId === session.id ? (
                      <div className="flex min-w-0 flex-1 items-center gap-1">
                        <Input
                          value={editingTitle}
                          onChange={(event) => setEditingTitle(event.target.value)}
                          className="h-8 min-w-0 text-xs"
                          autoFocus
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && !disabled && !event.nativeEvent.isComposing) {
                              onRename(session.id, editingTitle);
                              setEditingId(null);
                            }
                            if (event.key === 'Escape') setEditingId(null);
                          }}
                        />
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => { onRename(session.id, editingTitle); setEditingId(null); }} disabled={disabled} aria-label={t('repositoryChatSheet.save-title')}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditingId(null)} aria-label={t('repositoryChatSheet.cancel-edit')}>
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant={session.id === activeSessionId ? 'secondary' : 'ghost'}
                        className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left text-xs"
                        onClick={() => {
                          if (!disabled) onSelect(session.id);
                        }}
                        onDoubleClick={() => { setEditingId(session.id); setEditingTitle(session.title); }}
                        onKeyDown={(event) => {
                          if (event.key === 'F2') {
                            setEditingId(session.id);
                            setEditingTitle(session.title);
                          }
                        }}
                        aria-disabled={disabled || undefined}
                        aria-current={session.id === activeSessionId ? 'true' : undefined}
                      >
                        <span className="truncate">{session.title}</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => onDelete(session.id)}
                      disabled={disabled}
                      aria-label={t('repositoryChatHistoryPanel.delete-conversation-v1', { v1: session.title })}
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </section>
  );
};
