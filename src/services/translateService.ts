import queryString from 'query-string';
import { createCombinedAbortController } from '../utils/abortUtils';
import { useAppStore } from '../store/useAppStore';
import { AIService } from './aiService';
import type { TranslationEngine } from '../types';

export interface TranslateResult {
  translatedText: string;
  detectedLanguage: string;
}

export interface TranslateOptions {
  from?: string;
  to: string;
  text: string;
  signal?: AbortSignal;
  textType?: 'html' | 'plain';
}

/** 微软 Edge 翻译（免费、无需鉴权）。旧版 Bearer token 鉴权端点已下线（404）。 */
const MS_TRANSLATE_URL = 'https://edge.microsoft.com/translate/translatetext';
/** Google 翻译免费接口（Chrome 扩展同款，CORS 全放行）。 */
const GOOGLE_TRANSLATE_URL = 'https://clients5.google.com/translate_a/t';

/** 翻译请求超时：单批最多 50k 字符，慢网下放宽到 20s；超时同时覆盖响应体读取。 */
const TRANSLATE_TIMEOUT_MS = 20_000;
/** AI 翻译单次请求超时：LLM 生成较慢，给足余量。 */
const AI_TRANSLATE_TIMEOUT_MS = 90_000;

/** 单条 HTTP 请求的引擎分块参数：请求数 × 字符上限（微软引擎沿用外层 translateBatch 的 100 条 / 50k 字符上限）。 */
const GOOGLE_BATCH_LIMITS = { texts: 20, chars: 1_800 };
const AI_BATCH_LIMITS = { texts: 10 };

/** 应用内语言代码 → 引擎语言代码映射（zh 在两家引擎里都不是合法目标码）。 */
const MICROSOFT_LANG: Record<string, string> = { zh: 'zh-Hans' };
const GOOGLE_LANG: Record<string, string> = { zh: 'zh-CN' };

/** 匹配行内 <code>…</code> 标签（可带属性）。注意以 /g 使用前需重置 lastIndex。 */
const CODE_TAG_PATTERN = /<code(?:\s+[^>]*)?>[\s\S]*?<\/code>/g;

interface MsTranslateItem {
  translations?: { text?: string }[];
}

/**
 * 带超时的请求：fetch 与响应体消费（response.json() 等）都在超时管控内，
 * 慢速 body 读取同样会被超时中止。超时转换为普通 Error（无 status →
 * isTransientError 视为瞬时，外层 withTranslateRetry 会重试）；
 * 调用方主动中止仍以 AbortError 抛出（不重试）。
 */
const fetchWithTimeout = async <T>(
  url: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>
): Promise<T> => {
  const controller = createCombinedAbortController(signal, timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await consume(response);
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError' && !signal?.aborted) {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
};

/**
 * 把单条文本中的 <code>…</code> 替换为 {0} {1} 占位符（机器翻译引擎会原样
 * 保留 .NET 风格占位符），翻译后再还原。任一占位符在译文中丢失时回退整条
 * 原文，避免向渲染层输出损坏的代码标签。
 */
const protectInlineCode = (text: string): { payload: string; restore: (translated: string) => string } => {
  const codes: string[] = [];
  const payload = text.replace(CODE_TAG_PATTERN, (match) => {
    codes.push(match);
    return `{${codes.length - 1}}`;
  });
  CODE_TAG_PATTERN.lastIndex = 0;
  return {
    payload,
    restore: (translated) => {
      let result = translated;
      for (let i = 0; i < codes.length; i++) {
        const token = `{${i}}`;
        if (!result.includes(token)) return text;
        result = result.replace(token, codes[i]);
      }
      return result;
    },
  };
};

/**
 * 批量包装：仅对 html 类型（含行内代码的段落）启用占位符保护；
 * 文本自身已含 {数字}（如格式化字符串文档）时无法安全区分占位符，退化为原文直发。
 */
const protectBatch = (
  texts: string[],
  textType?: 'html' | 'plain'
): { payload: string[]; restore: (translated: string[]) => string[] } => {
  if (textType !== 'html') {
    return { payload: texts, restore: (translated) => translated };
  }
  const items = texts.map((text) =>
    /\{\d+\}/.test(text) ? { payload: text, restore: (t: string) => t } : protectInlineCode(text)
  );
  return {
    payload: items.map((item) => item.payload),
    restore: (translated) => translated.map((t, i) => items[i].restore(t)),
  };
};

/**
 * 从错误对象中提取 HTTP 状态码：优先读 status/response.status 字段
 * （如 AIRequestError），否则从 message 里匹配 "failed: 429" 之类的片段。
 */
const extractHttpStatus = (err: unknown): number | null => {
  const anyErr = err as Record<string, unknown>;
  const response = anyErr?.response as Record<string, unknown> | undefined;
  const status = response?.status ?? anyErr?.status;
  if (typeof status === 'number') return status;

  if (err instanceof Error) {
    const match = err.message.match(/(?:status|failed)[:\s]*(\d{3})/i);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
};

/** 判断错误是否值得重试：鉴权过期、无状态码（网络/超时/格式）、429 与 5xx 均视为瞬时。 */
const isTransientError = (err: unknown): boolean => {
  const status = extractHttpStatus(err);
  if (status === null) return true;
  return status === 429 || status >= 500;
};

/**
 * 指数退避重试包装。AbortError / CanceledError（调用方主动取消）直接上抛；
 * 非瞬时错误（如 4xx）不重试。sleep 期间同样响应调用方取消。
 */
const withTranslateRetry = async <T>(
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

      if (!isTransientError(err)) {
        throw err;
      }

      await sleep(baseDelay * Math.pow(2, attempt - 1), signal);
    }
  }

  throw lastError!;
};

