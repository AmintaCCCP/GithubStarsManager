import { useMemo, useState } from 'react';
import { History, Search, Trash2 } from 'lucide-react';
import type { RepositoryChatSession } from '../types/repositoryChat';
import { Button } from './ui/button';
import { Input } from './ui/input';
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

interface RepositoryChatHistoryPanelProps {
  sessions: RepositoryChatSession[];
  activeSessionId?: string;
  language: 'zh' | 'en';
  disabled?: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

type HistoryGroup = 'today' | 'week' | 'earlier';

const groupFor = (value: string): HistoryGroup => {
  const now = new Date();
  const date = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfWeek = today - 6 * 24 * 60 * 60 * 1000;
  if (date.getTime() >= today) return 'today';
  if (date.getTime() >= startOfWeek) return 'week';
  return 'earlier';
};

export const RepositoryChatHistoryPanel: React.FC<RepositoryChatHistoryPanelProps> = ({
  sessions,
  activeSessionId,
  language,
  disabled = false,
  onSelect,
  onDelete,
}) => {
  const [query, setQuery] = useState('');
  const [pendingDeletion, setPendingDeletion] = useState<RepositoryChatSession | null>(null);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const groupedSessions = useMemo(() => {
    const groups: Record<HistoryGroup, RepositoryChatSession[]> = { today: [], week: [], earlier: [] };
    const normalizedQuery = query.trim().toLocaleLowerCase();
    sessions
      .filter((session) => !normalizedQuery || session.title.toLocaleLowerCase().includes(normalizedQuery))
      .forEach((session) => groups[groupFor(session.updatedAt)].push(session));
    return groups;
  }, [query, sessions]);

  const hasVisibleSessions = Object.values(groupedSessions).some((group) => group.length > 0);

  const groupLabels: Record<HistoryGroup, string> = {
    today: t('今天', 'Today'),
    week: t('最近 7 天', 'Last 7 days'),
    earlier: t('更早', 'Earlier'),
  };

  return (
    <section aria-label={t('当前仓库的历史会话', 'History for this repository')} className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 pl-8 text-xs"
          placeholder={t('搜索当前仓库的对话', 'Search this repository')}
          aria-label={t('搜索当前仓库的历史会话', 'Search repository chat history')}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!hasVisibleSessions ? (
          <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
            <History className="h-5 w-5" aria-hidden="true" />
            <p>{sessions.length === 0
              ? t('这个仓库还没有保存的对话。', 'There are no saved conversations for this repository yet.')
              : t('没有匹配的会话。', 'No matching conversations found.')}</p>
          </div>
        ) : (
          (Object.keys(groupedSessions) as HistoryGroup[]).map((group) => groupedSessions[group].length > 0 && (
            <div key={group} className="mb-4">
              <h3 className="mb-1 px-1 text-xs font-medium text-muted-foreground">{groupLabels[group]}</h3>
              <ul className="space-y-1">
                {groupedSessions[group].map((session) => (
                  <li key={session.id} className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant={session.id === activeSessionId ? 'secondary' : 'ghost'}
                      className="h-auto min-w-0 flex-1 justify-start px-2 py-2 text-left text-xs"
                      onClick={() => onSelect(session.id)}
                      disabled={disabled}
                      aria-current={session.id === activeSessionId ? 'true' : undefined}
                    >
                      <span className="truncate">{session.title}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setPendingDeletion(session)}
                      disabled={disabled}
                      aria-label={t(`删除会话：${session.title}`, `Delete conversation: ${session.title}`)}
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
      <AlertDialog open={Boolean(pendingDeletion)} onOpenChange={(open) => !open && setPendingDeletion(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('删除此会话？', 'Delete this conversation?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                '仅删除此设备/账户保存的对话与工具轨迹，不会影响 GitHub 仓库、Star、README 或既有向量索引。',
                'This only deletes the conversation and tool trace saved for this device/account. It does not affect the GitHub repository, stars, README, or existing vector index.',
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('取消', 'Cancel')}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingDeletion) onDelete(pendingDeletion.id);
                setPendingDeletion(null);
              }}
            >
              {t('删除会话', 'Delete conversation')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};
