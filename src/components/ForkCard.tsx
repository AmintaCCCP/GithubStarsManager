



import { getDateFnsLocale } from '../i18n/format';
import { useT } from '../i18n/useT';
import type { AppLanguage } from '../i18n/languages';
import React, { memo } from 'react';
import { ExternalLink, GitFork, RefreshCw, ChevronDown, ChevronUp, FolderOpen, Folder, Play, Loader2 } from 'lucide-react';
import { ForkRepo, WorkflowDefinition } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { Button } from './ui/button';

interface ForkCardProps {
  fork: ForkRepo;
  isUnread: boolean;
  isWorkflowsExpanded: boolean;
  onToggleWorkflows: () => void;
  onSyncUpstream: () => void;
  onMarkAsRead: () => void;
  onRunWorkflow: (workflowPath: string, workflowName: string) => void;
  workflows: WorkflowDefinition[];
  isLoadingWorkflows: boolean;
  isSyncing: boolean;
  isRunningWorkflow: boolean;
  needsSync?: boolean; // true = out-of-date; false = current; undefined = check failed
  language: AppLanguage;
}

const ForkCard: React.FC<ForkCardProps> = memo(({
  fork,
  isUnread,
  isWorkflowsExpanded,
  onToggleWorkflows,
  onSyncUpstream,
  onMarkAsRead,
  onRunWorkflow,
  workflows,
  isLoadingWorkflows,
  isSyncing,
  isRunningWorkflow,
  needsSync,
  language,
}) => {
  const t = useT('releases');

  const sourceFullName = fork.source?.full_name || fork.parent?.full_name || '';

  return (
    <div
      onClick={onMarkAsRead}
      className={`ui-card cursor-pointer transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant ${
        isWorkflowsExpanded ? 'bg-raised shadow-elev-1' : ''
      }`}
    >
      {/* Header */}
      <div className="px-3.5 py-3 sm:px-4">
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex items-center min-w-0 flex-1">
            <span className="app-unread-marker-slot" aria-hidden="true">
              {isUnread && <span className="app-unread-marker" />}
            </span>
            <div className="app-list-row-icon flex items-center justify-center shrink-0">
              <GitFork aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1 ml-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h4 className="app-list-row-title truncate">
                  {fork.name}
                </h4>
                {fork.language && (
                  <span className="app-list-row-tag shrink-0">
                    {fork.language}
                  </span>
                )}
              </div>
              <p className="app-list-row-meta font-mono truncate mt-0.5">
                {fork.full_name}
              </p>
              {sourceFullName && (
                <p className="app-list-row-meta truncate mt-0.5 flex items-center gap-1">
                  <span>{t('forkCard.forked-from')}</span>
                  {fork.parent?.html_url || fork.source?.html_url ? (
                    <a
                      href={fork.parent?.html_url || fork.source?.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-text hover:underline font-mono truncate"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAsRead();
                      }}
                    >
                      {sourceFullName}
                    </a>
                  ) : (
                    <span className="text-accent-text font-mono truncate">{sourceFullName}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 shrink-0 self-stretch">
            <div className="hidden md:flex min-w-[140px] flex-col justify-center gap-1.5 text-label-sm text-tertiary tabular-nums">
              <div className="flex items-center gap-1.5">
                <RefreshCw className="size-3.5 shrink-0" />
                <span>
                  {fork.updated_at
                    ? formatDistanceToNow(new Date(fork.updated_at), { addSuffix: true, locale: getDateFnsLocale(language) })
                    : '-'}
                </span>
              </div>
              {fork.source?.updated_at && (
                <div className="flex items-center gap-1.5">
                  <GitFork className="size-3.5 shrink-0" />
                  <span>
                    {formatDistanceToNow(new Date(fork.source.updated_at), { addSuffix: true, locale: getDateFnsLocale(language) })}
                  </span>
                </div>
              )}
            </div>
            <div className="app-row-actions flex items-center shrink-0">
              {/* Workflows dropdown */}
              <Button
                variant={isWorkflowsExpanded ? 'secondary' : 'ghost'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWorkflows();
                  onMarkAsRead();
                }}
                className="app-row-action app-row-action--label shrink-0"
                title={isWorkflowsExpanded ? t('forkCard.hide-workflows') : t('forkCard.show-workflows')}
                aria-label={isWorkflowsExpanded ? t('forkCard.hide-workflows') : t('forkCard.show-workflows')}
                aria-expanded={isWorkflowsExpanded}
              >
                {isWorkflowsExpanded ? <FolderOpen className="size-3.5" /> : <Folder className="size-3.5" />}
                <span className="text-label-sm font-medium">{isWorkflowsExpanded ? t('forkCard.hide') : t('forkCard.workflows')}</span>
                {isWorkflowsExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
              </Button>

              {/* Sync Upstream button — enabled only when fork needs sync (out-of-date) */}
              <Button
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onSyncUpstream();
                  onMarkAsRead();
                }}
                disabled={isSyncing || needsSync !== true}
                className={`app-row-action disabled:cursor-not-allowed ${
                  needsSync === true ? '' : 'opacity-45'
                } ${isSyncing ? 'opacity-50' : ''}`}
                title={needsSync === true
                  ? t('forkCard.update-branch')
                  : needsSync === false
                    ? t('forkCard.already-up-to-date')
                    : t('forkTimeline.check-pending')}
                aria-label={needsSync === true
                  ? t('forkCard.update-branch')
                  : needsSync === false
                    ? t('forkCard.already-up-to-date')
                    : t('forkTimeline.check-pending')}
              >
                {isSyncing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
              </Button>

              {/* View on GitHub link */}
              <a
                href={fork.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="app-row-action"
                title={t('forkCard.view-on-github')}
                aria-label={t('forkCard.view-on-github')}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkAsRead();
                }}
              >
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable Workflows section */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: isWorkflowsExpanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-3.5 sm:px-4 pb-3.5 pt-3 border-t border-subtle">
            {isLoadingWorkflows ? (
              <div className="flex items-center justify-center py-5">
                <Loader2 className="size-4 animate-spin text-tertiary" />
                <span className="ml-2 text-label text-secondary">
                  {t('forkCard.loading-workflows')}
                </span>
              </div>
            ) : workflows.length === 0 ? (
              <div className="py-4 text-center text-label text-tertiary">
                {t('forkCard.no-workflows')}
              </div>
            ) : (
              <div className="py-1.5">
                <div className="flex items-center gap-1.5 mb-2.5">
                  <Folder className="size-3.5 text-tertiary" />
                  <span className="text-label-sm font-medium text-secondary">
                    {t('forkCard.workflows')}
                  </span>
                  <span className="text-label-sm text-tertiary tabular-nums">
                    ({workflows.length})
                  </span>
                </div>

                <div className="ui-inset-surface max-h-72 overflow-y-auto divide-y divide-subtle">
                  {workflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      className="flex items-center justify-between px-3.5 py-2.5 hover:bg-fill-hover transition-[background-color] duration-micro ease-out-subtle hover:duration-instant"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <span className={`size-2 rounded-full shrink-0 ${
                          workflow.state === 'active' ? 'bg-status-green' :
                          workflow.state === 'disabled' ? 'bg-fill-pressed' :
                          'bg-status-amber'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-label truncate text-foreground">
                            {workflow.name}
                          </p>
                          <p className="text-label-sm text-tertiary font-mono truncate">
                            {workflow.path}
                          </p>
                        </div>
                      </div>
                      <Button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRunWorkflow(workflow.path, workflow.name);
                          onMarkAsRead();
                        }}
                        disabled={workflow.state === 'disabled' || isRunningWorkflow}
                        variant="secondary"
                        size="icon-sm"
                        className="ml-2 shrink-0"
                        aria-label={workflow.state === 'disabled'
                          ? (t('forkCard.workflow-disabled'))
                          : t('app:forkCard.run-workflow-named', { name: workflow.name })
                        }
                        title={workflow.state === 'disabled'
                          ? (t('forkCard.workflow-disabled'))
                          : (t('forkCard.run-workflow'))
                        }
                      >
                        {isRunningWorkflow ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

ForkCard.displayName = 'ForkCard';

export default ForkCard;