/** 可取消的 sleep：signal 已中止或中止时立即以 AbortError 拒绝。 */
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

/** 读取当前生效的翻译引擎（设置页可切换，读取时机为每次翻译请求）。 */
const getTranslationEngine = (): TranslationEngine =>
  useAppStore.getState().translationEngine ?? 'microsoft';

/**
 * 微软 Edge 翻译引擎：POST JSON 字符串数组到 translatetext 端点，
 * 无需鉴权。响应为 [{ translations: [{ text }] }]。
 */
const translateWithMicrosoft = async (
  texts: string[],
  to: string,
  from: string | undefined,
  signal: AbortSignal | undefined,
  textType?: 'html' | 'plain'
): Promise<string[]> => {
  const { payload, restore } = protectBatch(texts, textType);
  const url = `${MS_TRANSLATE_URL}?${queryString.stringify({
    from: from ? MICROSOFT_LANG[from] || from : '',
    to: MICROSOFT_LANG[to] || to,
    isEnterpriseClient: 'false',
  })}`;

  const data = await fetchWithTimeout<MsTranslateItem[]>(
    url,
    {
      method: 'POST',
      headers: { 'Content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
    signal,
    TRANSLATE_TIMEOUT_MS,
    async (response) => {
      if (!response.ok) {
        throw new Error(`Translation failed: ${response.status}`);
      }
      return (await response.json()) as MsTranslateItem[];
    }
  );

  if (!Array.isArray(data) || data.length !== payload.length) {
    throw new Error('Invalid translation response');
  }
  return restore(data.map((item) => item?.translations?.[0]?.text ?? ''));
};

/**
 * Google 免费翻译引擎（clients5 dict-chrome-ex）：POST 表单 q=…（可重复），
 * 响应依 sl 参数有 [译文, 源语言] 二元组与裸字符串两种形态，统一归一化。
 * 单条 HTTP 请求按条数与字符数分块，避免超长请求被拒。
 */
const translateWithGoogle = async (
  texts: string[],
  to: string,
  from: string | undefined,
  signal: AbortSignal | undefined,
  textType?: 'html' | 'plain'
): Promise<string[]> => {
  const { payload, restore } = protectBatch(texts, textType);
  const url = `${GOOGLE_TRANSLATE_URL}?${queryString.stringify({
    client: 'dict-chrome-ex',
    sl: from ? GOOGLE_LANG[from] || from : 'auto',
    tl: GOOGLE_LANG[to] || to,
  })}`;

  const results: string[] = [];
  let batch: string[] = [];
  let batchChars = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const body = new URLSearchParams();
    batch.forEach((text) => body.append('q', text));

    const data = await fetchWithTimeout<unknown>(
      url,
      { method: 'POST', body },
      signal,
      TRANSLATE_TIMEOUT_MS,
      async (response) => {
        if (!response.ok) {
          throw new Error(`Translation failed: ${response.status}`);
        }
        return await response.json();
      }
    );

    if (!Array.isArray(data) || data.length !== batch.length) {
      throw new Error('Invalid translation response');
    }
    data.forEach((item) => {
      results.push(Array.isArray(item) ? String(item[0] ?? '') : String(item ?? ''));
    });
    batch = [];
    batchChars = 0;
  };

  for (const text of payload) {
    if (
      batch.length >= GOOGLE_BATCH_LIMITS.texts ||
      (batchChars + text.length > GOOGLE_BATCH_LIMITS.chars && batch.length > 0)
    ) {
      await flush();
    }
    batch.push(text);
    batchChars += text.length;
  }
  await flush();

  return restore(results);
};

/**
 * AI 翻译引擎：复用用户在设置中激活的 AI 配置（AIService.translateTexts），
 * 按小批量逐请求翻译，每个请求独立叠加超时（LLM 生成慢于直连 MT 接口）。
 */
const translateWithAI = async (
  texts: string[],
  to: string,
  from: string | undefined,
  signal: AbortSignal | undefined
): Promise<string[]> => {
  const { aiConfigs, activeAIConfig, language } = useAppStore.getState();
  const config = aiConfigs.find((item) => item.id === activeAIConfig);
  if (!config) {
    throw new Error(
      language === 'zh'
        ? 'AI 翻译引擎未就绪：请先在「设置 - AI 服务配置」中添加并激活 AI 配置'
        : 'AI translation engine is not ready: please add and activate an AI configuration in Settings → AI Service Configuration first'
    );
  }

  const aiService = new AIService(config, language);
  const results: string[] = [];

  for (let i = 0; i < texts.length; i += AI_BATCH_LIMITS.texts) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const chunk = texts.slice(i, i + AI_BATCH_LIMITS.texts);
    const controller = createCombinedAbortController(signal, AI_TRANSLATE_TIMEOUT_MS);
    try {
      const translated = await aiService.translateTexts(chunk, to, from, controller.signal);
      results.push(...translated);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' && !signal?.aborted) {
        throw new Error(`AI translation timed out after ${AI_TRANSLATE_TIMEOUT_MS}ms`);
      }
      throw err;
    }
  }

  return results;
};

