import { i18n } from '../i18n';
import { useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
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
  repository: Pick<Repository, 'full_name' | 'html_url' | 'owner' | 'default_branch'> | null;
}

const FONT_SIZES = [
  { label: '小', labelEn: 'Small', value: 'text-sm' },
  { label: '中', labelEn: 'Medium', value: 'text-base' },
  { label: '大', labelEn: 'Large', value: 'text-lg' },
];

const TOC_MAX_LEVEL = 6;

const shouldOpenTocByDefault = (): boolean => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return true;
  }
  return !window.matchMedia('(max-width: 767px)').matches;
};

const getDefaultReadmeVariant = (language: AppLanguage): ReadmeVariant => ({
  ...DEFAULT_README_VARIANT,
  label: i18n.getFixedT(language, 'app')('readmeModal.default-readme'),
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
  const [showToc, setShowToc] = useState(shouldOpenTocByDefault);
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

  const scrollRafRef = useRef<number | null>(null);
  const scrollFrameUsesRafRef = useRef(false);

  // 进度条读取 scrollHeight/clientHeight 会强制布局，用 rAF 合帧避免滚动时反复重排。
  const handleScroll = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    const run = () => {
      scrollRafRef.current = null;
      if (!contentRef.current) return;
      const container = contentRef.current;
      const { scrollTop, scrollHeight, clientHeight } = container;
      const progress = scrollHeight <= clientHeight ? 0 : (scrollTop / (scrollHeight - clientHeight)) * 100;
      setScrollProgress(Math.min(100, Math.max(0, progress)));
      setShowBackToTop(scrollTop > 300);
    };
    // 记录本次调度用的 API：取消时按同一 API 取消，避免环境变化后错配 id 类型。
    if (typeof window.requestAnimationFrame === 'function') {
      scrollFrameUsesRafRef.current = true;
      scrollRafRef.current = window.requestAnimationFrame(run);
    } else {
      scrollFrameUsesRafRef.current = false;
      scrollRafRef.current = window.setTimeout(run, 16) as unknown as number;
    }
  }, []);

  useEffect(() => () => {
    if (scrollRafRef.current === null) return;
    if (scrollFrameUsesRafRef.current) {
      window.cancelAnimationFrame(scrollRafRef.current);
    } else {
      window.clearTimeout(scrollRafRef.current);
    }
    scrollRafRef.current = null;
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

  const t = useT('app');

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
          ? (t('readmeModal.this-repository-has-no-readme-file'))
          : (t('readmeModal.this-readme-file-is-empty')));
      }
      setLoading(false);
    } catch (err) {
      // 被 hook abort（被新请求取代 / cancel）时静默返回，不动 loading 态
      if (isAbortError(err)) return;
      console.error('Failed to fetch README:', err);
      setReadmeContent('');
      const fallbackMessage = variant.isDefault
        ? (t('readmeModal.failed-to-load-readme-please-check-your-network'))
        : (t('readmeModal.failed-to-load-selected-readme-please-try-again'));
      setError(err instanceof Error && err.message ? err.message : fallbackMessage);
      setLoading(false);
    }
  }, [repository, fetchReadmeContentFromAvailableSource, t]);

  const fetchReadmeVariants = useCallback(async () => {
    if (!repository) return;

    setVariantsLoading(true);

    try {
      const defaultBranch = repository.default_branch;
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
          ? (t('readmeModal.this-repository-has-no-readme-file'))
          : (t('readmeModal.this-readme-file-is-empty')));
      return;
    }

    void fetchReadmeContent(nextVariant);
  }, [selectedReadmeKey, readmeVariants, readmeCache, resetReadmeViewState, fetchReadmeContent, t]);

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
      setShowToc(shouldOpenTocByDefault());
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
    if (level <= 2) return 'font-medium text-foreground';
    if (level <= 4) return 'text-secondary';
    return 'text-tertiary text-label-sm';
  };

  const isTranslating = translateStatus === 'translating';
  const isTranslated = translateStatus === 'translated';
  const isTranslateError = translateStatus === 'error';
  const currentReadmeVariant = pickReadmeCandidate(readmeVariants, selectedReadmeKey, defaultReadmeVariant);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showClose={false}
        fullscreen
        aria-describedby={undefined}
        className="flex min-w-0 flex-col overflow-hidden p-0"
        onCloseAutoFocus={(event) => {
          if (!onCloseAutoFocus) return;
          event.preventDefault();
          onCloseAutoFocus();
        }}
      >
        <div className="relative flex min-h-0 min-w-0 max-w-full w-full flex-1 flex-col overflow-hidden bg-paper">
          {readmeContent && !loading && (
            <div className="absolute top-0 left-0 right-0 z-20 h-0.5 overflow-hidden bg-fill-hover">
              <div
                className="h-full bg-accent-solid transition-[width] duration-150 ease-out"
                style={{ width: `${scrollProgress}%` }}
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 border-b border-subtle bg-paper px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2.5">
              <img
                src={repository.owner.avatar_url}
                alt={repository.owner.login}
                className="size-7 shrink-0 rounded-sm object-cover shadow-elev-0"
              />
              <div className="min-w-0">
                <DialogTitle className="truncate text-label-lg font-semibold text-foreground">
                  {repository.full_name}
                </DialogTitle>
                <p className="max-w-[260px] truncate text-label-sm text-tertiary" title={currentReadmeVariant.path || 'README'}>
                  {currentReadmeVariant.isDefault ? 'README' : currentReadmeVariant.path}
                </p>
              </div>
            </div>
            <div className="flex max-w-full flex-wrap items-center justify-end gap-1">
              {readmeVariants.length > 1 && (
                <Select value={selectedReadmeKey} onValueChange={handleReadmeVariantChange} disabled={loading || variantsLoading}>
                  <SelectTrigger className="h-control w-auto min-w-[7rem] max-w-[220px] rounded-md px-2 text-label" title={t('readmeModal.switch-readme-language')} aria-label={t('readmeModal.switch-readme-language')}><SelectValue /></SelectTrigger>
                  <SelectContent>{readmeVariants.map((variant) => <SelectItem key={variant.key} value={variant.key}>{variant.label}</SelectItem>)}</SelectContent>
                </Select>
              )}
              {readmeContent && !loading && (
                isTranslated ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={handleRevertTranslation}
                      className="h-control gap-1 rounded-md bg-accent-tint px-2.5 text-label text-accent-text hover:bg-accent-tint-strong"
                      title={t('readmeModal.close-translation')}
                    >
                      <Languages className="size-3.5" />
                      <span className="hidden sm:inline">{t('readmeModal.translated')}</span>
                    </Button>
                    {([
                      { mode: 'original' as DisplayMode, icon: FileText, label: t('readmeModal.original') },
                      { mode: 'translated' as DisplayMode, icon: Languages, label: t('readmeModal.translated-2') },
                      { mode: 'bilingual' as DisplayMode, icon: Eye, label: t('readmeModal.bilingual') },
                    ]).map(({ mode, icon: Icon, label }) => (
                      <Button
                        key={mode}
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={() => setDisplayMode(mode)}
                        className={`h-control gap-1 rounded-md px-2 text-label ${
                          displayMode === mode
                            ? 'bg-accent-tint text-accent-text'
                            : 'text-secondary hover:text-foreground'
                        }`}
                        title={label}
                      >
                        <Icon className="size-3.5" />
                        <span className="hidden sm:inline">{label}</span>
                      </Button>
                    ))}
                  </>
                ) : isTranslateError ? (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="md"
                      onClick={handleTranslate}
                      className="h-control gap-1 rounded-md px-2.5 text-label text-warning hover:bg-warning-tint"
                      title={t('readmeModal.retry-translation')}
                    >
                      <Languages className="size-3.5" />
                      <span className="hidden sm:inline">{t('readmeModal.retry')}</span>
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={handleRevertTranslation}
                      className="size-control rounded-md text-secondary hover:text-foreground"
                      title={t('readmeModal.close-translation')}
                    >
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="md"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="h-control gap-1.5 rounded-md px-2.5 text-label text-secondary hover:text-foreground"
                    title={t('readmeModal.translate-document')}
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span className="hidden sm:inline tabular-nums">
                          {translateProgress.total > 0 
                            ? `${translateProgress.current}/${translateProgress.total}` 
                            : t('readmeModal.translating')}
                        </span>
                      </>
                    ) : (
                      <>
                        <Languages className="size-3.5" />
                        <span className="hidden sm:inline">{language === 'zh' ? t('readmeModal.translate-to-chinese') : t('readmeModal.translate-to-english')}</span>
                      </>
                    )}
                  </Button>
                )
              )}
              {translateError && (
                <div
                  className={`cursor-pointer rounded-md bg-destructive-tint px-2.5 py-1 text-label-sm text-destructive ${errorExpanded ? 'max-w-[400px] whitespace-normal break-all' : 'max-w-[200px] truncate'}`}
                  onClick={() => setErrorExpanded(!errorExpanded)}
                  title={!errorExpanded ? translateError : undefined}
                >
                  {translateError}
                </div>
              )}
              {tocItems.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowToc(!showToc)}
                  aria-label={t('readmeModal.table-of-contents')}
                  className={`size-control rounded-md p-0 ${
                    showToc
                      ? 'bg-accent-tint text-accent-text'
                      : 'text-secondary hover:text-foreground'
                  }`}
                  title={t('readmeModal.table-of-contents')}
                >
                  <List className="size-4" />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('readmeModal.cycle-font-size')}
                onClick={cycleFontSize}
                className="size-control rounded-md p-0 text-secondary hover:text-foreground"
                title={t('readmeModal.font-size-v1', { v1: FONT_SIZES[fontSizeIndex].label })}
              >
                <Type className="size-4" />
              </Button>
              <a
                href={repository.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex h-control items-center gap-1.5 rounded-md px-2.5 text-label font-medium text-secondary transition-colors hover:bg-fill-hover hover:text-foreground"
                title={t('readmeModal.view-on-github')}
              >
                <ExternalLink className="size-3.5" />
                <span className="hidden sm:inline">{t('readmeModal.view-on-github')}</span>
              </a>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="size-control rounded-md text-secondary hover:text-foreground"
                aria-label={t('readmeModal.close')}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>

          <div className="app-readme-body flex min-h-0 min-w-0 flex-1 overflow-hidden">
            {showToc && tocItems.length > 0 && (
              <>
                <div
                  className="app-readme-toc shrink-0 overflow-y-auto border-r border-subtle bg-navigator p-3 readme-scrollbar md:w-[var(--readme-toc-width)]"
                  style={{ '--readme-toc-width': `${tocWidth}px` } as React.CSSProperties}
                >
                  <h4 className="mb-2 px-2 text-label-sm font-medium text-tertiary">
                    {t('readmeModal.contents')}
                  </h4>
                  <nav className="space-y-px">
                    {tocItems.map((item) => {
                      const displayText = translatedHeadingMap.get(item.id) || item.text;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            scrollToHeading(item.id, item.text);
                            if (window.matchMedia?.('(max-width: 767px)').matches) {
                              setShowToc(false);
                            }
                          }}
                          className={`motion-press block h-auto min-h-row-sidebar w-full truncate rounded-sm px-2 py-1 text-left text-label-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 ${tocIndentClass(item.level)} ${tocTextClass(item.level)} ${
                            activeHeadingId === item.id
                              ? 'bg-fill-selected font-medium text-foreground'
                              : 'hover:bg-fill-hover hover:text-foreground'
                          }`}
                          title={displayText}
                        >
                          {displayText}
                        </button>
                      );
                    })}
                  </nav>
                </div>
                <div
                  onMouseDown={handleResizeMouseDown}
                  className="app-readme-resize-handle group relative w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-ring"
                >
                  <div className="absolute inset-y-0 -left-1 -right-1" />
                </div>
              </>
            )}

            <div
              ref={contentRef}
              className={`app-readme-content relative min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-auto p-6 ${currentFontSize} select-text readme-scrollbar`}
              onScroll={handleScroll}
            >
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12">
                <Loader2 className="mb-3 size-8 animate-spin text-accent-text" />
                <p className="text-label text-secondary">
                  {t('readmeModal.loading-readme')}
                </p>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertCircle className="mb-3 size-10 stroke-[1.5] text-tertiary" />
                <p className="mb-4 max-w-sm text-label text-secondary">
                  {error}
                </p>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={fetchReadme}
                >
                  {t('readmeModal.retry')}
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
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <FileText className="mb-3 size-10 stroke-[1.5] text-tertiary" />
                <p className="text-label text-secondary">
                  {t('readmeModal.this-repository-has-no-readme-file')}
                </p>
              </div>
            )}
            </div>

            {showBackToTop && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={scrollToTop}
                aria-label={t('readmeModal.back-to-top')}
                className="absolute bottom-4 right-4 z-10 size-control rounded-md bg-floating shadow-elev-2 text-secondary hover:text-foreground"
                title={t('readmeModal.back-to-top')}
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
