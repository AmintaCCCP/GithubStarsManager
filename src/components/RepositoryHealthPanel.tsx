import React, { useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { AlertTriangle, Archive, Ban, PackageOpen } from 'lucide-react';
import type { Release, Repository } from '../types';
import type {
  RepositoryHealthFact,
  RepositoryHealthFactId,
  RepositoryHealthGroup,
  RepositoryHealthSignalId,
} from '../types/health';
import { Badge } from './ui/badge';
import {
  deriveRepositoryHealthSnapshot,
  groupRepositoryHealthFacts,
} from '../utils/repositoryHealth';

/**
 * Repository Health 事实面板。
 *
 * 只展示客观事实与保守观测，**不展示任何健康总分或「健康 / 不健康」结论**——
 * 主观评分属于插件（见 docs/plans/2026-09-17-product-roadmap.md §4.3）。
 * 因此这里刻意不做颜色化的「好 / 坏」判定，未知事实显示为「未知」而不是猜测。
 */
interface RepositoryHealthPanelProps {
  repository: Repository;
  /** 该仓库的本地 Release；用于推导 Release 相关事实，缺失时对应事实为未知。 */
  releases?: Release[];
  language: 'zh' | 'en';
}

/** 分组标题文案。i18n 重构（roadmap §13）后会迁入语言包。 */
const GROUP_LABELS: Record<RepositoryHealthGroup, { zh: string; en: string }> = {
  activity: { zh: '活跃度', en: 'Activity' },
  maintenance: { zh: '维护', en: 'Maintenance' },
  community: { zh: '社区', en: 'Community' },
  maturity: { zh: '成熟度', en: 'Maturity' },
};

/** 事实标签文案。 */
const FACT_LABELS: Record<RepositoryHealthFactId, { zh: string; en: string }> = {
  pushedAt: { zh: '最近推送', en: 'Last push' },
  latestCommitAt: { zh: '默认分支最近提交', en: 'Latest commit' },
  recentCommitCount: { zh: '近期提交数', en: 'Recent commits' },
  hasReleases: { zh: '是否存在 Release', en: 'Has releases' },
  latestReleaseAt: { zh: '最近 Release', en: 'Latest release' },
  archived: { zh: '已归档', en: 'Archived' },
  disabled: { zh: '已停用', en: 'Disabled' },
  fork: { zh: 'Fork 仓库', en: 'Fork' },
  template: { zh: '模板仓库', en: 'Template' },
  license: { zh: 'License', en: 'License' },
  hasSecurityPolicy: { zh: 'Security Policy', en: 'Security policy' },
  hasCI: { zh: 'CI / GitHub Actions', en: 'CI / GitHub Actions' },
  hasReadme: { zh: 'README', en: 'README' },
  hasDocs: { zh: '文档目录', en: 'Docs' },
  stars: { zh: 'Stars', en: 'Stars' },
  forks: { zh: 'Forks', en: 'Forks' },
  openIssues: { zh: 'Open Issues', en: 'Open issues' },
  closedIssues: { zh: 'Closed Issues', en: 'Closed issues' },
  contributors: { zh: '贡献者', en: 'Contributors' },
  createdAt: { zh: '创建时间', en: 'Created' },
  ageDays: { zh: '仓库年龄', en: 'Repository age' },
  releaseCount: { zh: 'Release 数量', en: 'Releases' },
  releasesPerYear: { zh: '发布频率', en: 'Release frequency' },
  latestStableVersion: { zh: '最新稳定版本', en: 'Latest stable version' },
};

/** 保守观测的文案与图标。`no-recent-activity` 用中性图标，避免暗示「不健康」。 */
const SIGNAL_LABELS: Record<RepositoryHealthSignalId, { zh: string; en: string }> = {
  archived: { zh: '已归档', en: 'Archived' },
  disabled: { zh: '已停用', en: 'Disabled' },
  'no-releases': { zh: '无 Release', en: 'No releases' },
  'no-recent-activity': { zh: '近 12 个月无推送', en: 'No pushes in 12 months' },
};

const SIGNAL_ICONS: Record<RepositoryHealthSignalId, React.ComponentType<{ className?: string }>> = {
  archived: Archive,
  disabled: Ban,
  'no-releases': PackageOpen,
  'no-recent-activity': AlertTriangle,
};

/** 千分位数字；非有限值原样回落，避免显示 NaN。 */
function formatCount(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
}

/** 绝对日期（YYYY-MM-DD），用于 tooltip 与相对时间的兜底。 */
function formatAbsoluteDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** 事实值的展示文本。`undefined` 一律显示「未知」，不做任何推断。 */
function formatFactValue(
  fact: RepositoryHealthFact,
  language: 'zh' | 'en',
): { text: string; title?: string; muted: boolean } {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);
  const unknown = { text: t('未知', 'Unknown'), muted: true };

  if (fact.value === undefined) return unknown;

  switch (fact.kind) {
    case 'boolean':
      if (fact.value === null) return { text: t('无', 'None'), muted: true };
      return fact.value
        ? { text: t('是', 'Yes'), muted: false }
        : { text: t('否', 'No'), muted: true };
    case 'count':
      if (fact.value === null) return { text: '—', muted: true };
      if (fact.id === 'releasesPerYear') {
        return { text: t(`${formatCount(fact.value as number)} 次/年`, `${formatCount(fact.value as number)} / year`), muted: false };
      }
      return { text: formatCount(fact.value as number), muted: false };
    case 'duration': {
      if (fact.value === null) return { text: '—', muted: true };
      const days = fact.value as number;
      const years = Math.round((days / 365.25) * 10) / 10;
      return {
        text: t(`${formatCount(days)} 天（约 ${years} 年）`, `${formatCount(days)} days (~${years} years)`),
        muted: false,
      };
    }
    case 'date': {
      if (fact.value === null) return { text: t('无', 'None'), muted: true };
      const raw = String(fact.value);
      const timestamp = Date.parse(raw);
      if (!Number.isFinite(timestamp)) return { text: raw, muted: false };
      return {
        text: formatDistanceToNow(timestamp, {
          addSuffix: true,
          locale: language === 'zh' ? zhCN : undefined,
        }),
        title: formatAbsoluteDate(raw),
        muted: false,
      };
    }
    case 'text':
    default:
      if (fact.value === null) return { text: t('无', 'None'), muted: true };
      return { text: String(fact.value), muted: false };
  }
}

