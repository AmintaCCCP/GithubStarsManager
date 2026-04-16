import React, { memo, useCallback } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, FolderOpen, Folder, BellOff, FileArchive } from 'lucide-react';
import { Release } from '../types';
import { formatDistanceToNow } from 'date-fns';
import MarkdownRenderer from './MarkdownRenderer';

interface DownloadLink {
  name: string;
  url: string;
  size: number;
  downloadCount: number;
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
      className={`bg-white dark:bg-gray-800 rounded-xl border transition-all duration-300 ease-in-out ${
        isAnyExpanded
          ? 'border-blue-300 dark:border-blue-700 shadow-lg ring-1 ring-blue-100 dark:ring-blue-900'
          : 'border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      {/* 头部区域 - 仅显示元信息，不可点击展开 */}
      <div className="p-1.5 sm:p-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center space-x-1.5 min-w-0 flex-1">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0 animate-pulse"></div>
            )}
            <div className="flex items-center justify-center w-5 h-5 sm:w-6 sm:h-6 bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 rounded flex-shrink-0">
              <GitBranch className="w-3 h-3 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <h4 className="font-semibold text-gray-900 dark:text-white text-sm truncate">
                  {release.repository.name}
                </h4>
                <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">{release.tag_name}</span>
                {release.name && release.name !== release.tag_name && (
                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                    {release.name}
                  </span>
                )}
                <div className="flex items-center space-x-0.5 text-xs text-gray-400 dark:text-gray-500">
                  <Calendar className="w-3 h-3" />
                  <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
                </div>
                {downloadLinks.length > 0 && (
                  <div className="flex items-center space-x-0.5 text-xs text-gray-400 dark:text-gray-500">
                    <Download className="w-3 h-3" />
                    <span>
                      {selectedFilters.length > 0
                        ? `${downloadLinks.filter(link => matchesActiveFilters(link.name)).length}/${downloadLinks.length}`
                        : downloadLinks.length}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">
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
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
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
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
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
              className="p-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={t('取消订阅 Release', 'Unsubscribe from releases')}
              aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
            >
              <BellOff className="w-3.5 h-3.5" />
            </button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1 rounded bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
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
          <div className="px-1.5 sm:px-2 pb-1.5 sm:pb-2 border-t border-gray-100 dark:border-gray-700">
          {isAssetsExpanded && downloadLinks.length > 0 && (
            <div className="py-1.5">
              <div className="flex items-center space-x-1.5 mb-1.5">
                <FileArchive className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {t('下载文件', 'Download Files')}
                </span>
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  ({downloadLinks.length})
                </span>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded border border-gray-200 dark:border-gray-600 max-h-72 overflow-y-auto">
                {downloadLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                      <Download className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="text-xs truncate text-gray-700 dark:text-gray-300">
                        {link.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-2 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
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
            <div className="py-1.5">
              <div className="flex items-center space-x-1.5 mb-1.5">
                <BookOpen className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
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
                      onClick={onToggleFullContent}
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 text-xs font-medium min-w-[120px]"
                    >
                      <BookOpen className="w-3 h-3" />
                      <span>{isFullContent ? t('收起', 'Collapse') : t('查看完整', 'View Full')}</span>
                    </button>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-1 px-3 py-1.5 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 transition-all duration-200 text-xs font-medium whitespace-nowrap"
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
