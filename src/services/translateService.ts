import { backend } from './backendAdapter';
import type { TranslateResult } from '../types';

export type { TranslateResult };

export interface TranslateOptions {
  from?: string;
  to: string;
  text: string;
  signal?: AbortSignal;
  textType?: 'html' | 'plain';
}

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const id = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

const withRetry = async <T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
  maxRetries = 3,
  baseDelay = 1000
): Promise<T> => {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      const name = (err as { name?: string })?.name;
      if (name === 'AbortError' || name === 'CanceledError') {
        throw err;
      }

      if (attempt >= maxRetries) break;

      // 仅在网络错误或服务端错误时重试
      const msg = lastError.message;
      const isTransient =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('AbortError') ||
        msg.includes('Gateway Timeout') ||
        msg.includes('Bad Gateway') ||
        msg.includes('429');

      if (!isTransient) {
        throw err;
      }

      await sleep(baseDelay * Math.pow(2, attempt - 1), signal);
    }
  }

  throw lastError!;
};

export const translateText = async (options: TranslateOptions): Promise<TranslateResult> => {
  const { from, to, text, signal, textType } = options;

  if (!text || text.trim() === '') {
    return { translatedText: text, detectedLanguage: '' };
  }

  return withRetry(async () => {
    const results = await backend.translate([text], to, from, textType);
    return results[0] || { translatedText: text, detectedLanguage: '' };
  }, signal, 3);
};

function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split('\n');
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 1 > maxChars && current.length > 0) {
      chunks.push(current);
      current = para;
    } else if (current.length > 0) {
      current += '\n' + para;
    } else {
      current = para;
    }

    while (current.length > maxChars) {
      const splitPoint = current.lastIndexOf(' ', maxChars);
      if (splitPoint <= 0) {
        chunks.push(current.slice(0, maxChars));
        current = current.slice(maxChars);
      } else {
        chunks.push(current.slice(0, splitPoint));
        current = current.slice(splitPoint + 1);
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export const translateBatch = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal,
  textType?: 'html' | 'plain'
): Promise<TranslateResult[]> => {
  if (texts.length === 0) return [];

  if (texts.length === 1) {
    const result = await translateText({ text: texts[0], to, from, signal, textType });
    return [result];
  }

  const results: TranslateResult[] = [];
  const batchSize = 100;
  const maxChars = 50000;

  for (let i = 0; i < texts.length; i += batchSize) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const batch = texts.slice(i, i + batchSize);
    let currentBatch: string[] = [];
    let currentLength = 0;

    for (const text of batch) {
      if (text.length > maxChars) {
        if (currentBatch.length > 0) {
          const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType);
          results.push(...batchResults);
          currentBatch = [];
          currentLength = 0;
        }
        const chunks = splitTextIntoChunks(text, maxChars);
        for (const chunk of chunks) {
          const batchResults = await translateBatchInternal([chunk], to, from, signal, textType);
          results.push(...batchResults);
        }
        continue;
      }

      if (currentLength + text.length > maxChars && currentBatch.length > 0) {
        const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType);
        results.push(...batchResults);
        currentBatch = [];
        currentLength = 0;
      }
      currentBatch.push(text);
      currentLength += text.length;
    }

    if (currentBatch.length > 0) {
      const batchResults = await translateBatchInternal(currentBatch, to, from, signal, textType);
      results.push(...batchResults);
    }
  }

  return results;
};

const translateBatchInternal = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal,
  textType?: 'html' | 'plain'
): Promise<TranslateResult[]> => {
  return withRetry(async () => {
    return backend.translate(texts, to, from, textType);
  }, signal, 3);
};
