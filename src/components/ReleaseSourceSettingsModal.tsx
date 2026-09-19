



import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useId, useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CustomReleaseRepository, ReleaseSourceId } from '../types';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { useDialog } from '../hooks/useDialog';
import { useWatchedSourcesSync } from '../features/releases/hooks/useWatchedSourcesSync';
import {
  CUSTOM_RELEASE_SOURCE_ID,
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
  createCustomReleaseRepository,
  getReleaseSourceLabel,
  normalizeRepoKey,
} from '../utils/releaseSources';

interface ReleaseSourceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface RepoListEditorProps {
  sourceId: ReleaseSourceId;
  repos: CustomReleaseRepository[];
  title: string;
  description: string;
  placeholder: string;
  language: AppLanguage;
}

interface PaginatedRepoListProps {
  repos: CustomReleaseRepository[];
  language: AppLanguage;
  emptyText: string;
  renderActions?: (repo: CustomReleaseRepository) => React.ReactNode;
}

const PAGE_SIZE = 8;

const PaginatedRepoList: React.FC<PaginatedRepoListProps> = ({ repos, emptyText, renderActions }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [page, setPage] = useState(1);
  const repositoryListId = useId();
  const t = useT('releases');
  const totalPages = Math.max(1, Math.ceil(repos.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRepos = repos.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  };

  return (
    <div className="mt-3">
      <Button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        aria-expanded={isExpanded}
        aria-controls={repositoryListId}
        className="flex w-full items-center justify-between rounded-lg bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-card dark:bg-card/[0.03] dark:text-muted-foreground dark:hover:bg-accent"
      >
        <span>{t('releaseSourceSettingsModal.repositories-v1', { v1: repos.length })}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </Button>

      {isExpanded && (
        <div id={repositoryListId} className="mt-2 space-y-2">
          {repos.length === 0 ? (
            <p className="rounded-lg bg-card dark:bg-card/[0.03] px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
              {emptyText}
            </p>
          ) : visibleRepos.map(repo => (
            <div
              key={normalizeRepoKey(repo.full_name)}
              className={`flex items-center justify-between gap-3 rounded-lg bg-card dark:bg-muted/40 px-3 py-2 ${repo.release_hidden ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-foreground dark:text-foreground">{repo.full_name}</div>
                <div className="truncate text-xs text-muted-foreground dark:text-muted-foreground">{repo.html_url}</div>
              </div>
              {renderActions && <div className="flex flex-shrink-0 items-center gap-1">{renderActions(repo)}</div>}
            </div>
          ))}

          {repos.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1 text-xs text-muted-foreground dark:text-muted-foreground">
              <span>{t('releaseSourceSettingsModal.page-currentpage-totalpages', { currentPage: currentPage, totalPages: totalPages })}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="h-8 w-8 rounded-md p-0 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-accent"
                  aria-label={t('releaseSourceSettingsModal.previous-page')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="h-8 w-8 rounded-md p-0 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-accent"
                  aria-label={t('releaseSourceSettingsModal.next-page')}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const RepoListEditor: React.FC<RepoListEditorProps> = ({
  sourceId,
  repos,
  title,
  description,
  placeholder,
  language,
}) => {
  const addReleaseSourceRepository = useAppStore(state => state.addReleaseSourceRepository);
  const removeReleaseSourceRepository = useAppStore(state => state.removeReleaseSourceRepository);
  const { toast } = useDialog();
  const [input, setInput] = useState('');

  const t = useT('releases');

  const repoKeys = useMemo(() => new Set(repos.map(repo => normalizeRepoKey(repo.full_name))), [repos]);

  const handleAdd = () => {
    const repo = createCustomReleaseRepository(input, sourceId);
    if (!repo) {
      toast(t('releaseSourceSettingsModal.enter-a-valid-github-repository-for-example-owne'), 'error');
      return;
    }

    if (repoKeys.has(normalizeRepoKey(repo.full_name))) {
      toast(t('releaseSourceSettingsModal.this-repository-is-already-in-the-list'), 'info');
      return;
    }

    addReleaseSourceRepository(sourceId, repo);
    setInput('');
    toast(t('releaseSourceSettingsModal.release-source-repository-added'), 'success');
  };

  return (
    <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{title}</h4>
        <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">{description}</p>
      </div>

      <div className="flex gap-2">
        <Input
          type="text"
          aria-label={t('releaseSourceSettingsModal.repository-name')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 px-3 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
        />
        <Button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('releaseSourceSettingsModal.add')}
        </Button>
      </div>

      <PaginatedRepoList
        repos={repos}
        language={language}
        emptyText={t('releaseSourceSettingsModal.no-repositories-yet')}
        renderActions={(repo) => (
          <Button
            type="button"
            variant="ghost"
            onClick={() => removeReleaseSourceRepository(sourceId, repo.full_name)}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
            title={t('releaseSourceSettingsModal.remove-repository')}
            aria-label={t('releaseSourceSettingsModal.remove-repository')}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      />
    </div>
  );
};

interface WatchCustomReleaseSyncPanelProps {
  repos: CustomReleaseRepository[];
  language: AppLanguage;
}

const WatchCustomReleaseSyncPanel: React.FC<WatchCustomReleaseSyncPanelProps> = ({ repos, language }) => {
  const githubToken = useAppStore(state => state.githubToken);
  const updateReleaseSourceRepository = useAppStore(state => state.updateReleaseSourceRepository);
  const { syncWatchedSources, isSyncingWatchedSources } = useWatchedSourcesSync();
  const isSyncing = isSyncingWatchedSources;

  const t = useT('releases');

  const handleSync = () => {
    void syncWatchedSources();
  };

  return (
    <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{t('releaseSourceSettingsModal.watch-repository-sync')}</h4>
          <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
            {t('releaseSourceSettingsModal.sync-pulls-repositories-watched-by-the-current-g')}
          </p>
        </div>
        <Button
          type="button"
          onClick={handleSync}
          disabled={isSyncing || !githubToken}
          className="inline-flex min-h-10 min-w-24 flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? t('releaseSourceSettingsModal.syncing') : t('releaseSourceSettingsModal.sync')}
        </Button>
      </div>

      <PaginatedRepoList
        repos={repos}
        language={language}
        emptyText={t('releaseSourceSettingsModal.no-synced-repositories-yet')}
        renderActions={(repo) => {
          const hidden = !!repo.release_hidden;
          return (
            <Button
              type="button"
              variant="ghost"
              onClick={() => updateReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, repo.full_name, { release_hidden: !hidden })}
              aria-pressed={hidden}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
              title={hidden ? t('releaseSourceSettingsModal.show-and-check-releases') : t('releaseSourceSettingsModal.hide-and-skip-release-checks')}
              aria-label={hidden ? t('releaseSourceSettingsModal.show-and-check-releases') : t('releaseSourceSettingsModal.hide-and-skip-release-checks')}
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          );
        }}
      />
    </div>
  );
};

export const ReleaseSourceSettingsModal: React.FC<ReleaseSourceSettingsModalProps> = ({ isOpen, onClose }) => {
  const language = useAppStore(state => state.language);
  const releaseSourceSettings = useAppStore(state => state.releaseSourceSettings);
  const releaseSubscriptions = useAppStore(state => state.releaseSubscriptions);
  const toggleReleaseSource = useAppStore(state => state.toggleReleaseSource);
  const { toast } = useDialog();

  const t = useT('releases');
  const enabledSources = new Set(releaseSourceSettings.enabledSourceIds);

  const sourceRows: Array<{ id: ReleaseSourceId; title: string; description: string; count: number }> = [
    {
      id: STARRED_RELEASE_SOURCE_ID,
      title: t('releaseSourceSettingsModal.starred-bell-subscriptions'),
      description: t('releaseSourceSettingsModal.existing-release-source-from-repository-cards-wh'),
      count: releaseSubscriptions.size,
    },
    {
      id: WATCH_CUSTOM_RELEASE_SOURCE_ID,
      title: getReleaseSourceLabel(WATCH_CUSTOM_RELEASE_SOURCE_ID, language),
      description: t('releaseSourceSettingsModal.release-source-synced-from-watch-repositories'),
      count: releaseSourceSettings.watchCustomReleaseRepos.length,
    },
    {
      id: CUSTOM_RELEASE_SOURCE_ID,
      title: t('releaseSourceSettingsModal.custom-release-source'),
      description: t('releaseSourceSettingsModal.manually-enter-github-repositories-to-check-duri'),
      count: releaseSourceSettings.customReleaseRepos.length,
    },
  ];

  const handleToggle = (sourceId: ReleaseSourceId) => {
    if (enabledSources.has(sourceId) && enabledSources.size === 1) {
      toast(t('releaseSourceSettingsModal.keep-at-least-one-release-source-enabled'), 'error');
      return;
    }
    toggleReleaseSource(sourceId);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('releaseSourceSettingsModal.release-source-settings')} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground dark:text-muted-foreground">
          {t('releaseSourceSettingsModal.choose-the-sources-checked-when-refreshing-relea')}
        </div>

        <div className="space-y-2">
          {sourceRows.map(source => {
            const checked = enabledSources.has(source.id);
            return (
              <Button
                key={source.id}
                type="button"
                onClick={() => handleToggle(source.id)}
                aria-pressed={checked}
                className={`h-auto flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition-colors ${
                  checked
                    // hover 必须显式声明：默认 variant 自带 hover:bg-primary/90，
                    // 深色实心底会压过内部 text-foreground 造成 WCAG 对比度不达标
                    ? 'border-primary/30 bg-primary/10 hover:bg-primary/15 dark:hover:bg-primary/20'
                    : 'border-border bg-card hover:bg-muted dark:border-border dark:bg-muted/20 dark:hover:bg-card/[0.05]'
                }`}
              >
                <span className="flex items-start gap-3">
                  <span className={`mt-0.5 rounded-lg p-2 ${checked ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                    <Bell className="h-4 w-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground dark:text-foreground">{source.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground dark:text-muted-foreground">{source.description}</span>
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-3">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {source.count}
                  </span>
                  <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-primary' : 'bg-muted dark:bg-accent'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </span>
                </span>
              </Button>
            );
          })}
        </div>

        {enabledSources.has(WATCH_CUSTOM_RELEASE_SOURCE_ID) && (
          <WatchCustomReleaseSyncPanel
            repos={releaseSourceSettings.watchCustomReleaseRepos}
            language={language}
          />
        )}

        {enabledSources.has(CUSTOM_RELEASE_SOURCE_ID) && (
          <RepoListEditor
            sourceId={CUSTOM_RELEASE_SOURCE_ID}
            repos={releaseSourceSettings.customReleaseRepos}
            title={t('releaseSourceSettingsModal.custom-repositories')}
            description={t('releaseSourceSettingsModal.when-custom-source-is-enabled-refresh-checks-rep')}
            placeholder="owner/repo or https://github.com/owner/repo"
            language={language}
          />
        )}

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('releaseSourceSettingsModal.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
