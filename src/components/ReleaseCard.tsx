import React, { memo, useCallback, useRef, useState, useEffect } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, FolderOpen, Folder, BellOff, FileArchive, Code2, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { Release } from '../types';
import { formatDistanceToNow } from 'date-fns';
import MarkdownRenderer from './MarkdownRenderer';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { sendToRpcDownload } from '../services/rpcDownloadService';
import { AIService } from '../services/aiService';

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
  language,
  formatFileSize,
}) => {
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

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
      className={`bg-white dark:bg-[#121314] rounded-xl border transition-all duration-300 ease-in-out cursor-pointer ${
        isAnyExpanded
          ? 'border-brand-indigo/20 shadow-lg ring-1 ring-brand-indigo/30'
          : 'border-black/[0.06] dark:border-white/[0.04] hover:shadow-md hover:border-black/10 dark:hover:border-white/10'
      }`}
    >
      {/* 头部区域 - 仅显示元信息，不可点击展开 */}
      <div className="p-3 sm:p-4">
        <div className="flex items-stretch justify-between gap-3">
          <div className="flex items-center min-w-0 flex-1">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-brand-violet rounded-full flex-shrink-0 animate-pulse mr-2"></div>
            )}
            <div className="flex items-center justify-center w-8 h-8 bg-gray-100 dark:bg-white/[0.04] rounded-lg flex-shrink-0 border border-transparent dark:border-white/[0.04]">
              <GitBranch className="w-4 h-4 text-gray-500 dark:text-text-tertiary" />
            </div>
            <div className="min-w-0 flex-1 ml-3">
              <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <h4 className="font-semibold text-gray-900 dark:text-text-primary text-sm truncate">
                    {release.repository.name}
                  </h4>
                  <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-text-secondary text-xs font-medium rounded-md border border-black/[0.06] dark:border-white/[0.04] shrink-0">
                    {release.tag_name}
                  </span>
                  {release.name && release.name !== release.tag_name && (
                    <span className="text-xs text-gray-500 dark:text-text-tertiary truncate max-w-[200px]">
                      {release.name}
                    </span>
                  )}
              </div>
              <p className="text-xs text-gray-500 dark:text-text-quaternary truncate mt-1">
                {release.repository.full_name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-shrink-0 self-stretch">
            <div className="hidden md:flex min-w-[140px] flex-col justify-center gap-2 text-xs text-gray-500 dark:text-text-tertiary">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" />
                <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
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
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAssets();
                }}
                className={`flex items-center space-x-0.5 px-1.5 py-1 rounded transition-all duration-200 whitespace-nowrap ${
                  isAssetsExpanded
                    ? 'bg-brand-indigo/15 text-brand-indigo dark:bg-brand-indigo/20 dark:text-white'
                    : 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/[0.08]'
                }`}
                title={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-label={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-expanded={isAssetsExpanded}
              >
                {isAssetsExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{isAssetsExpanded ? t('隐藏', 'Hide') : t('资产', 'Assets')}</span>
                {isAssetsExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}

            {release.body && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReleaseNotes();
                }}
                className={`flex items-center space-x-0.5 px-1.5 py-1 rounded transition-all duration-200 whitespace-nowrap ${
                  isReleaseNotesExpanded
                    ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-text-secondary '
                    : 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/[0.08]'
                }`}
                title={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-label={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-expanded={isReleaseNotesExpanded}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{isReleaseNotesExpanded ? t('隐藏', 'Hide') : t('日志', 'Notes')}</span>
                {isReleaseNotesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}

            {release.body && (
              <button
                onClick={handleToggleSummary}
                disabled={summary.status === 'loading'}
                className={`flex items-center space-x-0.5 px-1.5 py-1 rounded transition-all duration-200 whitespace-nowrap disabled:opacity-70 ${
                  isSummaryExpanded
                    ? 'bg-gray-100 dark:bg-white/[0.08] text-gray-700 dark:text-text-secondary'
                    : 'bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-white/[0.08]'
                }`}
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
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="p-1 rounded bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
              title={t('取消订阅 Release', 'Unsubscribe from releases')}
              aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
            >
              <BellOff className="w-3.5 h-3.5" />
            </button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded bg-light-surface text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
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
          <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-3 sm:pt-4 border-t border-black/[0.06] dark:border-white/[0.04]">
          {isAssetsExpanded && downloadLinks.length > 0 && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-3">
                <FileArchive className="w-3.5 h-3.5 text-gray-700 dark:text-text-secondary" />
                <span className="text-xs font-medium text-gray-900 dark:text-text-secondary">
                  {t('下载文件', 'Download Files')}
                </span>
                <span className="text-xs text-gray-500 dark:text-text-tertiary">
                  ({downloadLinks.length})
                </span>
              </div>

              <div className="bg-gray-50 dark:bg-[#121314] rounded border border-black/[0.06] dark:border-white/[0.04] max-h-72 overflow-y-auto">
                {downloadLinks.map((link, index) => {
                  const isRpcEnabled = rpcDownloadConfig.enabled;
                  const isDownloading = downloadingRef.current[link.url];
                  const isDownloaded = downloadedRef.current[link.url];

                  if (isRpcEnabled) {
                    return (
                      <button
                        key={index}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRpcDownload(link);
                        }}
                        disabled={isDownloading || isDownloaded}
                        className={`flex items-center justify-between px-4 py-3 w-full text-left hover:bg-light-surface dark:hover:bg-white/[0.06] transition-colors border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 disabled:opacity-60 ${
                          link.isSourceCode ? 'bg-gray-100 dark:bg-white/[0.04]' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                          {isDownloaded ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          ) : isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin flex-shrink-0" />
                          ) : link.isSourceCode ? (
                            <Code2 className="w-3.5 h-3.5 text-gray-700 dark:text-text-secondary flex-shrink-0" />
                          ) : (
                            <Download className="w-3.5 h-3.5 text-gray-400 dark:text-text-quaternary flex-shrink-0" />
                          )}
                          <span className={`text-sm truncate ${link.isSourceCode ? 'text-gray-700 dark:text-text-secondary font-medium' : 'text-gray-900 dark:text-text-secondary'}`}>
                            {link.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-text-tertiary flex-shrink-0">
                          {link.size > 0 && (
                            <span>{formatFileSize(link.size)}</span>
                          )}
                          {link.downloadCount > 0 && (
                            <span>{link.downloadCount.toLocaleString()} {t('下载', 'downloads')}</span>
                          )}
                        </div>
                      </button>
                    );
                  }

                  return (
                    <a
                      key={index}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-between px-4 py-3 hover:bg-light-surface dark:hover:bg-white/[0.06] transition-colors border-b border-black/[0.04] dark:border-white/[0.04] last:border-b-0 ${
                        link.isSourceCode ? 'bg-gray-100 dark:bg-white/[0.04]' : ''
                      }`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                        {link.isSourceCode ? (
                          <Code2 className="w-3.5 h-3.5 text-gray-700 dark:text-text-secondary flex-shrink-0" />
                        ) : (
                          <Download className="w-3.5 h-3.5 text-gray-400 dark:text-text-quaternary flex-shrink-0" />
                        )}
                        <span className={`text-sm truncate ${link.isSourceCode ? 'text-gray-700 dark:text-text-secondary font-medium' : 'text-gray-900 dark:text-text-secondary'}`}>
                          {link.name}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-text-tertiary flex-shrink-0">
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
                <BookOpen className="w-3.5 h-3.5 text-gray-700 dark:text-text-secondary" />
                <span className="text-xs font-medium text-gray-900 dark:text-text-secondary">
                  {t('Release 说明', 'Release Notes')}
                </span>
              </div>

              <div className="relative">
                <MarkdownRenderer
                  content={isFullContent ? (release.body || '') : truncatedBody}
                  shouldRender={true}
                />

                {(release.body || '').length > truncatedBody.length && (
                  <div className="mt-3 flex items-center justify-center space-x-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFullContent(e);
                      }}
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-brand-indigo text-white rounded hover:bg-gray-100 dark:bg-white/[0.04] active:bg-gray-100 dark:bg-white/[0.04] transition-all duration-200 text-xs font-medium min-w-[120px]"
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>{isFullContent ? t('收起', 'Collapse') : t('查看完整', 'View Full')}</span>
                    </button>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-light-surface text-gray-900 dark:bg-white/[0.04] dark:text-text-secondary rounded hover:bg-gray-200 dark:hover:bg-white/[0.08] active:bg-gray-300 dark:active:bg-gray-500 transition-all duration-200 text-xs font-medium whitespace-nowrap"
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
          {isSummaryExpanded && release.body && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-gray-700 dark:text-text-secondary" />
                <span className="text-xs font-medium text-gray-900 dark:text-text-secondary">
                  {t('AI 总结', 'AI Summary')}
                </span>
              </div>

              <div className="relative">
                {summary.status === 'loading' && (
                  <div className="flex items-center justify-center space-x-2 py-6 text-xs text-gray-500 dark:text-text-tertiary">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('正在分析更新内容…', 'Analyzing update…')}</span>
                  </div>
                )}
                {summary.status === 'done' && summary.content && (
                  <MarkdownRenderer content={summary.content} shouldRender={true} />
                )}
                {summary.status === 'error' && (
                  <div className="py-3 text-xs text-red-500 dark:text-red-400">
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