/** 按当前设置分派到对应翻译引擎，返回与输入等长的译文数组。 */
const dispatchTranslation = async (
  texts: string[],
  to: string,
  from: string | undefined,
  signal: AbortSignal | undefined,
  textType?: 'html' | 'plain'
): Promise<string[]> => {
  const engine = getTranslationEngine();
  switch (engine) {
    case 'google':
      return translateWithGoogle(texts, to, from, signal, textType);
    case 'ai':
      return translateWithAI(texts, to, from, signal);
    default:
      return translateWithMicrosoft(texts, to, from, signal, textType);
  }
};

/** 单批翻译 + 重试（AI 引擎重试 2 次，直连引擎 3 次），结果映射为 TranslateResult。 */
const translateBatchInternal = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal,
  textType?: 'html' | 'plain'
): Promise<TranslateResult[]> => {
  const maxRetries = getTranslationEngine() === 'ai' ? 2 : 3;
  return withTranslateRetry(async () => {
    const translated = await dispatchTranslation(texts, to, from, signal, textType);
    return translated.map((text) => ({ translatedText: text, detectedLanguage: '' }));
  }, signal, maxRetries);
};

/** 翻译单条文本（空文本原样返回，不发起请求）。 */
export const translateText = async (options: TranslateOptions): Promise<TranslateResult> => {
  const { from, to, text, signal, textType } = options;

  if (!text || text.trim() === '') {
    return { translatedText: text, detectedLanguage: '' };
  }

  const results = await translateBatchInternal([text], to, from, signal, textType);
  return results[0];
};

/** 按段落与字符上限把超长文本切成多条（仅用于超过引擎单条上限的文本）。 */
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

/**
 * 批量翻译入口：多条文本合并为尽量少的请求（受引擎单请求上限约束），
 * 超长文本先切片再逐片翻译，最终结果与输入顺序一一对应。
 */
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
      // Always flush accumulated batch before handling an oversized item.
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
        // (this branch is now only reached for non-oversized items)
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
