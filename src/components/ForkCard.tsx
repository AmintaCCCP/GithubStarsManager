



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
  needsSync: boolean; // true = out-of-date, can sync; false = already up-to-date
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
      className={`ui-card cursor-pointer ${
        isWorkflowsExpanded ? 'border-primary/20 ring-1 ring-ring/30' : ''
      }`}
    >
      {/* Header */}
      <div className="p-3 sm:p-4">
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex items-center min-w-0 flex-1">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0 animate-pulse mr-2"></div>
            )}
            <div className="flex items-center justify-center w-8 h-8 bg-muted dark:bg-muted/40 rounded-lg flex-shrink-0 border border-transparent dark:border-border">
              <GitFork className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 ml-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                <h4 className="font-semibold text-foreground dark:text-foreground text-sm truncate">
                  {fork.name}
                </h4>
                {fork.language && (
                  <span className="px-1.5 py-0.5 bg-muted text-muted-foreground text-xs font-medium rounded-md border border-border shrink-0">
                    {fork.language}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate mt-1">
                {fork.full_name}
              </p>
              {sourceFullName && (
                <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate mt-0.5 flex items-center gap-1">
                  <span>{t('forkCard.forked-from')}</span>
                  {fork.parent?.html_url || fork.source?.html_url ? (
                    <a
                      href={fork.parent?.html_url || fork.source?.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline truncate"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAsRead();
                      }}
                    >
                      {sourceFullName}
                    </a>
                  ) : (
                    <span className="text-primary truncate">{sourceFullName}</span>
                  )}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0 self-stretch">
            <div className="hidden md:flex min-w-[140px] flex-col justify-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {fork.updated_at
                    ? formatDistanceToNow(new Date(fork.updated_at), { addSuffix: true, locale: getDateFnsLocale(language) })
                    : '-'}
                </span>
              </div>
              {fork.source?.updated_at && (
                <div className="flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5" />
                  <span>
                    {formatDistanceToNow(new Date(fork.source.updated_at), { addSuffix: true, locale: getDateFnsLocale(language) })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-1 flex-shrink-0">
              {/* Workflows dropdown */}
              <Button
                variant={isWorkflowsExpanded ? 'secondary' : 'ghost'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWorkflows();
                  onMarkAsRead();
                }}
                className="h-8 shrink-0 gap-1 whitespace-nowrap px-2 text-xs"
                title={isWorkflowsExpanded ? t('forkCard.hide-workflows') : t('forkCard.show-workflows')}
                aria-label={isWorkflowsExpanded ? t('forkCard.hide-workflows') : t('forkCard.show-workflows')}
                aria-expanded={isWorkflowsExpanded}
              >
                {isWorkflowsExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{isWorkflowsExpanded ? t('forkCard.hide') : t('forkCard.workflows')}</span>
                {isWorkflowsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>

              {/* Sync Upstream button — enabled only when fork needs sync (out-of-date) */}
              <Button
                variant="ghost"
                onClick={(e) => {
                  e.stopPropagation();
                  onSyncUpstream();
                  onMarkAsRead();
                }}
                disabled={isSyncing || !needsSync}
                className={`h-7 w-7 p-1 rounded transition-colors disabled:cursor-not-allowed ${
                  needsSync
                    ? 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                    : 'bg-transparent text-muted-foreground/50 dark:text-muted-foreground/50 cursor-not-allowed'
                } ${isSyncing ? 'opacity-50' : ''}`}
                title={needsSync
                  ? t('forkCard.update-branch')
                  : t('forkCard.already-up-to-date')}
                aria-label={needsSync
                  ? t('forkCard.update-branch')
                  : t('forkCard.already-up-to-date')}
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
              </Button>

              {/* View on GitHub link */}
              <a
                href={fork.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1 rounded bg-muted text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                title={t('forkCard.view-on-github')}
                aria-label={t('forkCard.view-on-github')}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkAsRead();
                }}
              >
                <ExternalLink className="w-3.5 h-3.5" />
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
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-3 sm:pt-4 border-t border-border dark:border-border">
            {isLoadingWorkflows ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground dark:text-muted-foreground" />
                <span className="ml-2 text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('forkCard.loading-workflows')}
                </span>
              </div>
            ) : workflows.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground dark:text-muted-foreground">
                {t('forkCard.no-workflows')}
              </div>
            ) : (
              <div className="py-2">
                <div className="flex items-center space-x-2 mb-3">
                  <Folder className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                    {t('forkCard.workflows')}
                  </span>
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                    ({workflows.length})
                  </span>
                </div>

                <div className="bg-accent/50 rounded border border-border dark:border-border max-h-72 overflow-y-auto">
                  {workflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted dark:hover:bg-accent transition-colors border-b border-border/60 dark:border-border last:border-b-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center space-x-2 min-w-0 flex-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          workflow.state === 'active' ? 'bg-success' :
                          workflow.state === 'disabled' ? 'bg-muted-foreground/40' :
                          'bg-warning'
                        }`} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm truncate text-foreground dark:text-muted-foreground">
                            {workflow.name}
                          </p>
                          <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate">
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
                        className="ml-2 h-8 w-8 shrink-0 p-0"
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
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
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
