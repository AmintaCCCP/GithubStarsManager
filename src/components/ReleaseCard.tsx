import { getDateFnsLocale, getIntlLocale } from '../i18n/format';
import { useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
import React, { memo, useCallback, useMemo, useState, useEffect } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, FolderOpen, Folder, BellOff, FileArchive, Code2, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import { Release } from '../types';
import { formatDistanceToNow } from 'date-fns';
import MarkdownRenderer from './MarkdownRenderer';
import AssetLeadingIcon from './AssetLeadingIcon';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { computeRpcDownloadKey, useReleaseArtifactActions } from '../hooks/useReleaseArtifactActions';
import {
  effectiveReleaseTime,
  shouldShowAssetsUpdatedIndicator,
} from '../utils/releaseAssets';
import { Button } from './ui/button';
import { ReleasePluginRecommendations } from './ReleasePluginRecommendations';

interface DownloadLink {
  name: string;
  url: string;
  size: number;
  downloadCount: number;
  isSourceCode?: boolean;
  assetId?: number;
  updatedAt?: string;
  contentType?: string;
}

/** 资产相对时间：updated_at 非法时不渲染，避免 date-fns 对 Invalid Date 抛错；中文界面用 zhCN。 */
const AssetUpdatedTime = ({ updatedAt, language }: { updatedAt?: string; language: AppLanguage }) => {
  if (!updatedAt) return null;
  const time = new Date(updatedAt).getTime();
  if (Number.isNaN(time)) return null;
  return (
    <span title={new Date(time).toLocaleString()}>
      {formatDistanceToNow(new Date(time), {
        addSuffix: true,
        locale: getDateFnsLocale(language),
      })}
    </span>
  );
};

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
  language: AppLanguage;
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
  const t = useT('releases');

  const effectiveTime = effectiveReleaseTime(release);
  const showAssetsUpdatedIndicator = shouldShowAssetsUpdatedIndicator(release);

  // RPC 发送与 AI 总结动作由共享 hook 承担（useRepositoryReleaseSheet 同源委托）
  const { rpcDownloadConfig } = useAppStore(useShallow((state) => ({
    rpcDownloadConfig: state.rpcDownloadConfig,
  })));
  const { summaries, rpcDownloadStates, sendRpcDownload, generateSummary } = useReleaseArtifactActions();
  // AI 总结状态内聚在 hook（展开态留在卡片内，不持久化）；
  // 卡片卸载时的请求取消由 hook 的 unmount 副作用承担（卡片卸载即 hook 卸载）。
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(false);
  const summary = useMemo(() => summaries[release.id] ?? { status: 'idle' as const }, [summaries, release.id]);

  // 完成或失败后自动展开（原 runSummaryAnalysis 成功/失败分支的 setIsSummaryExpanded(true)）
  useEffect(() => {
    if (summary.status === 'done' || summary.status === 'error') {
      setIsSummaryExpanded(true);
    }
  }, [summary.status]);

  // 判断是否有任何内容展开
  const isAnyExpanded = isAssetsExpanded || isReleaseNotesExpanded || isSummaryExpanded;

  const handleRpcDownload = useCallback(async (link: DownloadLink) => {
    await sendRpcDownload(link);
  }, [sendRpcDownload]);

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
    await generateSummary(release);
  }, [isSummaryExpanded, summary, generateSummary, release]);

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

          {/* 元信息列不设固定上限：出现“资产已更新”徽标时整行向左扩展（min-w 保证
              无徽标时仍维持 140px 栏宽对齐），否则 140px 内放不下徽标会把时间和
              徽标文字都挤到换行；按钮区仍固定 344px 靠右，位置不受影响。 */}
          <div className="flex items-center gap-3 flex-shrink-0 self-center md:justify-end">
            <div className="hidden md:flex md:min-w-[140px] shrink-0 flex-col justify-center gap-1.5 text-xs text-muted-foreground dark:text-muted-foreground">
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <Calendar className="w-3.5 h-3.5" />
                <span>
                  {formatDistanceToNow(new Date(effectiveTime), {
                    addSuffix: true,
                    locale: getDateFnsLocale(language),
                  })}
                </span>
                {showAssetsUpdatedIndicator && (
                  <span className="text-xs px-1 py-px rounded bg-primary/10 text-primary font-medium">
                    {t('releaseCard.assets-updated')}
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
            {/* 固定宽度需容纳英文五控件（Assets/Notes/Summary+2图标，约340px），否则换行按钮会溢出头部 */}
            <div className="flex items-center justify-end gap-1 flex-shrink-0 md:w-[344px] md:min-w-[344px]">
            {downloadLinks.length > 0 && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAssets();
                }}
                variant={isAssetsExpanded ? 'secondary' : 'ghost'}
                className="h-8 gap-1 px-2 text-xs whitespace-nowrap"
                title={isAssetsExpanded ? t('releaseCard.hide-assets') : t('releaseCard.show-assets')}
                aria-label={isAssetsExpanded ? t('releaseCard.hide-assets') : t('releaseCard.show-assets')}
                aria-expanded={isAssetsExpanded}
              >
                {isAssetsExpanded ? <FolderOpen className="w-3.5 h-3.5" /> : <Folder className="w-3.5 h-3.5" />}
                <span className="text-xs font-medium">{isAssetsExpanded ? t('releaseCard.hide') : t('releaseCard.assets')}</span>
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
                title={isReleaseNotesExpanded ? t('releaseCard.hide-changelog') : t('releaseCard.show-changelog')}
                aria-label={isReleaseNotesExpanded ? t('releaseCard.hide-changelog') : t('releaseCard.show-changelog')}
                aria-expanded={isReleaseNotesExpanded}
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span className="text-xs font-medium">{isReleaseNotesExpanded ? t('releaseCard.hide') : t('releaseCard.notes')}</span>
                {isReleaseNotesExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </Button>
            )}

            {release.body?.trim() && (
              <Button
                onClick={handleToggleSummary}
                disabled={summary.status === 'loading'}
                variant={isSummaryExpanded ? 'secondary' : 'ghost'}
                className="h-8 gap-1 px-2 text-xs whitespace-nowrap disabled:opacity-70"
                title={isSummaryExpanded ? t('releaseCard.hide-ai-summary') : (summary.status === 'error' ? t('releaseCard.retry-ai-summary') : t('releaseCard.ai-summary-of-this-update'))}
                aria-label={isSummaryExpanded ? t('releaseCard.hide-ai-summary') : (summary.status === 'error' ? t('releaseCard.retry-ai-summary') : t('releaseCard.ai-summary-of-this-update'))}
                aria-expanded={isSummaryExpanded}
              >
                {summary.status === 'loading' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span className="text-xs font-medium">{t('releaseCard.summary')}</span>
                {summary.status !== 'loading' && (isSummaryExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </Button>
            )}

            <Button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="h-auto p-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
              title={t('releaseCard.unsubscribe-from-releases')}
              aria-label={t('releaseCard.unsubscribe-from-releases')}
            >
              <BellOff className="w-3.5 h-3.5" />
            </Button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-auto p-1 rounded bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
              title={t('releaseCard.view-on-github')}
              aria-label={t('releaseCard.view-on-github')}
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
              <ReleasePluginRecommendations release={release} language={language} />
              <div className="flex items-center space-x-2 mb-3">
                <FileArchive className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground" />
                <span className="text-xs font-medium text-foreground dark:text-muted-foreground">
                  {t('releaseCard.download-files')}
                </span>
                <span className="text-xs text-muted-foreground dark:text-muted-foreground">
                  ({downloadLinks.length})
                </span>
              </div>

              <div className="ui-inset-surface max-h-72 overflow-hidden overflow-y-auto">
                {downloadLinks.map((link, index) => {
                  const isRpcEnabled = rpcDownloadConfig.enabled;
                  // 与 sendRpcDownload 使用相同的版本化 key
                  const rpcKey = computeRpcDownloadKey(link);
                  const isDownloading = rpcDownloadStates[rpcKey] === 'sending';
                  const isDownloaded = rpcDownloadStates[rpcKey] === 'sent';
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
                        disabled={isDownloading}
                        className={`h-auto flex items-center justify-between rounded-none px-4 py-3 w-full text-left hover:bg-muted dark:hover:bg-accent transition-colors border-b border-border last:border-b-0 disabled:opacity-60 ${
                          link.isSourceCode ? 'bg-accent/60' : ''
                        }`}
                      >
                        <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                          {isDownloading ? (
                            <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin flex-shrink-0" />
                          ) : isDownloaded ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
                          ) : link.isSourceCode ? (
                            <Code2 className="w-3.5 h-3.5 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />
                          ) : (
                            <AssetLeadingIcon name={link.name} contentType={link.contentType} />
                          )}
                          <span className={`text-sm truncate ${link.isSourceCode ? 'text-muted-foreground dark:text-muted-foreground font-medium' : 'text-foreground dark:text-muted-foreground'}`}>
                            {link.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 text-xs text-muted-foreground dark:text-muted-foreground flex-shrink-0">
                          {isAssetUpdated && (
                            <span className="text-xs px-1 py-px rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                              {t('releaseCard.asset-updated')}
                            </span>
                          )}
                          <AssetUpdatedTime updatedAt={link.updatedAt} language={language} />
                          {link.size > 0 && (
                            <span>{formatFileSize(link.size)}</span>
                          )}
                          {link.downloadCount > 0 && (
                            <span>{t('releaseCard.download-count', { count: link.downloadCount.toLocaleString(getIntlLocale(language)) })}</span>
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
                          <AssetLeadingIcon name={link.name} contentType={link.contentType} />
                        )}
                        <span className={`text-sm truncate ${link.isSourceCode ? 'text-muted-foreground dark:text-muted-foreground font-medium' : 'text-foreground dark:text-muted-foreground'}`}>
                          {link.name}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 text-xs text-muted-foreground dark:text-muted-foreground flex-shrink-0">
                        {isAssetUpdated && (
                          <span className="text-xs px-1 py-px rounded bg-primary/10 text-primary font-medium whitespace-nowrap">
                            {t('releaseCard.asset-updated')}
                          </span>
                        )}
                        <AssetUpdatedTime updatedAt={link.updatedAt} language={language} />
                        {link.size > 0 && (
                          <span>{formatFileSize(link.size)}</span>
                        )}
                        {link.downloadCount > 0 && (
                          <span>{t('releaseCard.download-count', { count: link.downloadCount.toLocaleString(getIntlLocale(language)) })}</span>
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
                  {t('releaseCard.release-notes')}
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
                      <span>{isFullContent ? t('releaseCard.collapse') : t('releaseCard.view-full')}</span>
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
                      <span>{t('releaseCard.github')}</span>
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
                  {t('releaseCard.ai-summary')}
                </span>
              </div>

              <div className="relative">
                {summary.status === 'loading' && (
                  <div className="flex items-center justify-center space-x-2 py-6 text-xs text-muted-foreground dark:text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('releaseCard.analyzing-update')}</span>
                  </div>
                )}
                {summary.status === 'done' && summary.content && (
                  <MarkdownRenderer content={summary.content} shouldRender={true} breaks={true} />
                )}
                {summary.status === 'error' && (
                  <div className="py-3 text-xs text-destructive">
                    {t('releaseCard.failed-to-generate-summary-please-try-again')}
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
