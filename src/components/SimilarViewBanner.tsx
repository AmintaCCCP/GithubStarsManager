import React from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Button } from './ui/button';

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
    <div className="flex items-center justify-between gap-3 bg-primary/5 dark:bg-primary/10 border border-primary/20 dark:border-primary/30 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 min-w-0">
        <Search className="w-4 h-4 flex-shrink-0 text-primary dark:text-primary" />
        <p className="text-sm text-muted-foreground dark:text-muted-foreground truncate">
          <span className="text-muted-foreground dark:text-muted-foreground">
            {t('正在查看 ', 'Viewing similar repositories of ')}
          </span>
          <span className="font-semibold text-foreground dark:text-foreground">
            {anchorRepoName}
          </span>
          <span className="text-muted-foreground dark:text-muted-foreground">
            {t(' 的相似仓库', '')}
          </span>
        </p>
      </div>
      <Button type="button" onClick={onReset} className="h-8 shrink-0 gap-1.5 px-3 text-sm">
        <RotateCcw className="w-4 h-4" />
        {t('重置', 'Reset')}
      </Button>
    </div>
  );
};
