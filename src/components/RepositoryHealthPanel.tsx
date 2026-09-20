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
import { useT, type TranslateFn } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
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
  /** 仅用于 date-fns 的本地化；界面文案一律走 i18n key。 */
  language: AppLanguage;
}

/** 分组标题的 i18n key。 */
const GROUP_KEYS: Record<RepositoryHealthGroup, string> = {
  activity: 'repositoryHealthPanel.activity',
  maintenance: 'repositoryHealthPanel.maintenance',
  community: 'repositoryHealthPanel.community',
  maturity: 'repositoryHealthPanel.maturity',
};

/** 事实标签的 i18n key。 */
const FACT_KEYS: Record<RepositoryHealthFactId, string> = {
  pushedAt: 'repositoryHealthPanel.last-push',
  latestCommitAt: 'repositoryHealthPanel.latest-commit',
  recentCommitCount: 'repositoryHealthPanel.recent-commits',
  hasReleases: 'repositoryHealthPanel.has-releases',
  latestReleaseAt: 'repositoryHealthPanel.latest-release',
  archived: 'repositoryHealthPanel.archived',
  disabled: 'repositoryHealthPanel.disabled',
  fork: 'repositoryHealthPanel.fork',
  template: 'repositoryHealthPanel.template',
  license: 'repositoryHealthPanel.license',
  hasSecurityPolicy: 'repositoryHealthPanel.security-policy',
  hasCI: 'repositoryHealthPanel.ci-github-actions',
  hasReadme: 'repositoryHealthPanel.readme',
  hasDocs: 'repositoryHealthPanel.docs',
  stars: 'repositoryHealthPanel.stars',
  forks: 'repositoryHealthPanel.forks',
  openIssues: 'repositoryHealthPanel.open-issues',
  closedIssues: 'repositoryHealthPanel.closed-issues',
  contributors: 'repositoryHealthPanel.contributors',
  createdAt: 'repositoryHealthPanel.created',
  ageDays: 'repositoryHealthPanel.repository-age',
  releaseCount: 'repositoryHealthPanel.releases',
  releasesPerYear: 'repositoryHealthPanel.release-frequency',
  latestStableVersion: 'repositoryHealthPanel.latest-stable-version',
};

/**
 * 保守观测的 i18n key（图标见 {@link SIGNAL_ICONS}）。
 * `no-recent-activity` 用中性文案与图标，避免暗示「不健康」。
 */
const SIGNAL_KEYS: Record<RepositoryHealthSignalId, string> = {
  archived: 'repositoryHealthPanel.archived',
  disabled: 'repositoryHealthPanel.disabled',
  'no-releases': 'repositoryHealthPanel.no-releases',
  'no-recent-activity': 'repositoryHealthPanel.no-pushes-in-12-months',
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

/**
 * 事实值的展示文本。`undefined` 一律显示「未知」，不做任何推断。
 *
 * `t` 由调用方传入而不是在这里 `useT()`：这是一个普通函数，可能被条件调用，
 * 在函数内部调用 Hook 会违反 Hooks 规则。
 */
function formatFactValue(
  fact: RepositoryHealthFact,
  t: TranslateFn,
  language: AppLanguage,
): { text: string; title?: string; muted: boolean } {
  const unknown = { text: t('repositoryHealthPanel.unknown'), muted: true };

  if (fact.value === undefined) return unknown;

  switch (fact.kind) {
    case 'boolean':
      if (fact.value === null) return { text: t('repositoryHealthPanel.none'), muted: true };
      return fact.value
        ? { text: t('repositoryHealthPanel.yes'), muted: false }
        : { text: t('repositoryHealthPanel.no'), muted: true };
    case 'count':
      if (fact.value === null) return { text: '—', muted: true };
      if (fact.id === 'releasesPerYear') {
        return { text: t('repositoryHealthPanel.v1-year', { v1: formatCount(fact.value as number) }), muted: false };
      }
      return { text: formatCount(fact.value as number), muted: false };
    case 'duration': {
      if (fact.value === null) return { text: '—', muted: true };
      const days = fact.value as number;
      const years = Math.round((days / 365.25) * 10) / 10;
      return {
        text: t('repositoryHealthPanel.v1-days-years-years', { v1: formatCount(days), years: years }),
        muted: false,
      };
    }
    case 'date': {
      if (fact.value === null) return { text: t('repositoryHealthPanel.none'), muted: true };
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
      if (fact.value === null) return { text: t('repositoryHealthPanel.none'), muted: true };
      return { text: String(fact.value), muted: false };
  }
}

export const RepositoryHealthPanel: React.FC<RepositoryHealthPanelProps> = ({
  repository,
  releases,
  language,
}) => {
  const t = useT('repositories');

  // 纯函数推导：无网络请求，Release 未同步时相关事实自动成为「未知」。
  const groups = useMemo(() => {
    const snapshot = deriveRepositoryHealthSnapshot(repository, releases);
    return { snapshot, views: groupRepositoryHealthFacts(snapshot) };
  }, [repository, releases]);

  const { snapshot, views } = groups;

  return (
    <section
      className="mb-3 rounded-md border border-border bg-muted/20 px-3 py-3"
      aria-label={t('repositoryHealthPanel.repository-health-facts')}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-semibold">{t('repositoryHealthPanel.repository-health-facts')}</h3>
        {snapshot.signals.map((signal) => {
          const Icon = SIGNAL_ICONS[signal.id];
          return (
            <Badge key={signal.id} variant="outline" className="gap-1 text-[11px] font-normal">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {t(SIGNAL_KEYS[signal.id])}
            </Badge>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {views.map(({ group, facts }) => (
          <div key={group}>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {t(GROUP_KEYS[group])}
            </p>
            <dl className="space-y-0.5">
              {facts.map((fact) => {
                const formatted = formatFactValue(fact, t, language);
                return (
                  <div key={fact.id} className="flex items-baseline justify-between gap-2 text-xs">
                    <dt className="truncate text-muted-foreground">{t(FACT_KEYS[fact.id])}</dt>
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
        {t('repositoryHealthPanel.these-are-objective-facts-with-no-overall-score')}
      </p>
    </section>
  );
};

export default RepositoryHealthPanel;
