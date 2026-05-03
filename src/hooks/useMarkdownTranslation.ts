import { useState, useCallback, useRef } from 'react';
import { translateBatch, clearTranslateCache } from '../services/translateService';
import {
  splitMarkdownSimple,
  restorePlaceholders,
  detectLanguage,
  getTranslateDirection,
  TranslationSegment,
  cleanTranslatedText,
} from '../utils/markdownSplitter';

export type TranslationStatus = 'idle' | 'translating' | 'translated' | 'error';

interface UseMarkdownTranslationOptions {
  targetLanguage: 'zh' | 'en';
  onProgress?: (current: number, total: number) => void;
  onSegmentTranslated?: (index: number, total: number) => void;
}

interface UseMarkdownTranslationResult {
  status: TranslationStatus;
  progress: { current: number; total: number };
  error: string | null;
  segments: TranslationSegment[];
  placeholderMap: Map<string, string>;
  detectedLanguage: 'zh' | 'en' | 'unknown';
  translate: (content: string) => Promise<boolean>;
  revert: () => void;
  clearError: () => void;
  reset: () => void;
}

export const useMarkdownTranslation = (
  options: UseMarkdownTranslationOptions
): UseMarkdownTranslationResult => {
  const { targetLanguage, onProgress, onSegmentTranslated } = options;

  const [status, setStatus] = useState<TranslationStatus>('idle');
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranslationSegment[]>([]);
  const [placeholderMap, setPlaceholderMap] = useState<Map<string, string>>(new Map());
  const [detectedLanguage, setDetectedLanguage] = useState<'zh' | 'en' | 'unknown'>('unknown');

  const abortControllerRef = useRef<AbortController | null>(null);

  const translate = useCallback(
    async (content: string): Promise<boolean> => {
      if (status === 'translating') {
        return false;
      }

      const { segments: newSegments, placeholderMap: newPlaceholderMap } = splitMarkdownSimple(content);
      
      if (newSegments.length === 0) {
        setStatus('translated');
        setSegments([]);
        setPlaceholderMap(new Map());
        return true;
      }

      const detected = detectLanguage(content);
      setDetectedLanguage(detected);

      if (detected === targetLanguage) {
        setError(detected === 'zh' ? '内容已是中文' : 'Content is already in English');
        setStatus('error');
        return false;
      }

      setStatus('translating');
      setError(null);
      setSegments(newSegments);
      setPlaceholderMap(newPlaceholderMap);
      setProgress({ current: 0, total: newSegments.length });

      abortControllerRef.current = new AbortController();

      try {
        const direction = getTranslateDirection(detected, targetLanguage);
        const totalSegments = newSegments.length;
        let completedCount = 0;

        const batchSize = 10;
        for (let i = 0; i < totalSegments; i += batchSize) {
          if (abortControllerRef.current.signal.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          const batchIndices: number[] = [];
          const batchTexts: string[] = [];
          
          for (let j = i; j < Math.min(i + batchSize, totalSegments); j++) {
            const segment = newSegments[j];
            if (segment.hasCodeBlock) {
              batchTexts.push(segment.originalContent);
              batchIndices.push(j);
            } else if (segment.originalContent.trim()) {
              batchTexts.push(segment.originalContent);
              batchIndices.push(j);
            }
          }

          if (batchTexts.length === 0) continue;

          const results = await translateBatch(
            batchTexts,
            direction.to,
            direction.from,
            abortControllerRef.current.signal
          );

          setSegments(prev => {
            const updated = [...prev];
            batchIndices.forEach((segIndex, resultIndex) => {
              let translatedText = results[resultIndex]?.translatedText || '';
              translatedText = restorePlaceholders(translatedText, newPlaceholderMap);
              translatedText = cleanTranslatedText(translatedText);
              updated[segIndex] = {
                ...updated[segIndex],
                translatedContent: translatedText,
                status: 'done',
              };
            });
            return updated;
          });

          completedCount += batchIndices.length;
          setProgress({ current: completedCount, total: totalSegments });
          onProgress?.(completedCount, totalSegments);
          batchIndices.forEach((segIndex) => {
            onSegmentTranslated?.(segIndex, totalSegments);
          });
        }

        setStatus('translated');
        setProgress({ current: totalSegments, total: totalSegments });
        onProgress?.(totalSegments, totalSegments);
        return true;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          setStatus('idle');
          return false;
        }

        const errorMessage =
          err instanceof Error ? err.message : 'Translation failed';
        setError(errorMessage);
        setStatus('error');
        return false;
      }
    },
    [status, targetLanguage, onProgress, onSegmentTranslated]
  );

  const revert = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    setStatus('idle');
    setSegments([]);
    setPlaceholderMap(new Map());
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
    setSegments([]);
    setPlaceholderMap(new Map());
    setProgress({ current: 0, total: 0 });
    setError(null);
    setDetectedLanguage('unknown');
  }, []);

  return {
    status,
    progress,
    error,
    segments,
    placeholderMap,
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
