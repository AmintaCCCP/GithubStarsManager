import { Component, lazy, Suspense, useState, type ErrorInfo, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useBatchStarImport } from '../features/repositories/hooks/useBatchStarImport';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { Textarea } from './ui/textarea';
import { Modal } from './Modal';
import { logger } from '../services/logger';
import { useBatchStarHistory } from '../features/repositories/hooks/useBatchStarHistory';
import type { Repository } from '../types';

const LazyReadmeModal = lazy(() => import('./ReadmeModal').then(module => ({ default: module.ReadmeModal })));
type ReadmeRepository = Pick<Repository, 'full_name' | 'html_url' | 'owner' | 'default_branch'>;

class ReadmeLoadBoundary extends Component<{ title: string; closeLabel: string; errorMessage: string; onClose: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logger.errorFromError('ui.batchStar', 'Failed to load README preview', error, { componentStack: errorInfo.componentStack });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Modal isOpen onClose={this.props.onClose} title={this.props.title}>
        <p role="alert">{this.props.errorMessage}</p>
        <Button variant="outline" className="mt-4" onClick={this.props.onClose}>{this.props.closeLabel}</Button>
      </Modal>
    );
  }
}

interface BatchStarImportDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Dialog for starring repositories parsed from pasted text: previews their
 * details, lets the user adjust the selection and optionally translate the
 * descriptions into the interface language, then stars the selected ones
 * with per-repository results.
 */
