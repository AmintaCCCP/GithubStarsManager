



import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from './ui/button';

interface SimilarViewBannerProps {
  anchorRepoName: string;
  onReset: () => void;
  language: AppLanguage;
}

/**
 * 相似仓库视图顶部横幅：展示当前锚点仓库名，并提供"重置"按钮回到查找相似之前的状态。
 */
export const SimilarViewBanner: React.FC<SimilarViewBannerProps> = ({
  anchorRepoName,
  onReset,

}) => {
  const t = useT('app');

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-accent-tint px-3.5 py-2.5 shadow-[inset_0_0_0_1px_var(--accent-tint-strong)]">
      <div className="flex min-w-0 items-center gap-2">
        <Search className="size-3.5 shrink-0 text-accent-text" />
        <p className="truncate text-label text-secondary">
          <span>
            {t('similarViewBanner.viewing-similar-repositories-of')}
          </span>
          <span className="font-medium text-foreground">
            {anchorRepoName}
          </span>
          <span>
            {t('similarViewBanner.text')}
          </span>
        </p>
      </div>
      <Button type="button" variant="outline" size="md" onClick={onReset} className="h-control shrink-0 gap-1.5 rounded-md">
        <RotateCcw className="size-3.5" />
        {t('similarViewBanner.reset')}
      </Button>
    </div>
  );
};
