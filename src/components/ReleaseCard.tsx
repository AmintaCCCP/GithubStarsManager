import React, { memo, useCallback } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, FolderOpen, Folder, BellOff, FileArchive, Code2 } from 'lucide-react';
import { Release } from '../types';
import { formatDistanceToNow } from 'date-fns';
import MarkdownRenderer from './MarkdownRenderer';

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

  // 判断是否有任何内容展开
  const isAnyExpanded = isAssetsExpanded || isReleaseNotesExpanded;

  return (
    <div
      onClick={onMarkAsRead}
      className={`bg-white dark:bg-[#121314] rounded-xl border transition-all duration-300 ease-in-out cursor-pointer ${
        isAnyExpanded
          ? 'border-brand-indigo/20 shadow-lg ring-1 ring-brand-indigo/30'
          : 'border-black/[0.06] dark:border-white/[0.04] hover:shadow-md hover:border-black/[0.06]-alt dark:hover:border-white/10'
      }`}
    >
      {/* 头部区域 - 仅显示元信息，不可点击展开 */}
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center min-w-0 flex-1">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-brand-violet rounded-full flex-shrink-0 animate-pulse mr-2"></div>
            )}
            <div className="flex items-center justify-center w-8 h-8 bg-gray-100 dark:bg-white/[0.04] rounded-lg flex-shrink-0 border border-transparent dark:border-white/[0.04]">
              <GitBranch className="w-4 h-4 text-gray-500 dark:text-text-tertiary" />
            </div>
            <div className="min-w-0 flex-1 ml-3">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0">
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
                
                <div className="flex items-center gap-3 shrink-0">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-text-tertiary">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
                  </div>
                  {downloadLinks.length > 0 && (
                    <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-text-tertiary">
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {selectedFilters.length > 0
                          ? `${downloadLinks.filter(link => matchesActiveFilters(link.name)).length}/${downloadLinks.length}`
                          : downloadLinks.length}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-text-quaternary truncate mt-1">
                {release.repository.full_name}
              </p>
            </div>
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
                    ? 'bg-brand-indigo/20 text-gray-700 dark:text-text-secondary dark:bg-brand-indigo/20 '
                    : 'bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600'
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
                    ? 'bg-gray-100 dark:bg-white/[0.04] text-gray-700 dark:text-text-secondary '
                    : 'bg-light-surfacetext-gray-700 dark:bg-white/[0.04] dark:text-text-tertiary hover:bg-gray-200 dark:hover:bg-gray-600'
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

      {/* 可展开内容区域 */}
      <div
        className="grid transition-[grid-template-rows] duration-300 ease-in-out"
        style={{ gridTemplateRows: (isAssetsExpanded || isReleaseNotesExpanded) ? '1fr' : '0fr' }}
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
                {downloadLinks.map((link, index) => (
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
                ))}
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
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary rounded hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 transition-all duration-200 text-xs font-medium whitespace-nowrap"
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
          </div>
        </div>
      </div>
    </div>
  );
});

ReleaseCard.displayName = 'ReleaseCard';

export default ReleaseCard;