export function BatchStarImportDialog({ isOpen, onClose }: BatchStarImportDialogProps) {
  const t = useT('repositories');
  const [text, setText] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [editingText, setEditingText] = useState<string>();
  const [readmeRepository, setReadmeRepository] = useState<ReadmeRepository | null>(null);
  const { history, historyError, record, edit } = useBatchStarHistory();
  const {
    rows, duplicateCount, inputError, isResolving, isStarring, syncError,
    translations, isTranslating, translationError, translationsVisible,
    preview, toggleRow, selectAll, invertSelection, clearPreview, starSelected, toggleTranslations,
  } = useBatchStarImport();
  const selectedCount = rows.filter(row => row.status === 'ready' && row.selected).length;
  const starredCount = rows.filter(row => row.status === 'starred').length;
  // locked 在解析与 Star 批处理期间同时禁用关闭，避免中途打断半完成的批次；
  // 翻译只读不改选区，允许随时关闭弹窗。
  const locked = isResolving || isStarring;
  const busy = locked || isTranslating;
  const hasSelectable = rows.some(row => row.status === 'ready');
  const hasDescription = rows.some(row => Boolean(row.detail?.description));

  const errorLabels: Record<string, string> = {
    'sign-in': t('batchStar.sign-in'),
    'no-repositories': t('batchStar.no-repositories'),
    'too-many-repositories': t('batchStar.too-many-repositories'),
    'input-too-large': t('batchStar.input-too-large'),
  };

  return (
    <>
    <Modal
      isOpen={isOpen && !readmeRepository}
      onClose={() => { if (!locked) onClose(); }}
      title={t('batchStar.title')}
      maxWidth="max-w-3xl"
      scrollable
      footer={(
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground">
            {starredCount > 0 ? t('batchStar.completed', { count: starredCount }) : t('batchStar.selected', { count: selectedCount })}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" disabled={locked} onClick={onClose}>{t('batchStar.close')}</Button>
            <Button disabled={busy || selectedCount === 0} onClick={() => void starSelected()}>
              {isStarring ? t('batchStar.starring') : t('batchStar.star-selected', { count: selectedCount })}
            </Button>
          </div>
        </div>
      )}
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('batchStar.hint')}</p>
      <Textarea
        aria-label={t('batchStar.input-label')}
        value={text}
        onChange={event => { setText(event.target.value); clearPreview(); }}
        disabled={busy}
        placeholder={t('batchStar.placeholder')}
        className="min-h-32 resize-y"
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy || !text.trim()} onClick={() => { if (record(text, editingText)) setEditingText(text); void preview(text); }}>
          {isResolving ? t('batchStar.checking') : t('batchStar.preview')}
        </Button>
        <Button variant="outline" disabled={busy} aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>
          {t('batchStar.history')}
        </Button>
        {editingText !== undefined && <Button variant="outline" disabled={busy || !text.trim()} onClick={() => { if (edit(editingText, text)) setEditingText(text); }}>
          {t('batchStar.save-history')}
        </Button>}
        {duplicateCount > 0 && <span className="text-sm text-muted-foreground">{t('batchStar.duplicates', { count: duplicateCount })}</span>}
      </div>
      {historyError && <p role="alert" className="mt-3 text-sm text-destructive">{t('batchStar.history-error')}</p>}
      {historyOpen && <section className="mt-3 space-y-2" aria-label={t('batchStar.history')}>
        <p className="text-sm text-muted-foreground">{t('batchStar.history-hint')}</p>
        {history.length === 0 && <p className="text-sm text-muted-foreground">{t('batchStar.history-empty')}</p>}
        {history.map(entry => <button key={entry.text} type="button" disabled={busy}
          className="block w-full rounded-lg border border-border p-3 text-left hover:bg-muted"
          onClick={() => { setText(entry.text); setEditingText(entry.text); clearPreview(); }}>
          <time dateTime={new Date(entry.generatedAt).toISOString()} className="text-xs text-muted-foreground">{new Date(entry.generatedAt).toLocaleString()}</time>
          <span className="mt-1 block whitespace-pre-wrap break-all line-clamp-2">{entry.text}</span>
        </button>)}
      </section>}
      {inputError && <p role="alert" className="mt-3 text-sm text-destructive">{errorLabels[inputError] ?? inputError}</p>}
      {syncError && <p role="alert" className="mt-3 text-sm text-destructive">{t('batchStar.sync-failed')}: {syncError}</p>}
      {translationError && <p role="alert" className="mt-3 text-sm text-destructive">{t('batchStar.translation-failed')}: {translationError}</p>}
      {rows.length > 0 && (
        <div className="mt-5 space-y-2" aria-label={t('batchStar.results')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={busy || !hasSelectable} onClick={selectAll}>
                {t('batchStar.select-all')}
              </Button>
              <Button variant="outline" size="sm" disabled={busy || !hasSelectable} onClick={invertSelection}>
                {t('batchStar.invert-selection')}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !hasDescription}
              onClick={() => void toggleTranslations()}
            >
              {isTranslating ? t('batchStar.translating') : translationsVisible ? t('batchStar.show-original') : t('batchStar.translate-descriptions')}
            </Button>
          </div>
          {rows.map((row, index) => {
            const renamed = row.detail && row.detail.full_name.toLowerCase() !== row.candidate.repositoryFullName.toLowerCase();
            const label = row.detail?.full_name ?? (row.candidate.repositoryFullName || row.candidate.originalValue);
            const statusKey = row.status === 'ready' && row.candidate.confidence === 'low'
              ? 'check-name'
              : row.status;
            // 已 Star（含本次批处理刚 Star 成功）的仓库固定为选中禁用态，
            // 与"无法再次 Star"的业务状态保持一致。
            const rowStarred = row.status === 'already-starred' || row.status === 'starred';
            const originalDescription = row.detail?.description || t('batchStar.no-description');
            const translatedDescription = row.detail ? translations[row.detail.full_name] : undefined;
            const description = translationsVisible && translatedDescription
              ? translatedDescription
              : originalDescription;
            return (
              <div key={`${row.candidate.originalValue}-${index}`} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={rowStarred ? true : row.selected}
                    disabled={busy || row.status !== 'ready'}
                    onCheckedChange={() => toggleRow(index)}
                    aria-label={t('batchStar.select-repository', { name: label })}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <button type="button" className="block w-full text-left hover:bg-muted rounded-md"
                      aria-label={t('batchStar.view-readme', { name: label })}
                      disabled={locked || !row.candidate.repositoryFullName || row.candidate.status === 'invalid'}
                      onClick={() => {
                        const fullName = row.detail?.full_name ?? row.candidate.repositoryFullName;
                        setReadmeRepository(row.detail ?? {
                          full_name: fullName, html_url: `https://github.com/${fullName}`,
                          owner: { login: fullName.split('/')[0], avatar_url: '' },
                        });
                      }}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {row.detail ? (
                        <span className="break-all font-medium hover:underline">
                          {renamed ? `${row.candidate.repositoryFullName} → ${label}` : label}
                        </span>
                      ) : <span className="break-all font-medium">{label}</span>}
                      <span className="text-xs text-muted-foreground">{t(`batchStar.${statusKey}`)}</span>
                    </div>
                    {row.detail && (
                      <>
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{row.detail.language || '—'} · ★ {row.detail.stargazers_count.toLocaleString()}</p>
                      </>
                    )}
                    {row.error && <p className="mt-1 break-all text-xs text-destructive">{row.error}</p>}
                    </button>
                    {row.detail && <a href={row.detail.html_url} target="_blank" rel="noopener noreferrer"
                      aria-label={t('batchStar.open-github', { name: label })} className="mt-2 inline-flex text-muted-foreground hover:text-foreground">
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    </a>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
    {readmeRepository && <ReadmeLoadBoundary
      title={t('batchStar.view-readme', { name: readmeRepository.full_name })}
      closeLabel={t('batchStar.close')}
      errorMessage={t('batchStar.readme-load-error')}
      onClose={() => setReadmeRepository(null)}
    ><Suspense fallback={
      <Modal isOpen onClose={() => setReadmeRepository(null)} title={t('batchStar.view-readme', { name: readmeRepository.full_name })}>
        <p role="status">{t('batchStar.loading-readme')}</p>
      </Modal>
    }><LazyReadmeModal isOpen repository={readmeRepository} onClose={() => setReadmeRepository(null)} /></Suspense></ReadmeLoadBoundary>}
    </>
  );
}
