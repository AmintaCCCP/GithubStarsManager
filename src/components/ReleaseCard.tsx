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
      <div className="p-2.5 sm:p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-2 flex-1 min-w-0">
            {isUnread && (
              <div className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 animate-pulse"></div>
            )}
            <div className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 rounded-lg flex-shrink-0">
              <GitBranch className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white text-base sm:text-lg truncate">
                {release.repository.name} <span className="text-blue-600 dark:text-blue-400">{release.tag_name}</span>
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {release.repository.full_name}
              </p>
              {release.name && release.name !== release.tag_name && (
                <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
                  {release.name}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
          {downloadLinks.length > 0 && (
            <div className="flex items-center space-x-1 text-sm text-gray-600 dark:text-gray-400">
              <Download className="w-3.5 h-3.5" />
              <span>
                {selectedFilters.length > 0
                  ? `${downloadLinks.filter(link => matchesActiveFilters(link.name)).length}/${downloadLinks.length} ${t('个文件', 'files')}`
                  : `${downloadLinks.length} ${t('个文件', 'files')}`}
              </span>
            </div>
          )}

          <div className="flex items-center space-x-1 text-sm text-gray-500 dark:text-gray-400">
            <Calendar className="w-3.5 h-3.5" />
            <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
          </div>

          <div className="flex items-center space-x-1.5 ml-auto">
            {/* 下载资产按钮 */}
            {downloadLinks.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAssets();
                }}
                className={`flex items-center space-x-1 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all duration-200 whitespace-nowrap ${
                  isAssetsExpanded
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-label={isAssetsExpanded ? t('隐藏下载资产', 'Hide Assets') : t('显示下载资产', 'Show Assets')}
                aria-expanded={isAssetsExpanded}
              >
                {isAssetsExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                ) : (
                  <Folder className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                )}
                <span className="text-xs sm:text-sm font-medium">
                  {isAssetsExpanded ? t('隐藏资产', 'Hide Assets') : t('下载资产', 'Assets')}
                </span>
                {isAssetsExpanded ? (
                  <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                ) : (
                  <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                )}
              </button>
            )}

            {/* 更新日志按钮 */}
            {release.body && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReleaseNotes();
                }}
                className={`flex items-center space-x-1 px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-lg transition-all duration-200 whitespace-nowrap ${
                  isReleaseNotesExpanded
                    ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300'
                    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
                title={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-label={isReleaseNotesExpanded ? t('隐藏更新日志', 'Hide Changelog') : t('显示更新日志', 'Show Changelog')}
                aria-expanded={isReleaseNotesExpanded}
              >
                <BookOpen className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="text-xs sm:text-sm font-medium">
                  {isReleaseNotesExpanded ? t('隐藏日志', 'Hide Notes') : t('更新日志', 'Changelog')}
                </span>
                {isReleaseNotesExpanded ? (
                  <ChevronUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                ) : (
                  <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                )}
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="p-2 sm:p-2.5 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={t('取消订阅 Release', 'Unsubscribe from releases')}
              aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
            >
              <BellOff className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 sm:p-2.5 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={t('在GitHub上查看', 'View on GitHub')}
              aria-label={t('在GitHub上查看', 'View on GitHub')}
              onClick={(e) => {
                e.stopPropagation();
                onMarkAsRead();
              }}
            >
              <ExternalLink className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </a>
          </div>
        </div>
      </div>

      {/* 可展开内容区域 */}
      {(isAssetsExpanded || isReleaseNotesExpanded) && (
        <div className="px-2.5 sm:px-3 pb-2.5 sm:pb-3 border-t border-gray-100 dark:border-gray-700">
          {/* 下载资产区域 */}
          {isAssetsExpanded && downloadLinks.length > 0 && (
            <div className="py-2">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <FileArchive className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('下载文件', 'Download Files')}
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({downloadLinks.length})
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 max-h-96 overflow-y-auto">
                {downloadLinks.map((link, index) => (
                  <a
                    key={index}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors border-b border-gray-200 dark:border-gray-600 last:border-b-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center space-x-2 min-w-0 flex-1">
                      <Download className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="text-sm truncate text-gray-700 dark:text-gray-300">
                        {link.name}
                      </span>
                    </div>
                    <div className="flex items-center space-x-3 text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">
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

          {/* 更新日志区域 */}
          {isReleaseNotesExpanded && release.body && (
            <div className="py-2">
              <div className="flex items-center space-x-2 mb-2">
                <BookOpen className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('Release 说明', 'Release Notes')}
                </span>
              </div>

              <div className="relative">
                <MarkdownRenderer
                  content={isFullContent ? release.body : truncatedBody}
                  shouldRender={true}
                />

                {release.body.length > truncatedBody.length && (
                  <div className="mt-4 flex items-center justify-center space-x-3">
                    <button
                      onClick={onToggleFullContent}
                      className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 text-sm font-medium min-w-[140px]"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      <span>{isFullContent ? t('收起内容', 'Collapse') : t('查看完整内容', 'View Full Content')}</span>
                    </button>
                    <a
                      href={release.html_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 active:bg-gray-300 dark:active:bg-gray-500 transition-all duration-200 text-sm font-medium whitespace-nowrap"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMarkAsRead();
                      }}
                    >
                      <ArrowUpRight className="w-4 h-4" />
                      <span>{t('在GitHub上查看', 'View on GitHub')}</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
});

ReleaseCard.displayName = 'ReleaseCard';

export default ReleaseCard;
