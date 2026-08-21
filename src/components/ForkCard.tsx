import React, { memo, useCallback } from 'react';
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
  language: 'zh' | 'en';
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
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const sourceFullName = fork.source?.full_name || fork.parent?.full_name || '';

  return (
    <div
      onClick={onMarkAsRead}
      className={`bg-white dark:bg-[#121314] rounded-xl border transition-all duration-300 ease-in-out cursor-pointer ${
        isWorkflowsExpanded
          ? 'border-primary/20 shadow-lg ring-1 ring-ring/30'
          : 'border-border dark:border-border hover:shadow-md hover:border-black/10 dark:hover:border-white/10'
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
                  <span className="px-1.5 py-0.5 bg-muted dark:bg-accent/60 text-muted-foreground dark:text-muted-foreground text-xs font-medium rounded-md border border-border dark:border-border shrink-0">
                    {fork.language}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate mt-1">
                {fork.full_name}
              </p>
              {sourceFullName && (
                <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate mt-0.5 flex items-center gap-1">
                  <span>{t('派生自', 'Forked from')}</span>
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
                    ? formatDistanceToNow(new Date(fork.updated_at), { addSuffix: true })
                    : '-'}
                </span>
              </div>
              {fork.source?.updated_at && (
                <div className="flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5" />
                  <span>
                    {formatDistanceToNow(new Date(fork.source.updated_at), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-1 flex-shrink-0">
              {/* Workflows dropdown */}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWorkflows();
                  onMarkAsRead();
                }}
                className={`flex items-center space-x-0.5 px-1.5 py-1 rounded transition-all duration-200 whitespace-nowrap ${
                  isWorkflowsExpanded
                    ? 'bg-primary/15 text-primary dark:bg-primary/20 dark:text-primary-foreground'
                    : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                }`}
                title={isWorkflowsExpanded ? t('隐藏工作流', 'Hide Workflows') : t('显示工作流', 'Show Workflows')}
                aria-label={isWorkflowsExpanded ? t('隐藏工作流', 'Hide Workflows') : t('显示工作流', 'Show Workflows')}
                aria-expanded={isWorkflowsExpanded}
              >
                {isWorkflowsExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{isWorkflowsExpanded ? t('隐藏', 'Hide') : t('工作流', 'Workflows')}</span>
                {isWorkflowsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>

              {/* Sync Upstream button — enabled only when fork needs sync (out-of-date) */}
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onSyncUpstream();
                  onMarkAsRead();
                }}
                disabled={isSyncing || !needsSync}
                className={`h-7 w-7 p-1 rounded transition-colors disabled:cursor-not-allowed ${
                  needsSync
                    ? 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
                    : 'bg-muted text-gray-300 dark:text-muted-foreground cursor-not-allowed'
                } ${isSyncing ? 'opacity-50' : ''}`}
                title={needsSync
                  ? t('Update branch', 'Update branch')
                  : t('已是最新版本', 'Already up to date')}
                aria-label={t('Update branch', 'Update branch')}
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
                className="p-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
                title={t('在GitHub上查看', 'View on GitHub')}
                aria-label={t('在GitHub上查看', 'View on GitHub')}
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
                  {t('加载工作流中...', 'Loading workflows...')}
                </span>
              </div>
            ) : workflows.length === 0 ? (
              <div className="py-4 text-center text-sm text-muted-foreground dark:text-muted-foreground">
                {t('暂无工作流', 'No workflows')}
              </div>
            ) : (
              <div className="py-2">
                <div className="flex items-center space-x-2 mb-3">
                  <Folder className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                  <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                    {t('工作流', 'Workflows')}
                  </span>
                  <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                    ({workflows.length})
                  </span>
                </div>

                <div className="bg-accent/50 dark:bg-[#121314] rounded border border-border dark:border-border max-h-72 overflow-y-auto">
                  {workflows.map((workflow) => (
                    <div
                      key={workflow.id}
                      className="flex items-center justify-between px-4 py-3 hover:bg-muted dark:hover:bg-accent transition-colors border-b border-black/[0.04] dark:border-border last:border-b-0"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center space-x-2 min-w-0 flex-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          workflow.state === 'active' ? 'bg-green-500' :
                          workflow.state === 'disabled' ? 'bg-gray-400' :
                          'bg-yellow-500'
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
                        className="ml-2 h-8 w-8 p-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0"
                        aria-label={workflow.state === 'disabled'
                          ? (language === 'zh' ? '工作流已禁用' : 'Workflow disabled')
                          : `${language === 'zh' ? '运行工作流' : 'Run workflow'}: ${workflow.name}`
                        }
                        title={workflow.state === 'disabled'
                          ? (language === 'zh' ? '工作流已禁用' : 'Workflow disabled')
                          : (language === 'zh' ? '运行工作流' : 'Run workflow')
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