export const RepositoryHealthPanel: React.FC<RepositoryHealthPanelProps> = ({
  repository,
  releases,
  language,
}) => {
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  // 纯函数推导：无网络请求，Release 未同步时相关事实自动成为「未知」。
  const groups = useMemo(() => {
    const snapshot = deriveRepositoryHealthSnapshot(repository, releases);
    return { snapshot, views: groupRepositoryHealthFacts(snapshot) };
  }, [repository, releases]);

  const { snapshot, views } = groups;

  return (
    <section
      className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-3"
      aria-label={t('仓库健康事实', 'Repository health facts')}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold">{t('仓库健康事实', 'Repository health facts')}</h3>
        {snapshot.signals.map((signal) => {
          const Icon = SIGNAL_ICONS[signal.id];
          return (
            <Badge key={signal.id} variant="outline" className="gap-1 text-[11px] font-normal">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {language === 'zh' ? SIGNAL_LABELS[signal.id].zh : SIGNAL_LABELS[signal.id].en}
            </Badge>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {views.map(({ group, facts }) => (
          <div key={group}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {language === 'zh' ? GROUP_LABELS[group].zh : GROUP_LABELS[group].en}
            </p>
            <dl className="space-y-0.5">
              {facts.map((fact) => {
                const formatted = formatFactValue(fact, language);
                const label =
                  language === 'zh' ? FACT_LABELS[fact.id].zh : FACT_LABELS[fact.id].en;
                return (
                  <div key={fact.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="truncate text-muted-foreground">{label}</dt>
                    <dd
                      className={`shrink-0 text-right ${formatted.muted ? 'text-muted-foreground' : ''}`}
                      title={formatted.title}
                    >
                      {formatted.text}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {t(
          '以上为客观事实，不含健康总分。「未知」表示尚未获得该事实。',
          'These are objective facts with no overall score. “Unknown” means the fact has not been obtained yet.',
        )}
      </p>
    </section>
  );
};

export default RepositoryHealthPanel;
