import React from 'react';
import { RotateCcw, Search } from 'lucide-react';

interface SimilarViewBannerProps {
  anchorRepoName: string;
  onReset: () => void;
  language: 'zh' | 'en';
}

/**
 * 相似仓库视图顶部横幅：展示当前锚点仓库名，并提供"重置"按钮回到查找相似之前的状态。
 */
export const SimilarViewBanner: React.FC<SimilarViewBannerProps> = ({
  anchorRepoName,
  onReset,
  language,
}) => {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  return (
    <div className="flex items-center justify-between gap-3 bg-brand-indigo/5 dark:bg-brand-indigo/10 border border-brand-indigo/20 dark:border-brand-indigo/30 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 min-w-0">
        <Search className="w-4 h-4 flex-shrink-0 text-brand-violet dark:text-brand-violet" />
        <p className="text-sm text-gray-700 dark:text-text-secondary truncate">
          <span className="text-gray-500 dark:text-text-tertiary">
            {t('正在查看 ', 'Viewing similar repositories of ')}
          </span>
          <span className="font-semibold text-gray-900 dark:text-text-primary">
            {anchorRepoName}
          </span>
          <span className="text-gray-500 dark:text-text-tertiary">
            {t(' 的相似仓库', '')}
          </span>
        </p>
      </div>
      <button
        onClick={onReset}
        className="flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 text-sm font-medium rounded-lg bg-brand-indigo text-white hover:bg-brand-hover transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
        {t('重置', 'Reset')}
      </button>
    </div>
  );
};
