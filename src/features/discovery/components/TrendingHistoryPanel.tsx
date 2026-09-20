import React, { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ArrowDownRight, ArrowUpRight, Sparkles, TrendingUp } from 'lucide-react';
import type { TrendingTimeRange } from '../../../types';
import { useT } from '../../../i18n/useT';
import { getDateFnsLocale } from '../../../i18n/format';
import { useAppStore } from '../../../store/useAppStore';
import { buildTrendingHistory, pickTrendingHighlights } from '../../../utils/trendingSnapshots';
import { formatDistanceToNow } from 'date-fns';

interface TrendingHistoryPanelProps {
  period: TrendingTimeRange;
  language: string;
}

/**
 * 榜单历史面板（开发守则 §7）。
 *
 * 数据全部来自本地快照：排名变化对比的是**上一天**的记录（同一天刷新多次不算变化），
 * "新增 stars"是我们自己两次记录之间的差值，不是 GitHub 的"本周期新增"——文案里说清楚，
 * 免得用户以为是官方口径。
 *
 * 只有一份快照时（第一天）不渲染：那时所有条目都会被算成"新上榜"，没有信息量。
 */
export const TrendingHistoryPanel: React.FC<TrendingHistoryPanelProps> = ({ period, language }) => {
  const t = useT('discovery');
  const { snapshots, appLanguage } = useAppStore(useShallow((state) => ({
    snapshots: state.trendingSnapshots,
    appLanguage: state.language,
  })));

  const bucketSize = useMemo(
    () => snapshots.filter((snapshot) => snapshot.period === period && snapshot.language === language).length,
    [snapshots, period, language],
  );

  const rows = useMemo(
    () => buildTrendingHistory(snapshots, period, language),
    [snapshots, period, language],
  );
  const highlights = useMemo(() => pickTrendingHighlights(rows, 2), [rows]);

  if (bucketSize < 2 || highlights.length === 0) return null;

  const iconFor = (kind: 'new-entry' | 'rising' | 'falling') => {
    if (kind === 'rising') return <ArrowUpRight className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />;
    if (kind === 'falling') return <ArrowDownRight className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />;
    return <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />;
  };

  const labelFor = (kind: 'new-entry' | 'rising' | 'falling') => (
    kind === 'rising' ? t('trendingHistoryPanel.rising')
      : kind === 'falling' ? t('trendingHistoryPanel.falling')
        : t('trendingHistoryPanel.new-entry')
  );

  return (
    <section className="ui-toolbar p-3" aria-label={t('trendingHistoryPanel.title')} data-testid="trending-history">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
          {t('trendingHistoryPanel.title')}
        </span>
        <span className="text-[11px] text-muted-foreground">{t('trendingHistoryPanel.hint')}</span>
      </div>

      <ul className="grid gap-2 sm:grid-cols-2">
        {highlights.map((highlight) => {
          const row = rows.find((candidate) => candidate.repositoryFullName === highlight.repositoryFullName);
          return (
            <li
              key={`${highlight.kind}-${highlight.repositoryFullName}`}
              className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5"
              data-testid={`trending-highlight-${highlight.kind}`}
            >
              {iconFor(highlight.kind)}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground" title={highlight.repositoryFullName}>
                  {highlight.repositoryFullName}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {labelFor(highlight.kind)}
                  {highlight.rankChange !== null ? ` ${Math.abs(highlight.rankChange)}` : ''}
                  {row ? ` · ${t('trendingHistoryPanel.streak-days', { v1: row.streakDays })}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                #{highlight.rank}
              </span>
            </li>
          );
        })}
      </ul>

      {rows[0] && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('trendingHistoryPanel.first-seen', {
            v1: formatDistanceToNow(new Date(rows[0].firstSeenAt), {
              addSuffix: true,
              locale: getDateFnsLocale(appLanguage),
            }),
          })}
          {rows[0].starsGained !== null ? ` · ${t('trendingHistoryPanel.stars-gained', { v1: rows[0].starsGained })}` : ''}
        </p>
      )}
    </section>
  );
};

export default TrendingHistoryPanel;
