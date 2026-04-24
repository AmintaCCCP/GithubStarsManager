import React, { useEffect, useState, useCallback, useRef } from 'react';
import { X, Loader2, AlertCircle, FileText, ExternalLink, List, Type, ArrowUp } from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer';
import { stripMarkdownFormatting } from '../utils/markdownUtils';
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

const TOC_MAX_LEVEL = 6;

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
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const currentFontSize = FONT_SIZES[fontSizeIndex].value;

  const extractToc = useCallback((content: string): { items: TocItem[], idMap: Map<string, string> } => {
    const items: TocItem[] = [];
    const idMap = new Map<string, string>();

    const codeBlockRegex = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
    const cleanedContent = content.replace(codeBlockRegex, '');
    const regex = new RegExp(`^(#{1,${TOC_MAX_LEVEL}})\\s+(.+)$`, 'gm');
    let match;
    let idCounter = 0;
    const textCountMap = new Map<string, number>();

    while ((match = regex.exec(cleanedContent)) !== null) {
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

  const scrollToHeading = useCallback((id: string, fallbackText?: string) => {
    if (!contentRef.current) return;
    const container = contentRef.current;

    let element = container.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;

    if (!element && fallbackText) {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i] as HTMLElement;
        if (heading.textContent?.trim() === fallbackText.trim()) {
          element = heading;
          break;
        }
      }
    }

    if (!element && fallbackText) {
      const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
      for (let i = 0; i < headings.length; i++) {
        const heading = headings[i] as HTMLElement;
        if (heading.textContent?.includes(fallbackText)) {
          element = heading;
          break;
        }
      }
    }

    if (element) {
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

  const handleScroll = useCallback(() => {
    if (!contentRef.current) return;
    const container = contentRef.current;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const progress = scrollHeight <= clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * 100;
    setScrollProgress(Math.min(100, Math.max(0, progress)));
    setShowBackToTop(scrollTop > 300);
  }, []);

  useEffect(() => {
    if (!contentRef.current || !tocItems.length || !readmeContent) return;

    let observer: IntersectionObserver | null = null;

    const timer = setTimeout(() => {
      const container = contentRef.current;
      if (!container) return;

      if (observer) observer.disconnect();

      observer = new IntersectionObserver(
        (entries) => {
          const visibleEntries = entries.filter(e => e.isIntersecting);
          if (visibleEntries.length > 0) {
            const topEntry = visibleEntries.reduce((a, b) =>
              a.boundingClientRect.top < b.boundingClientRect.top ? a : b
            );
            setActiveHeadingId(topEntry.target.id);
          }
        },
        {
          root: container,
          rootMargin: '-10% 0px -80% 0px',
          threshold: 0,
        }
      );

      tocItems.forEach((item) => {
        let el = container.querySelector(`#${CSS.escape(item.id)}`);
        if (!el && item.text) {
          const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (let i = 0; i < headings.length; i++) {
            const heading = headings[i] as HTMLElement;
            if (heading.textContent?.trim() === item.text.trim()) {
              el = heading;
              break;
            }
          }
        }
        if (el && observer) observer.observe(el);
      });
    }, 150);

    return () => {
      clearTimeout(timer);
      if (observer) observer.disconnect();
    };
  }, [tocItems, readmeContent]);

  const scrollToTop = useCallback(() => {
    if (contentRef.current) {
      try {
        contentRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {
        contentRef.current.scrollTop = 0;
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
  }, [repository, githubToken, language, extractToc]);

  useEffect(() => {
    if (isOpen && repository) {
      fetchReadme();
    }
  }, [isOpen, repository, fetchReadme]);

  useEffect(() => {
    setReadmeModalOpen(isOpen);
    return () => setReadmeModalOpen(false);
  }, [isOpen, setReadmeModalOpen]);

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
      setScrollProgress(0);
      setShowBackToTop(false);
      setActiveHeadingId(null);
    } else {
      setShowToc(true);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
    };
  }, []);

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

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const tocIndentClass = (level: number): string => {
    switch (level) {
      case 1: return '';
      case 2: return 'pl-3';
      case 3: return 'pl-6';
      case 4: return 'pl-9';
      case 5: return 'pl-12';
      case 6: return 'pl-16';
      default: return '';
    }
  };

  const tocTextClass = (level: number): string => {
    if (level <= 2) return 'font-medium text-gray-800 dark:text-gray-200';
    if (level <= 4) return 'text-gray-600 dark:text-gray-400';
    return 'text-gray-500 dark:text-gray-500 text-xs';
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
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
          className="relative w-full bg-white dark:bg-panel-dark dark:border dark:border-white/[0.04] rounded-xl shadow-xl transform transition-all max-h-[90vh] flex flex-col"
          style={{ maxWidth: '1130px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Reading Progress Bar */}
          {readmeContent && !loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-gray-200 dark:bg-gray-700 z-20 rounded-t-xl overflow-hidden">
              <div
                className="h-full bg-blue-500 dark:bg-blue-400 transition-[width] duration-150 ease-out"
                style={{ width: `${scrollProgress}%` }}
              />
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black/[0.06] dark:border-white/[0.04] flex-shrink-0">
            <div className="flex items-center space-x-3">
              <img
                src={repository.owner.avatar_url}
                alt={repository.owner.login}
                className="w-8 h-8 rounded-full"
              />
              <div>
                <h3 id="readme-modal-title" className="text-lg font-semibold text-gray-900 dark:text-text-primary">
                  {repository.full_name}
                </h3>
                <p className="text-sm text-gray-500 dark:text-text-secondary">
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
                      ? 'bg-brand-indigo/20 text-brand-violet dark:bg-brand-indigo/10 dark:text-brand-violet'
                      : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-900 hover:bg-light-surface dark:hover:bg-white/10'
                  }`}
                  title={t('目录', 'Table of Contents')}
                >
                  <List className="w-4 h-4" />
                </button>
              )}
              <button
                onClick={cycleFontSize}
                className="p-2 rounded-lg text-gray-400 dark:text-text-quaternary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-900 dark:text-text-primary hover:bg-light-surface dark:hover:bg-white/10 transition-colors"
                title={t(`字体大小: ${FONT_SIZES[fontSizeIndex].label}`, `Font Size: ${FONT_SIZES[fontSizeIndex].labelEn}`)}
              >
                <Type className="w-4 h-4" />
              </button>
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center space-x-1 px-3 py-2 text-sm text-gray-700 dark:text-text-secondary hover:text-gray-900 dark:hover:text-gray-900 hover:bg-light-surface dark:hover:bg-white/10 rounded-lg transition-colors"
                title={t('在 GitHub 上查看', 'View on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{t('在 GitHub 上查看', 'View on GitHub')}</span>
              </a>
              <button
                onClick={onClose}
                className="p-2 rounded-lg text-gray-400 dark:text-text-quaternary hover:text-gray-700 dark:text-text-secondary dark:hover:text-gray-900 dark:text-text-primary hover:bg-light-surface dark:hover:bg-white/10 transition-colors"
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
              <div className="w-56 border-r border-black/[0.06] dark:border-white/[0.04] overflow-y-auto p-4 flex-shrink-0 readme-scrollbar">
                <h4 className="text-sm font-semibold text-gray-900 dark:text-text-primary mb-3">
                  {t('目录', 'Contents')}
                </h4>
                <nav className="space-y-0.5">
                  {tocItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => scrollToHeading(item.id, item.text)}
                      className={`block w-full text-left text-sm py-1 px-2 rounded transition-colors truncate ${tocIndentClass(item.level)} ${tocTextClass(item.level)} ${
                        activeHeadingId === item.id
                          ? 'bg-brand-indigo/10 text-brand-violet dark:bg-brand-indigo/10 dark:text-brand-violet font-medium'
                          : 'hover:bg-light-surface dark:hover:bg-white/5'
                      }`}
                      title={item.text}
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
              className={`flex-1 overflow-y-auto p-6 ${currentFontSize} select-text readme-scrollbar relative`}
              onScroll={handleScroll}
            >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-brand-violet dark:text-brand-violet animate-spin mb-4" />
                <p className="text-gray-500 dark:text-text-secondary">
                  {language === 'zh' ? '正在加载 README...' : 'Loading README...'}
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="w-12 h-12 text-gray-700 dark:text-text-secondary mb-4" />
                <p className="text-gray-900 dark:text-text-secondary text-center mb-4">
                  {error}
                </p>
                <button
                  onClick={fetchReadme}
                  className="px-4 py-2 bg-brand-violet text-white rounded-lg hover:bg-brand-violet/90 dark:bg-status-red/80 dark:hover:bg-status-red transition-colors"
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
                <FileText className="w-12 h-12 text-gray-400 dark:text-text-quaternary mb-4" />
                <p className="text-gray-500 dark:text-text-secondary">
                  {language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file'}
                </p>
              </div>
            )}
            </div>

            {/* Back to Top Button */}
            {showBackToTop && (
              <button
                onClick={scrollToTop}
                className="absolute bottom-4 right-4 p-2.5 bg-white dark:bg-gray-700 rounded-full shadow-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 hover:text-gray-900 dark:hover:text-white transition-all z-10"
                title={t('回到顶部', 'Back to top')}
              >
                <ArrowUp className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
