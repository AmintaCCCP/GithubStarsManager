import React from 'react';
import { ArrowLeft, Download, ExternalLink, Maximize2, Minimize2, MoreHorizontal, PanelLeft, Plus, Settings2, Trash2 } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import type { Repository } from '../../../types';
import type { RepositoryChatSession } from '../../../types/repositoryChat';
import { Button } from '../../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';

export const ChatHeader: React.FC<{
  repository: Repository;
  session: RepositoryChatSession | null;
  fullscreen: boolean;
  historyOpen: boolean;
  onBack?: () => void;
  onNew: () => void;
  onToggleHistory: () => void;
  onToggleFullscreen: () => void;
  onOpenGithub: () => void;
  onExport: () => void;
  onSettings: () => void;
  onDelete: () => void;
}> = ({
  repository,
  session,
  fullscreen,
  historyOpen,
  onBack,
  onNew,
  onToggleHistory,
  onToggleFullscreen,
  onOpenGithub,
  onExport,
  onSettings,
  onDelete,
}) => {
  const t = useT('chat');
  return (
    <header className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border/70">
      {onBack ? (
        <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onBack} aria-label={t('repositoryChatSheet.back-to-history')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleHistory} aria-label={t('repositoryChatSheet.history')} aria-pressed={historyOpen}>
        <PanelLeft className="h-4 w-4" aria-hidden="true" />
      </Button>
      <img src={repository.owner.avatar_url} alt="" className="ml-0.5 h-6 w-6 rounded-md border border-border" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{repository.full_name}</h2>
      </div>
      {session?.sourceRefSha ? (
        <a
          href={`${repository.html_url}/tree/${session.sourceRefSha}`}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground sm:inline-flex"
          title={t('repositoryChatSheet.commit-snapshot-help')}
        >
          @{session.sourceRefSha.slice(0, 7)}
        </a>
      ) : null}
      <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2" onClick={onNew}>
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="hidden sm:inline">{t('repositoryChatSheet.new-chat')}</span>
      </Button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleFullscreen} aria-label={fullscreen ? t('repositoryChatSheet.exit-fullscreen') : t('repositoryChatSheet.fullscreen')}>
        {fullscreen ? <Minimize2 className="h-4 w-4" aria-hidden="true" /> : <Maximize2 className="h-4 w-4" aria-hidden="true" />}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={t('repositoryChatSheet.more-actions')}>
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onOpenGithub}>
            <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('repositoryChatSheet.open-on-github')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport} disabled={!session}>
            <Download className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('repositoryChatSheet.export-markdown')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSettings}>
            <Settings2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('repositoryChatSheet.chat-settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onSelect={onDelete} disabled={!session}>
            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
            {t('repositoryChatSheet.delete-conversation')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
};
