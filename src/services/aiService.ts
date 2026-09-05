import { Repository, Gist, AIConfig, AIApiType } from '../types';
import { isToolCallCapableApiType } from '../constants/aiCapabilities';
import { backend } from './backendAdapter';
import { buildApiUrl, buildFinalApiUrl } from '../utils/apiUrlBuilder';
import { NO_LICENSE_SENTINEL, normalizeLicense } from '../utils/licenseFilter';
import { logger } from './logger';

interface OpenAIResponseContentPart {
  text?: string;
}

interface OpenAIResponseOutputItem {
  content?: OpenAIResponseContentPart[];
}

interface OpenAIResponseMessage {
  content?: string;
  reasoning_content?: string;
}

interface OpenAIResponseChoice {
  message?: OpenAIResponseMessage;
}

interface OpenAIResponse {
  output_text?: string;
  output?: OpenAIResponseOutputItem[];
  choices?: OpenAIResponseChoice[];
}

export interface ConnectionTestResult {
  success: boolean;
  statusCode?: number;
  statusText?: string;
  errorType?: 'network' | 'auth' | 'timeout' | 'server' | 'unknown';
  message: string;
}

type RepositoryAnalysisResult = {
  summary: string;
  tags: string[];
  platforms: string[];
};

type ParsedAIResponse = RepositoryAnalysisResult & {
  isValid: boolean;
  invalidReason?: string;
};

/**
 * 统一的 AI 请求错误，携带 HTTP 状态码与（可选）服务端建议的等待时长。
 * 上层（限流器 / 优化器）依赖 status / retryAfterMs 判断退避策略。
 */
export class AIRequestError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;
  readonly isRateLimit: boolean;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'AIRequestError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.isRateLimit = status === 429;
  }
}

/** 支持检查一个错误对象是否是 AI 限流（429 或代理透传的限流错误）。 */
export function isRateLimitedError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { statusCode?: unknown; status?: unknown; isRateLimit?: unknown; message?: unknown };
  if (e.isRateLimit === true) return true;
  if (typeof e.statusCode === 'number' && e.statusCode === 429) return true;
  if (typeof e.status === 'number' && e.status === 429) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return /429|rate\s*limit|too many requests/i.test(msg);
}

/** 从限流错误中读取服务端建议的等待毫秒数（Retry-After / retry-after-ms）。 */
export function getRetryAfterMsFromError(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const e = error as { retryAfterMs?: unknown; retryAfter?: unknown };
  const ms = typeof e.retryAfterMs === 'number' ? e.retryAfterMs : undefined;
  if (ms !== undefined && Number.isFinite(ms) && ms > 0) return ms;
  return undefined;
}

/** 解析响应头里的 Retry-After（retry-after-ms → retry-after 秒 → HTTP date）。 */
function parseRetryAfterMs(response: Response): number | undefined {
  const msHeader = response.headers.get('retry-after-ms');
  if (msHeader) {
    const v = Number(msHeader);
    if (Number.isFinite(v) && v > 0) return Math.round(v);
  }
  const secHeader = response.headers.get('retry-after');
  if (secHeader) {
    const v = Number(secHeader);
    if (Number.isFinite(v) && v > 0) return Math.round(v * 1000);
    const parsed = Date.parse(secHeader);
    if (!Number.isNaN(parsed)) {
      const remaining = parsed - Date.now();
      if (remaining > 0) return remaining;
    }
  }
  return undefined;
}

/** 流式请求不可用（如走后端代理等仅支持整段 JSON 的通道）。调用方应降级为非流式。 */
export class AIStreamUnsupportedError extends Error {
  constructor(message = 'Streaming is not supported on this transport') {
    super(message);
    this.name = 'AIStreamUnsupportedError';
  }
}

export function isAIStreamUnsupportedError(error: unknown): boolean {
  return error instanceof AIStreamUnsupportedError;
}

/** 判断错误是否为请求取消（AbortError）。取消不是失败：调用方应停止流程而非兜底。 */
export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

/** 当前 AI 配置/端点不支持模型原生工具调用（function calling）。调用方应降级到编排式循环。 */
export class AIToolCallUnsupportedError extends Error {
  constructor(message = 'Tool calling is not supported on this AI configuration') {
    super(message);
    this.name = 'AIToolCallUnsupportedError';
  }
}

export function isAIToolCallUnsupportedError(error: unknown): boolean {
  return error instanceof AIToolCallUnsupportedError;
}

export interface AIToolDefinition {
  name: string;
  description: string;
  /** JSON Schema 格式的参数定义。 */
  parameters: Record<string, unknown>;
}

export interface AIToolCall {
  id: string;
  name: string;
  /** 原始 JSON 字符串参数（由调用方解析，解析失败按空对象处理）。 */
  arguments: string;
}

export type AIToolLoopMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls: AIToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

/**
 * 该配置是否实际启用原生工具调用：协议族支持 且 用户在该 AI 配置中显式
 * 勾选“支持工具调用”。两者缺一不可——避免未经验证的端点默认进入工具循环。
 * 端点实际能力不足时由请求失败降级兜底。
 */
export function supportsChatToolCalls(config: Pick<AIConfig, 'apiType' | 'supportsToolCalls'>): boolean {
  return isToolCallCapableApiType(config.apiType) && config.supportsToolCalls === true;
}

/** 逐事件消费 SSE 字节流，把每个 data: 载荷交给回调（自动跨 chunk 缓冲不完整行）。 */
export async function consumeSseStream(body: ReadableStream<Uint8Array>, onData: (payload: string) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let dataLines: string[] = [];
  const flush = () => {
    if (dataLines.length > 0) {
      onData(dataLines.join('\n'));
      dataLines = [];
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separatorIndex: number;
      // SSE 行分隔符按规范接受 CRLF / LF / 裸 CR。
      while ((separatorIndex = buffer.search(/[\r\n]/)) >= 0) {
        // 末尾的 \r 可能与下一块开头的 \n 组成 CRLF，先等更多数据再定。
        if (buffer[separatorIndex] === '\r' && separatorIndex === buffer.length - 1) break;
        const separatorLength = buffer[separatorIndex] === '\r' && buffer[separatorIndex + 1] === '\n' ? 2 : 1;
        const line = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + separatorLength);
        if (line === '') {
          flush();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // event:/id:/注释行与这些 API 无关，直接忽略。
      }
    }
    // 冲刷解码器中剩余的多字节序列，EOF 残余按同样规则切分：覆盖未以换行
    // 结尾的最后一行、裸 CR 分隔与末尾悬挂的 \r。
    buffer += decoder.decode();
    const residualLines = buffer.split(/\r\n|\r|\n/);
    buffer = '';
    for (const line of residualLines) {
      if (line === '') {
        flush();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    flush();
  } finally {
    reader.releaseLock();
  }
}

export function extractOpenAiChatDelta(payload: string): string {
  if (!payload || payload === '[DONE]') return '';
  try {
    const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string | null } }> };
    const delta = json.choices?.[0]?.delta?.content;
    return typeof delta === 'string' ? delta : '';
  } catch {
    return '';
  }
}

export function extractOpenAiResponsesDelta(payload: string): string {
  try {
    const json = JSON.parse(payload) as { type?: string; delta?: unknown };
    if (json.type === 'response.output_text.delta' && typeof json.delta === 'string') return json.delta;
    return '';
  } catch {
    return '';
  }
}

export function extractClaudeDelta(payload: string): string {
  try {
    const json = JSON.parse(payload) as { type?: string; delta?: { type?: string; text?: string } };
    if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta' && typeof json.delta.text === 'string') {
      return json.delta.text;
    }
    return '';
  } catch {
    return '';
  }
}

export function extractGeminiDelta(payload: string): string {
  try {
    const json = JSON.parse(payload) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    const parts = json.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
      .filter((p) => p && !p.thought && typeof p.text === 'string')
      .map((p) => p.text as string)
      .join('');
  } catch {
    return '';
  }
}

