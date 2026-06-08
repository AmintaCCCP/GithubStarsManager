import React, { useMemo, useState } from 'react';
import { Bell, ChevronDown, ChevronLeft, ChevronRight, Eye, EyeOff, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { CustomReleaseRepository, ReleaseSourceId } from '../types';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { useDialog } from '../hooks/useDialog';
import { GitHubApiService } from '../services/githubApi';
import {
  CUSTOM_RELEASE_SOURCE_ID,
  RELEASE_SOURCE_LABELS,
  STARRED_RELEASE_SOURCE_ID,
  WATCH_CUSTOM_RELEASE_SOURCE_ID,
  createCustomReleaseRepository,
  normalizeRepoKey,
  repositoryToCustomReleaseRepository,
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
  language: 'zh' | 'en';
}

interface PaginatedRepoListProps {
  repos: CustomReleaseRepository[];
  language: 'zh' | 'en';
  emptyText: string;
  renderActions?: (repo: CustomReleaseRepository) => React.ReactNode;
}

const PAGE_SIZE = 8;

const PaginatedRepoList: React.FC<PaginatedRepoListProps> = ({ repos, language, emptyText, renderActions }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const [page, setPage] = useState(1);
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const totalPages = Math.max(1, Math.ceil(repos.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleRepos = repos.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const goToPage = (nextPage: number) => {
    setPage(Math.max(1, Math.min(nextPage, totalPages)));
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className="flex w-full items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-left text-xs font-medium text-gray-600 transition-colors hover:bg-white dark:bg-white/[0.03] dark:text-text-tertiary dark:hover:bg-white/[0.06]"
      >
        <span>{t(`仓库列表（${repos.length}）`, `Repositories (${repos.length})`)}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-2">
          {repos.length === 0 ? (
            <p className="rounded-lg bg-white/60 dark:bg-white/[0.03] px-3 py-2 text-xs text-gray-500 dark:text-text-tertiary">
              {emptyText}
            </p>
          ) : visibleRepos.map(repo => (
            <div
              key={normalizeRepoKey(repo.full_name)}
              className={`flex items-center justify-between gap-3 rounded-lg bg-white dark:bg-white/[0.04] px-3 py-2 ${repo.release_hidden ? 'opacity-60' : ''}`}
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-gray-900 dark:text-text-primary">{repo.full_name}</div>
                <div className="truncate text-xs text-gray-500 dark:text-text-tertiary">{repo.html_url}</div>
              </div>
              {renderActions && <div className="flex flex-shrink-0 items-center gap-1">{renderActions(repo)}</div>}
            </div>
          ))}

          {repos.length > PAGE_SIZE && (
            <div className="flex items-center justify-between pt-1 text-xs text-gray-500 dark:text-text-tertiary">
              <span>{t(`第 ${currentPage}/${totalPages} 页`, `Page ${currentPage}/${totalPages}`)}</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  className="rounded-md p-1.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]"
                  aria-label={t('上一页', 'Previous page')}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  className="rounded-md p-1.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/[0.08]"
                  aria-label={t('下一页', 'Next page')}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
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

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const repoKeys = useMemo(() => new Set(repos.map(repo => normalizeRepoKey(repo.full_name))), [repos]);

  const handleAdd = () => {
    const repo = createCustomReleaseRepository(input, sourceId);
    if (!repo) {
      toast(t('请输入有效的 GitHub 仓库地址，例如 owner/repo。', 'Enter a valid GitHub repository, for example owner/repo.'), 'error');
      return;
    }

    if (repoKeys.has(normalizeRepoKey(repo.full_name))) {
      toast(t('该仓库已在列表中。', 'This repository is already in the list.'), 'info');
      return;
    }

    addReleaseSourceRepository(sourceId, repo);
    setInput('');
    toast(t('已添加 Release 来源仓库。', 'Release source repository added.'), 'success');
  };

  return (
    <div className="rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-light-surface/50 dark:bg-white/[0.02] p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-text-primary">{title}</h4>
        <p className="mt-1 text-xs text-gray-500 dark:text-text-tertiary">{description}</p>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') handleAdd();
          }}
          placeholder={placeholder}
          className="min-w-0 flex-1 rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] px-3 py-2 text-sm text-gray-900 dark:text-text-primary focus:border-transparent focus:ring-2 focus:ring-brand-violet"
        />
        <button
          type="button"
          onClick={handleAdd}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
        >
          <Plus className="h-4 w-4" />
          {t('添加', 'Add')}
        </button>
      </div>

      <PaginatedRepoList
        repos={repos}
        language={language}
        emptyText={t('暂无仓库。', 'No repositories yet.')}
        renderActions={(repo) => (
          <button
            type="button"
            onClick={() => removeReleaseSourceRepository(sourceId, repo.full_name)}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-status-red dark:text-text-tertiary dark:hover:bg-white/[0.08] dark:hover:text-status-red"
            title={t('移除仓库', 'Remove repository')}
            aria-label={t('移除仓库', 'Remove repository')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      />
    </div>
  );
};

interface WatchCustomReleaseSyncPanelProps {
  repos: CustomReleaseRepository[];
  language: 'zh' | 'en';
}

const WatchCustomReleaseSyncPanel: React.FC<WatchCustomReleaseSyncPanelProps> = ({ repos, language }) => {
  const githubToken = useAppStore(state => state.githubToken);
  const setReleaseSourceRepositories = useAppStore(state => state.setReleaseSourceRepositories);
  const updateReleaseSourceRepository = useAppStore(state => state.updateReleaseSourceRepository);
  const { toast } = useDialog();
  const [isSyncing, setIsSyncing] = useState(false);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleSync = async () => {
    if (!githubToken || isSyncing) return;

    setIsSyncing(true);
    try {
      const githubApi = new GitHubApiService(githubToken);
      const watchedRepos = await githubApi.getAllWatchedRepositoriesForCurrentUser();
      const hiddenByRepo = new Map(repos.map(repo => [normalizeRepoKey(repo.full_name), repo.release_hidden]));
      const sourceRepos = watchedRepos.map(repo => ({
        ...repositoryToCustomReleaseRepository(repo, WATCH_CUSTOM_RELEASE_SOURCE_ID),
        release_hidden: hiddenByRepo.get(normalizeRepoKey(repo.full_name)) || undefined,
      }));
      setReleaseSourceRepositories(WATCH_CUSTOM_RELEASE_SOURCE_ID, sourceRepos);
      toast(
        t(
          `已同步 ${sourceRepos.length} 个 Watch 仓库。`,
          `Synced ${sourceRepos.length} Watch repositories.`
        ),
        'success'
      );
    } catch (error) {
      console.error('Failed to sync watched repositories:', error);
      toast(t('同步 Watch 仓库失败，请检查网络或 Token 权限。', 'Failed to sync Watch repositories. Check network or token permissions.'), 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="rounded-lg border border-black/[0.06] dark:border-white/[0.04] bg-light-surface/50 dark:bg-white/[0.02] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900 dark:text-text-primary">{t('Watch 仓库同步', 'Watch repository sync')}</h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-text-tertiary">
            {t(
              '点击同步会拉取当前 GitHub 账号 Watch 的仓库，并作为 Release 来源。',
              'Sync pulls repositories watched by the current GitHub account and uses them as release sources.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={isSyncing || !githubToken}
          className="inline-flex min-h-10 min-w-24 flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-brand-indigo px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isSyncing ? 'animate-spin' : ''}`} />
          {isSyncing ? t('同步中...', 'Syncing...') : t('同步', 'Sync')}
        </button>
      </div>

      <PaginatedRepoList
        repos={repos}
        language={language}
        emptyText={t('暂无已同步仓库。', 'No synced repositories yet.')}
        renderActions={(repo) => {
          const hidden = !!repo.release_hidden;
          return (
            <button
              type="button"
              onClick={() => updateReleaseSourceRepository(WATCH_CUSTOM_RELEASE_SOURCE_ID, repo.full_name, { release_hidden: !hidden })}
              className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-text-tertiary dark:hover:bg-white/[0.08] dark:hover:text-text-primary"
              title={hidden ? t('显示并检查 Release', 'Show and check releases') : t('隐藏并跳过 Release 检查', 'Hide and skip release checks')}
              aria-label={hidden ? t('显示并检查 Release', 'Show and check releases') : t('隐藏并跳过 Release 检查', 'Hide and skip release checks')}
            >
              {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
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

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const enabledSources = new Set(releaseSourceSettings.enabledSourceIds);

  const sourceRows: Array<{ id: ReleaseSourceId; title: string; description: string; count: number }> = [
    {
      id: STARRED_RELEASE_SOURCE_ID,
      title: t('星标铃铛订阅', 'Starred bell subscriptions'),
      description: t('当前在仓库卡片点击铃铛订阅的 Release 来源，默认启用。', 'Existing release source from repository cards where the bell is enabled. Enabled by default.'),
      count: releaseSubscriptions.size,
    },
    {
      id: WATCH_CUSTOM_RELEASE_SOURCE_ID,
      title: RELEASE_SOURCE_LABELS[WATCH_CUSTOM_RELEASE_SOURCE_ID][language],
      description: t('从 Watch 仓库同步的 Release 来源。', 'Release source synced from Watch repositories.'),
      count: releaseSourceSettings.watchCustomReleaseRepos.length,
    },
    {
      id: CUSTOM_RELEASE_SOURCE_ID,
      title: t('自定义 Release 来源', 'Custom release source'),
      description: t('手动输入 GitHub 仓库地址，刷新时一并检查 Release。', 'Manually enter GitHub repositories to check during release refresh.'),
      count: releaseSourceSettings.customReleaseRepos.length,
    },
  ];

  const handleToggle = (sourceId: ReleaseSourceId) => {
    if (enabledSources.has(sourceId) && enabledSources.size === 1) {
      toast(t('至少需要保留一个 Release 来源。', 'Keep at least one release source enabled.'), 'error');
      return;
    }
    toggleReleaseSource(sourceId);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('Release 来源设置', 'Release Source Settings')} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-brand-indigo/20 bg-brand-indigo/5 p-4 text-sm text-gray-700 dark:text-text-secondary">
          {t(
            '选择刷新 Release 时要检查的来源。多个来源包含同一仓库时会自动去重。',
            'Choose the sources checked when refreshing releases. Repositories appearing in multiple sources are deduplicated.'
          )}
        </div>

        <div className="space-y-2">
          {sourceRows.map(source => {
            const checked = enabledSources.has(source.id);
            return (
              <button
                key={source.id}
                type="button"
                onClick={() => handleToggle(source.id)}
                className={`flex w-full items-start justify-between gap-4 rounded-lg border p-4 text-left transition-colors ${
                  checked
                    ? 'border-brand-indigo/30 bg-brand-indigo/10'
                    : 'border-black/[0.06] bg-white hover:bg-light-surface dark:border-white/[0.04] dark:bg-white/[0.02] dark:hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`mt-0.5 rounded-lg p-2 ${checked ? 'bg-brand-indigo text-white' : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-text-secondary'}`}>
                    <Bell className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-gray-900 dark:text-text-primary">{source.title}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-text-tertiary">{source.description}</div>
                  </div>
                </div>
                <div className="flex flex-shrink-0 items-center gap-3">
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/[0.06] dark:text-text-tertiary">
                    {source.count}
                  </span>
                  <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${checked ? 'bg-brand-indigo' : 'bg-gray-300 dark:bg-gray-600'}`}>
                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} />
                  </span>
                </div>
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
            title={t('自定义仓库列表', 'Custom repositories')}
            description={t('勾选自定义来源后，刷新会检查此列表中的仓库。', 'When custom source is enabled, refresh checks repositories in this list.')}
            placeholder="owner/repo or https://github.com/owner/repo"
            language={language}
          />
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-brand-indigo px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
          >
            {t('完成', 'Done')}
          </button>
        </div>
      </div>
    </Modal>
  );
};
