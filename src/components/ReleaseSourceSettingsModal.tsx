



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
        variant="ghost"
        onClick={() => setIsExpanded(prev => !prev)}
        aria-expanded={isExpanded}
        aria-controls={repositoryListId}
        className="flex h-control w-full items-center justify-between rounded-md bg-sunken px-2.5 text-left text-label-sm font-medium text-secondary hover:bg-fill-hover hover:text-foreground"
      >
        <span className="tabular-nums">{t('releaseSourceSettingsModal.repositories-v1', { v1: repos.length })}</span>
        <ChevronDown className={`size-4 text-tertiary transition-transform duration-fast ${isExpanded ? 'rotate-180' : ''}`} />
      </Button>

      {isExpanded && (
        <div id={repositoryListId} className="mt-2 space-y-2">
          {repos.length === 0 ? (
            <p className="rounded-md border border-subtle bg-sunken px-3 py-2.5 text-label-sm text-tertiary">
              {emptyText}
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-subtle bg-sunken divide-y divide-subtle">
              {visibleRepos.map(repo => (
                <div
                  key={normalizeRepoKey(repo.full_name)}
                  className={`flex min-h-[52px] items-center justify-between gap-3 px-3 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant ${repo.release_hidden ? 'opacity-60' : ''}`}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="truncate text-label font-medium text-foreground">{repo.full_name}</div>
                    <div className="truncate text-label-sm text-tertiary font-mono">{repo.html_url}</div>
                  </div>
                  {renderActions && <div className="flex shrink-0 items-center gap-1">{renderActions(repo)}</div>}
                </div>
              ))}
            </div>
          )}

          {repos.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1 text-label-sm text-tertiary tabular-nums">
              <span>{t('releaseSourceSettingsModal.page-currentpage-totalpages', { currentPage: currentPage, totalPages: totalPages })}</span>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  aria-label={t('releaseSourceSettingsModal.previous-page')}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  aria-label={t('releaseSourceSettingsModal.next-page')}
                >
                  <ChevronRight className="size-4" />
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
    <div className="rounded-lg bg-raised p-4 shadow-elev-1">
      <div className="mb-3">
        <h4 className="text-label font-semibold text-foreground">{title}</h4>
        <p className="mt-0.5 text-label-sm text-secondary">{description}</p>
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="text"
          aria-label={t('releaseSourceSettingsModal.repository-name')}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1"
        />
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={handleAdd}
        >
          <Plus className="size-4" />
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
            size="icon-sm"
            onClick={() => removeReleaseSourceRepository(sourceId, repo.full_name)}
            className="text-tertiary hover:bg-destructive-tint hover:text-destructive"
            title={t('releaseSourceSettingsModal.remove-repository')}
            aria-label={t('releaseSourceSettingsModal.remove-repository')}
          >
            <Trash2 className="size-4" />
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
    <div className="rounded-lg bg-raised p-4 shadow-elev-1">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-label font-semibold text-foreground">{t('releaseSourceSettingsModal.watch-repository-sync')}</h4>
          <p className="mt-0.5 text-label-sm text-secondary">
            {t('releaseSourceSettingsModal.sync-pulls-repositories-watched-by-the-current-g')}
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          onClick={handleSync}
          disabled={isSyncing || !githubToken}
          className="shrink-0 whitespace-nowrap"
        >
          <RefreshCw className={`size-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
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
              size="icon-sm"
              onClick={() => updateReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, repo.full_name, { release_hidden: !hidden })}
              aria-pressed={hidden}
              className="text-tertiary hover:text-foreground"
              title={hidden ? t('releaseSourceSettingsModal.show-and-check-releases') : t('releaseSourceSettingsModal.hide-and-skip-release-checks')}
              aria-label={hidden ? t('releaseSourceSettingsModal.show-and-check-releases') : t('releaseSourceSettingsModal.hide-and-skip-release-checks')}
            >
              {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
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
      <div className="space-y-4">
        <div className="rounded-md border border-subtle bg-sunken px-3.5 py-2.5 text-label text-secondary">
          {t('releaseSourceSettingsModal.choose-the-sources-checked-when-refreshing-relea')}
        </div>

        <div className="overflow-hidden rounded-lg border border-subtle bg-raised shadow-elev-1 divide-y divide-subtle">
          {sourceRows.map(source => {
            const checked = enabledSources.has(source.id);
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => handleToggle(source.id)}
                aria-pressed={checked}
                className={`app-release-source-row motion-press flex h-auto min-h-[60px] w-full !items-center justify-between gap-3 rounded-none px-3.5 py-3 text-left font-normal transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-inset ${
                  checked
                    ? 'bg-fill-selected hover:bg-fill-selected'
                    : 'bg-transparent hover:bg-fill-hover'
                }`}
              >
                <span className="app-release-source-main flex min-w-0 flex-1 items-start gap-3">
                  <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-md ${checked ? 'bg-accent-solid text-on-accent' : 'bg-fill-hover text-tertiary'}`}>
                    <Bell className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 space-y-0.5 whitespace-normal">
                    <span className="block text-label font-medium text-foreground">{source.title}</span>
                    <span className="block text-label-sm leading-snug text-secondary">{source.description}</span>
                  </span>
                </span>
                <span className="app-release-source-control flex shrink-0 items-center gap-3">
                  <span className="rounded-xs bg-fill-hover px-1.5 py-0.5 text-label-sm text-secondary tabular-nums">
                    {source.count}
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-fast ${
                      checked ? 'bg-accent-solid' : 'border border-control bg-transparent'
                    }`}
                  >
                    <span
                      className={`inline-block size-3.5 transform rounded-full transition-transform duration-fast ${
                        checked ? 'translate-x-[18px] bg-on-accent' : 'translate-x-[2px] bg-[var(--border-control)]'
                      }`}
                    />
                  </span>
                </span>
              </button>
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

        <div className="flex justify-end border-t border-subtle pt-3">
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
          >
            {t('releaseSourceSettingsModal.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