/** 服务端未按 SSE 返回时，从整段 JSON 响应里提取文本（与 requestText 的解析保持一致）。 */
function extractFullTextFromResponse(apiType: AIApiType, data: unknown): string {
  if (apiType === 'openai-responses') {
    const typed = data as OpenAIResponse;
    if (typeof typed.output_text === 'string' && typed.output_text) return typed.output_text;
    if (Array.isArray(typed.output)) {
      return typed.output
        .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
        .map((part) => part?.text || '')
        .join('');
    }
    return '';
  }
  if (apiType === 'claude') {
    const blocks = (data as { content?: unknown }).content;
    if (!Array.isArray(blocks)) return '';
    return blocks
      .map((b) => {
        if (!b || typeof b !== 'object') return '';
        const block = b as { type?: unknown; text?: unknown };
        return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
      })
      .join('');
  }
  if (apiType === 'gemini') {
    const candidates = (data as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return '';
    const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts
      .filter((p) => p && typeof p === 'object' && !(p as { thought?: boolean }).thought)
      .map((p) => {
        if (!p || typeof p !== 'object') return '';
        const part = p as { text?: unknown };
        return typeof part.text === 'string' ? part.text : '';
      })
      .join('');
  }
  const content = (data as { choices?: OpenAIResponseChoice[] }).choices?.[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function getStatusCodeMeaning(statusCode: number, language: string): string {
  const meanings: Record<number, { zh: string; en: string }> = {
    400: { zh: '请求参数错误', en: 'Bad Request' },
    401: { zh: 'API密钥无效或已过期', en: 'Invalid or expired API key' },
    403: { zh: '没有权限访问该资源', en: 'Forbidden - no permission' },
    404: { zh: 'API端点或模型不存在', en: 'API endpoint or model not found' },
    408: { zh: '请求超时', en: 'Request timeout' },
    429: { zh: '请求过于频繁，已达到速率限制', en: 'Rate limit exceeded' },
    500: { zh: '服务器内部错误', en: 'Internal server error' },
    502: { zh: '网关错误，服务器暂时不可用', en: 'Bad Gateway' },
    503: { zh: '服务暂时不可用，请稍后重试', en: 'Service unavailable' },
    504: { zh: '网关超时', en: 'Gateway timeout' },
  };
  return meanings[statusCode]?.[language as 'zh' | 'en'] || (language === 'zh' ? '未知错误' : 'Unknown error');
}

function getErrorTypeFromStatus(statusCode: number): ConnectionTestResult['errorType'] {
  if (statusCode === 401 || statusCode === 403) return 'auth';
  if (statusCode === 408 || statusCode === 504) return 'timeout';
  if (statusCode >= 500) return 'server';
  if (statusCode >= 400) return 'unknown';
  return 'unknown';
}

export class AIService {
  private config: AIConfig;
  private language: string;
  private static readonly ANALYSIS_MAX_ATTEMPTS = 3;
  private static readonly ANALYSIS_MAX_TOKENS = 4096;
  private static readonly RERANKING_MAX_TOKENS = 4096;
  /** 库容不超过该数量时跳过词法召回，直接把全库交给 LLM 精选。 */
  private static readonly SELECTION_FULL_LIBRARY_LIMIT = 150;
  /** 大库时送入 LLM 的候选上限：token 成本与库容解耦的关键。 */
  private static readonly SELECTION_CANDIDATE_LIMIT = 100;
  /** 词法候选不足该数量时用 star 排序补足，保证 LLM 始终有足够候选。 */
  private static readonly SELECTION_MIN_CANDIDATES = 15;
  /** LLM 精选最多返回的相关仓库数。 */
  private static readonly SELECTION_MAX_RESULTS = 20;
  private static readonly SELECTION_MAX_TOKENS = 800;

  constructor(config: AIConfig, language: string = 'zh') {
    this.config = config;
    this.language = language;
  }

  /**
   * Log AI request details at debug level (only logged when debug mode is on).
   */
  private logAIRequestDebug(
    startTime: number,
    context: { apiType: string; model: string; configId: string },
    result: { responseLength: number } | { error: string },
    httpDetails?: {
      url?: string;
      requestHeaders?: Record<string, string>;
      requestBody?: unknown;
      responseHeaders?: Record<string, string>;
      responseBody?: string;
      status?: number;
      /** 是否走 SSE 流式返回（流式调试日志使用）。 */
      streamed?: boolean;
    }
  ): void {
    if (logger.isDebugMode()) {
      logger.debug('ai', 'AI request', {
        ...context,
        durationMs: Date.now() - startTime,
        ...result,
        ...(httpDetails || {}),
      });
    }
  }

  /**
   * 清理用户内容中可能导致 JSON 序列化问题的字符
   * - 移除 null 字节和控制字符（保留 \n \r \t）
   * - 替换孤立代理项（lone surrogates），避免某些 JSON 解析器报错
   */
  private sanitizeForPrompt(content: string): string {
    // 移除 null 字节和控制字符（保留换行、回车、制表符）
    // eslint-disable-next-line no-control-regex
    let sanitized = content.replace(/[\0-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    // 替换孤立代理项，同时保留合法代理对（避免 lookbehind 以兼容 Safari 12+）
    sanitized = sanitized.replace(
      /([\uD800-\uDBFF][\uDC00-\uDFFF])|[\uD800-\uDBFF]|[\uDC00-\uDFFF]/g,
      (m, pair) => (pair ? m : '�')
    );
    return sanitized;
  }

  private getApiType(): AIApiType {
    return this.config.apiType || 'openai';
  }

  /**
   * 直连模式安全守卫：禁止把 Authorization / x-api-key / URL key 通过明文
   * HTTP 发往远端。仅 localhost / 127.0.0.1 / [::1] / 0.0.0.0 等本机地址豁免
   * （本地推理服务场景）。走后端代理时由代理负责，不在此检查。
   */
  private requireSecureDirectEndpoint(): void {
    if (backend.isAvailable) return;
    const base = this.config.baseUrl.trim();
    if (!/^http:\/\//i.test(base)) return;
    let host = base.replace(/^http:\/\//i, '').split('/')[0] || '';
    try {
      host = new URL(base).hostname;
    } catch {
      // 保留字符串解析结果
    }
    const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\])$/i.test(host);
    if (!isLocal) {
      throw new Error(this.language === 'zh'
        ? 'AI 服务地址必须使用 HTTPS：为保护 API Key，仅 localhost / 127.0.0.1 等本机地址允许 HTTP。'
        : 'The AI endpoint must use HTTPS: to protect your API key, plain HTTP is only allowed for local addresses (localhost / 127.0.0.1).');
    }
  }

  private getOpenAIReasoningPayload(): { effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' } | undefined {
    const effort = this.config.reasoningEffort;
    return effort ? { effort } : undefined;
  }

  private isDeepSeekModel(): boolean {
    return this.getApiType() === 'deepseek';
  }

  private isDeepSeekReasonerModel(): boolean {
    return this.isDeepSeekModel() && this.config.model.trim() === 'deepseek-reasoner';
  }

  /**
   * Check if the model is a DeepSeek model with default thinking enabled (e.g. deepseek-v4-pro, deepseek-v4-flash).
   * These models consume max_tokens for reasoning, leaving 0 tokens for content if max_tokens is too low.
   * We need to explicitly disable thinking for these models.
   */
  private isDeepSeekThinkingModel(): boolean {
    return this.isDeepSeekModel() && this.config.model.trim() !== 'deepseek-reasoner';
  }

  private isMiMoModel(): boolean {
    return this.getApiType() === 'mimo';
  }

  private async extractErrorDetail(response: Response): Promise<string> {
    try {
      const text = await response.text();
      try {
        const errorBody = JSON.parse(text);
        return typeof errorBody === 'object' ? JSON.stringify(errorBody) : String(errorBody);
      } catch {
        return text;
      }
    } catch {
      return '';
    }
  }

  private async requestText(options: {
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<string> {
    this.requireSecureDirectEndpoint();
    const startTime = Date.now();
    const apiType = this.getApiType();
    const model = this.config.model;
    const configId = this.config.id;
    const reasoning = this.getOpenAIReasoningPayload();

    if (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible' || apiType === 'deepseek' || apiType === 'mimo') {
      const messages = [
        ...(options.system.trim()
          ? [{ role: 'system', content: options.system }]
          : []),
        { role: 'user', content: options.user },
      ];
      const isDeepSeekReasoner = this.isDeepSeekReasonerModel();
      const isDeepSeekThinking = this.isDeepSeekThinkingModel();
      const isMiMoModel = this.isMiMoModel();

      const requestBody = apiType === 'openai-responses'
        ? {
            model: this.config.model,
            input: messages,
            temperature: options.temperature,
            max_output_tokens: options.maxTokens,
            ...(reasoning ? { reasoning } : {}),
            ...(isMiMoModel || isDeepSeekThinking ? { thinking: { type: 'disabled' } } : {}),
          }
        : {
            model: this.config.model,
            messages,
            max_tokens: options.maxTokens,
            ...(!isDeepSeekReasoner ? { temperature: options.temperature } : {}),
            ...(!isDeepSeekReasoner && !isDeepSeekThinking && !isMiMoModel && reasoning && apiType !== 'openai-compatible' ? { reasoning } : {}),
            ...(isMiMoModel || isDeepSeekThinking ? { thinking: { type: 'disabled' } } : {}),
          };

      let data: Record<string, unknown>;
      // HTTP details captured in debug mode
      const requestUrl = buildFinalApiUrl(this.config.baseUrl, apiType);
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ***',
      };
      let responseHeaders: Record<string, string> | undefined;
      let responseBodyPreview: string | undefined;
      let responseStatus: number | undefined;

      if (backend.isAvailable) {
        // Note: backend proxy does not return HTTP-level details (headers, body preview).
        // httpDetails will contain only url/requestHeaders/requestBody; response fields stay undefined.
        data = await backend.proxyAIRequestWithFallback(this.config.id, this.config, requestBody, options.signal) as Record<string, unknown>;
      } else {
        const response = await fetch(requestUrl, {
          // 直连携带 API Key，禁止跟随重定向以防凭据外泄。
          redirect: 'error',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: options.signal,
        });
        // Capture response headers
        responseHeaders = {};
        response.headers.forEach((v, k) => { responseHeaders![k] = v; });
        responseStatus = response.status;
        // Capture response body preview (clone to avoid consuming)
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (text.length > 0) {
            responseBodyPreview = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
          }
        } catch { /* body not readable */ }
        if (!response.ok) {
          const errorDetail = await this.extractErrorDetail(response);
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, {
            url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
          });
          throw new AIRequestError(
            `AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`,
            response.status,
            parseRetryAfterMs(response)
          );
        }
        data = await response.json();
      }

      const httpDetails = logger.isDebugMode() ? {
        url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
      } : undefined;

      if (apiType === 'openai-responses') {
        const typedData = data as OpenAIResponse;
        const outputText = typedData.output_text;
        if (outputText) {
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: outputText.length }, httpDetails);
          return outputText;
        }

        const output = typedData.output;
        if (Array.isArray(output)) {
          const text = output
            .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
            .map((part) => part?.text || '')
            .join('');
          if (text) {
            this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: text.length }, httpDetails);
            return text;
          }
        }
      } else {
        const typedData = data as { choices?: OpenAIResponseChoice[] };
        const choices = typedData.choices;
        const message = choices?.[0]?.message;
        const content = message?.content;
        if (content) {
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: content.length }, httpDetails);
          return content;
        }

        // Only fall back to reasoning_content for the dedicated deepseek-reasoner model.
        // Other DeepSeek models (e.g. deepseek-v4-flash, deepseek-v4-pro) may also return
        // reasoning_content (the thinking chain), but we must not use it as the final answer.
        const reasoningContent = message?.reasoning_content;
        if (reasoningContent && isDeepSeekReasoner) {
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: reasoningContent.length }, httpDetails);
          return reasoningContent;
        }

        if (!content && reasoningContent) {
          logger.warn('ai', 'Model returned reasoning_content but empty content', { model, configId });
        }
      }

      this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, httpDetails);
      throw new Error('No content received from AI service');
    }

    if (apiType === 'claude') {
      const requestBody = {
        model: this.config.model,
        ...(options.system.trim() ? { system: options.system } : {}),
        messages: [{ role: 'user', content: options.user }],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      };

      let data: unknown;
      // HTTP details captured in debug mode
      const requestUrl = buildApiUrl(this.config.baseUrl, 'v1/messages');
      const requestHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': '***',
        'anthropic-version': '2023-06-01',
      };
      let responseHeaders: Record<string, string> | undefined;
      let responseBodyPreview: string | undefined;
      let responseStatus: number | undefined;

      if (backend.isAvailable) {
        // Note: backend proxy does not return HTTP-level details (headers, body preview).
        data = await backend.proxyAIRequestWithFallback(this.config.id, this.config, requestBody, options.signal);
      } else {
        const response = await fetch(requestUrl, {
          // 直连携带 API Key，禁止跟随重定向以防凭据外泄。
          redirect: 'error',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'x-api-key': this.config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(requestBody),
          signal: options.signal,
        });
        // Capture response headers
        responseHeaders = {};
        response.headers.forEach((v, k) => { responseHeaders![k] = v; });
        responseStatus = response.status;
        // Capture response body preview
        try {
          const cloned = response.clone();
          const text = await cloned.text();
          if (text.length > 0) {
            responseBodyPreview = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
          }
        } catch { /* body not readable */ }
        if (!response.ok) {
          const errorDetail = await this.extractErrorDetail(response);
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, {
            url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
          });
          throw new AIRequestError(
            `AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`,
            response.status,
            parseRetryAfterMs(response)
          );
        }
        data = await response.json();
      }

      const httpDetails = logger.isDebugMode() ? {
        url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
      } : undefined;

      const contentBlocks = (data as { content?: unknown }).content;
      if (Array.isArray(contentBlocks)) {
        const text = contentBlocks
          .map((b) => {
            if (!b || typeof b !== 'object') return '';
            const block = b as { type?: unknown; text?: unknown };
            return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
          })
          .join('');
        if (text) {
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: text.length }, httpDetails);
          return text;
        }
      }
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, httpDetails);
      throw new Error('No content received from AI service');
    }

    // gemini
    const rawModel = this.config.model.trim();
    const geminiModel = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
    const prompt = options.system ? `${options.system}

${options.user}` : options.user;
    const requestBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      },
    };

    let data: unknown;
    // HTTP details captured in debug mode
    const path = `v1beta/models/${encodeURIComponent(geminiModel)}:generateContent`;
    const urlObj = new URL(buildApiUrl(this.config.baseUrl, path));
    urlObj.searchParams.set('key', this.config.apiKey);
    const requestUrl = urlObj.toString();
    // Mask API key in URL for debug logging
    const maskedUrl = requestUrl.replace(/([?&]key=)[^&]+/, '$1***');
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    let responseHeaders: Record<string, string> | undefined;
    let responseBodyPreview: string | undefined;
    let responseStatus: number | undefined;

    if (backend.isAvailable) {
      // Note: backend proxy does not return HTTP-level details (headers, body preview).
      data = await backend.proxyAIRequestWithFallback(this.config.id, this.config, requestBody, options.signal);
    } else {
      const response = await fetch(requestUrl, {
        // 直连在 URL 携带 API Key，禁止跟随重定向以防凭据外泄。
        redirect: 'error',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      // Capture response headers
      responseHeaders = {};
      response.headers.forEach((v, k) => { responseHeaders![k] = v; });
      responseStatus = response.status;
      // Capture response body preview
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        if (text.length > 0) {
          responseBodyPreview = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
        }
      } catch { /* body not readable */ }
      if (!response.ok) {
        const errorDetail = await this.extractErrorDetail(response);
        this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, {
          url: maskedUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
        });
        throw new AIRequestError(
          `AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`,
          response.status,
          parseRetryAfterMs(response)
        );
      }
      data = await response.json();
    }

    const httpDetails = logger.isDebugMode() ? {
      url: maskedUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
    } : undefined;

    const candidates = (data as { candidates?: unknown }).candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const candidate = candidates[0] as { content?: { parts?: unknown }; finishReason?: string };
      const parts = candidate.content?.parts;
      if (Array.isArray(parts)) {
        // Skip thought parts emitted by Gemini thinking models (e.g. gemini-2.5-pro)
        const text = parts
          .filter((p) => p && typeof p === 'object' && !(p as { thought?: boolean }).thought)
          .map((p) => {
            if (!p || typeof p !== 'object') return '';
            const part = p as { text?: unknown };
            return typeof part.text === 'string' ? part.text : '';
          })
          .join('');
        if (text) {
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: text.length }, httpDetails);
          return text;
        }
      }
    }
    this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, httpDetails);
    throw new Error('No content received from AI service');
  }

  /**
   * 流式文本生成（SSE）。仅支持直连模式；走后端代理时抛 AIStreamUnsupportedError，
   * 由调用方决定降级。返回完整拼接文本；增量通过 onChunk 逐段回调。
   */
  private async requestTextStream(options: {
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
    onChunk: (delta: string) => void;
  }): Promise<string> {
    if (backend.isAvailable) {
      // /api/proxy/ai 会整体缓冲 JSON 响应，无法转发 SSE 帧。
      throw new AIStreamUnsupportedError();
    }
    this.requireSecureDirectEndpoint();
    if (this.isDeepSeekReasonerModel()) {
      // deepseek-reasoner 的最终文本可能仅存在于 reasoning_content（思考链），
      // 非流式路径对此有专门处理（且思考链不得用于其他 DeepSeek 模型）。流式
      // 增量无法安全区分思考与正文，直接走阻塞路径以复用既有语义。
      throw new AIStreamUnsupportedError();
    }

    const apiType = this.getApiType();
    const model = this.config.model;
    const configId = this.config.id;
    const startTime = Date.now();

    let requestUrl: string;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    };
    let body: unknown;
    let extractDelta: (payload: string) => string;

    if (apiType === 'claude') {
      requestUrl = buildApiUrl(this.config.baseUrl, 'v1/messages');
      headers['x-api-key'] = this.config.apiKey;
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model,
        stream: true,
        ...(options.system.trim() ? { system: options.system } : {}),
        messages: [{ role: 'user', content: options.user }],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      };
      extractDelta = extractClaudeDelta;
    } else if (apiType === 'gemini') {
      const rawModel = this.config.model.trim();
      const geminiModel = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
      const prompt = options.system ? `${options.system}\n\n${options.user}` : options.user;
      const urlObj = new URL(buildApiUrl(this.config.baseUrl, `v1beta/models/${encodeURIComponent(geminiModel)}:streamGenerateContent`));
      urlObj.searchParams.set('alt', 'sse');
      urlObj.searchParams.set('key', this.config.apiKey);
      requestUrl = urlObj.toString();
      body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: options.temperature,
          maxOutputTokens: options.maxTokens,
        },
      };
      extractDelta = extractGeminiDelta;
    } else if (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible' || apiType === 'deepseek' || apiType === 'mimo') {
      const messages = [
        ...(options.system.trim() ? [{ role: 'system', content: options.system }] : []),
        { role: 'user', content: options.user },
      ];
      const isDeepSeekReasoner = this.isDeepSeekReasonerModel();
      const isDeepSeekThinking = this.isDeepSeekThinkingModel();
      const isMiMoModel = this.isMiMoModel();
      const reasoning = this.getOpenAIReasoningPayload();

      body = apiType === 'openai-responses'
        ? {
            model,
            input: messages,
            stream: true,
            temperature: options.temperature,
            max_output_tokens: options.maxTokens,
            ...(reasoning ? { reasoning } : {}),
            ...(isMiMoModel || isDeepSeekThinking ? { thinking: { type: 'disabled' } } : {}),
          }
        : {
            model,
            messages,
            stream: true,
            max_tokens: options.maxTokens,
            ...(!isDeepSeekReasoner ? { temperature: options.temperature } : {}),
            ...(!isDeepSeekReasoner && !isDeepSeekThinking && !isMiMoModel && reasoning && apiType !== 'openai-compatible' ? { reasoning } : {}),
            ...(isMiMoModel || isDeepSeekThinking ? { thinking: { type: 'disabled' } } : {}),
          };
      requestUrl = buildFinalApiUrl(this.config.baseUrl, apiType);
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      extractDelta = apiType === 'openai-responses' ? extractOpenAiResponsesDelta : extractOpenAiChatDelta;
    } else {
      throw new AIStreamUnsupportedError();
    }

    // 请求头仅在 debug 日志中展示，密钥做掩码
    const debugHeaders: Record<string, string> = { ...headers };
    if (debugHeaders['Authorization']) debugHeaders['Authorization'] = 'Bearer ***';
    if (debugHeaders['x-api-key']) debugHeaders['x-api-key'] = '***';
    const maskedUrl = requestUrl.replace(/([?&]key=)[^&]+/, '$1***');

    const response = await fetch(requestUrl, {
      // 直连携带 API Key（URL 或请求头），禁止跟随重定向以防凭据外泄。
      redirect: 'error',
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: options.signal,
    });
    if (!response.ok) {
      const errorDetail = await this.extractErrorDetail(response);
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, {
        url: maskedUrl, requestHeaders: debugHeaders, status: response.status,
      });
      throw new AIRequestError(
        `AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`,
        response.status,
        parseRetryAfterMs(response)
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!contentType) {
      // 缺失 Content-Type 时按内容嗅探：body 含 data: 帧走 SSE 解析，
      // 否则按整段 JSON / 纯文本回退（此时 body 已整体读入，逐段回调）。
      const raw = await response.text();
      const ssePayloads: string[] = [];
      let dataLines: string[] = [];
      // SSE 行分隔符按规范接受 CRLF / LF / 裸 CR。
      for (const line of raw.split(/\r\n|\r|\n/)) {
        if (line === '') {
          if (dataLines.length > 0) {
            ssePayloads.push(dataLines.join('\n'));
            dataLines = [];
          }
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
      }
      if (dataLines.length > 0) ssePayloads.push(dataLines.join('\n'));

      if (ssePayloads.length > 0) {
        // 只有至少一帧解出当前 API 的有效增量才算 SSE；普通文本里恰好出现
        // "data:" 开头的行时继续走下方 JSON / 纯文本回退。
        const deltas = ssePayloads
          .map((payload) => extractDelta(payload))
          .filter((delta) => delta !== '');
        if (deltas.length > 0) {
          let full = '';
          for (const delta of deltas) {
            full += delta;
            options.onChunk(delta);
          }
          this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: full.length }, { url: maskedUrl, streamed: true });
          return full;
        }
      }

      let text = '';
      try {
        text = extractFullTextFromResponse(apiType, JSON.parse(raw));
      } catch {
        text = raw;
      }
      if (!text) {
        this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, { url: maskedUrl });
        throw new Error('No content received from AI service');
      }
      options.onChunk(text);
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: text.length }, { url: maskedUrl, streamed: false });
      return text;
    }

    if (!contentType.includes('text/event-stream')) {
      // 服务端忽略 stream:true 时可能返回整段 JSON（application/json）或纯文本
      // 回答：先按 JSON 解析提取结构化文本，失败则把原始文本作为一次性 chunk。
      const raw = await response.text();
      let text = '';
      try {
        text = extractFullTextFromResponse(apiType, JSON.parse(raw));
      } catch {
        text = raw;
      }
      if (!text) {
        this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, { url: maskedUrl });
        throw new Error('No content received from AI service');
      }
      options.onChunk(text);
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: text.length }, { url: maskedUrl, streamed: false });
      return text;
    }

    if (!response.body) {
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'empty response body' }, { url: maskedUrl });
      throw new Error('No content received from AI service (empty body)');
    }
    let full = '';
    await consumeSseStream(response.body, (payload) => {
      const delta = extractDelta(payload);
      if (delta) {
        full += delta;
        options.onChunk(delta);
      }
    });

    this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: full.length }, { url: maskedUrl, streamed: true });
    if (!full.trim()) {
      throw new Error('No content received from AI service (stream)');
    }
    return full;
  }

  async generateChatText(options: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<string> {
    return await this.requestText({
      system: options.system,
      user: options.user,
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 4000,
      signal: options.signal,
    });
  }

  /** 流式版本的 generateChatText；不支持流式的通道抛 AIStreamUnsupportedError。 */
  async generateChatTextStream(options: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
    onChunk: (delta: string) => void;
  }): Promise<string> {
    return await this.requestTextStream({
      system: options.system,
      user: options.user,
      temperature: options.temperature ?? 0.2,
      maxTokens: options.maxTokens ?? 4000,
      signal: options.signal,
      onChunk: options.onChunk,
    });
  }

  /**
   * 原生 function calling（OpenAI chat completions 线格式）。与 generateChatText
   * 共享 URL/鉴权/重定向守卫；只做单次请求——多轮对话由调用方把返回的
   * tool_calls 与工具结果追加进 messages 后再次调用。端点不支持 tools 时抛
   * AIToolCallUnsupportedError，调用方可降级到编排式循环。
   */
  async generateWithTools(options: {
    system: string;
    messages: AIToolLoopMessage[];
    tools: AIToolDefinition[];
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  }): Promise<{ content: string; toolCalls: AIToolCall[] }> {
    const apiType = this.getApiType();
    if (!supportsChatToolCalls(this.config)) {
      throw new AIToolCallUnsupportedError(`API type "${apiType}" does not support native tool calling`);
    }
    this.requireSecureDirectEndpoint();
    const startTime = Date.now();
    const model = this.config.model;
    const configId = this.config.id;
    const isDeepSeekReasoner = this.isDeepSeekReasonerModel();
    const isDeepSeekThinking = this.isDeepSeekThinkingModel();
    const isMiMoModel = this.isMiMoModel();
    const reasoning = this.getOpenAIReasoningPayload();

    const messages = [
      ...(options.system.trim() ? [{ role: 'system', content: options.system }] : []),
      ...options.messages.map((message): Record<string, unknown> => {
        if (message.role === 'assistant') {
          return {
            role: 'assistant',
            // content 为空（null/''）时直接省略该字段：显式 null 与空字符串在
            // 部分网关与模型上会被拒绝；带 tool_calls 的消息省略 content 是
            // 兼容性最好的线格式。
            ...(message.content ? { content: message.content } : {}),
            // 空 tool_calls 会与 content:null 组合成部分网关拒绝的请求体，直接省略。
            ...(message.toolCalls.length > 0 ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            } : {}),
          };
        }
        if (message.role === 'tool') {
          return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
        }
        return { role: message.role, content: message.content };
      }),
    ];

    const requestBody = {
      model: this.config.model,
      messages,
      tools: options.tools.map((tool) => ({
        type: 'function',
        function: { name: tool.name, description: tool.description, parameters: tool.parameters },
      })),
      tool_choice: 'auto',
      max_tokens: options.maxTokens ?? 4_000,
      ...(!isDeepSeekReasoner ? { temperature: options.temperature ?? 0 } : {}),
      ...(!isDeepSeekReasoner && !isDeepSeekThinking && !isMiMoModel && reasoning && apiType !== 'openai-compatible' ? { reasoning } : {}),
      ...(isMiMoModel || isDeepSeekThinking ? { thinking: { type: 'disabled' } } : {}),
    };

    const requestUrl = buildFinalApiUrl(this.config.baseUrl, apiType);
    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': 'Bearer ***',
    };
    let responseHeaders: Record<string, string> | undefined;
    let responseBodyPreview: string | undefined;
    let responseStatus: number | undefined;
    let data: Record<string, unknown>;

    if (backend.isAvailable) {
      // 代理整体透传请求体（含 tools 字段），响应仍由客户端解析。
      try {
        data = await backend.proxyAIRequestWithFallback(this.config.id, this.config, requestBody, options.signal) as Record<string, unknown>;
      } catch (error) {
        // 代理错误不保留上游响应体：按状态码 + 消息识别端点拒绝 tools 的情形，
        // 与直连路径同样转为 AIToolCallUnsupportedError，让调用方落回编排式循环。
        const carrier = error as { status?: unknown; statusCode?: unknown };
        const status = typeof carrier.status === 'number' ? carrier.status : carrier.statusCode;
        const message = error instanceof Error ? error.message : String(error ?? '');
        if ((status === 400 || status === 404 || status === 422) && /\btools?\b|function/i.test(message)) {
          throw new AIToolCallUnsupportedError(`Endpoint rejected tool calling: ${message.slice(0, 200)}`);
        }
        throw error;
      }
    } else {
      const response = await fetch(requestUrl, {
        // 直连携带 API Key，禁止跟随重定向以防凭据外泄。
        redirect: 'error',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      responseHeaders = {};
      response.headers.forEach((v, k) => { responseHeaders![k] = v; });
      responseStatus = response.status;
      try {
        const cloned = response.clone();
        const text = await cloned.text();
        if (text.length > 0) {
          responseBodyPreview = text.length > 4000 ? text.slice(0, 4000) + '...[truncated]' : text;
        }
      } catch { /* body not readable */ }
      if (!response.ok) {
        const errorDetail = await this.extractErrorDetail(response);
        this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, {
          url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
        });
        const error = new AIRequestError(
          `AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`,
          response.status,
          parseRetryAfterMs(response),
        );
        // 网关不支持 tools 时通常以 4xx 拒绝并提及 tools/function：识别为
        // 能力缺失而非瞬时故障，让调用方落回编排式循环。
        if ((response.status === 400 || response.status === 404 || response.status === 422) && /\btools?\b|function/i.test(errorDetail)) {
          throw new AIToolCallUnsupportedError(`Endpoint rejected tool calling: ${errorDetail.slice(0, 200)}`);
        }
        throw error;
      }
      data = await response.json();
    }

    const httpDetails = logger.isDebugMode() ? {
      url: requestUrl, requestHeaders, requestBody, responseHeaders, responseBody: responseBodyPreview, status: responseStatus,
    } : undefined;

    const message = (data as { choices?: OpenAIResponseChoice[] }).choices?.[0]?.message;
    const rawToolCalls = (message as { tool_calls?: unknown } | undefined)?.tool_calls;
    const toolCalls = Array.isArray(rawToolCalls)
      ? rawToolCalls.flatMap((call): AIToolCall[] => {
          if (!call || typeof call !== 'object') return [];
          const typed = call as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
          const name = typeof typed.function?.name === 'string' ? typed.function.name : '';
          if (!name) return [];
          return [{
            id: typeof typed.id === 'string' ? typed.id : `call_${name}`,
            name,
            arguments: typeof typed.function?.arguments === 'string' ? typed.function.arguments : '{}',
          }];
        })
      : [];
    const content = typeof message?.content === 'string' ? message.content : '';
    if (!content && toolCalls.length === 0) {
      this.logAIRequestDebug(startTime, { apiType, model, configId }, { error: 'request failed' }, httpDetails);
      throw new Error('No content or tool calls received from AI service');
    }
    this.logAIRequestDebug(startTime, { apiType, model, configId }, { responseLength: content.length + toolCalls.length }, httpDetails);
    return { content, toolCalls };
  }

  async analyzeRepository(repository: Repository, readmeContent: string, customCategories?: string[], categoryHints?: string, signal?: AbortSignal): Promise<RepositoryAnalysisResult> {
    const startTime = Date.now();
    const configId = this.config.id;
    const { full_name } = repository;
    const owner = full_name.split('/')[0] || '';
    const repo = full_name.split('/')[1] || full_name;
    logger.info('ai', 'AI analysis started', { owner, repo, configId });

    const prompt = this.config.useCustomPrompt && this.config.customPrompt
      ? this.createCustomAnalysisPrompt(repository, readmeContent, customCategories, categoryHints)
      : this.createAnalysisPrompt(repository, readmeContent, customCategories, categoryHints);

    try {
      const system = this.language === 'zh'
        ? '你是一个专业的GitHub仓库分析助手。请严格按照用户指定的语言进行分析，无论原始内容是什么语言。请用中文简洁地分析仓库，提供实用的概述、分类标签和支持的平台类型。只输出合法JSON，不要输出思考过程、Markdown、代码块标记或任何额外文本。summary字段只能描述仓库功能，不得复述提示词、输出格式或“只输出JSON”等要求。'
        : 'You are a professional GitHub repository analysis assistant. Please strictly analyze in the language specified by the user, regardless of the original content language. Please analyze repositories concisely in English, providing practical overviews, category tags, and supported platform types. Only output valid JSON. Do not output thinking process, Markdown, code block markers, or any extra text. The summary field must describe repository functionality only; never restate the prompt, output format, or JSON-only requirements.';

      let lastContent = '';
      let lastInvalidReason = '';

      for (let attempt = 1; attempt <= AIService.ANALYSIS_MAX_ATTEMPTS; attempt++) {
        const content = await this.requestText({
          system,
          user: attempt === 1
            ? prompt
            : this.createAnalysisRetryPrompt(prompt, lastContent, lastInvalidReason),
          temperature: attempt === 1 ? 0.3 : 0.1,
          maxTokens: AIService.ANALYSIS_MAX_TOKENS,
          signal,
        });

        const result = this.parseAIResponse(content);
        if (result.isValid) {
          logger.info('ai', 'AI analysis completed', {
            owner,
            repo,
            configId,
            attempts: attempt,
            durationMs: Date.now() - startTime,
          });
          return {
            summary: result.summary,
            tags: result.tags,
            platforms: result.platforms,
          };
        }

        lastContent = content;
        lastInvalidReason = result.invalidReason || (this.language === 'zh' ? '返回内容不符合要求' : 'Response did not meet requirements');

        if (attempt < AIService.ANALYSIS_MAX_ATTEMPTS) {
          logger.warn('ai', 'AI analysis response invalid, retrying', {
            owner,
            repo,
            configId,
            attempt,
            invalidReason: lastInvalidReason,
          });
        }
      }

      throw new Error(this.language === 'zh'
        ? `AI返回内容不符合要求，已重试${AIService.ANALYSIS_MAX_ATTEMPTS - 1}次：${lastInvalidReason}`
        : `AI response did not meet requirements after ${AIService.ANALYSIS_MAX_ATTEMPTS - 1} retries: ${lastInvalidReason}`);
    } catch (error) {
      logger.errorFromError('ai', 'AI analysis failed', error, { configId, durationMs: Date.now() - startTime });
      // 抛出错误，让调用方处理失败状态
      throw error;
    }
  }

  async analyzeGist(gist: Gist, contentPreview: string, signal?: AbortSignal): Promise<string> {
    const fileList = Object.values(gist.files || {})
      .map(file => `${file.filename}${file.language ? ` (${file.language})` : ''}, ${file.size} bytes`)
      .join('\n');

    const system = this.language === 'zh'
      ? '你是一个专业的 GitHub Gist 分析助手。请用中文简洁总结 gist 的用途、关键内容和可能的使用场景。只输出摘要文本，不要 Markdown 标题。'
      : 'You are a professional GitHub Gist analysis assistant. Summarize the gist purpose, key content, and likely use case concisely in English. Output summary text only, no Markdown heading.';

    const user = this.language === 'zh'
      ? `
请分析以下 GitHub Gist，输出不超过 80 字的中文摘要。

描述：${this.sanitizeForPrompt(gist.description || '无描述')}
创建者：${gist.owner?.login || '未知'}
文件：
${this.sanitizeForPrompt(fileList || '无文件')}

内容预览：
${this.sanitizeForPrompt(contentPreview).slice(0, 6000)}
      `.trim()
      : `
Analyze this GitHub Gist and output an English summary under 80 words.

Description: ${this.sanitizeForPrompt(gist.description || 'No description')}
Owner: ${gist.owner?.login || 'Unknown'}
Files:
${this.sanitizeForPrompt(fileList || 'No files')}

Content preview:
${this.sanitizeForPrompt(contentPreview).slice(0, 6000)}
      `.trim();

    return this.requestText({
      system,
      user,
      temperature: 0.25,
      maxTokens: 500,
      signal,
    });
  }

  /**
   * 使用当前 AI 配置批量翻译文本（README 双语渲染的 AI 翻译引擎）。
   * 输入一组字符串，返回等长的译文数组；模型输出 JSON 数组，解析失败或
   * 数量不符时抛错（由调用方按瞬时错误重试）。
   * @param texts 待翻译文本（不含 Markdown 块级结构，多为段落/标题/列表项）
   * @param targetLanguage 目标语言代码（'zh' | 'en' 等）
   * @param sourceLanguage 可选源语言代码，缺省时由模型自动判断
   * @param signal 可选 AbortSignal
   */
  async translateTexts(
    texts: string[],
    targetLanguage: string,
    sourceLanguage?: string,
    signal?: AbortSignal
  ): Promise<string[]> {
    if (texts.length === 0) return [];

    const LANGUAGE_NAMES: Record<string, string> = {
      zh: 'Simplified Chinese',
      en: 'English',
      ja: 'Japanese',
      ko: 'Korean',
      fr: 'French',
      de: 'German',
      es: 'Spanish',
      ru: 'Russian',
      pt: 'Portuguese',
    };
    const targetName = LANGUAGE_NAMES[targetLanguage] || targetLanguage;
    const sourceName = sourceLanguage ? (LANGUAGE_NAMES[sourceLanguage] || sourceLanguage) : 'auto-detect';

    const system = this.language === 'zh'
      ? '你是一个专业的机器翻译引擎。把用户提供的每条文本翻译成自然流畅的目标语言。规则：保留占位符（如 {0}）、HTML 行内标签（如 <code>）、专有名词和命令原样不译；不加解释；输出一个 JSON 字符串数组，长度与输入完全一致。'
      : 'You are a professional machine translation engine. Translate each input text into the target language naturally. Rules: keep placeholders (e.g. {0}), inline HTML tags (e.g. <code>), proper nouns and commands untranslated; no explanations; output a JSON array of strings with exactly the same length as the input.';

    const user = this.language === 'zh'
      ? `目标语言：${targetName}\n源语言：${sourceName}\n\n待翻译文本（JSON 数组）：\n${JSON.stringify(texts)}`
      : `Target language: ${targetName}\nSource language: ${sourceName}\n\nTexts to translate (JSON array):\n${JSON.stringify(texts)}`;

    const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
    const raw = await this.requestText({
      system,
      user,
      temperature: 0.2,
      // 输出至少要容纳等长译文：按输入长度估算并留出 JSON 结构开销
      maxTokens: Math.min(16000, Math.max(1024, Math.ceil(totalChars * 2) + 512)),
      signal,
    });

    const parsed = this.parseTranslationResponse(raw, texts.length);
    if (!parsed) {
      throw new Error('AI translation returned an invalid format');
    }
    return parsed;
  }

  /** 从模型输出中提取 JSON 字符串数组；容忍代码块围栏与前后杂文，失败返回 null。 */
  private parseTranslationResponse(raw: string, expectedCount: number): string[] | null {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start === -1 || end <= start) return null;
    try {
      const data = JSON.parse(cleaned.slice(start, end + 1)) as unknown;
      if (!Array.isArray(data) || data.length !== expectedCount) return null;
      if (!data.every((item): item is string => typeof item === 'string')) return null;
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 分析单个 release 的更新日志，输出通俗易懂、按重要程度排序的 Markdown 总结。
   * 用于 Release 列表项的「总结」按钮。直接返回 Markdown 文本，调用方负责渲染。
   * @param releaseBody release 的正文（Markdown 更新说明）
   * @param meta release 的元信息
   * @param signal 可选 AbortSignal
   */
  async analyzeReleaseSummary(
    releaseBody: string,
    meta: { repoName: string; tagName: string; releaseName?: string },
    signal?: AbortSignal
  ): Promise<string> {
    const body = this.sanitizeForPrompt(releaseBody || '').slice(0, 12000);
    if (!body.trim()) {
      throw new Error(this.language === 'zh' ? 'Release 内容为空，无法分析。' : 'Release body is empty, cannot analyze.');
    }

    const system = this.language === 'zh'
      ? '你是一个专业的 GitHub Release 更新日志分析助手。请用简体中文，以通俗易懂的语言总结本次更新。直接输出 Markdown，不要输出任何额外解释、代码块标记或“以下是总结”之类的开场白。排版需易读，使用列表形式，并按重要程度从高到低排序。'
      : 'You are a professional GitHub Release changelog analysis assistant. Summarize this update in plain, easy-to-understand English. Output Markdown directly, without any extra explanation, code fences, or opening remarks such as "Here is the summary". Use a readable layout with lists, ordered from most to least important.';

    const repoName = this.sanitizeForPrompt(meta.repoName);
    const tagName = this.sanitizeForPrompt(meta.tagName);
    const releaseName = meta.releaseName ? this.sanitizeForPrompt(meta.releaseName) : '';

    const user = this.language === 'zh'
      ? `
以下是 GitHub 仓库 "${repoName}" 的 Release（标签：${tagName}${releaseName ? `，名称：${releaseName}` : ''}）的更新说明。

请完成以下要求：
1. 用通俗易懂的语言，面向普通用户总结本次更新的要点。
2. 尽量区分「新功能 / 特性」与「Bug 修复」两类内容（无对应内容时可省略该分类）。
3. 使用列表形式（可用子列表），按重要程度从高到低排序，最重要的写在最前面。
4. 只输出 Markdown 内容，不要加额外说明。

更新说明原文：
${body}
      `.trim()
      : `
Below is the changelog of a GitHub Release for "${repoName}" (tag: ${tagName}${releaseName ? `, name: ${releaseName}` : ''}).

Requirements:
1. Summarize the update in plain language for general users.
2. Separate "New Features" from "Bug Fixes" where applicable (omit a section if empty).
3. Use lists (nested lists are fine), ordered from most to least important.
4. Output only Markdown content, no extra commentary.

Changelog:
${body}
      `.trim();

    const response = await this.requestText({
      system,
      user,
      temperature: 0.3,
      maxTokens: 4096,
      signal,
    });

    // 防御性处理：部分模型仍会用 ```markdown 或 ``` 包裹返回内容，
    // 剥离首尾代码块标记，避免 MarkdownRenderer 将其渲染成代码块。
    return response
      .replace(/^```(?:markdown)?[ \t]*\n?/i, '')
      .replace(/\n?[ \t]*```\s*$/i, '')
      .trim();
  }

  async searchGistsWithReranking(gists: Gist[], query: string): Promise<Gist[]> {
    if (gists.length === 0) return [];

    const gistSummaries = gists.slice(0, 120).map((gist, index) => {
      const files = Object.values(gist.files || {}).map(file => file.filename).join(', ');
      return `${index + 1}. ID: ${gist.id}
Description: ${gist.description || 'No description'}
Owner: ${gist.owner?.login || 'Unknown'}
Files: ${files || 'No files'}
AI Summary: ${gist.ai_summary || 'None'}`;
    }).join('\n\n');

    const system = this.language === 'zh'
      ? '你是 GitHub Gist 搜索排序助手。根据用户查询返回最相关 gist 的 id 数组 JSON，不要输出额外文字。'
      : 'You are a GitHub Gist search reranking assistant. Return a JSON array of the most relevant gist ids for the user query. Do not output extra text.';

    const content = await this.requestText({
      system,
      user: `Query: ${query}\n\nGists:\n${this.sanitizeForPrompt(gistSummaries)}`,
      temperature: 0.1,
      maxTokens: AIService.RERANKING_MAX_TOKENS,
    });

    try {
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      const ids = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      if (!Array.isArray(ids)) return gists;
      const gistById = new Map(gists.map(gist => [gist.id, gist]));
      const seen = new Set<string>();
      const ranked = ids
        .map(id => String(id))
        .filter(id => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map(id => gistById.get(id))
        .filter((gist): gist is Gist => !!gist);
      const rankedIds = new Set(ranked.map(gist => gist.id));
      return [...ranked, ...gists.filter(gist => !rankedIds.has(gist.id))];
    } catch (error) {
      logger.warn('ai', 'Failed to parse gist reranking result', error);
      return gists;
    }
  }

  /**
   * 对仓库列表做真正的语义重排序（参照 gist 重排序模式）
   * 将候选仓库摘要发送给 LLM，让其按相关性排序返回 ID 列表
   * @param repositories 候选仓库列表（通常是向量搜索的 top-K 结果）
   * @param query 用户搜索查询
   * @returns 按语义相关性排序的仓库列表
   */
  async searchRepositoriesWithSemanticReranking(repositories: Repository[], query: string, signal?: AbortSignal): Promise<Repository[]> {
    if (repositories.length === 0) return [];

    // 限制候选数量，控制 token 消耗
    // 注意：searchTopK 配置与此上限独立；若 searchTopK > 50，超出部分不会被重排序
    const candidates = repositories.slice(0, 50);

    const system = this.language === 'zh'
      ? '你是 GitHub 仓库搜索排序助手。根据用户查询，从候选仓库中选出最相关的，按相关性从高到低返回 ID 数组 JSON。只输出 JSON 数组，不要输出额外文字。'
      : 'You are a GitHub repository search reranking assistant. Given a user query and candidate repositories, return a JSON array of repository IDs ordered from most to least relevant. Output only the JSON array, no extra text.';

    const content = await this.requestText({
      system,
      user: `Query: ${query}\n\nRepositories:\n${this.sanitizeForPrompt(this.buildCandidateSummaries(candidates))}`,
      temperature: 0.1,
      maxTokens: AIService.RERANKING_MAX_TOKENS,
      signal,
    });

    const ranked = this.resolveRankedRepositories(content, candidates);
    if (ranked === null) {
      logger.warn('ai', 'Failed to parse semantic reranking result');
      return repositories;
    }
    const rankedIds = new Set(ranked.map(r => r.id));
    // 未被 LLM 排到的仓库追加到末尾（保留原始顺序）
    return [...ranked, ...repositories.filter(r => !rankedIds.has(r.id))];
  }

  /**
   * 构造候选仓库的紧凑摘要（序号. ID | 全名 / 简介 / 语言 | ★ | License | Tags）。
   * 语义重排序与无向量精选共用同一格式。
   */
  private buildCandidateSummaries(candidates: Repository[]): string {
    return candidates.map((repo, index) => {
      const stars = repo.stargazers_count >= 1000
        ? `${(repo.stargazers_count / 1000).toFixed(0)}k`
        : String(repo.stargazers_count || 0);
      const tags = (repo.ai_tags || []).slice(0, 5).join(', ');
      const desc = (repo.ai_summary || repo.description || '').slice(0, 150);
      const parts = [`${index + 1}. ID: ${repo.id} | ${repo.full_name}`];
      if (desc) parts.push(`   ${desc}`);
      const meta = [repo.language, `★${stars}`];
      // 与 embedding 一致：归一化后、非哨兵才写入，避免 raw 对象变成 "[object Object]"
      const lic = normalizeLicense(repo.license);
      if (lic !== NO_LICENSE_SENTINEL) meta.push(`License: ${lic}`);
      if (tags) meta.push(`Tags: ${tags}`);
      parts.push(`   ${meta.join(' | ')}`);
      return parts.join('\n');
    }).join('\n\n');
  }

  /**
   * 从模型输出解析排序后的仓库列表。ID 优先匹配；模型偶尔会把候选行号
   * （1..N）当作 ID 返回，此时在候选范围内按行号解析——否则整份重排结果会被
   * 静默丢弃。返回 null 表示输出里没有可解析的 JSON 数组。
   */
  private resolveRankedRepositories(content: string, candidates: Repository[]): Repository[] | null {
    const jsonMatch = content.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return null;
    let ids: unknown[];
    try {
      const parsed = JSON.parse(jsonMatch[0]) as unknown;
      if (!Array.isArray(parsed)) return null;
      ids = parsed;
    } catch {
      return null;
    }
    const byId = new Map(candidates.map(repo => [String(repo.id), repo]));
    const seen = new Set<string>();
    const ranked: Repository[] = [];
    for (const raw of ids) {
      const key = String(raw).trim();
      let repo = byId.get(key);
      if (!repo) {
        // 真实 GitHub ID 都是大整数，与 1..N 行号不会冲突；先按 ID 匹配失败
        // 再尝试行号，两种引用风格都能正确落位。
        const ordinal = Number(key);
        if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= candidates.length) {
          repo = candidates[ordinal - 1];
        }
      }
      if (repo) {
        const idKey = String(repo.id);
        if (!seen.has(idKey)) {
          seen.add(idKey);
          ranked.push(repo);
        }
      }
    }
    return ranked;
  }

  private createAnalysisRetryPrompt(originalPrompt: string, previousContent: string, invalidReason: string): string {
    const previousOutput = this.sanitizeForPrompt(previousContent).slice(0, 1200);

    if (this.language === 'zh') {
      return `
上一次 AI 输出不符合要求，原因：${invalidReason}

请基于同一仓库信息重新生成结果。必须只输出一个合法 JSON 对象，不要 Markdown、代码块、解释或任何额外文本。

强制要求：
- summary 必须是仓库功能和用途的中文概述，不超过50字。
- summary 禁止复述提示词、输出格式、字段名或“只输出JSON”等要求。
- tags 必须是字符串数组。
- platforms 只能从 ["mac","windows","linux","ios","android","docker","web","cli"] 中选择。

原始分析任务：
${originalPrompt}

上一次错误输出（仅用于纠错，不要复述）：
${previousOutput}
      `.trim();
    }

    return `
The previous AI output did not meet the requirements. Reason: ${invalidReason}

Regenerate the result for the same repository information. Output exactly one valid JSON object. Do not output Markdown, code fences, explanations, or any extra text.

Mandatory requirements:
- summary must describe the repository functionality and purpose in no more than 50 words.
- summary must not restate the prompt, output format, field names, or JSON-only requirements.
- tags must be a string array.
- platforms must only use ["mac","windows","linux","ios","android","docker","web","cli"].

Original analysis task:
${originalPrompt}

Previous invalid output for correction only. Do not restate it:
${previousOutput}
    `.trim();
  }

  private createCustomAnalysisPrompt(repository: Repository, readmeContent: string, customCategories?: string[], categoryHints?: string): string {
    const repoInfo = `
${this.language === 'zh' ? '仓库名称' : 'Repository Name'}: ${repository.full_name}
${this.language === 'zh' ? '描述' : 'Description'}: ${this.sanitizeForPrompt(repository.description || (this.language === 'zh' ? '无描述' : 'No description'))}
${this.language === 'zh' ? '编程语言' : 'Programming Language'}: ${repository.language || (this.language === 'zh' ? '未知' : 'Unknown')}
${this.language === 'zh' ? 'Star数' : 'Stars'}: ${repository.stargazers_count}
${this.language === 'zh' ? '主题标签' : 'Topics'}: ${repository.topics?.join(', ') || (this.language === 'zh' ? '无' : 'None')}

${this.language === 'zh' ? 'README内容 (前2000字符)' : 'README Content (first 2000 characters)'}:
${this.sanitizeForPrompt(readmeContent.substring(0, 2000))}
    `.trim();

    const categoriesInfo = customCategories && customCategories.length > 0 
      ? `\n\n${this.language === 'zh' ? '可用的应用分类' : 'Available Application Categories'}: ${customCategories.join(', ')}`
      : '';

    let customPrompt = this.config.customPrompt || '';
    customPrompt = customPrompt.replace(/\{REPO_INFO\}/g, repoInfo);
    customPrompt = customPrompt.replace(/\{CATEGORIES_INFO\}/g, categoriesInfo);
    customPrompt = customPrompt.replace(/\{LANGUAGE\}/g, this.language);
    const sanitizedHints = this.sanitizeForPrompt(categoryHints || '');
    if (customPrompt.includes('{CATEGORIES_HINT}')) {
      customPrompt = customPrompt.replace(/\{CATEGORIES_HINT\}/g, sanitizedHints);
    } else if (sanitizedHints) {
      customPrompt = `${customPrompt.trim()}\n\n${this.language === 'zh'
        ? '自定义分类提示：\n' + sanitizedHints
        : 'Custom category hints:\n' + sanitizedHints}`;
    }

    return customPrompt;
  }

  private createAnalysisPrompt(repository: Repository, readmeContent: string, customCategories?: string[], categoryHints?: string): string {
    const repoInfo = `
${this.language === 'zh' ? '仓库名称' : 'Repository Name'}: ${repository.full_name}
${this.language === 'zh' ? '描述' : 'Description'}: ${this.sanitizeForPrompt(repository.description || (this.language === 'zh' ? '无描述' : 'No description'))}
${this.language === 'zh' ? '编程语言' : 'Programming Language'}: ${repository.language || (this.language === 'zh' ? '未知' : 'Unknown')}
${this.language === 'zh' ? 'Star数' : 'Stars'}: ${repository.stargazers_count}
${this.language === 'zh' ? '主题标签' : 'Topics'}: ${repository.topics?.join(', ') || (this.language === 'zh' ? '无' : 'None')}

${this.language === 'zh' ? 'README内容 (前2000字符)' : 'README Content (first 2000 characters)'}:
${this.sanitizeForPrompt(readmeContent.substring(0, 2000))}
    `.trim();

    if (this.language === 'zh') {
      const categoriesLine = customCategories && customCategories.length > 0
        ? `\n可用分类（tags 请优先从中选择）：${customCategories.join(', ')}`
        : '';
      const hintLine = categoryHints && categoryHints.length > 0
        ? `\n\n自定义分类提示：以下是用户自定义的分类及其关键词。当仓库的名称、描述、Topics 或 README 明显与某个自定义分类的关键词相关时，请务必把该自定义分类名作为 tags 之一（仍保持中文，3-5个）。\n${this.sanitizeForPrompt(categoryHints)}`
        : '';
      return `
请分析以下GitHub仓库信息，并只输出合法JSON对象。不要输出思考过程、Markdown、代码块标记、解释或任何额外文本。

要求：
- summary：中文概述，说明仓库的主要功能和用途，不超过50字。
  禁止出现“我们被要求”“只输出JSON”“根据仓库信息”“summary/tags/platforms”等提示词复述。
- tags：3-5个中文应用类型标签${customCategories && customCategories.length > 0 ? '，请优先从上方的可用分类中选择' : '，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等'}。${categoriesLine}${hintLine}
- platforms：只能从 ["mac","windows","linux","ios","android","docker","web","cli"] 中选择；无法判断则为 []。

输出格式：
{
  "summary": "中文概述",
  "tags": ["标签1", "标签2", "标签3"],
  "platforms": ["web", "cli"]
}

平台线索：
Dockerfile/docker-compose=docker；CLI/命令行/终端=cli；浏览器/前端/API=web；iOS/Swift/Xcode=ios；Android/Kotlin/Gradle=android；macOS/Homebrew=mac；Windows/.exe/MSI=windows；Linux/systemd/apt=linux。

仓库信息：
${repoInfo}
      `.trim();
    } else {
      const categoriesLine = customCategories && customCategories.length > 0
        ? `\nAvailable categories (tags should prioritize these): ${customCategories.join(', ')}`
        : '';
      const hintLine = categoryHints && categoryHints.length > 0
        ? `\n\nCustom category hint: The following are user-defined custom categories with their keywords. When the repository keywords, description, Topics, or README clearly relate to these keywords, include the custom category name as-is in tags (3-5 tags total).\n${this.sanitizeForPrompt(categoryHints)}`
        : '';
      return `
Please analyze the following GitHub repository information and only output a valid JSON object. Do not output thinking process, Markdown, code block markers, explanations, or any extra text.

Requirements:
- summary: A concise English overview explaining the main functionality and purpose, no more than 50 words.
  Do not include prompt restatements such as "asked to", "only output JSON", "based on repository information", or "summary/tags/platforms".
- tags: 3-5 English application type tags${customCategories && customCategories.length > 0 ? ', please prioritize from the available categories above' : ', similar to app store categories such as: development tools, web apps, mobile apps, database, AI tools, etc.'}.${categoriesLine}${hintLine}
- platforms: Must only choose from ["mac","windows","linux","ios","android","docker","web","cli"]; use [] if unable to determine.

Output format:
{
  "summary": "English overview",
  "tags": ["tag1", "tag2", "tag3"],
  "platforms": ["web", "cli"]
}

Platform hints:
Dockerfile/docker-compose=docker; CLI/command-line/terminal=cli; browser/frontend/API=web; iOS/Swift/Xcode=ios; Android/Kotlin/Gradle=android; macOS/Homebrew=mac; Windows/.exe/MSI=windows; Linux/systemd/apt=linux.

Repository information:
${repoInfo}
      `.trim();
    }
  }

  private static readonly VALID_PLATFORMS = ['mac', 'windows', 'linux', 'ios', 'android', 'docker', 'web', 'cli'];

  /**
   * 校验 summary 是否为真实仓库概述。
   * 命中提示词复述时直接判为无效，由上层触发重新生成。
   */
  private sanitizeSummary(raw: string): string | null {
    if (!raw) return null;

    const cleaned = raw
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, '')
      .trim();

    if (cleaned.length < 3) return null;

    if (/^[\s.,;:!?，。；：！？、]+$/.test(cleaned)) return null;

    const promptRestatementPatterns: RegExp[] = [
      /^(?:我们|我)被要求(?:只?输出|分析|评估|总结|概述|介绍|提供|生成|返回)/i,
      /^(?:根据|按照|基于)(?:给定的?)?(?:要求|提示|指示|任务|prompt|instruction)[，,。.\s]/i,
      /^(?:根据|按照|基于)(?:给定的?)?(?:仓库|项目|repo|repository)(?:信息|描述)?[，,。.\s]*(?:需要|应|要)?(?:提供|输出|生成|返回)(?:\s*summary|\s*摘要|\s*tags?|\s*platforms?)/i,
      /(?:^|[。！？.!?]\s*)(?:只输出|输出)\s*(?:一个)?(?:合法)?\s*JSON(?:对象)?(?:[，,。.!?]|$)/i,
      /(?:不要|不应|不能)(?:输出)?(?:任何)?(?:思考过程|Markdown|代码块|解释|额外文本)/i,
      /(?:需要|要求)(?:提供|输出|生成|返回)\s*(?:summary|摘要)[、,，\s]*(?:tags?)[、,，\s]*(?:和|与|and)?\s*platforms?/i,
      /\bsummary\b[、,，/\s]*(?:tags?)[、,，/\s]*(?:和|与|and)?\s*platforms?\b/i,
      /^(?:I|we)\s*(?:(?:have been|was|were|am)\s*)?(?:asked|instructed|told|requested)\b/i,
      /^(?:based|according)\s+(?:on|to)\s+(?:the\s+)?(?:request|prompt|instruction|task)[.,:;\s]/i,
      /^(?:based|according)\s+(?:on|to)\s+(?:the\s+)?(?:repository|repo|project)\s+(?:information|description)[.,:;\s]*(?:we\s+)?(?:need|should|must|will)?\s*(?:provide|output|generate|return)/i,
      /(?:^|[.!?]\s*)(?:only\s+output|output\s+only)\s+(?:one\s+)?(?:valid\s+)?json(?:\s+object)?(?:[.,!?]|$)/i,
      /(?:do\s+not|don't)\s+output\s+(?:any\s+)?(?:thinking|markdown|code\s+block|explanation|extra\s+text)/i,
      /(?:need|required|asked)\s+to\s+(?:provide|output|generate|return)\s+summary/i,
      /^(?:here|this)\s+(?:is|are)\s+(?:the|my|a)\s+(?:analysis|summary|result|overview)[.,:;\s]/i,
      /^(?:analysis|summary|overview)\s*(?:result|of)?[.:]\s*/i,
    ];

    if (promptRestatementPatterns.some((pattern) => pattern.test(cleaned))) return null;

    return cleaned;
  }

  private parseAIResponse(content: string): ParsedAIResponse {
    try {
      // Strip thinking tags that some models embed in the content field (e.g. <think>...</think>)
      // Also handle truncated tags (dangling <think> without </think>) from token exhaustion
      const cleaned = content
        .trim()
        .replace(/<think>[\s\S]*?<\/think>/gi, '')
        .replace(/<think>[\s\S]*$/gi, '')
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = this.extractAndParseAIJson(cleaned);
      if (parsed) {
        const rawSummary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
        const summary = this.sanitizeSummary(rawSummary);
        const tags = Array.isArray(parsed.tags) ? parsed.tags.filter((v) => typeof v === 'string').slice(0, 5) : [];
        const platforms = Array.isArray(parsed.platforms)
          ? Array.from(
              new Set(
                parsed.platforms
                  .filter((v): v is string => typeof v === 'string')
                  .map((v) => v.trim().toLowerCase())
                  .filter((v) => AIService.VALID_PLATFORMS.includes(v))
              )
            ).slice(0, 8)
          : [];

        if (!summary) {
          return {
            summary: '',
            tags,
            platforms,
            isValid: false,
            invalidReason: rawSummary
              ? (this.language === 'zh' ? 'summary包含提示词复述或不是仓库概述' : 'summary contains prompt restatement or is not a repository overview')
              : (this.language === 'zh' ? 'summary缺失或为空' : 'summary is missing or empty'),
          };
        }

        return {
          summary,
          tags,
          platforms,
          isValid: true,
        };
      }

      return {
        summary: '',
        tags: [],
        platforms: [],
        isValid: false,
        invalidReason: this.language === 'zh' ? '未返回合法JSON对象' : 'No valid JSON object returned',
      };
    } catch (error) {
      logger.errorFromError('ai', 'Failed to parse AI response', error);
      return {
        summary: '',
        tags: [],
        platforms: [],
        isValid: false,
        invalidReason: this.language === 'zh' ? '解析AI返回失败' : 'Failed to parse AI response',
      };
    }
  }

  private extractAndParseAIJson(content: string): Record<string, unknown> | null {
    const direct = this.tryParseJsonObject(content);
    if (direct) return direct;

    const start = content.indexOf('{');
    if (start === -1) return null;

    let inString = false;
    let escaped = false;
    let depth = 0;

    for (let i = start; i < content.length; i++) {
      const char = content[i];

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === '{') depth++;
      if (char === '}') {
        depth--;
        if (depth === 0) {
          return this.tryParseJsonObject(content.slice(start, i + 1));
        }
      }
    }

    return null;
  }

  private tryParseJsonObject(text: string): Record<string, unknown> | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;

    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const apiType = this.getApiType();
    const timeoutMs = apiType === 'openai-responses' || apiType === 'gemini' || this.config.reasoningEffort ? 30000 : 10000;

    try {
      const base = new URL(this.config.baseUrl);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') {
        return {
          success: false,
          errorType: 'unknown',
          message: this.language === 'zh'
            ? '无效的协议，请使用 http:// 或 https://'
            : 'Invalid protocol, please use http:// or https://',
        };
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const content = await this.requestText({
          system: 'You are a connection test assistant.',
          user: 'Reply with exactly one word: OK',
          temperature: 0,
          maxTokens: 2048,
          signal: controller.signal,
        });
        if (content) {
          return {
            success: true,
            message: this.language === 'zh' ? '连接成功' : 'Connection successful',
          };
        }
        return {
          success: false,
          errorType: 'unknown',
          message: this.language === 'zh' ? '未收到响应内容' : 'No content received',
        };
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const err = error as Error;
      const errorMessage = err.message || '';

      // 解析状态码
      const statusMatch = errorMessage.match(/(\d{3})/);
      const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : undefined;

      // 处理超时错误
      if (errorMessage.includes('timeout') || errorMessage.includes('abort') || err.name === 'AbortError') {
        return {
          success: false,
          errorType: 'timeout',
          message: this.language === 'zh'
            ? `连接超时（${timeoutMs / 1000}秒）。请检查：1. 网络连接是否正常 2. API端点是否正确 3. 服务器是否响应缓慢`
            : `Connection timeout (${timeoutMs / 1000}s). Please check: 1. Network connection 2. API endpoint 3. Server response time`,
        };
      }

      // 处理网络错误
      if (errorMessage.includes('fetch') || errorMessage.includes('network') || errorMessage.includes('Failed to fetch')) {
        return {
          success: false,
          errorType: 'network',
          message: this.language === 'zh'
            ? '网络连接失败。请检查：1. 网络连接是否正常 2. API端点地址是否正确 3. 防火墙或代理设置'
            : 'Network connection failed. Please check: 1. Network connection 2. API endpoint 3. Firewall or proxy settings',
        };
      }

      // 如果有状态码，提供详细的错误信息
      if (statusCode) {
        const meaning = getStatusCodeMeaning(statusCode, this.language);
        const errorType = getErrorTypeFromStatus(statusCode) ?? 'unknown';
        const suggestions: Record<string, { zh: string; en: string }> = {
          auth: {
            zh: '请检查 API 密钥是否正确，或密钥是否已过期',
            en: 'Please check if the API key is correct or expired',
          },
          timeout: {
            zh: '请求超时，请稍后重试或检查网络连接',
            en: 'Request timeout, please retry later or check network',
          },
          server: {
            zh: '服务器端错误，请稍后重试或联系服务提供商',
            en: 'Server error, please retry later or contact provider',
          },
          unknown: {
            zh: '请检查 API 端点、模型名称和请求参数是否正确',
            en: 'Please check API endpoint, model name and request parameters',
          },
        };

        return {
          success: false,
          statusCode,
          statusText: meaning,
          errorType,
          message: this.language === 'zh'
            ? `HTTP ${statusCode} - ${meaning}\n建议：${suggestions[errorType].zh}`
            : `HTTP ${statusCode} - ${meaning}\nSuggestion: ${suggestions[errorType].en}`,
        };
      }

      // 默认错误
      return {
        success: false,
        errorType: 'unknown',
        message: this.language === 'zh'
          ? `连接失败：${errorMessage || '未知错误'}\n请检查 API 端点、API 密钥和模型名称是否正确`
          : `Connection failed: ${errorMessage || 'Unknown error'}\nPlease check API endpoint, API key and model name`,
      };
    }
  }

  /**
   * HyDE (Hypothetical Document Embedding) 查询预处理
   * 根据用户查询生成一个"理想仓库描述"，用该描述生成向量而非原始查询
   * 对短查询、中文查询、概念查询效果显著提升
   * @param query 用户原始查询
   * @param signal 可选 AbortSignal
   * @returns 生成的理想仓库描述（用于向量嵌入）
   */
  async generateHyDEQuery(query: string, signal?: AbortSignal): Promise<string> {
    const system = this.language === 'zh'
      ? '你是一个搜索助手。根据用户的搜索意图，生成一段 2-3 句话的理想 GitHub 仓库描述，包含相关技术术语、编程语言和使用场景。只输出描述文本，不要输出其他内容。'
      : 'You are a search assistant. Given a user search query, generate a 2-3 sentence description of the ideal GitHub repository that would perfectly match this query. Include relevant technical terms, programming languages, and use cases. Output only the description, no extra text.';

    const content = await this.requestText({
      system,
      user: `Search query: "${query}"`,
      temperature: 0.3,
      maxTokens: 200,
      signal,
    });

    // 清理可能的引号或多余空白
    return content.replace(/^["']|["']$/g, '').trim() || query;
  }

  /**
   * 无向量路径的 AI 语义搜索（向量搜索不可用时的降级链）。
   * 三段式：
   * ① 查询扩展 + 意图复述（一次 chat 调用）；
   * ② 本地词法打分召回候选（小库直接全量；大库取 top-K，token 成本与库容解耦）；
   * ③ LLM 精选排序（只返回真正相关的仓库，最多 20 个）。
   * 与旧实现（LLM 只做关键词扩展、本地 OR 子串过滤）的本质区别：LLM 能看到
   * 仓库摘要并直接决定结果与顺序。LLM 调用/解析失败时按词法得分序兜底；
   * 模型明确表示"无相关结果"时返回空数组（UI 呈现空态而非噪声）。
   */
  async searchRepositoriesWithSelection(
    repositories: Repository[],
    query: string,
    options: {
      signal?: AbortSignal;
      /** 搜索阶段回调，供 UI 展示进度（扩展查询 → 精选排序）。 */
      onPhase?: (phase: 'expanding' | 'selecting') => void;
      /** AI 精选未能产出结果时回调，供 UI 提示原因：ai_failed=请求/配置失败，
       *  unparseable=响应无法解析，ai_empty=模型判定无相关仓库。 */
      onFallback?: (reason: 'ai_failed' | 'unparseable' | 'ai_empty') => void;
    } = {}
  ): Promise<Repository[]> {
    const startTime = Date.now();
    if (!query.trim()) return repositories;
    const { signal, onPhase, onFallback } = options;
    let aiTerms: string[] = [];
    let intent = '';

    try {
      logger.info('ai', 'Starting AI selection search', { apiType: this.getApiType(), model: this.config.model, configId: this.config.id, query });

      // ① 查询扩展 + 意图复述。思考类模型的思考 token 与输出共享预算，
      //    预算太小会把 JSON 截断在半截（实测 glm 思考模型 300 token 不够），
      //    给足余量；非思考模型只按实际用量计费，无额外成本。
      onPhase?.('expanding');
      const system = this.language === 'zh'
        ? '你是一个智能搜索助手。请分析用户的搜索意图，提取关键词并提供多语言翻译。'
        : 'You are an intelligent search assistant. Please analyze user search intent, extract keywords and provide multilingual translations.';
      const content = await this.requestText({
        system,
        user: this.createSearchPrompt(query),
        temperature: 0.1,
        maxTokens: 2000,
        signal,
      });
      if (content) {
        const parsed = this.parseSearchResponse(content);
        aiTerms = parsed.terms;
        intent = parsed.intent;
      }

      // ② 候选召回
      let candidates: Repository[];
      if (repositories.length <= AIService.SELECTION_FULL_LIBRARY_LIMIT) {
        // 小库：全量直送（LLM 上下文足够，召回阶段没有信息增益）
        candidates = [...repositories].sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
      } else {
        const scored = this.scoreRepositoriesByKeywords(repositories, query, aiTerms);
        candidates = scored.slice(0, AIService.SELECTION_CANDIDATE_LIMIT).map(item => item.repo);
        if (candidates.length < AIService.SELECTION_MIN_CANDIDATES) {
          // 词法命中过少（如纯语义查询）：用 star 排序补足，保证 LLM 有足够候选
          const have = new Set(candidates.map(repo => repo.id));
          const pad = [...repositories]
            .sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0))
            .filter(repo => !have.has(repo.id));
          candidates = candidates.concat(pad.slice(0, AIService.SELECTION_CANDIDATE_LIMIT - candidates.length));
        }
      }
      if (candidates.length === 0) return [];

      // ③ LLM 精选排序
      onPhase?.('selecting');
      const ranked = await this.selectRelevantRepositories(candidates, query, intent, signal);
      if (ranked === null) {
        // 响应缺失或格式非法：按词法得分序兜底
        onFallback?.('unparseable');
        logger.warn('ai', 'AI selection returned unparseable result, falling back to lexical ranking', { configId: this.config.id, durationMs: Date.now() - startTime });
        return this.performEnhancedBasicSearch(repositories, query, aiTerms)
          .slice(0, AIService.SELECTION_CANDIDATE_LIMIT);
      }
      if (ranked.length === 0) {
        // 模型明确判定无相关仓库：尊重该判断返回空态，但让调用方知道原因
        onFallback?.('ai_empty');
        logger.info('ai', 'AI selection found no relevant repositories', { configId: this.config.id, durationMs: Date.now() - startTime });
        return [];
      }
      logger.info('ai', 'AI selection completed', {
        apiType: this.getApiType(),
        model: this.config.model,
        configId: this.config.id,
        candidates: candidates.length,
        resultCount: ranked.length,
        durationMs: Date.now() - startTime,
      });
      return ranked;
    } catch (error) {
      // 用户主动取消：不产出兜底结果，向上传播交由调用方处理
      if (signal?.aborted || isAbortError(error)) throw error;
      onFallback?.('ai_failed');
      logger.warn('ai', 'AI selection failed, falling back to lexical ranking', {
        apiType: this.getApiType(),
        model: this.config.model,
        configId: this.config.id,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.performEnhancedBasicSearch(repositories, query, aiTerms)
        .slice(0, AIService.SELECTION_CANDIDATE_LIMIT);
    }
  }

  /**
   * 把候选仓库摘要交给 LLM，选出与查询真正相关的仓库并按相关性排序。
   * 返回 null 表示响应缺失/无法解析（调用方走词法兜底）；空数组是合法结果
   * （模型判断没有仓库能满足查询意图）。
   */
  private async selectRelevantRepositories(
    candidates: Repository[],
    query: string,
    intent: string,
    signal?: AbortSignal
  ): Promise<Repository[] | null> {
    const summaries = this.sanitizeForPrompt(this.buildCandidateSummaries(candidates));
    const intentLine = intent
      ? (this.language === 'zh'
        ? `\n\n用户意图说明：${this.sanitizeForPrompt(intent)}`
        : `\n\nQuery intent: ${this.sanitizeForPrompt(intent)}`)
      : '';

    const system = this.language === 'zh'
      ? '你是 GitHub 仓库搜索排序助手。根据用户查询，从候选仓库中选出真正相关的仓库，按相关性从高到低返回其 ID 的 JSON 数组。注意：ID 是候选列表中给出的真实仓库 ID（一长串数字），严禁使用序号、行号或自行编号。只输出 JSON 数组，不要输出任何额外文字。若没有仓库能满足查询意图，返回空数组 []。'
      : 'You are a GitHub repository search reranking assistant. Select the repositories that truly match the user query and return their IDs as a JSON array ordered from most to least relevant. The ID is the real repository ID (a long number) from the candidate list; never use ordinals or line numbers. Output only the JSON array, no extra text. If no repository satisfies the query intent, return an empty array [].';

    const user = this.language === 'zh'
      ? `用户查询：「${this.sanitizeForPrompt(query)}」${intentLine}\n\n候选仓库（共 ${candidates.length} 个）：\n${summaries}\n\n要求：\n- 只保留能满足查询意图的仓库；若没有仓库能真正满足意图，返回 []，不要用仅部分沾边的仓库凑数。\n- 相关性相近时，star 数更高、更活跃的优先。\n- 最多返回 ${AIService.SELECTION_MAX_RESULTS} 个 ID。`
      : `User query: "${this.sanitizeForPrompt(query)}"${intentLine}\n\nCandidate repositories (${candidates.length} total):\n${summaries}\n\nRequirements:\n- Keep only repositories that satisfy the query intent; if none truly do, return [] instead of padding with loosely related ones.\n- When relevance is similar, prefer higher stars and more active projects.\n- Return at most ${AIService.SELECTION_MAX_RESULTS} IDs.`;

    const content = await this.requestText({
      system,
      user,
      temperature: 0.1,
      // 推理 token 与输出共享预算（openai reasoning 模型、gemini 2.5 思考模型）：
      // 小预算被推理耗尽时 content 为空、精选会静默退化，故复用重排序的 4096
      // 预算；普通模型 800 足够容纳 ≤20 个 ID 的 JSON 数组。
      maxTokens: (this.config.reasoningEffort || this.getApiType() === 'gemini')
        ? AIService.RERANKING_MAX_TOKENS
        : AIService.SELECTION_MAX_TOKENS,
      signal,
    });

    const ranked = this.resolveRankedRepositories(content, candidates);
    if (ranked === null) return null;
    return ranked.slice(0, AIService.SELECTION_MAX_RESULTS);
  }

  /**
   * 词法加权打分（候选召回与失败兜底共用）。查询词用高权重；AI 扩展词是弱
   * 信号，只用于召回与加分，权重约为查询词的六成。
   */
  private scoreRepositoriesByKeywords(repositories: Repository[], query: string, aiTerms: string[]): Array<{ repo: Repository; score: number }> {
    const normalizedQuery = query.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 0);
    // 去重并剔除与任一查询词相同的扩展词：避免同一命中被查询词与扩展词
    // 重复计分（按词级剔除，而非仅完整查询串）
    const querySet = new Set([normalizedQuery, ...queryWords]);
    // 中文查询没有空格分词，整串子串在英文元数据上几乎必然零命中（AI 失败
    // 兜底时会得到空结果）：把 CJK 连续段切成 bigram 作为弱信号词参与召回
    // 与计分。仅用于 AI 搜索的词法路径；输入框的 performBasicTextSearch 不受影响。
    const cjkTerms = AIService.extractCjkBigrams(normalizedQuery).filter(bigram => !querySet.has(bigram));
    const terms = [
      ...new Set([
        ...aiTerms.map(term => term.toLowerCase()).filter(term => term && !querySet.has(term)),
        ...cjkTerms,
      ]),
    ];

    const scoredRepos: Array<{ repo: Repository; score: number }> = [];
    for (const repo of repositories) {
      let score = 0;

      const searchableFields = {
        name: repo.name.toLowerCase(),
        fullName: repo.full_name.toLowerCase(),
        description: (repo.description || '').toLowerCase(),
        language: (repo.language || '').toLowerCase(),
        topics: (repo.topics || []).join(' ').toLowerCase(),
        aiSummary: (repo.ai_summary || '').toLowerCase(),
        aiTags: (repo.ai_tags || []).join(' ').toLowerCase(),
        aiPlatforms: (repo.ai_platforms || []).join(' ').toLowerCase(),
        customDescription: (repo.custom_description || '').toLowerCase(),
        customTags: (repo.custom_tags || []).join(' ').toLowerCase(),
        license: normalizeLicense(repo.license).toLowerCase(),
      };

      // 完全无命中（查询词与扩展词均未命中）的仓库不进入候选
      const hasMatch = queryWords.some(word => {
        return Object.values(searchableFields).some(fieldValue => {
          return fieldValue.includes(word);
        });
      }) || terms.some(term => {
        return Object.values(searchableFields).some(fieldValue => {
          return fieldValue.includes(term);
        });
      });

      if (!hasMatch) continue;

      // Calculate relevance score
      queryWords.forEach(word => {
        // Name matches (highest weight)
        if (searchableFields.name.includes(word)) score += 0.4;
        if (searchableFields.fullName.includes(word)) score += 0.35;

        // Description matches
        if (searchableFields.description.includes(word)) score += 0.3;
        if (searchableFields.customDescription.includes(word)) score += 0.32;

        // Tags and topics matches
        if (searchableFields.topics.includes(word)) score += 0.25;
        if (searchableFields.aiTags.includes(word)) score += 0.22;
        if (searchableFields.customTags.includes(word)) score += 0.24;

        // AI summary matches
        if (searchableFields.aiSummary.includes(word)) score += 0.15;

        // Platform and language matches
        if (searchableFields.aiPlatforms.includes(word)) score += 0.18;
        if (searchableFields.language.includes(word)) score += 0.12;

        // License matches
        if (searchableFields.license.includes(word)) score += 0.2;
      });

      // AI 扩展词：较弱权重的同类命中
      terms.forEach(term => {
        if (searchableFields.name.includes(term)) score += 0.25;
        if (searchableFields.fullName.includes(term)) score += 0.2;
        if (searchableFields.customDescription.includes(term)) score += 0.2;
        if (searchableFields.description.includes(term)) score += 0.18;
        if (searchableFields.topics.includes(term)) score += 0.15;
        if (searchableFields.aiTags.includes(term)) score += 0.13;
        if (searchableFields.customTags.includes(term)) score += 0.14;
        if (searchableFields.aiPlatforms.includes(term)) score += 0.1;
        if (searchableFields.aiSummary.includes(term)) score += 0.1;
        if (searchableFields.license.includes(term)) score += 0.12;
        if (searchableFields.language.includes(term)) score += 0.08;
      });

      // Boost for exact matches
      if (searchableFields.name === normalizedQuery) score += 0.5;
      if (searchableFields.name.includes(normalizedQuery)) score += 0.3;

      // Popularity boost (logarithmic to avoid overwhelming other factors)
      const popularityScore = Math.log10(repo.stargazers_count + 1) * 0.05;
      score += popularityScore;

      scoredRepos.push({ repo, score });
    }

    scoredRepos.sort((a, b) => b.score - a.score);
    return scoredRepos;
  }

  /** 词法得分排序兜底：只保留得分 > 0 的仓库，按得分从高到低。 */
  private performEnhancedBasicSearch(repositories: Repository[], query: string, aiTerms: string[] = []): Repository[] {
    return this.scoreRepositoriesByKeywords(repositories, query, aiTerms)
      .filter(item => item.score > 0)
      .map(item => item.repo);
  }

  /**
   * 把文本里的 CJK 连续段切成 bigram（"星标仓库" → 星标 / 标仓 / 仓库），
   * 去重并限量。中文没有空格分词，整串子串匹配对英文元数据几乎必然失效，
   * bigram 是无依赖词典时的最低成本召回手段。
   */
  private static extractCjkBigrams(text: string): string[] {
    const cjkRuns = text.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || [];
    const bigrams: string[] = [];
    for (const run of cjkRuns) {
      if (run.length === 1) {
        bigrams.push(run);
        continue;
      }
      for (let i = 0; i < run.length - 1; i++) {
        bigrams.push(run.slice(i, i + 2));
      }
    }
    return [...new Set(bigrams)].slice(0, 12);
  }

  private createSearchPrompt(query: string): string {
    if (this.language === 'zh') {
      return `
用户搜索查询: "${query}"

请分析这个搜索查询并提供：
1. 一句话复述用户的真实搜索意图（不超过30字）
2. 主要关键词（中英文）
3. 相关的技术术语和同义词
4. 可能的应用类型或分类

以JSON格式回复：
{
  "intent": "一句话复述用户的真实搜索意图",
  "keywords": ["关键词1", "keyword1", "关键词2", "keyword2"],
  "categories": ["分类1", "category1"],
  "synonyms": ["同义词1", "synonym1"]
}
      `.trim();
    } else {
      return `
User search query: "${query}"

Please analyze this search query and provide:
1. One sentence restating the user's true search intent (max 30 words)
2. Main keywords (in English and Chinese)
3. Related technical terms and synonyms
4. Possible application types or categories

Reply in JSON format:
{
  "intent": "One sentence restating the user's true search intent",
  "keywords": ["keyword1", "关键词1", "keyword2", "关键词2"],
  "categories": ["category1", "分类1"],
  "synonyms": ["synonym1", "同义词1"]
}
      `.trim();
    }
  }

  private parseSearchResponse(content: string): { terms: string[]; intent: string } {
    try {
      const parsed = this.extractAndParseAIJson(content);
      if (parsed) {
        const terms = [
          ...(Array.isArray(parsed.keywords) ? parsed.keywords : []),
          ...(Array.isArray(parsed.categories) ? parsed.categories : []),
          ...(Array.isArray(parsed.synonyms) ? parsed.synonyms : []),
        ]
          .filter((term): term is string => typeof term === 'string' && term.trim().length > 0)
          .map(term => term.trim());
        const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : '';
        return { terms: [...new Set(terms)], intent: intent.slice(0, 100) };
      }
    } catch (error) {
      logger.warn('ai', 'Failed to parse AI search response', { error: String(error) });
    }
    return { terms: [], intent: '' };
  }

  static async searchRepositories(repositories: Repository[], query: string): Promise<Repository[]> {
    // This is a static fallback method for when no AI config is available
    if (!query.trim()) return repositories;

    const normalizedQuery = query.toLowerCase();
    
    return repositories.filter(repo => {
      const searchableText = [
        repo.name,
        repo.full_name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
        ...(repo.custom_tags || []),
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
        normalizeLicense(repo.license),
      ].join(' ').toLowerCase();

      // Split query into words and check if all words are present
      const queryWords = normalizedQuery.split(/\s+/);
      return queryWords.every(word => searchableText.includes(word));
    });
  }
}
