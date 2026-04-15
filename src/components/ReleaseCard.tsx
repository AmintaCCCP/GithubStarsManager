import React, { memo, useState, useCallback } from 'react';
import { ExternalLink, GitBranch, Calendar, Download, ChevronDown, ChevronUp, BookOpen, ArrowUpRight, Folder, BellOff } from 'lucide-react';
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
  isExpanded: boolean;
  isFullContent: boolean;
  isReleaseNotesCollapsed: boolean;
  isDropdownOpen: boolean;
  truncatedBody: string;
  matchesActiveFilters: (linkName: string) => boolean;
  selectedFilters: string[];
  onToggleExpansion: () => void;
  onToggleDropdown: () => void;
  onToggleFullContent: (e: React.MouseEvent) => void;
  onToggleReleaseNotes: () => void;
  onUnsubscribe: () => void;
  onMarkAsRead: () => void;
  language: 'zh' | 'en';
  formatFileSize: (bytes: number) => string;
}

const ReleaseCard: React.FC<ReleaseCardProps> = memo(({
  release,
  downloadLinks,
  isUnread,
  isExpanded,
  isFullContent,
  isReleaseNotesCollapsed,
  isDropdownOpen,
  truncatedBody,
  matchesActiveFilters,
  selectedFilters,
  onToggleExpansion,
  onToggleDropdown,
  onToggleFullContent,
  onToggleReleaseNotes,
  onUnsubscribe,
  onMarkAsRead,
  language,
  formatFileSize,
}) => {
  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  return (
    <div
      className={`bg-white dark:bg-gray-800 rounded-xl border transition-all duration-300 ease-in-out ${
        isExpanded 
          ? 'border-blue-300 dark:border-blue-700 shadow-lg ring-1 ring-blue-100 dark:ring-blue-900' 
          : 'border-gray-200 dark:border-gray-700 hover:shadow-md hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div
        className="p-1.5 sm:p-2 cursor-pointer select-none"
        onClick={onToggleExpansion}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center space-x-1.5 flex-1 min-w-0">
            {isUnread && (
              <div className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0 animate-pulse"></div>
            )}
            <div className="flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 bg-gradient-to-br from-green-100 to-green-200 dark:from-green-900 dark:to-green-800 rounded-lg flex-shrink-0">
              <GitBranch className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="font-semibold text-gray-900 dark:text-white text-base sm:text-lg truncate">
                {release.repository.name} <span className="text-blue-600 dark:text-blue-400">{release.tag_name}</span>
              </h4>
              <p className="text-sm sm:text-base text-gray-500 dark:text-gray-400 truncate">
                {release.repository.full_name}
              </p>
              {release.name && release.name !== release.tag_name && (
                <p className="text-sm sm:text-base text-gray-600 dark:text-gray-300 truncate">
                  {release.name}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-1 flex-shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleExpansion();
              }}
              className={`p-1 rounded-lg transition-all duration-300 ${
                isExpanded
                  ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-300 rotate-180'
                  : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              }`}
              aria-label={isExpanded ? t('折叠', 'Collapse') : t('展开', 'Expand')}
              aria-expanded={isExpanded}
              aria-controls={`release-content-${release.id}`}
            >
              <ChevronDown className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-700">
          {downloadLinks.length > 0 && (
            <div className="flex items-center space-x-1 text-sm sm:text-base text-gray-600 dark:text-gray-400">
              <Download className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              <span>
                {(() => {
                  const filteredLinks = downloadLinks.filter(link => matchesActiveFilters(link.name));
                  const filteredCount = filteredLinks.length;
                  return selectedFilters.length > 0 && filteredCount !== downloadLinks.length
                    ? `${filteredCount}/${downloadLinks.length} ${t('个文件', 'files')}`
                    : `${downloadLinks.length} ${t('个文件', 'files')}`;
                })()}
              </span>
            </div>
          )}

          <div className="flex items-center space-x-1 text-sm sm:text-base text-gray-500 dark:text-gray-400">
            <Calendar className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            <span>{formatDistanceToNow(new Date(release.published_at), { addSuffix: true })}</span>
          </div>

          <div className="flex items-center space-x-1.5 ml-auto">
            {downloadLinks.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isExpanded) {
                    onToggleExpansion();
                  }
                  setTimeout(() => onToggleDropdown(), 100);
                }}
                className="file-toggle-btn flex items-center space-x-1 px-2 py-1 sm:px-3 sm:py-1.5 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors whitespace-nowrap"
                title={isDropdownOpen ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}
                aria-label={isDropdownOpen ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}
                aria-expanded={isDropdownOpen}
                aria-controls={`files-panel-${release.id}`}
              >
                <Folder className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="text-xs sm:text-sm">{isDropdownOpen ? t('隐藏文件', 'Hide Files') : t('显示文件', 'Show Files')}</span>
              </button>
            )}

            <button
              onClick={(e) => {
                e.stopPropagation();
                onUnsubscribe();
              }}
              className="p-1.5 sm:p-2 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={t('取消订阅 Release', 'Unsubscribe from releases')}
              aria-label={t('取消订阅 Release', 'Unsubscribe from releases')}
            >
              <BellOff className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </button>
            <a
              href={release.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 sm:p-2 rounded-lg bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              title={t('在GitHub上查看', 'View on GitHub')}
              aria-label={t('在GitHub上查看', 'View on GitHub')}
              onClick={(e) => {
                e.stopPropagation();
                onMarkAsRead();
              }}
            >
              <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
            </a>
          </div>
        </div>
      </div>

      <div
        id={`release-content-${release.id}`}
        className={`expandable-container ${isExpanded ? 'expanded' : ''}`}
      >
        <div className="expandable-content">
          <div className={`release-card-expand ${isExpanded ? 'expanding' : ''} px-3 sm:px-4 pb-3 sm:pb-4 border-t border-gray-100 dark:border-gray-700`}>
          {downloadLinks.length > 0 && (
            <div className="py-3 relative download-dropdown">
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleDropdown();
                  }}
                  className="flex items-center space-x-1.5 text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{t('下载文件', 'Download Files')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    ({downloadLinks.length})
                  </span>
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {isDropdownOpen && (
                <div 
                  id={`files-panel-${release.id}`}
                  className="bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600 max-h-96 overflow-y-auto"
                >
                  {downloadLinks.map((link, index) => {
                    const matchesFilter = matchesActiveFilters(link.name);
                    const shouldHighlight = selectedFilters.length > 0 && matchesFilter;
                    
                    return (
                      <a
                        key={index}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`flex items-center justify-between p-2.5 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors border-b border-gray-200 dark:border-gray-600 last:border-b-0 ${
                          shouldHighlight ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center space-x-2 min-w-0 flex-1">
                          <Download className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className={`text-base truncate ${shouldHighlight ? 'font-medium text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}>
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
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {release.body && (
            <div className="py-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleReleaseNotes();
                }}
                className="flex items-center space-x-1.5 text-base font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors w-full"
              >
                <BookOpen className="w-3.5 h-3.5" />
                <span>{t('Release 说明', 'Release Notes')}</span>
                {isReleaseNotesCollapsed ? (
                  <ChevronDown className="w-3.5 h-3.5" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" />
                )}
              </button>

              {!isReleaseNotesCollapsed && (
                <div className="mt-3">
                  <div className="relative">
                    <MarkdownRenderer
                      content={isFullContent ? release.body : truncatedBody}
                      shouldRender={isExpanded && !isReleaseNotesCollapsed}
                    />
                    
                    {release.body.length > truncatedBody.length && (
                      <div className="mt-3 flex items-center justify-center space-x-3">
                        <button
                          onClick={onToggleFullContent}
                          className="flex items-center justify-center space-x-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 active:bg-blue-800 transition-all duration-200 text-sm font-medium min-w-[140px]"
                        >
                          <BookOpen className="w-3.5 h-3.5" />
                          <span>{isFullContent ? t('隐藏', 'Hide') : t('查看完整内容', 'View Full Content')}</span>
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
                          <span>{t('前往查看完整Release说明', 'View Full Release Notes')}</span>
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}
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
