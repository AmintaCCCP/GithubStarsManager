import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { X, Loader2, AlertCircle, FileText, ExternalLink, List, Type, ArrowUp, Languages, Eye } from 'lucide-react';
import BilingualMarkdownRenderer, { DisplayMode, BilingualMarkdownRendererHandle, TranslationStatus } from './BilingualMarkdownRenderer';
import { stripMarkdownFormatting } from '../utils/markdownUtils';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useReadmeFetch, pickReadmeCandidate } from '../hooks/useReadmeFetch';
import { buildReadmeVariants, DEFAULT_README_VARIANT, type ReadmeVariant } from '../utils/readmeVariants';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';

interface TocItem {
  id: string;
  text: string;
  level: number;
}

interface ReadmeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCloseAutoFocus?: () => void;
  repository: Repository | null;
}

const FONT_SIZES = [
  { label: '小', labelEn: 'Small', value: 'text-sm' },
  { label: '中', labelEn: 'Medium', value: 'text-base' },
  { label: '大', labelEn: 'Large', value: 'text-lg' },
];

const TOC_MAX_LEVEL = 6;

const getDefaultReadmeVariant = (language: 'zh' | 'en'): ReadmeVariant => ({
  ...DEFAULT_README_VARIANT,
  label: language === 'zh' ? '默认 README' : 'Default README',
});

const isAbortError = (error: unknown, signal?: AbortSignal): boolean => {
  return Boolean(signal?.aborted || (error as { name?: string })?.name === 'AbortError');
};

