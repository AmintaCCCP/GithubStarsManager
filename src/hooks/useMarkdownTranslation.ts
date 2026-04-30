import { useState, useCallback, useRef } from 'react';
import { translateBatch, clearTranslateCache } from '../services/translateService';
import {
  splitMarkdownForTranslation,
  reconstructMarkdown,
  extractTranslatableChunks,
  mergeTranslatedChunks,
  detectLanguage,
  getTranslateDirection,
} from '../utils/markdownSplitter';

export type TranslationStatus = 'idle' | 'translating' | 'translated' | 'error';

interface UseMarkdownTranslationOptions {
  targetLanguage: 'zh' | 'en';
  onProgress?: (current: number, total: number) => void;
}

interface UseMarkdownTranslationResult {
  status: TranslationStatus;
  progress: { current: number; total: number };
  error: string | null;
  translatedContent: string | null;
  detectedLanguage: 'zh' | 'en' | 'unknown';
  translate: (content: string) => Promise<string | null>;
  revert: () => void;
  clearError: () => void;
  reset: () => void;
}

export const useMarkdownTranslation = (
  options: UseMarkdownTranslationOptions
): UseMarkdownTranslationResult => {
  const { targetLanguage, onProgress } = options;

  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [translatedContent, setTranslatedContent] = useState<string | null>(null);
  const [detectedLanguage, setDetectedLanguage] = useState<'zh' | 'en' | 'unknown'>('unknown');

  const abortControllerRef = useRef<AbortController | null>(null);
  const originalContentRef = useRef<string | null>(null);

  const translate = useCallback(
    async (content: string): Promise<string | null> => {
      if (status === 'translating') {
        return null;
      }

      originalContentRef.current = content;

      const detected = detectLanguage(content);
      setDetectedLanguage(detected);

      if (detected === targetLanguage) {
        setError(detected === 'zh' ? '内容已是中文' : 'Content is already in English');
        setStatus('error');
        return null;
      }

      setStatus('translating');
      setError(null);
      setProgress({ current: 0, total: 0 });

      abortControllerRef.current = new AbortController();

      try {
        const { segments } = splitMarkdownForTranslation(content);
        
        const translatableSegments = segments.filter(s => s.type === 'translatable');

        if (translatableSegments.length === 0) {
          setStatus('translated');
          setTranslatedContent(content);
          return content;
        }

        const chunks = extractTranslatableChunks(segments);

        if (chunks.length === 0) {
          setStatus('translated');
          setTranslatedContent(content);
          return content;
        }

        const totalSegments = translatableSegments.length;
        setProgress({ current: 0, total: totalSegments });
        onProgress?.(0, totalSegments);

        const direction = getTranslateDirection(detected, targetLanguage);

        const chunkTexts = chunks.map(c => c.content);
        
        let completedCount = 0;
        const results = await translateBatch(
          chunkTexts,
          direction.to,
          direction.from,
          abortControllerRef.current.signal
        );

        const translations = results.map((r) => r.translatedText);

        const translatedMap = mergeTranslatedChunks(chunks, translations);
        
        completedCount = translations.length;
        setProgress({ current: completedCount, total: totalSegments });
        onProgress?.(completedCount, totalSegments);

        const result = reconstructMarkdown(segments, translatedMap);

        setStatus('translated');
        setTranslatedContent(result);
        setProgress({ current: totalSegments, total: totalSegments });
        onProgress?.(totalSegments, totalSegments);

        return result;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setStatus('idle');
          return null;
        }

        const errorMessage =
          err instanceof Error ? err.message : 'Translation failed';
        setError(errorMessage);
        setStatus('error');
        return null;
      }
    },
    [status, targetLanguage, onProgress]
  );

  const revert = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setStatus('idle');
    setTranslatedContent(null);
    setProgress({ current: 0, total: 0 });
    setError(null);
  }, []);

  const clearError = useCallback(() => {
    setError(null);
    if (status === 'error') {
      setStatus('idle');
    }
  }, [status]);

  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setStatus('idle');
    setTranslatedContent(null);
    setProgress({ current: 0, total: 0 });
    setError(null);
    setDetectedLanguage('unknown');
    originalContentRef.current = null;
  }, []);

  return {
    status,
    progress,
    error,
    translatedContent,
    detectedLanguage,
    translate,
    revert,
    clearError,
    reset,
  };
};

export const clearTranslationTokenCache = (): void => {
  clearTranslateCache();
};
