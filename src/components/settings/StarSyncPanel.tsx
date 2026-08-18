import React from 'react';
import { Star, ListChecks, GitBranch, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useDialog } from '../../hooks/useDialog';
import { createGitHubListsApiService } from '../../services/githubApiFactory';

interface StarSyncPanelProps {
  t: (zh: string, en: string) => string;
}

export const StarSyncPanel: React.FC<StarSyncPanelProps> = ({ t }) => {
  const {
    syncMode,
    setSyncMode,
    setSyncModeConfigured,
    githubToken,
    listsPush,
    pushCategoriesToLists,
    setListsPushError,
  } = useAppStore();

  const { confirm } = useDialog();

  const handlePushCategoriesToLists = async () => {
    if (!githubToken) {
      setListsPushError(t('未登录 GitHub，请先连接', 'Not connected to GitHub yet'));
      return;
    }
    const confirmed = await confirm(
      t('同步仓库分类到 GitHub list', 'Push categories to GitHub lists'),
      t(
        '将每个本地分类（含默认与自定义分类）写回为同名 GitHub List：\n\n' +
        '· 同名 list 将覆盖其成员（未匹配分类的仓库会从该 list 移除）\n' +
        '· 无同名 list 则新建（默认私有）\n' +
        '· 仓库将按其匹配的分类加入对应 list\n' +
        '· 不属于本地分类的其他 list 成员关系会被保留\n\n确定继续吗？',
        'Each local category (default & custom) will be written to a GitHub List of the same name:\n\n' +
        '· Existing same-name lists will be overwritten (repos no longer matching are removed)\n' +
        '· Missing lists will be created (private by default)\n' +
        '· Repos are added to the lists matching their category\n' +
        '· Memberships in lists not managed locally are preserved\n\nContinue?'
      ),
      { type: 'warning' }
    );
    if (!confirmed) return;

    const api = createGitHubListsApiService(githubToken);
    await pushCategoriesToLists(api);
  };

  const progressPercent = listsPush.total > 0
    ? Math.min(100, Math.round((listsPush.done / listsPush.total) * 100))
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Star className="w-6 h-6 text-gray-700 dark:text-text-secondary" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('星标同步', 'Star Sync')}
        </h3>
      </div>

      {/* 同步范围 */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <Star className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('同步范围', 'Sync Scope')}
          </h4>
        </div>
        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-4">
          {t('选择同步按钮默认拉取的数据范围：仅星标仓库，或星标仓库及 GitHub Lists。', 'Choose what the sync button pulls by default: starred repos only, or starred repos plus GitHub Lists.')}
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="syncMode"
              value="stars"
              checked={syncMode === 'stars'}
              onChange={() => { setSyncMode('stars'); setSyncModeConfigured(true); }}
              className="w-4 h-4 text-brand-violet bg-light-surface border-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                {t('仅同步星标仓库', 'Starred repos only')}
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                {t('与以前行为一致', 'Same as before')}
              </p>
            </div>
          </label>
          <label className="flex items-center space-x-3 cursor-pointer p-3 rounded-lg border border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10 transition-colors">
            <input
              type="radio"
              name="syncMode"
              value="stars-and-lists"
              checked={syncMode === 'stars-and-lists'}
              onChange={() => { setSyncMode('stars-and-lists'); setSyncModeConfigured(true); }}
              className="w-4 h-4 text-brand-violet bg-light-surface border-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
            />
            <div>
              <span className="text-base font-medium text-gray-900 dark:text-text-primary">
                {t('同步星标仓库及 list', 'Starred repos & lists')}
              </span>
              <p className="text-xs text-gray-500 dark:text-text-tertiary">
                <ListChecks className="w-3 h-3 inline mr-1" />
                {t('拉取 GitHub Lists 并按标签归类', 'Also pull GitHub Lists & categorize by tags')}
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* 同步仓库分类到 GitHub list */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
        <div className="flex items-center space-x-3 mb-4">
          <GitBranch className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <div>
            <h4 className="font-medium text-gray-900 dark:text-text-primary">
              {t('同步仓库分类到 GitHub list', 'Push categories to GitHub lists')}
            </h4>
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              {t(
                '将每个本地分类写回为同名 GitHub List。同名 list 将被覆盖，无同名 list 则新建。',
                'Write each local category to a GitHub List of the same name. Same-name lists are overwritten, missing lists are created.'
              )}
            </p>
          </div>
        </div>

        <button
          onClick={handlePushCategoriesToLists}
          disabled={listsPush.isRunning}
          className="ui-button-primary inline-flex items-center gap-2 px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {listsPush.isRunning ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t('同步中...', 'Pushing...')}</span>
            </>
          ) : (
            <>
              <ListChecks className="w-4 h-4" />
              <span>{t('同步仓库分类到 GitHub list', 'Push categories to lists')}</span>
            </>
          )}
        </button>

        {listsPush.isRunning && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-700 dark:text-text-secondary truncate">
                {listsPush.currentLabel || t('准备中...', 'Preparing...')}
              </span>
              <span className="text-gray-500 dark:text-text-tertiary ml-2 shrink-0">
                {listsPush.done}/{listsPush.total}
              </span>
            </div>
            <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/[0.04] overflow-hidden">
              <div
                className="h-full bg-brand-violet dark:bg-brand-violet transition-all duration-200"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {!listsPush.isRunning && listsPush.error && (
          <p className="mt-4 text-sm text-red-600 dark:text-red-400">
            {listsPush.error}
          </p>
        )}
        {!listsPush.isRunning && listsPush.message && !listsPush.error && (
          <p className="mt-4 text-sm text-emerald-600 dark:text-emerald-400">
            {listsPush.message}
          </p>
        )}
      </div>
    </div>
  );
};