export const ReadmeModal: React.FC<ReadmeModalProps> = ({
  isOpen,
  onClose,
  onCloseAutoFocus,
  repository
}) => {
  const { language, setReadmeModalOpen } = useAppStore(useShallow((state) => ({
    language: state.language,
    setReadmeModalOpen: state.setReadmeModalOpen,
  })));
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('bilingual');
  const [errorExpanded, setErrorExpanded] = useState(false);
  const [tocWidth, setTocWidth] = useState(224);
  const [translatedHeadingMap, setTranslatedHeadingMap] = useState<Map<string, string>>(new Map());
  const [readmeVariants, setReadmeVariants] = useState<ReadmeVariant[]>(() => [getDefaultReadmeVariant(language)]);
  const [selectedReadmeKey, setSelectedReadmeKey] = useState('default');
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [readmeCache, setReadmeCache] = useState<Record<string, string>>({});

  const defaultReadmeVariant = useMemo(() => getDefaultReadmeVariant(language), [language]);

  const contentRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // README 抓取（backend 优先 → GitHub 兜底）由共享 hook 承担；
  // abort 实体在 hook（每次 fetch 前中止上一个，unmount 自动取消），关闭 modal 时调 cancelFetches。
  const [repoOwner = '', repoName = ''] = repository?.full_name.split('/') ?? [];
  const {
    fetchReadmeContent: fetchReadmeContentFromAvailableSource,
    fetchReadmeCandidates: fetchReadmeCandidatesFromAvailableSource,
    cancel: cancelFetches,
  } = useReadmeFetch({ owner: repoOwner, name: repoName });

  const bilingualRef = useRef<BilingualMarkdownRendererHandle>(null);
  const [translateStatus, setTranslateStatus] = useState<TranslationStatus>('idle');
  const [translateProgress, setTranslateProgress] = useState({ current: 0, total: 0 });
  const [translateError, setTranslateError] = useState<string | null>(null);

  const displayContent = readmeContent;

  const currentFontSize = FONT_SIZES[fontSizeIndex].value;

  const getFontSizeType = useCallback((): 'small' | 'medium' | 'large' => {
    switch (fontSizeIndex) {
      case 0:
        return 'small';
      case 2:
        return 'large';
      case 1:
      default:
        return 'medium';
    }
  }, [fontSizeIndex]);

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

    const translationWrapper = container.querySelector(`[data-bi-heading-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (translationWrapper && translationWrapper.offsetParent !== null) {
      const elementRect = translationWrapper.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const scrollTop = container.scrollTop + elementRect.top - containerRect.top - 20;
      try {
        container.scrollTo({ top: scrollTop, behavior: 'smooth' });
      } catch {
        container.scrollTop = scrollTop;
      }
      return;
    }

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
            const target = topEntry.target as HTMLElement;
            setActiveHeadingId(target.dataset.biHeadingId ?? target.id);
          }
        },
        {
          root: container,
          rootMargin: '-10% 0px -80% 0px',
          threshold: 0,
        }
      );

      tocItems.forEach((item) => {
        let el = container.querySelector(`[data-bi-heading-id="${CSS.escape(item.id)}"]`) as HTMLElement | null;
        if (!el) {
          el = container.querySelector(`#${CSS.escape(item.id)}`);
        }
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
  }, [tocItems, readmeContent, translateStatus, displayMode]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = e.clientX - startXRef.current;
      setTocWidth(Math.max(150, Math.min(500, startWidthRef.current + delta)));
    };
    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = tocWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [tocWidth]);

  const t = useCallback((zh: string, en: string) => language === 'zh' ? zh : en, [language]);

  const handleTranslate = useCallback(async () => {
    if (translateStatus === 'translating') return;
    await bilingualRef.current?.translate();
  }, [translateStatus]);

  const handleRevertTranslation = useCallback(() => {
    bilingualRef.current?.revert();
    setTranslatedHeadingMap(new Map());
  }, []);

  const handleHeadingsTranslated = useCallback((headings: { id: string; text: string }[]) => {
    const map = new Map<string, string>();
    headings.forEach(h => map.set(h.id, h.text));
    setTranslatedHeadingMap(map);
  }, []);

  const resetTranslationState = useCallback(() => {
    bilingualRef.current?.revert();
    setDisplayMode('bilingual');
    setTranslateStatus('idle');
    setTranslateProgress({ current: 0, total: 0 });
    setTranslateError(null);
    setTranslatedHeadingMap(new Map());
  }, []);

  const resetReadmeViewState = useCallback(() => {
    resetTranslationState();
    setTocItems([]);
    setHeadingIdMap(new Map());
    setActiveHeadingId(null);
    setScrollProgress(0);
    setShowBackToTop(false);
    scrollToTop();
  }, [resetTranslationState, scrollToTop]);

  const fetchReadmeContent = useCallback(async (variant: ReadmeVariant) => {
    if (!repository) return;

    setLoading(true);
    setError(null);

    try {
      const content = await fetchReadmeContentFromAvailableSource(variant);

      setReadmeCache(prev => ({ ...prev, [variant.key]: content }));

      if (content.trim()) {
        setReadmeContent(content);
        setError(null);
      } else {
        setReadmeContent('');
        setError(variant.isDefault
          ? (language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file')
          : (language === 'zh' ? '该 README 文件为空' : 'This README file is empty'));
      }
      setLoading(false);
    } catch (err) {
      // 被 hook abort（被新请求取代 / cancel）时静默返回，不动 loading 态
      if (isAbortError(err)) return;
      console.error('Failed to fetch README:', err);
      setReadmeContent('');
      const fallbackMessage = variant.isDefault
        ? (language === 'zh' ? '加载 README 失败，请检查网络连接或稍后重试' : 'Failed to load README. Please check your network connection and try again later')
        : (language === 'zh' ? '加载所选 README 失败，请稍后重试' : 'Failed to load selected README. Please try again later');
      setError(err instanceof Error && err.message ? err.message : fallbackMessage);
      setLoading(false);
    }
  }, [repository, fetchReadmeContentFromAvailableSource, language]);

  const fetchReadmeVariants = useCallback(async () => {
    if (!repository) return;

    setVariantsLoading(true);

    try {
      const defaultBranch = (repository as Repository & { default_branch?: string }).default_branch;
      const candidates = await fetchReadmeCandidatesFromAvailableSource(defaultBranch);

      setReadmeVariants(buildReadmeVariants(candidates, language));
      setVariantsLoading(false);
    } catch (err) {
      if (isAbortError(err)) return;
      console.warn('Failed to detect README variants:', err);
      setReadmeVariants([defaultReadmeVariant]);
      setVariantsLoading(false);
    }
  }, [repository, fetchReadmeCandidatesFromAvailableSource, language, defaultReadmeVariant]);

  const fetchReadme = useCallback(async () => {
    await fetchReadmeContent(pickReadmeCandidate(readmeVariants, selectedReadmeKey, defaultReadmeVariant));
  }, [readmeVariants, selectedReadmeKey, defaultReadmeVariant, fetchReadmeContent]);

  const handleReadmeVariantChange = useCallback((nextKey: string) => {
    if (nextKey === selectedReadmeKey) return;

    const nextVariant = readmeVariants.find(variant => variant.key === nextKey);
    if (!nextVariant) return;

    setSelectedReadmeKey(nextKey);
    resetReadmeViewState();

    const cachedContent = readmeCache[nextKey];
    if (cachedContent !== undefined) {
      setReadmeContent(cachedContent);
      setError(cachedContent.trim()
        ? null
        : nextVariant.isDefault
          ? (language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file')
          : (language === 'zh' ? '该 README 文件为空' : 'This README file is empty'));
      return;
    }

    void fetchReadmeContent(nextVariant);
  }, [selectedReadmeKey, readmeVariants, readmeCache, resetReadmeViewState, language, fetchReadmeContent]);

  useEffect(() => {
    if (isOpen && repository) {
      const defaultVariant = getDefaultReadmeVariant(language);
      setReadmeVariants([defaultVariant]);
      setSelectedReadmeKey('default');
      setReadmeCache({});
      resetReadmeViewState();
      void fetchReadmeContent(defaultVariant);
      void fetchReadmeVariants();
    }
  }, [isOpen, repository, language, fetchReadmeContent, fetchReadmeVariants, resetReadmeViewState]);

  useEffect(() => {
    if (displayContent) {
      const { items, idMap } = extractToc(displayContent);
      setTocItems(items);
      setHeadingIdMap(idMap);
      setTranslatedHeadingMap(new Map());
    }
  }, [displayContent, extractToc]);

  useEffect(() => {
    setReadmeModalOpen(isOpen);
    return () => setReadmeModalOpen(false);
  }, [isOpen, setReadmeModalOpen]);

  useEffect(() => {
    if (!isOpen) {
      cancelFetches();
      setReadmeContent('');
      setError(null);
      setLoading(false);
      setReadmeVariants([getDefaultReadmeVariant(language)]);
      setSelectedReadmeKey('default');
      setVariantsLoading(false);
      setReadmeCache({});
      setTocItems([]);
      setHeadingIdMap(new Map());
      setScrollProgress(0);
      setShowBackToTop(false);
      setActiveHeadingId(null);
      setDisplayMode('bilingual');
      setErrorExpanded(false);
      bilingualRef.current?.revert();
      setTranslateStatus('idle');
      setTranslateProgress({ current: 0, total: 0 });
      setTranslateError(null);
      setTranslatedHeadingMap(new Map());
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    } else {
      setShowToc(true);
    }
  }, [isOpen, language, cancelFetches]);

  if (!repository) return null;

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
    if (level <= 2) return 'font-medium text-foreground dark:text-muted-foreground';
    if (level <= 4) return 'text-muted-foreground dark:text-muted-foreground';
    return 'text-muted-foreground dark:text-muted-foreground text-xs';
  };

  const isTranslating = translateStatus === 'translating';
  const isTranslated = translateStatus === 'translated';
  const isTranslateError = translateStatus === 'error';
  const currentReadmeVariant = pickReadmeCandidate(readmeVariants, selectedReadmeKey, defaultReadmeVariant);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        aria-describedby={undefined}
        className="max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] w-[calc(100%_-_2rem)] max-w-full sm:max-w-[1130px] min-w-0 overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (!onCloseAutoFocus) return;
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <div className="relative flex max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-top)_-_env(safe-area-inset-bottom))] min-w-0 max-w-full w-full flex-col overflow-hidden bg-card pb-[env(safe-area-inset-bottom)] dark:bg-card">
          {readmeContent && !loading && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent dark:bg-muted z-20 rounded-t-xl overflow-hidden">
              <div
                className="h-full bg-primary transition-[width] duration-150 ease-out"
                style={{ width: `${scrollProgress}%` }}
              />
            </div>
          )}

          <div className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border p-4 dark:border-border">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <img
                src={repository.owner.avatar_url}
                alt={repository.owner.login}
                className="w-8 h-8 rounded-full"
              />
              <div className="min-w-0">
                <DialogTitle className="break-all text-lg font-semibold text-foreground dark:text-foreground">
                  {repository.full_name}
                </DialogTitle>
                <p className="max-w-full truncate text-sm text-muted-foreground dark:text-muted-foreground" title={currentReadmeVariant.path || 'README'}>
                  {currentReadmeVariant.isDefault ? 'README' : currentReadmeVariant.path}
                </p>
              </div>
            </div>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
              {readmeVariants.length > 1 && (
                <Select value={selectedReadmeKey} onValueChange={handleReadmeVariantChange} disabled={loading || variantsLoading}>
                  <SelectTrigger className="h-11 w-auto min-w-[7rem] max-w-[220px] px-2 py-2 text-sm sm:h-9" title={t('切换 README 语言', 'Switch README language')} aria-label={t('切换 README 语言', 'Switch README language')}><SelectValue /></SelectTrigger>
                  <SelectContent>{readmeVariants.map((variant) => <SelectItem key={variant.key} value={variant.key}>{variant.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {readmeContent && !loading && (
                isTranslated ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={handleRevertTranslation}
                      className="flex h-11 items-center space-x-1 rounded-lg px-3 py-2 text-sm transition-colors sm:h-9 bg-primary/20 text-primary dark:bg-primary/10 dark:text-primary"
                      title={t('关闭翻译', 'Close Translation')}
                      aria-label={t('关闭翻译', 'Close Translation')}
                    >
                      <Languages className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('已翻译', 'Translated')}</span>
                    </Button>
                    {([
                      { mode: 'original' as DisplayMode, icon: FileText, label: t('原文', 'Original') },
                      { mode: 'translated' as DisplayMode, icon: Languages, label: t('译文', 'Translated') },
                      { mode: 'bilingual' as DisplayMode, icon: Eye, label: t('双语', 'Bilingual') },
                    ]).map(({ mode, icon: Icon, label }) => (
                      <Button
                        key={mode}
                        variant="ghost"
                        onClick={() => setDisplayMode(mode)}
                        className={`flex h-11 items-center space-x-1 rounded-lg px-2 py-2 text-sm transition-colors sm:h-9 ${
                          displayMode === mode
                            ? 'bg-primary/20 text-primary dark:bg-primary/10 dark:text-primary'
                            : 'text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground hover:bg-muted dark:hover:bg-card'
                        }`}
                        title={label}
                        aria-label={label}
                      >
                        <Icon className="w-4 h-4" />
                        <span className="hidden sm:inline">{label}</span>
                      </Button>
                    ))}
                  </>
                ) : isTranslateError ? (
                  <>
                    <Button
                      variant="ghost"
                      onClick={handleTranslate}
                      className="flex h-11 items-center space-x-1 rounded-lg px-3 py-2 text-sm transition-colors sm:h-9 text-warning hover:bg-warning/10"
                      title={t('重试翻译', 'Retry Translation')}
                      aria-label={t('重试翻译', 'Retry Translation')}
                    >
                      <Languages className="w-4 h-4" />
                      <span className="hidden sm:inline">{t('重试', 'Retry')}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={handleRevertTranslation}
                      className="flex h-11 items-center space-x-1 rounded-lg px-2 py-2 text-sm transition-colors sm:h-9 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground hover:bg-muted dark:hover:bg-card"
                      title={t('关闭翻译', 'Close Translation')}
                      aria-label={t('关闭翻译', 'Close Translation')}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className={`flex h-11 items-center space-x-1 rounded-lg px-3 py-2 text-sm transition-colors sm:h-9 ${
                      isTranslating
                        ? 'text-muted-foreground dark:text-muted-foreground/70 cursor-not-allowed'
                        : 'text-muted-foreground dark:text-foreground hover:text-foreground hover:bg-muted dark:hover:bg-accent'
                    }`}
                    title={t('翻译文档', 'Translate Document')}
                    aria-label={t('翻译文档', 'Translate Document')}
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="hidden sm:inline">
                          {translateProgress.total > 0 
                            ? `${translateProgress.current}/${translateProgress.total}` 
                            : t('翻译中…', 'Translating…')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Languages className="w-4 h-4" />
                        <span className="hidden sm:inline">{language === 'zh' ? t('翻译为中文', 'Translate to Chinese') : t('翻译为英文', 'Translate to English')}</span>
                      </>
                    )}
                  </Button>
                )
              )}
              {translateError && (
                <div
                  className={`max-w-full cursor-pointer break-all rounded-lg bg-destructive/10 px-3 py-1 text-xs text-destructive ${errorExpanded ? 'whitespace-normal' : 'sm:max-w-[200px] truncate'}`}
                  onClick={() => setErrorExpanded(!errorExpanded)}
                  title={!errorExpanded ? translateError : undefined}
                >
                  {translateError}
                </div>
              )}
              {tocItems.length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowToc(!showToc)}
                  aria-label={t('目录', 'Table of Contents')}
                  className={`h-11 w-11 rounded-lg p-0 transition-colors sm:h-8 sm:w-8 ${
                    showToc
                      ? 'bg-primary/20 text-primary dark:bg-primary/10 dark:text-primary'
                      : 'text-muted-foreground hover:text-muted-foreground dark:hover:text-foreground hover:bg-muted dark:hover:bg-accent'
                  }`}
                  title={t('目录', 'Table of Contents')}
                >
                  <List className="w-4 h-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={t(`字体大小: ${FONT_SIZES[fontSizeIndex].label}`, `Font Size: ${FONT_SIZES[fontSizeIndex].labelEn}`)}
                onClick={cycleFontSize}
                className="h-11 w-11 rounded-lg p-0 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted dark:text-foreground dark:hover:text-foreground dark:hover:bg-accent sm:h-8 sm:w-8"
                title={t(`字体大小: ${FONT_SIZES[fontSizeIndex].label}`, `Font Size: ${FONT_SIZES[fontSizeIndex].labelEn}`)}
              >
                <Type className="w-4 h-4" />
              </Button>
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-11 items-center space-x-1 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground hover:bg-muted dark:text-foreground dark:hover:bg-accent sm:h-9"
                title={t('在 GitHub 上查看', 'View on GitHub')}
                aria-label={t('在 GitHub 上查看', 'View on GitHub')}
              >
                <ExternalLink className="w-4 h-4" />
                <span className="hidden sm:inline">{t('在 GitHub 上查看', 'View on GitHub')}</span>
              </a>
              <Button
                variant="ghost"
                onClick={onClose}
                className="h-11 w-11 rounded-lg p-2 text-muted-foreground transition-colors hover:text-foreground hover:bg-muted dark:text-foreground dark:hover:text-foreground dark:hover:bg-accent sm:h-8 sm:w-8"
                aria-label={t('关闭', 'Close')}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>
          </div>

          <div data-readme-layout className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:flex-row">
            {showToc && tocItems.length > 0 && (
              <>
                <div
                  data-readme-toc
                  className="max-h-[40dvh] w-full shrink-0 overflow-y-auto border-b border-border p-4 readme-scrollbar dark:border-border md:max-h-none md:w-[var(--toc-width)] md:border-b-0 md:border-r"
                  style={{ '--toc-width': `${tocWidth}px` } as React.CSSProperties}
                >
                  <h4 className="text-sm font-semibold text-foreground dark:text-foreground mb-3">
                    {t('目录', 'Contents')}
                  </h4>
                  <nav className="space-y-0.5">
                    {tocItems.map((item) => {
                      const displayText = translatedHeadingMap.get(item.id) || item.text;
                      return (
                        <Button
                          key={item.id}
                          variant="ghost"
                          onClick={() => scrollToHeading(item.id, item.text)}
                          className={`block min-h-11 w-full truncate rounded px-2 py-1 text-left text-sm transition-colors sm:h-8 sm:min-h-8 ${tocIndentClass(item.level)} ${tocTextClass(item.level)} ${
                            activeHeadingId === item.id
                              ? 'bg-primary/10 text-primary dark:bg-primary/10 dark:text-primary font-medium'
                              : 'hover:bg-muted dark:hover:bg-card'
                          }`}
                          title={displayText}
                        >
                          {displayText}
                        </Button>
                      );
                    })}
                  </nav>
                </div>
                <div
                  data-readme-resizer
                  onMouseDown={handleResizeMouseDown}
                  className="relative hidden w-1.5 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-ring dark:hover:bg-ring md:block"
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
              </>
            )}

            <div
              ref={contentRef}
              className={`relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto p-4 ${currentFontSize} select-text readme-scrollbar sm:p-6`}
              data-readme-content
              onScroll={handleScroll}
            >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="w-8 h-8 text-primary dark:text-primary animate-spin mb-4" />
                <p className="text-muted-foreground dark:text-muted-foreground">
                  {language === 'zh' ? '正在加载 README…' : 'Loading README…'}
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12">
                <AlertCircle className="w-12 h-12 text-muted-foreground dark:text-muted-foreground mb-4" />
                <p className="text-foreground dark:text-muted-foreground text-center mb-4">
                  {error}
                </p>
                <Button
                  onClick={fetchReadme}
                  className="rounded-lg px-4 py-2 bg-primary text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  {language === 'zh' ? '重试' : 'Retry'}
                </Button>
              </div>
            ) : readmeContent ? (
              <BilingualMarkdownRenderer
                ref={bilingualRef}
                markdown={readmeContent}
                baseUrl={repository?.html_url}
                headingIds={headingIdMap}
                fontSize={getFontSizeType()}
                language={language}
                displayMode={displayMode}
                onDisplayModeChange={setDisplayMode}
                onStatusChange={setTranslateStatus}
                onProgress={(current, total) => setTranslateProgress({ current, total })}
                onHeadingsTranslated={handleHeadingsTranslated}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-12">
                <FileText className="w-12 h-12 text-muted-foreground dark:text-muted-foreground/70 mb-4" />
                <p className="text-muted-foreground dark:text-muted-foreground">
                  {language === 'zh' ? '该仓库没有 README 文件' : 'This repository has no README file'}
                </p>
              </div>
            )}
            </div>

            {showBackToTop && (
              <Button
                onClick={scrollToTop}
                aria-label={t('回到顶部', 'Back to top')}
                className="absolute bottom-[calc(1rem+env(safe-area-inset-bottom))] right-[calc(1rem+env(safe-area-inset-right))] h-11 w-11 rounded-full border border-border bg-card p-0 text-muted-foreground shadow-lg transition-all hover:bg-accent hover:text-foreground dark:border-border dark:bg-muted dark:text-muted-foreground dark:hover:bg-accent sm:bottom-4 sm:right-4 sm:h-8 sm:w-8 z-10"
                title={t('回到顶部', 'Back to top')}
              >
                <ArrowUp className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
