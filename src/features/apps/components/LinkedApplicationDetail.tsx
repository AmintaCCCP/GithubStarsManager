import React, { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { formatDate } from '../../../i18n/format';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Switch } from '../../../components/ui/switch';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import { useDialog } from '../../../hooks/useDialog';
import { useAppStore } from '../../../store/useAppStore';
import type { LinkedApplication, LinkedApplicationEditablePatch } from '../../../types/linkedApplication';
import { useLinkedApplicationLabels } from '../hooks/useLinkedApplicationLabels';
import { useLinkedApplicationRelease } from '../hooks/useLinkedApplicationRelease';

interface LinkedApplicationDetailProps {
  application: LinkedApplication;
  onUpdate: (id: string, patch: LinkedApplicationEditablePatch) => void;
  onUnlink: (id: string) => void;
}

/**
 * 关联详情：本地记录 + 该仓库最新 Release 的只读展示。
 *
 * 只读边界：本阶段不提供下载/安装入口（下载推荐资产是 1b），也无法从记录反推用户磁盘状态。
 * 版本比较的结果只在这一个面板里查询（打开界面即查一次，可手动刷新），没有后台轮询。
 */
export const LinkedApplicationDetail: React.FC<LinkedApplicationDetailProps> = ({
  application,
  onUpdate,
  onUnlink,
}) => {
  const t = useT('app');
  const labels = useLinkedApplicationLabels();
  const { confirm } = useDialog();
  const language = useAppStore(useShallow((state) => state.language));
  const [versionDraft, setVersionDraft] = useState(application.installedVersion ?? '');

  const { latestRelease, updateStatus, isLoading, error, assetNames, refresh } = useLinkedApplicationRelease(application);

  const statusVariant = updateStatus === 'update-available'
    ? 'default'
    : updateStatus === 'up-to-date'
      ? 'success'
      : 'secondary';

  const handleSaveVersion = () => {
    const next = versionDraft.trim();
    onUpdate(application.id, { installedVersion: next ? next : null });
  };

  const handleUnlink = async () => {
    const confirmed = await confirm(
      t('myApps.unlink-confirm-title'),
      t('myApps.unlink-confirm-body'),
      { type: 'warning', confirmText: t('myApps.unlink') },
    );
    if (confirmed) {
      onUnlink(application.id);
    }
  };

  return (
    <section
      data-testid="linked-application-detail"
      className="space-y-6 rounded-lg border border-border bg-card p-5 text-card-foreground"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="truncate text-lg font-semibold">{application.displayName}</h2>
          <a
            href={application.repositorySourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            {application.repositoryFullName}
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
        <Badge data-testid="update-status" variant={statusVariant}>{labels.updateStatus[updateStatus]}</Badge>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <dt><Label htmlFor="my-apps-detail-installed-version">{t('myApps.installed-version')}</Label></dt>
          <dd className="flex items-center gap-2">
            <Input
              id="my-apps-detail-installed-version"
              value={versionDraft}
              placeholder={t('myApps.installed-version-placeholder')}
              onChange={(event) => setVersionDraft(event.target.value)}
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleSaveVersion}>
              {t('myApps.save')}
            </Button>
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">{t('myApps.platform')}</dt>
          <dd className="text-sm text-foreground">{labels.platform[application.platform]}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">{t('myApps.architecture')}</dt>
          <dd className="text-sm text-foreground">
            {application.architecture ? labels.architecture[application.architecture] : t('myApps.architecture-not-set')}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">{t('myApps.linked-at')}</dt>
          <dd className="text-sm text-foreground">
            {application.linkedAt ? formatDate(new Date(application.linkedAt), language) : t('myApps.not-recorded')}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">{t('myApps.link-source')}</dt>
          <dd className="text-sm text-foreground">{labels.linkSource[application.linkSource]}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-sm font-medium text-muted-foreground">{t('myApps.last-checked-at')}</dt>
          <dd className="text-sm text-foreground">
            {application.lastCheckedAt ? formatDate(new Date(application.lastCheckedAt), language) : t('myApps.not-recorded')}
          </dd>
        </div>
      </dl>

      <div className="flex items-start justify-between gap-4 rounded-md border border-border p-3">
        <div className="space-y-1">
          <Label htmlFor="my-apps-detail-include-prereleases">{t('myApps.include-prereleases')}</Label>
          <p className="text-xs text-muted-foreground">{t('myApps.include-prereleases-hint')}</p>
        </div>
        <Switch
          id="my-apps-detail-include-prereleases"
          checked={application.includePrereleases}
          onCheckedChange={(checked) => onUpdate(application.id, { includePrereleases: checked })}
        />
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-foreground">{t('myApps.latest-release')}</h3>
          <Button type="button" variant="ghost" size="sm" onClick={refresh} disabled={isLoading}>
            <RefreshCw className="h-4 w-4" />
            {t('myApps.refresh')}
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground" data-testid="latest-release-loading">
            {t('myApps.latest-release-loading')}
          </p>
        ) : error ? (
          <p className="text-sm text-destructive" data-testid="latest-release-error">
            {t('myApps.latest-release-failed')}
          </p>
        ) : latestRelease ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-foreground" data-testid="latest-release-tag">{latestRelease.tag_name}</span>
              <span className="text-muted-foreground">{formatDate(new Date(latestRelease.published_at), language)}</span>
            </div>
            <div className="space-y-1">
              <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('myApps.changelog')}</h4>
              {latestRelease.body ? (
                <MarkdownRenderer content={latestRelease.body} shouldRender fontSize="small" />
              ) : (
                <p className="text-sm text-muted-foreground">{t('myApps.no-changelog')}</p>
              )}
            </div>
            {assetNames.length > 0 ? (
              <div className="space-y-1">
                <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t('myApps.assets')}</h4>
                <p className="text-sm text-muted-foreground" data-testid="latest-release-assets">
                  {assetNames.join(' · ')}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="latest-release-none">
            {t('myApps.latest-release-none')}
          </p>
        )}
      </div>

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="button" variant="destructive" size="sm" onClick={handleUnlink} data-testid="unlink-application">
          {t('myApps.unlink')}
        </Button>
      </div>
    </section>
  );
};
