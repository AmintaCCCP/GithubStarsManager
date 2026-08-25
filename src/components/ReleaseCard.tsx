import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, FolderOpen, Folder, BellOff, FileArchive, Code2, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { Release } from '../types';
import { formatDistanceToNow } from 'date-fns';
import MarkdownRenderer from './MarkdownRenderer';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { sendToRpcDownload } from '../services/rpcDownloadService';
import { AIService } from '../services/aiService';
import {
  effectiveReleaseTime,
  shouldShowAssetsUpdatedIndicator,
} from '../utils/releaseAssets';
import { Button } from './ui/button';

type SummaryState = {
  status: 'idle' | 'loading' | 'done' | 'error';
  content?: string;
  error?: string;
};

interface DownloadLink {
  name: string;
  url: string;
  size: number;
  downloadCount: number;
  isSourceCode?: boolean;
  assetId?: number;
}

interface ReleaseCardProps {
  release: Release;
  downloadLinks: DownloadLink[];
  isUnread: boolean;
  isAssetsExpanded: boolean;
  isReleaseNotesExpanded: boolean;
  isFullContent: boolean;
  truncatedBody: string;
  matchesActiveFilters: (linkName: string) => boolean;
  selectedFilters: string[];
  onToggleAssets: () => void;
  onToggleReleaseNotes: () => void;
  onToggleFullContent: (e: React.MouseEvent) => void;
  onUnsubscribe: () => void;
  onMarkAsRead: () => void;
  onMarkAssetAsRead: (assetId: number) => void;
  language: 'zh' | 'en';
  formatFileSize: (bytes: number) => string;
}

