



import { useT } from '../i18n/useT';
import React, { useMemo } from 'react';
import { Bot, Clock, Copy, Edit3, ExternalLink, FileCode2, Loader2, StarOff, Trash2, User } from 'lucide-react';
import type { Gist } from '../types';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import { useDialog } from '../hooks/useDialog';
import { safeWriteText } from '../utils/clipboardUtils';
import { getGistFileCount, getGistPrimaryLanguage, getGistTitle } from '../utils/gistUtils';
import { Button } from './ui/button';

interface GistCardProps {
  gist: Gist;
  isMine: boolean;
  onOpen: (gist: Gist) => void;
  onEdit: (gist: Gist) => void;
  onDeleted?: (gistId: string) => void;
  onUnstarred: (gistId: string) => void;
}

export const GistCard: React.FC<GistCardProps> = ({
  gist,
  isMine,
  onOpen,
  onEdit,
  onDeleted,
  onUnstarred,
}) => {
  const { analyzeOne, unstarGist, deleteGist, isAnalyzingGist, isMutating } = useGistActions();
  const { toast } = useDialog();
  const t = useT('gists');
  const title = getGistTitle(gist);
  const primaryLanguage = getGistPrimaryLanguage(gist);
  const fileCount = getGistFileCount(gist);
  const isAnalyzing = isAnalyzingGist(gist.id);

  const fileNames = useMemo(() =>
    Object.values(gist.files || {}).slice(0, 3).map(file => file.filename).join(', '),
    [gist.files]
  );

  const handleCopyLink = async (event: React.MouseEvent) => {
    event.stopPropagation();
    const result = await safeWriteText(gist.html_url);
    toast(result.success ? t('gistCard.link-copied') : (result.error || t('gistCard.copy-failed')), result.success ? 'success' : 'error');
  };

  const handleAnalyze = (event: React.MouseEvent) => {
    event.stopPropagation();
    void analyzeOne(gist);
  };

  const handleUnstar = (event: React.MouseEvent) => {
    event.stopPropagation();
    void unstarGist(gist, onUnstarred);
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    void deleteGist(gist, onDeleted);
  };

  return (
    <article
      onClick={() => onOpen(gist)}
      className="ui-card group cursor-pointer p-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-foreground dark:text-foreground">{title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground dark:text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <User className="h-4 w-4" />
              {gist.owner?.login || t('gistCard.unknown')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-4 w-4" />
              {new Date(gist.updated_at).toLocaleDateString()}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileCode2 className="h-4 w-4" />
              {fileCount} {t('gistCard.files')}
            </span>
            {primaryLanguage && <span>{primaryLanguage}</span>}
            <span>{gist.public ? t('gistCard.public') : t('gistCard.secret')}</span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50 dark:text-muted-foreground dark:hover:bg-primary/15 dark:hover:text-primary"
            title={t('gistCard.ai-analyze')}
          >
            {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCopyLink}
            className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t('gistCard.copy-link')}
          >
            <Copy className="h-4 w-4" />
          </Button>
          <a
            href={gist.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={t('gistCard.open-link')}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          {gist.starred && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleUnstar}
              disabled={isMutating}
              className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-warning/10 hover:text-warning disabled:opacity-50 dark:text-muted-foreground"
              title={t('gistCard.unstar')}
            >
              <StarOff className="h-4 w-4" />
            </Button>
          )}
          {isMine && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={(event) => {
                  event.stopPropagation();
                  onEdit(gist);
                }}
                className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={t('gistCard.edit')}
              >
                <Edit3 className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isMutating}
                className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50 dark:text-muted-foreground"
                title={t('gistCard.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-6 text-muted-foreground dark:text-muted-foreground">
        {gist.ai_summary || gist.description || fileNames || t('gistCard.no-description')}
      </p>

      {gist.analysis_failed && (
        <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {gist.analysis_error || t('gistCard.ai-analysis-failed')}
        </div>
      )}
    </article>
  );
};
