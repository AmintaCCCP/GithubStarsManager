import React from 'react';
import { Star, ListChecks } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

/**
 * 首次登录 / 首次使用 GitHub Lists 同步时，选择同步范围。
 * 必须渲染在已认证的组件树内（例如 App 的已登录 shell），
 * 不能在 LoginScreen 里触发——因为 setUser 后 LoginScreen 会被卸载，弹窗无法显示。
 */
export const SyncModeChoiceModal: React.FC = () => {
  const language = useAppStore((state) => state.language);
  const syncModeConfigured = useAppStore((state) => state.syncModeConfigured);
  const setSyncMode = useAppStore((state) => state.setSyncMode);
  const setSyncModeConfigured = useAppStore((state) => state.setSyncModeConfigured);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  // 尚未配置过同步范围时弹出选择（结果持久化，可在设置中切换）
  if (syncModeConfigured) {
    return null;
  }

  const handleChooseSyncMode = (mode: 'stars' | 'stars-and-lists') => {
    setSyncMode(mode);
    setSyncModeConfigured(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="max-w-md w-full linear-login-card p-6 sm:p-7">
        <h2 className="text-xl font-semibold text-gray-900 dark:text-text-primary mb-2">
          {t('选择同步范围', 'Choose sync scope')}
        </h2>
        <p className="text-sm text-gray-700 dark:text-text-tertiary mb-5">
          {t('您希望同步哪些数据？此选择可在设置中随时切换。', 'What should be synced? You can change this anytime in Settings.')}
        </p>
        <div className="space-y-3">
          <button
            onClick={() => handleChooseSyncMode('stars')}
            className="w-full flex items-start gap-3 p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-left hover:border-brand-violet/40 transition-colors"
          >
            <Star className="w-5 h-5 text-brand-violet mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900 dark:text-text-primary">{t('仅同步星标仓库', 'Starred repos only')}</p>
              <p className="text-xs text-gray-700 dark:text-text-tertiary mt-1">
                {t('同步你的全部星标仓库（默认，与以前行为一致）。', 'Sync all your starred repositories (default, same as before).')}
              </p>
            </div>
          </button>
          <button
            onClick={() => handleChooseSyncMode('stars-and-lists')}
            className="w-full flex items-start gap-3 p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-white dark:bg-white/[0.04] text-left hover:border-brand-violet/40 transition-colors"
          >
            <ListChecks className="w-5 h-5 text-brand-violet mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-gray-900 dark:text-text-primary">{t('同步星标仓库及 list', 'Starred repos & lists')}</p>
              <p className="text-xs text-gray-700 dark:text-text-tertiary mt-1">
                {t('除星标仓库外，还将拉取你的 Lists（星标列表）并按标签归类；未锁定分类的仓库会被自动锁定。', 'Also fetch your Lists and categorize by tags; unlocked repos will be auto-locked.')}
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default SyncModeChoiceModal;
