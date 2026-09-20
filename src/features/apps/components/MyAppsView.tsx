import React, { useMemo, useState } from 'react';
import { Package, Plus } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import { Button } from '../../../components/ui/button';
import { useLinkedApplications } from '../hooks/useLinkedApplications';
import { useLinkedApplicationLabels } from '../hooks/useLinkedApplicationLabels';
import { LinkApplicationDialog } from './LinkApplicationDialog';
import { LinkedApplicationDetail } from './LinkedApplicationDetail';

/**
 * My Apps 视图（开发守则 §3，阶段 1a）：列表 + 详情 + 手动关联。
 *
 * 入口是 header 里可独立访问的 `apps` 视图，不藏在设置里（见 PR 说明的入口取舍）。
 * View 层只渲染与转发意图：所有 Store 读写与 Release 查询都在 hooks 里。
 */
export const MyAppsView: React.FC = () => {
  const t = useT('app');
  const labels = useLinkedApplicationLabels();
  const {
    linkedApplications,
    linkableRepositories,
    defaultPlatform,
    linkApplication,
    updateApplication,
    unlinkApplication,
  } = useLinkedApplications();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLinkDialogOpen, setIsLinkDialogOpen] = useState(false);

  // 选中的记录被解除关联后回落到第一条，避免详情区停留在已消失的记录上
  const selectedApplication = useMemo(() => {
    const explicit = linkedApplications.find((application) => application.id === selectedId);
    return explicit ?? linkedApplications[0] ?? null;
  }, [linkedApplications, selectedId]);

  return (
    <div className="space-y-6" data-testid="my-apps-view">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('myApps.title')}</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">{t('myApps.subtitle')}</p>
        </div>
        <Button
          type="button"
          onClick={() => setIsLinkDialogOpen(true)}
          disabled={linkableRepositories.length === 0}
          data-testid="open-link-dialog"
        >
          <Plus className="h-4 w-4" />
          {t('myApps.link-application')}
        </Button>
      </header>

      <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        {t('myApps.local-only-notice')}
      </p>

      {linkedApplications.length === 0 ? (
        <div
          data-testid="my-apps-empty"
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border p-10 text-center"
        >
          <Package className="h-8 w-8 text-muted-foreground" />
          <h2 className="text-base font-medium text-foreground">{t('myApps.empty-title')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">{t('myApps.empty-description')}</p>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-foreground">{t('myApps.list-heading')}</h2>
            <ul className="space-y-2" data-testid="linked-application-list">
              {linkedApplications.map((application) => {
                const isSelected = selectedApplication?.id === application.id;
                return (
                  <li key={application.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(application.id)}
                      aria-current={isSelected ? 'true' : undefined}
                      data-testid={`linked-application-${application.id}`}
                      className={`w-full space-y-1 rounded-md border p-3 text-left transition-colors ${
                        isSelected ? 'border-primary bg-accent' : 'border-border hover:bg-accent/60'
                      }`}
                    >
                      <span className="block truncate font-medium text-foreground">{application.displayName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{application.repositoryFullName}</span>
                      <span className="block text-xs text-muted-foreground">
                        {t('myApps.installed-version')}
                        {': '}
                        {application.installedVersion ?? t('myApps.not-recorded')}
                      </span>
                      <span className="block text-xs text-muted-foreground">{labels.platform[application.platform]}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {selectedApplication ? (
            <LinkedApplicationDetail
              key={selectedApplication.id}
              application={selectedApplication}
              onUpdate={updateApplication}
              onUnlink={unlinkApplication}
            />
          ) : (
            <p className="text-sm text-muted-foreground">{t('myApps.select-hint')}</p>
          )}
        </div>
      )}

      <LinkApplicationDialog
        open={isLinkDialogOpen}
        onOpenChange={setIsLinkDialogOpen}
        repositories={linkableRepositories}
        defaultPlatform={defaultPlatform}
        onSubmit={linkApplication}
      />
    </div>
  );
};
