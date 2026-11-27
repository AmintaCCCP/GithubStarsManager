



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
      className="app-list-row ui-card group cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="app-list-row-title truncate">{title}</h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-label-sm text-tertiary tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <User className="size-3.5 shrink-0" />
              {gist.owner?.login || t('gistCard.unknown')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-3.5 shrink-0" />
              {new Date(gist.updated_at).toLocaleDateString()}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <FileCode2 className="size-3.5 shrink-0" />
              {fileCount} {t('gistCard.files')}
            </span>
            {primaryLanguage && <span className="rounded-xs bg-fill-hover px-1.5 py-px text-caption font-medium text-secondary">{primaryLanguage}</span>}
            <span className="rounded-xs bg-fill-hover px-1.5 py-px text-caption text-tertiary">{gist.public ? t('gistCard.public') : t('gistCard.secret')}</span>
          </div>
        </div>

        <div className="app-row-actions flex shrink-0 items-center">
          <Button
            type="button"
            variant="ghost"
            onClick={handleAnalyze}
            disabled={isAnalyzing}
            className="app-row-action"
            title={t('gistCard.ai-analyze')}
          >
            {isAnalyzing ? <Loader2 className="size-3.5 animate-spin" /> : <Bot className="size-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={handleCopyLink}
            className="app-row-action"
            title={t('gistCard.copy-link')}
          >
            <Copy className="size-3.5" />
          </Button>
          <a
            href={gist.html_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="app-row-action"
            title={t('gistCard.open-link')}
          >
            <ExternalLink className="size-3.5" />
          </a>
          {gist.starred && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleUnstar}
              disabled={isMutating}
              className="app-row-action text-warning"
              title={t('gistCard.unstar')}
            >
              <StarOff className="size-3.5" />
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
                className="app-row-action"
                title={t('gistCard.edit')}
              >
                <Edit3 className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleDelete}
                disabled={isMutating}
                className="app-row-action text-destructive"
                title={t('gistCard.delete')}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="app-list-row-description mt-2.5 line-clamp-2">
        {gist.ai_summary || gist.description || fileNames || t('gistCard.no-description')}
      </p>

      {gist.analysis_failed && (
        <div className="mt-2.5 rounded-md bg-destructive-tint px-3 py-2 text-label-sm text-destructive">
          {gist.analysis_error || t('gistCard.ai-analysis-failed')}
        </div>
      )}
    </article>
  );
};
