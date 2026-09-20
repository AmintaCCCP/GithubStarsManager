import React, { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Clock } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Repository } from '../../../types';
import { useT } from '../../../i18n/useT';
import { getDateFnsLocale } from '../../../i18n/format';
import { useAppStore } from '../../../store/useAppStore';
import { Button } from '../../../components/ui/button';

/** 与 RepositoryCard 一致：README 模态按需加载，别把它和 Markdown 渲染链拉进主包。 */
const LazyReadmeModal = React.lazy(() => (
  import('../../../components/ReadmeModal').then((module) => ({ default: module.ReadmeModal }))
));

/** 条带里最多展示多少条；列表本身的上限由 utils 控制。 */
const MAX_VISIBLE = 12;

/**
 * 「最近浏览」条带（开发守则 §9）。
 *
 * 纯本地记录：只读 store 里的 `recentlyViewed`，不发起任何远端请求，也不暴露给插件。
 * 没有记录时整块不渲染，不给主列表添噪音；记录开关与清空在设置面板里。
 */
export const RecentlyViewedStrip: React.FC = () => {
  const t = useT('repositories');
  const { entries, language, clearRecentlyViewed } = useAppStore(useShallow((state) => ({
    entries: state.recentlyViewed,
    language: state.language,
    clearRecentlyViewed: state.clearRecentlyViewed,
  })));
  const [openRepository, setOpenRepository] = useState<Repository | null>(null);

  const visible = useMemo(() => entries.slice(0, MAX_VISIBLE), [entries]);

  if (visible.length === 0) return null;

  return (
    <section className="ui-toolbar p-3" aria-label={t('recentlyViewedStrip.recently-viewed')}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {t('recentlyViewedStrip.recently-viewed')}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs"
          onClick={clearRecentlyViewed}
        >
          {t('recentlyViewedStrip.clear')}
        </Button>
      </div>
      <ul className="flex gap-2 overflow-x-auto pb-1">
        {visible.map(({ repository, viewedAt }) => (
          <li key={repository.id} className="shrink-0">
            <button
              type="button"
              className="flex w-52 items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-left transition-colors hover:bg-accent"
              onClick={() => setOpenRepository(repository)}
            >
              <img
                src={repository.owner.avatar_url}
                alt=""
                className="h-6 w-6 shrink-0 rounded-full"
                loading="lazy"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground" title={repository.full_name}>
                  {repository.full_name}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {formatDistanceToNow(new Date(viewedAt), { addSuffix: true, locale: getDateFnsLocale(language) })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {openRepository && (
        <React.Suspense fallback={null}>
          <LazyReadmeModal
            isOpen
            onClose={() => setOpenRepository(null)}
            repository={openRepository}
          />
        </React.Suspense>
      )}
    </section>
  );
};

export default RecentlyViewedStrip;
