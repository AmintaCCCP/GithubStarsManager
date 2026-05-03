import { memo, useState, useRef, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import {
  scanDomForTranslation,
  ATTR_ORIGINAL,
  ATTR_TRANSLATION,
  DomBlockSegment,
  wrapTextNodesWithAttr,
  unwrapSpans,
} from '../utils/domTextScanner';
import { translateBatch } from '../services/translateService';
import { detectLanguage, getTranslateDirection, cleanTranslatedText } from '../utils/markdownSplitter';
import { FileText, Languages, Eye, Loader2 } from 'lucide-react';

export type DisplayMode = 'original' | 'translated' | 'bilingual';
export type TranslationStatus = 'idle' | 'scanning' | 'translating' | 'translated' | 'error';

export interface BilingualMarkdownRendererHandle {
  translate: () => Promise<void>;
  revert: () => void;
  getStatus: () => TranslationStatus;
}

interface BilingualMarkdownRendererProps {
  markdown: string;
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  language?: 'zh' | 'en';
  defaultDisplayMode?: DisplayMode;
  displayMode?: DisplayMode;
  onDisplayModeChange?: (mode: DisplayMode) => void;
  onStatusChange?: (status: TranslationStatus) => void;
  onProgress?: (current: number, total: number) => void;
  onHeadingsTranslated?: (headings: { id: string; text: string }[]) => void;
  autoTranslate?: boolean;
}

const BILINGUAL_MODE_CSS = `
.bimd-mode-translated [${ATTR_ORIGINAL}] { display: none !important; }
.bimd-mode-original [${ATTR_TRANSLATION}] { display: none !important; }
[${ATTR_TRANSLATION}] code {
  background: rgba(0,0,0,0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.92em;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  [${ATTR_TRANSLATION}] code {
    background: rgba(255,255,255,0.1);
  }
}
`;

function appendSafeHTMLNodes(target: HTMLElement, source: HTMLElement): void {
  for (let i = 0; i < source.childNodes.length; i++) {
    const child = source.childNodes[i];
    if (child.nodeType === Node.TEXT_NODE) {
      target.appendChild(document.createTextNode(child.textContent || ''));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as HTMLElement;
      if (el.tagName.toLowerCase() === 'code') {
        const codeEl = document.createElement('code');
        codeEl.textContent = el.textContent || '';
        target.appendChild(codeEl);
      } else {
        appendSafeHTMLNodes(target, el);
      }
    }
  }
}

const BilingualMarkdownRenderer = forwardRef<BilingualMarkdownRendererHandle, BilingualMarkdownRendererProps>(({
  markdown,
  baseUrl,
  headingIds,
  fontSize = 'medium',
  language = 'zh',
  defaultDisplayMode = 'bilingual',
  displayMode: controlledDisplayMode,
  onDisplayModeChange,
  onStatusChange,
  onProgress,
  onHeadingsTranslated,
  autoTranslate = false,
}, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentsRef = useRef<DomBlockSegment[]>([]);
  const translationElementsRef = useRef<Map<number, HTMLElement>>(new Map());
  const originalSpansRef = useRef<HTMLElement[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const statusRef = useRef<TranslationStatus>('idle');
  const onHeadingsTranslatedRef = useRef(onHeadingsTranslated);
  onHeadingsTranslatedRef.current = onHeadingsTranslated;

  const [internalDisplayMode, setInternalDisplayMode] = useState<DisplayMode>(defaultDisplayMode);
  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);

  const isControlled = controlledDisplayMode !== undefined;
  const displayMode = isControlled ? controlledDisplayMode : internalDisplayMode;
  const modeClass = `bimd-mode-${displayMode}`;

  const updateStatus = useCallback((newStatus: TranslationStatus) => {
    statusRef.current = newStatus;
    setStatus(newStatus);
    onStatusChange?.(newStatus);
  }, [onStatusChange]);

  const removeTranslations = useCallback(() => {
    translationElementsRef.current.forEach(el => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
    translationElementsRef.current.clear();

    unwrapSpans(originalSpansRef.current);
    originalSpansRef.current = [];

    segmentsRef.current.forEach(seg => {
      if (!seg.hasVisualContent) {
        seg.element.removeAttribute(ATTR_ORIGINAL);
      }
    });
    segmentsRef.current = [];
  }, []);

  const scan = useCallback((): DomBlockSegment[] => {
    const container = containerRef.current;
    if (!container) return [];
    const segments = scanDomForTranslation(container);
    segmentsRef.current = segments;
    return segments;
  }, []);

  const translate = useCallback(async () => {
    const container = containerRef.current;
    if (!container || statusRef.current === 'translating') return;

    removeTranslations();

    const segments = scan();
    if (segments.length === 0) {
      updateStatus('translated');
      return;
    }

    const detected = detectLanguage(markdown);
    const targetLang = language;

    if (detected === targetLang) {
      setError(language === 'zh' ? '内容已是中文，无需翻译' : 'Content is already in English');
      updateStatus('error');
      return;
    }

    const direction = getTranslateDirection(detected, targetLang);

    for (const segment of segments) {
      if (segment.hasVisualContent) {
        const spans = wrapTextNodesWithAttr(segment.element, ATTR_ORIGINAL, 'true');
        originalSpansRef.current.push(...spans);
      } else {
        segment.element.setAttribute(ATTR_ORIGINAL, 'true');
      }
    }

    updateStatus('translating');
    setProgress({ current: 0, total: segments.length });
    setError(null);

    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;

    try {

      const batchSize = 10;
      let completedCount = 0;
      const translatedTexts: string[] = new Array(segments.length).fill('');

      for (let i = 0; i < segments.length; i += batchSize) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        const batchIndices: number[] = [];
        const batchTexts: string[] = [];

        for (let j = i; j < Math.min(i + batchSize, segments.length); j++) {
          if (segments[j].text.trim()) {
            batchTexts.push(segments[j].text);
            batchIndices.push(j);
          }
        }

        if (batchTexts.length === 0) continue;

        const batchHasInlineCode = batchIndices.some(j => segments[j].hasInlineCode);
        const textType = batchHasInlineCode ? 'html' as const : 'plain' as const;

        const results = await translateBatch(batchTexts, direction.to, direction.from, signal, textType);

        batchIndices.forEach((segIndex, resultIndex) => {
          translatedTexts[segIndex] = cleanTranslatedText(results[resultIndex]?.translatedText || '');
        });

        completedCount += batchIndices.length;
        setProgress({ current: completedCount, total: segments.length });
        onProgress?.(completedCount, segments.length);
      }

      for (let i = 0; i < segments.length; i++) {
        if (!translatedTexts[i]) continue;

        const wrapper = document.createElement('div');
        wrapper.setAttribute(ATTR_TRANSLATION, 'true');
        wrapper.className =
          'mt-1 pl-3 border-l-2 border-blue-400 dark:border-blue-500 text-gray-600 dark:text-text-tertiary text-sm leading-relaxed';

        if (segments[i].hasInlineCode) {
          const temp = document.createElement('div');
          temp.innerHTML = translatedTexts[i];
          appendSafeHTMLNodes(wrapper, temp);
        } else {
          wrapper.textContent = translatedTexts[i];
        }

        if (segments[i].blockType === 'heading' && segments[i].element.id) {
          wrapper.setAttribute('data-bi-heading-id', segments[i].element.id);
        }

        segments[i].element.after(wrapper);
        translationElementsRef.current.set(segments[i].id, wrapper);
      }

      if (onHeadingsTranslatedRef.current) {
        const headingTranslations: { id: string; text: string }[] = [];
        for (let i = 0; i < segments.length; i++) {
          if (segments[i].blockType === 'heading' && segments[i].element.id && translatedTexts[i]) {
            headingTranslations.push({ id: segments[i].element.id, text: translatedTexts[i] });
          }
        }
        if (headingTranslations.length > 0) {
          onHeadingsTranslatedRef.current(headingTranslations);
        }
      }

      updateStatus('translated');
      setProgress({ current: segments.length, total: segments.length });
      onProgress?.(segments.length, segments.length);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') {
        updateStatus('idle');
        return;
      }
      setError(err instanceof Error ? err.message : 'Translation failed');
      updateStatus('error');
    }
  }, [markdown, language, scan, updateStatus, removeTranslations, onProgress]);

  const revert = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    removeTranslations();
    updateStatus('idle');
    setError(null);
    setProgress({ current: 0, total: 0 });
  }, [removeTranslations, updateStatus]);

  useImperativeHandle(ref, () => ({
    translate,
    revert,
    getStatus: () => statusRef.current,
  }), [translate, revert]);

  useEffect(() => {
    revert();
    const timer = setTimeout(() => {
      if (containerRef.current) {
        scan();
        if (autoTranslate) {
          translate();
        }
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [markdown]);

  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, []);

  const handleModeChange = (newMode: DisplayMode) => {
    if (!isControlled) {
      setInternalDisplayMode(newMode);
    }
    onDisplayModeChange?.(newMode);
  };

  const isTranslated = status === 'translated';

  return (
    <div className={`bilingual-markdown ${modeClass}`}>
      <style>{BILINGUAL_MODE_CSS}</style>

      {!isControlled && (
        <div className="flex items-center justify-end gap-1 mb-3 pb-2 border-b border-gray-100 dark:border-white/[0.04]">
          {[
            {
              mode: 'original' as DisplayMode,
              icon: FileText,
              label: language === 'zh' ? '原文' : 'Original',
            },
            {
              mode: 'translated' as DisplayMode,
              icon: Languages,
              label: language === 'zh' ? '译文' : 'Translated',
            },
            {
              mode: 'bilingual' as DisplayMode,
              icon: Eye,
              label: language === 'zh' ? '双语' : 'Bilingual',
            },
          ].map(({ mode, icon: Icon, label }) => {
            const active = displayMode === mode;
            const disabled = mode !== 'original' && !isTranslated;
            return (
              <button
                key={mode}
                onClick={() => handleModeChange(mode)}
                disabled={disabled}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
                  active
                    ? 'bg-brand-indigo/20 text-brand-violet dark:bg-brand-indigo/10'
                    : disabled
                      ? 'text-gray-300 dark:text-text-quaternary cursor-not-allowed'
                      : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-light-surface dark:hover:bg-white/5'
                }`}
                title={label}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </button>
            );
          })}
        </div>
      )}

      <div ref={containerRef}>
        <MarkdownRenderer
          content={markdown}
          baseUrl={baseUrl}
          headingIds={headingIds}
          fontSize={fontSize}
          enableHtml={true}
        />
      </div>

      {status === 'translating' && (
        <div className="flex items-center justify-center py-4 gap-2 text-sm text-gray-500 dark:text-text-tertiary">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>
            {language === 'zh' ? '翻译中...' : 'Translating...'}
            {progress.total > 0 && ` ${progress.current}/${progress.total}`}
          </span>
        </div>
      )}

      {error && (
        <div className="text-center py-2 text-sm text-red-500 dark:text-red-400">{error}</div>
      )}
    </div>
  );
});

BilingualMarkdownRenderer.displayName = 'BilingualMarkdownRenderer';

export default memo(BilingualMarkdownRenderer);