const ReleaseCard: React.FC<ReleaseCardProps> = memo(({
  release,
  downloadLinks,
  isUnread,
  isAssetsExpanded,
  isReleaseNotesExpanded,
  isFullContent,
  truncatedBody,
  matchesActiveFilters,
  selectedFilters,
  onToggleAssets,
  onToggleReleaseNotes,
  onToggleFullContent,
  onUnsubscribe,
  onMarkAsRead,
  onMarkAssetAsRead,
  language,
  formatFileSize,
}) => {
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const effectiveTime = effectiveReleaseTime(release);
  const showAssetsUpdatedIndicator = shouldShowAssetsUpdatedIndicator(release);

  // RPC download support — use refs to avoid stale closure in async handler
  const { rpcDownloadConfig, backendApiSecret, aiConfigs, activeAIConfig } = useAppStore();
  const activeConfig = aiConfigs.find((config) => config.id === activeAIConfig);

  // AI 总结的本地状态（展开态与结果均内聚在卡片内，不持久化）
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const [summary, setSummary] = useState<SummaryState>({ status: 'idle' });
  const { toast } = useDialog();
  // 管理进行中的 AI 请求，组件卸载或重新发起时取消，避免内存泄漏与无效网络开销
  const summaryAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      summaryAbortRef.current?.abort();
    };
  }, []);
  const downloadingRef = useRef<Record<string, boolean>>({});
  const downloadedRef = useRef<Record<string, boolean>>({});
  const [, forceUpdate] = useState(0);

  const handleRpcDownload = useCallback(async (link: DownloadLink) => {
    const key = link.url;
    if (downloadingRef.current[key] || downloadedRef.current[key]) return;

    downloadingRef.current = { ...downloadingRef.current, [key]: true };
    forceUpdate(n => n + 1);
    try {
      const result = await sendToRpcDownload(link.url, link.name, backendApiSecret || undefined);
      if (result.success) {
        downloadedRef.current = { ...downloadedRef.current, [key]: true };
        toast(t('已发送到远程下载器', 'Sent to remote downloader'), 'success');
      } else {
        toast(
          result.error === 'RPC service not running'
            ? t('远程下载服务未运行，请检查配置', 'Remote download service not running, please check config')
            : result.error || t('发送失败', 'Send failed'),
          'error'
        );
      }
    } catch {
      toast(t('远程下载服务未运行，请检查配置', 'Remote download service not running, please check config'), 'error');
    } finally {
      downloadingRef.current = { ...downloadingRef.current, [key]: false };
      forceUpdate(n => n + 1);
    }
  }, [backendApiSecret, toast, t]);

  // 判断是否有任何内容展开
  const isAnyExpanded = isAssetsExpanded || isReleaseNotesExpanded || isSummaryExpanded;

  const runSummaryAnalysis = useCallback(async () => {
    if (!activeConfig) {
      toast(
        language === 'zh' ? '请先在设置中配置 AI 服务。' : 'Please configure AI service in settings first.',
        'error'
      );
      return;
    }

    // 取消上一次未完成的请求
    summaryAbortRef.current?.abort();
    const controller = new AbortController();
    summaryAbortRef.current = controller;

    const config = activeConfig;
    setSummary({ status: 'loading' });
    try {
      const aiService = new AIService(config, language);
      const content = await aiService.analyzeReleaseSummary(
        release.body || '',
        {
          repoName: release.repository.full_name,
          tagName: release.tag_name,
          releaseName: release.name && release.name !== release.tag_name ? release.name : undefined,
        },
        controller.signal
      );
      setSummary({ status: 'done', content });
      setIsSummaryExpanded(true);
    } catch (error) {
      // 主动取消（卸载/重新发起）时静默处理，不更新状态、不弹错误
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setSummary({ status: 'error', error: message });
      setIsSummaryExpanded(true);
      toast(
        language === 'zh' ? `总结生成失败：${message}` : `Summary failed: ${message}`,
        'error'
      );
    } finally {
      if (summaryAbortRef.current === controller) {
        summaryAbortRef.current = null;
      }
    }
  }, [activeConfig, language, release, toast]);

  const handleToggleSummary = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();

    // 已展开时：一律收起（出错态也先收起，再次点击已收起的错误态才会重试）
    if (isSummaryExpanded) {
      setIsSummaryExpanded(false);
      return;
    }

    // 已有结论且未展开 → 直接展开（不重复分析）
    if (summary.status === 'done' && summary.content) {
      setIsSummaryExpanded(true);
      return;
    }

    // 未分析或上次失败 → 触发 AI 分析（按钮转圈，完成后自动展开）
    await runSummaryAnalysis();
  }, [isSummaryExpanded, summary, runSummaryAnalysis]);

  return (
    <div
      onClick={onMarkAsRead}
      className={`release-card ui-card transition-all duration-200 ease-in-out cursor-pointer ${
        isAnyExpanded ? 'is-expanded' : ''
      }`}
    >
      {/* 头部区域 - 仅显示元信息，不可点击展开 */}
      <div className="p-3 sm:p-4">
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex items-center min-w-0 flex-1">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-primary rounded-full flex-shrink-0 animate-pulse mr-2"></div>
            )}
            <div className="linear-platform-icon flex items-center justify-center w-8 h-8 flex-shrink-0">
              <GitBranch className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1 ml-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <h4 className="font-semibold text-foreground dark:text-foreground text-sm truncate">
                    {release.repository.name}
                  </h4>
                  <span className="linear-card-tag px-1.5 py-0.5 text-xs font-medium shrink-0">
                    {release.tag_name}
                  </span>
                  {release.name && release.name !== release.tag_name && (
                    <span className="text-xs text-muted-foreground dark:text-muted-foreground truncate max-w-[200px]">
                      {release.name}
                    </span>
                  )}
              </div>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground/70 truncate mt-1">
                {release.repository.full_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0 self-stretch">
            <div className="hidden md:flex min-w-[140px] flex-col justify-center gap-2 text-xs text-muted-foreground dark:text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDistanceToNow(new Date(effectiveTime), { addSuffix: true })}</span>
                {showAssetsUpdatedIndicator && (
                  <span className="text-[10px] px-1 py-px rounded bg-primary/10 text-primary font-medium">
                    {t('资产已更新', 'Assets updated')}
                  </span>
                )}
              </div>
              {downloadLinks.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {selectedFilters.length > 0
                      ? `${downloadLinks.filter(link => matchesActiveFilters(link.name)).length}/${downloadLinks.length}`
                      : downloadLinks.length}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center space-x-1 flex-shrink-0">
            {downloadLinks.length > 0 && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAssets();
                }}
                variant={isAssetsExpanded ? 'secondary' : 'ghost'}
                className="h-8 gap-1 px-2 text-xs whitespace-nowrap"
                title={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-label={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-expanded={isAssetsExpanded}
              >
                {isAssetsExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{isAssetsExpanded ? t('隐藏', 'Hide') : t('资产', 'Assets')}</span>
                {isAssetsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}

            {release.body && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReleaseNotes();
                }}
                variant={isReleaseNotesExpanded ? 'secondary' : 'ghost'}
                className="h-8 gap-1 px-2 text-xs whitespace-nowrap"
                title={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-label={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-expanded={isReleaseNotesExpanded}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{isReleaseNotesExpanded ? t('隐藏', 'Hide') : t('日志', 'Notes')}</span>
                {isReleaseNotesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}

            {release.body?.trim() && (
              <Button
                onClick={handleToggleSummary}
                disabled={summary.status === 'loading'}
                variant={isSummaryExpanded ? 'secondary' : 'ghost'}
                className="h-8 gap-1 px-2 text-xs whitespace-nowrap disabled:opacity-70"
                title={isSummaryExpanded ? t('隐藏 AI 总结', 'Hide AI Summary') : (summary.status === 'error' ? t('重试 AI 总结', 'Retry AI summary') : t('AI 总结本次更新', 'AI Summary of this update'))}
                aria-label={isSummaryExpanded ? t('隐藏 AI 总结', 'Hide AI Summary') : (summary.status === 'error' ? t('重试 AI 总结', 'Retry AI summary') : t('AI 总结本次更新', 'AI Summary of this update'))}
                aria-expanded={isSummaryExpanded}
              >
                {summary.status === 'loading' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span className="text-xs font-medium">{t('总结', 'Summary')}</span>
                {summary.status !== 'loading' && (isSummaryExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </Button>
            )}

            <Button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="h-auto p-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
              title={t('取消订阅 Release', 'Unsubscribe from releases')}
              aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
            >
              <BellOff className="w-3.5 h-3.5" />
            </Button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-auto p-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
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

      {/* 可展开内容区域 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: (isAssetsExpanded || isReleaseNotesExpanded || isSummaryExpanded) ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden min-h-0">
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-3 sm:pt-4 border-t border-border dark:border-border">
          {isAssetsExpanded && downloadLinks.length > 0 && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-3">
                <FileArchive className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                  {t('下载文件', 'Download Files')}
                </span>
                <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                  ({downloadLinks.length})
                </span>
              </div>

              <div className="ui-inset-surface max-h-72 overflow-hidden overflow-y-auto">
                {downloadLinks.map((link, index) => {
                  const isRpcEnabled = rpcDownloadConfig.enabled;
                  const isDownloading = downloadingRef.current[link.url];
                  const isDownloaded = downloadedRef.current[link.url];
                  const isAssetUpdated = link.assetId !== undefined
                    && release.updated_asset_ids?.includes(link.assetId) === true;

                  if (isRpcEnabled) {
                    return (
                      <Button
                        key={index}
                        variant="ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (link.assetId !== undefined) onMarkAssetAsRead(link.assetId);
                          handleRpcDownload(link);
                        }}
                        disabled={isDownloading || isDownloaded}
                        className={`h-auto flex items-center justify-between rounded-none px-4 py-3 w-full text-left hover:bg-muted dark:hover:bg-accent transition-colors border-b border-border last:border-b-0 disabled:opacity-60 ${
                          link.isSourceCode ? 'bg-accent/60' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                          {isDownloaded ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
                          ) : isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />
                          ) : link.isSourceCode ? (
                            <Code2 className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground/70 flex-shrink-0" />
                          )}
                          <span className={`text-sm truncate ${link.isSourceCode ? 'text-muted-foreground dark:text-muted-foreground font-medium' : 'text-foreground dark:text-muted-foreground'}`}>
                            {link.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-muted-foreground dark:text-muted-foreground flex-shrink-0">
                          {isAssetUpdated && (
                            <span className="text-[10px] px-1 py-px rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                              {t('资产已更新', 'Asset updated')}
                            </span>
                          )}
                          {link.size > 0 && (
                            <span>{formatFileSize(link.size)}</span>
                          )}
                          {link.downloadCount > 0 && (
                            <span>{link.downloadCount.toLocaleString()} {t('下载', 'downloads')}</span>
                          )}
                        </div>
                      </Button>
                    );
                  }

                  return (
                    <a
                      key={index}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-between px-4 py-3 hover:bg-muted dark:hover:bg-accent transition-colors border-b border-border last:border-b-0 ${
                        link.isSourceCode ? 'bg-accent/60' : ''
                      }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (link.assetId !== undefined) onMarkAssetAsRead(link.assetId);
                      }}
                    >
                      <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                        {link.isSourceCode ? (
                          <Code2 className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />
                        ) : (
                          <Download className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground/70 flex-shrink-0" />
                        )}
                        <span className={`text-sm truncate ${link.isSourceCode ? 'text-muted-foreground dark:text-muted-foreground font-medium' : 'text-foreground dark:text-muted-foreground'}`}>
                          {link.name}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-muted-foreground dark:text-muted-foreground flex-shrink-0">
                        {isAssetUpdated && (
                          <span className="text-[10px] px-1 py-px rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                            {t('资产已更新', 'Asset updated')}
                          </span>
                        )}
                        {link.size > 0 && (
                          <span>{formatFileSize(link.size)}</span>
                        )}
                        {link.downloadCount > 0 && (
                          <span>{link.downloadCount.toLocaleString()} {t('下载', 'downloads')}</span>
                        )}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {isReleaseNotesExpanded && release.body && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                  {t('Release 说明', 'Release Notes')}
                </span>
              </div>

              <div className="rounded-md border border-border bg-background px-5 pt-5 pb-4 dark:border-border dark:bg-muted/30">
                <MarkdownRenderer
                  content={isFullContent ? (release.body || '') : truncatedBody}
                  shouldRender={true}
                  fontSize="small"
                />

                {(release.body || '').length > truncatedBody.length && (
                  <div className="mt-3 flex items-center justify-center space-x-2">
                    <Button
                      variant="default"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFullContent(e);
                      }}
                      className="h-auto flex items-center justify-center space-x-1 px-3 py-1.5 rounded hover:bg-primary/90 active:bg-primary/80 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 dark:active:bg-primary/80 transition-all duration-200 text-xs font-medium min-w-[120px]"
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>{isFullContent ? t('收起', 'Collapse') : t('查看完整', 'View Full')}</span>
                    </Button>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-muted text-foreground rounded hover:bg-accent hover:text-accent-foreground active:bg-accent/80 dark:bg-muted/40 dark:text-foreground dark:hover:bg-accent dark:hover:text-accent-foreground dark:active:bg-accent/80 transition-all duration-200 text-xs font-medium whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAsRead();
                      }}
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>{t('GitHub', 'GitHub')}</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
          {isSummaryExpanded && release.body?.trim() && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                  {t('AI 总结', 'AI Summary')}
                </span>
              </div>

              <div className="relative">
                {summary.status === 'loading' && (
                  <div className="flex items-center justify-center space-x-2 py-6 text-xs text-muted-foreground dark:text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('正在分析更新内容…', 'Analyzing update…')}</span>
                  </div>
                )}
                {summary.status === 'done' && summary.content && (
                  <MarkdownRenderer content={summary.content} shouldRender={true} breaks={true} />
                )}
                {summary.status === 'error' && (
                  <div className="py-3 text-xs text-destructive">
                    {t('总结生成失败，请重试。', 'Failed to generate summary. Please try again.')}
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
});

ReleaseCard.displayName = 'ReleaseCard';

export default ReleaseCard;
