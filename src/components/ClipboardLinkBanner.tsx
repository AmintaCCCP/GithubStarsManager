import React, { Suspense, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ClipboardPaste, X } from 'lucide-react';
import type { Repository } from '../types';
import { useT } from '../i18n/useT';
import { useAppStore } from '../store/useAppStore';
import { useClipboardGitHubDetection } from '../hooks/useClipboardGitHubDetection';
import { Button } from './ui/button';

/** README 模态按需加载，别把 Markdown 渲染链拉进主包（与 RepositoryCard 一致）。 */
const LazyReadmeModal = React.lazy(() => (
  import('./ReadmeModal').then((module) => ({ default: module.ReadmeModal }))
));

/**
 * 剪贴板链接提示条（开发守则 §11）。
 *
 * 只有在用户开启开关、且切回窗口时才可能出现；命中本地已收藏的仓库就直接开 README，
 * 否则在浏览器里打开对应 GitHub 页面——剪贴板里可能是个还没 Star 的仓库，
 * 应用内没有它的详情可开。
 */
export const ClipboardLinkBanner: React.FC = () => {
  const t = useT('app');
  const { target, dismiss } = useClipboardGitHubDetection();
  const repositories = useAppStore(useShallow((state) => state.repositories));
  const [localRepository, setLocalRepository] = useState<Repository | null>(null);

  const handleOpen = useCallback(() => {
    if (!target) return;
    // 只有"仓库链接"才尝试在应用内打开 README；Release / 开发者链接直接交给浏览器，
    // 免得点"打开 Release"却只打开了仓库首页。
    const fullName = target.kind === 'repository' ? `${target.owner}/${target.name}` : null;
    const match = fullName
      ? repositories.find((repo) => repo.full_name.toLowerCase() === fullName.toLowerCase())
      : undefined;

    if (match) {
      setLocalRepository(match);
    } else {
      window.open(target.url, '_blank', 'noopener,noreferrer');
    }
    dismiss();
  }, [dismiss, repositories, target]);

  if (!target) return null;

  return (
    <>
      <div
        role="status"
        className="mb-3 flex items-center gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm"
      >
        <ClipboardPaste className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={target.label}>
          {t('clipboardLinkBanner.github-link-found', { v1: target.label })}
        </span>
        <Button type="button" size="sm" className="h-7 px-2 text-xs" onClick={handleOpen}>
          {t('clipboardLinkBanner.open')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          aria-label={t('clipboardLinkBanner.dismiss')}
          onClick={dismiss}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      {localRepository && (
        <Suspense fallback={null}>
          <LazyReadmeModal
            isOpen
            onClose={() => setLocalRepository(null)}
            repository={localRepository}
          />
        </Suspense>
      )}
    </>
  );
};

export default ClipboardLinkBanner;
