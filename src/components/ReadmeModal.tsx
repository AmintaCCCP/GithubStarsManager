import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2, AlertCircle, FileText, ExternalLink, List, Type } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { Repository } from '../types';
import { GitHubApiService } from '../services/githubApi';
import { backend } from '../services/backendAdapter';
import { useAppStore } from '../store/useAppStore';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface ReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  repository: Repository | null;
}

const FONT_SIZES = [
  { label: '小', labelEn: 'Small', value: 'text-sm' },
  { label: '中', labelEn: 'Medium', value: 'text-base' },
  { label: '大', labelEn: 'Large', value: 'text-lg' },
];

export const ReadmeModal: React.FC<ReadmeModalProps> = ({
  isOpen,
  onClose,
  repository
}) => {
  const { githubToken, language, setReadmeModalOpen } = useAppStore();
  const [readmeContent, setReadmeContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToc, setShowToc] = useState(true);
  const [fontSizeIndex, setFontSizeIndex] = useState(1);
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [headingIdMap, setHeadingIdMap] = useState<Map<string, string>>(new Map());
  
  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentFontSize = FONT_SIZES[fontSizeIndex].value;

  const stripMarkdownFormatting = (text: string): string => {
    return text
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/`(.+?)`/g, '$1')
      .replace(/\[(.+?)\]\(.+?\)/g, '$1')
      .replace(/~~(.+?)~~/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const extractToc = useCallback((content: string): { items: TocItem[], idMap: Map<string, string> } => {
    const items: TocItem[] = [];
    const idMap = new Map<string, string>();
    const regex = /^(#{1,3})\s+(.+)$/gm;
    let match;
    let idCounter = 0;
    const textCountMap = new Map<string, number>();
    
    while ((match = regex.exec(content)) !== null) {
      const level = match[1].length;
      const rawText = match[2].trim();
      const displayText = stripMarkdownFormatting(rawText);
      const id = `heading-${idCounter++}`;
      const count = textCountMap.get(displayText) || 0;
      const mapKey = count === 0 ? displayText : `${displayText}__${count}`;
      textCountMap.set(displayText, count + 1);
      items.push({ id, text: displayText, level });
      idMap.set(mapKey, id);
    }
    
    return { items, idMap };
  }, []);

  const scrollToHeading = useCallback((id: string) => {
    const element = document.getElementById(id);
    if (element && contentRef.current) {
      const container = contentRef.current;
      const elementRect = element.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop + elementRect.top - containerRect.top - 20;
      
      try {
        container.scrollTo({
          top: scrollTop,
          behavior: 'smooth'
        });
      } catch {
        container.scrollTop = scrollTop;
      }
    }
  }, []);

  const cycleFontSize = useCallback(() => {
    setFontSizeIndex((prev) => (prev + 1) % FONT_SIZES.length);
  }, []);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const fetchReadme = useCallback(async () => {
    if (!repository) return;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setLoading(true);
    setError(null);

    try {
      const [owner, name] = repository.full_name.split('/');
      let content = '';

      if (backend.isAvailable) {
        content = await backend.getRepositoryReadme(owner, name);
      } else if (githubToken) {
        const githubApi = new GitHubApiService(githubToken);
        content = await githubApi.getRepositoryReadme(owner, name, abortController.signal);
      } else {
        setError(language === 'zh' ? '未登录且后端不可用，无法加载 README' : 'Not logged in and backend unavailable, cannot load README');
        setLoading(false);
        return;
      }

      if (abortController.signal.aborted) return;

      if (content.trim()) {
        setReadmeContent(content);
        const { items, idMap } = extractToc(content);
        setTocItems(items);
        setHeadingIdMap(idMap);
      } else {
        setError(language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file');
      }
    } catch (err) {
      if (abortController.signal.aborted) return;
      console.error('Failed to fetch README:', err);
      setError(language === 'zh' ? '加载 README 失败，请检查网络连接或稍后重试' : 'Failed to load README. Please check your network connection and try again later');
    } finally {
      if (!abortController.signal.aborted) {
        setLoading(false);
      }
    }
  }, [repository, githubToken, language]);

  useEffect(() => {
    if (isOpen && repository) {
      fetchReadme();
    }
  }, [isOpen, repository, fetchReadme]);

  useEffect(() => {
    setReadmeModalOpen(isOpen);
    return () => setReadmeModalOpen(false);
  }, [isOpen, setReadmeModalOpen]);

  // Reset state when modal closes and cancel pending requests
  useEffect(() => {
    if (!isOpen) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      setReadmeContent('');
      setError(null);
      setLoading(false);
      setTocItems([]);
      setHeadingIdMap(new Map());
    } else {
      setShowToc(true);
    }
  }, [isOpen]);

  // Cleanup abortController on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

  // Close modal on Escape key press and manage focus
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        modalRef.current?.focus();
      }, 0);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      if (document.body.style.overflow === 'hidden') {
        document.body.style.overflow = 'unset';
      }
      previousFocusRef.current?.focus();
    };
  }, [isOpen, onClose]);

  if (!isOpen || !repository) return null;

  // 处理遮罩层点击，确保只有点击真正的背景时才关闭
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    // 只有点击的是 flex 容器本身（即背景区域）时才关闭
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Modal Container - 点击背景区域关闭 */}
      <div
        className="flex min-h-full items-center justify-center p-4 bg-black bg-opacity-50 transition-opacity"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="readme-modal-title"
          tabIndex={-1}
          className="relative w-full bg-white dark:bg-gray-800 rounded-xl shadow-xl transform transition-all max-h-[90vh] flex flex-col"
          style={{ maxWidth: '1130px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
            <div className="flex items-center space-x-3">
              <img
                src={repository.owner.avatar_url}
                alt={repository.owner.login}
                className="w-8 h-8 rounded-full"
              />
              <div>
                <h3 id="readme-modal-title" className="text-lg font-semibold text-gray-900 dark:text-white">
                  {repository.full_name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  README
                </p>
              </div>
            </div>
            <div className="flex items-center space-x-1">
              {tocItems.length > 0 && (
                <button
                  onClick={() => setShowToc(!showToc)}
                  className={`p-2 rounded-lg transition-colors ${
                    showToc 
                      ? 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400' 
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
                  title={t('目录', 'Table of Contents')}
                >
                  <List className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={cycleFontSize}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                title={t(`字体大小: ${FONT_SIZES[fontSizeIndex].label}`, `Font Size: ${FONT_SIZES[fontSizeIndex].labelEn}`)}
              >
                <Type className="w-4 h-4" />
              </button>
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                title={t('在 GitHub 上查看', 'View on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{t('在 GitHub 上查看', 'View on GitHub')}</span>
              </a>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 flex overflow-hidden">
            {/* TOC Sidebar */}
            {showToc && tocItems.length > 0 && (
              <div className="w-56 border-r border-gray-200 dark:border-gray-700 overflow-y-auto p-4 flex-shrink-0 readme-scrollbar">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                  {t('目录', 'Contents')}
                </h4>
                <nav className="space-y-1">
                  {tocItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => scrollToHeading(item.id)}
                      className={`block w-full text-left text-sm py-1 px-2 rounded transition-colors ${
                        item.level === 1 
                          ? 'font-semibold text-gray-900 dark:text-white' 
                          : item.level === 2 
                            ? 'pl-4 text-gray-700 dark:text-gray-300'
                            : 'pl-6 text-gray-500 dark:text-gray-400'
                      } hover:bg-gray-100 dark:hover:bg-gray-700`}
                    >
                      {item.text}
                    </button>
                  ))}
                </nav>
              </div>
            )}

            {/* Content */}
            <div 
              ref={contentRef}
              className={`flex-1 overflow-y-auto p-6 ${currentFontSize} select-text readme-scrollbar`}
            >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  {language === 'zh' ? '正在加载 README...' : 'Loading README...'}
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="w-12 h-12 text-red-500 mb-4" />
                <p className="text-gray-700 dark:text-gray-300 text-center mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchReadme}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  {language === 'zh' ? '重试' : 'Retry'}
                </button>
              </div>
            ) : readmeContent ? (
              <MarkdownRenderer
                content={readmeContent}
                enableHtml={true}
                baseUrl={repository?.html_url}
                headingIds={headingIdMap}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="w-12 h-12 text-gray-400 mb-4" />
                <p className="text-gray-500 dark:text-gray-400">
                  {language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file'}
                </p>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
