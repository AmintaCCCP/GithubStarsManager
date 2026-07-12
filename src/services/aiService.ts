import { Repository, Gist, AIConfig, AIApiType } from '../types';
import { backend } from './backendAdapter';
import { buildApiUrl, buildFinalApiUrl } from '../utils/apiUrlBuilder';
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
          throw new Error(`AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`);
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
          throw new Error(`AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`);
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
        throw new Error(`AI API error: ${response.status} ${response.statusText}${errorDetail ? ` - ${errorDetail}` : ''}`);
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

  async analyzeRepository(repository: Repository, readmeContent: string, customCategories?: string[], signal?: AbortSignal): Promise<RepositoryAnalysisResult> {
    const startTime = Date.now();
    const configId = this.config.id;
    const { full_name } = repository;
    const owner = full_name.split('/')[0] || '';
    const repo = full_name.split('/')[1] || full_name;
    logger.info('ai', 'AI analysis started', { owner, repo, configId });

    const prompt = this.config.useCustomPrompt && this.config.customPrompt
      ? this.createCustomAnalysisPrompt(repository, readmeContent, customCategories)
      : this.createAnalysisPrompt(repository, readmeContent, customCategories);

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

    const repoSummaries = candidates.map((repo, index) => {
      const stars = repo.stargazers_count >= 1000
        ? `${(repo.stargazers_count / 1000).toFixed(0)}k`
        : String(repo.stargazers_count || 0);
      const tags = (repo.ai_tags || []).slice(0, 5).join(', ');
      const desc = (repo.ai_summary || repo.description || '').slice(0, 150);
      const parts = [`${index + 1}. ID: ${repo.id} | ${repo.full_name}`];
      if (desc) parts.push(`   ${desc}`);
      const meta = [repo.language, `★${stars}`];
      if (tags) meta.push(`Tags: ${tags}`);
      parts.push(`   ${meta.join(' | ')}`);
      return parts.join('\n');
    }).join('\n\n');

    const system = this.language === 'zh'
      ? '你是 GitHub 仓库搜索排序助手。根据用户查询，从候选仓库中选出最相关的，按相关性从高到低返回 ID 数组 JSON。只输出 JSON 数组，不要输出额外文字。'
      : 'You are a GitHub repository search reranking assistant. Given a user query and candidate repositories, return a JSON array of repository IDs ordered from most to least relevant. Output only the JSON array, no extra text.';

    const content = await this.requestText({
      system,
      user: `Query: ${query}\n\nRepositories:\n${this.sanitizeForPrompt(repoSummaries)}`,
      temperature: 0.1,
      maxTokens: AIService.RERANKING_MAX_TOKENS,
      signal,
    });

    try {
      const jsonMatch = content.match(/\[[\s\S]*?\]/);
      const ids = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      if (!Array.isArray(ids)) return repositories;

      const repoById = new Map(repositories.map(r => [String(r.id), r]));
      const seen = new Set<string>();
      const ranked = ids
        .map((id: unknown) => String(id))
        .filter(id => {
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map(id => repoById.get(id))
        .filter((r): r is Repository => !!r);
      const rankedIds = new Set(ranked.map(r => r.id));
      // 未被 LLM 排到的仓库追加到末尾（保留原始顺序）
      return [...ranked, ...repositories.filter(r => !rankedIds.has(r.id))];
    } catch (error) {
      logger.warn('ai', 'Failed to parse semantic reranking result', error);
      return repositories;
    }
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

  private createCustomAnalysisPrompt(repository: Repository, readmeContent: string, customCategories?: string[]): string {
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

    // 替换自定义提示词中的占位符
    let customPrompt = this.config.customPrompt || '';
    customPrompt = customPrompt.replace(/\{REPO_INFO\}/g, repoInfo);
    customPrompt = customPrompt.replace(/\{CATEGORIES_INFO\}/g, categoriesInfo);
    customPrompt = customPrompt.replace(/\{LANGUAGE\}/g, this.language);

    return customPrompt;
  }

  private createAnalysisPrompt(repository: Repository, readmeContent: string, customCategories?: string[]): string {
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
      return `
请分析以下GitHub仓库信息，并只输出合法JSON对象。不要输出思考过程、Markdown、代码块标记、解释或任何额外文本。

要求：
- summary：中文概述，说明仓库的主要功能和用途，不超过50字。
  禁止出现“我们被要求”“只输出JSON”“根据仓库信息”“summary/tags/platforms”等提示词复述。
- tags：3-5个中文应用类型标签${customCategories && customCategories.length > 0 ? '，请优先从上方的可用分类中选择' : '，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等'}。${categoriesLine}
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
      return `
Please analyze the following GitHub repository information and only output a valid JSON object. Do not output thinking process, Markdown, code block markers, explanations, or any extra text.

Requirements:
- summary: A concise English overview explaining the main functionality and purpose, no more than 50 words.
  Do not include prompt restatements such as "asked to", "only output JSON", "based on repository information", or "summary/tags/platforms".
- tags: 3-5 English application type tags${customCategories && customCategories.length > 0 ? ', please prioritize from the available categories above' : ', similar to app store categories such as: development tools, web apps, mobile apps, database, AI tools, etc.'}.${categoriesLine}
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

  async searchRepositories(repositories: Repository[], query: string): Promise<Repository[]> {
    const startTime = Date.now();
    if (!query.trim()) return repositories;

    try {
      // Use AI to understand and translate the search query
      const searchPrompt = this.createSearchPrompt(query);

      const system = this.language === 'zh'
        ? '你是一个智能搜索助手。请分析用户的搜索意图，提取关键词并提供多语言翻译。'
        : 'You are an intelligent search assistant. Please analyze user search intent, extract keywords and provide multilingual translations.';

      const content = await this.requestText({
        system,
        user: searchPrompt,
        temperature: 0.1,
        maxTokens: 200,
      });

      if (content) {
        const searchTerms = this.parseSearchResponse(content);
        return this.performEnhancedSearch(repositories, query, searchTerms);
      }
    } catch {
      logger.warn('ai', 'AI search failed, falling back to basic search', { configId: this.config.id, durationMs: Date.now() - startTime });
    }

    // Fallback to basic search
    return this.performBasicSearch(repositories, query);
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
   * Search repositories using AI semantic search with fallback to enhanced basic search.
   * Attempts to call the configured AI service to parse search intent and extract
   * multilingual keywords, then delegates to performEnhancedSearch. Falls back to
   * performEnhancedBasicSearch with intelligent ranking if AI is unavailable or fails.
   *
   * @param repositories - The full list of repositories to search
   * @param query - The user's search query string
   * @returns Filtered and ranked repositories matching the query
   */
  async searchRepositoriesWithReranking(repositories: Repository[], query: string): Promise<Repository[]> {
    const startTime = Date.now();
    logger.info('ai', 'Starting enhanced search', { query });
    if (!query.trim()) return repositories;

    try {
      logger.info('ai', 'Calling configured AI service for semantic search', { apiType: this.getApiType(), model: this.config.model, configId: this.config.id });
      const searchPrompt = this.createSearchPrompt(query);
      const system = this.language === 'zh'
        ? '你是一个智能搜索助手。请分析用户的搜索意图，提取关键词并提供多语言翻译。'
        : 'You are an intelligent search assistant. Please analyze user search intent, extract keywords and provide multilingual translations.';

      const content = await this.requestText({
        system,
        user: searchPrompt,
        temperature: 0.1,
        maxTokens: 200,
      });

      if (content) {
        const searchTerms = this.parseSearchResponse(content);
        const results = this.performEnhancedSearch(repositories, query, searchTerms);
        logger.info('ai', 'AI semantic search completed', { resultCount: results.length, apiType: this.getApiType(), model: this.config.model, durationMs: Date.now() - startTime });
        return results;
      }
    } catch {
      logger.warn('ai', 'AI semantic search failed, falling back to enhanced basic search', { apiType: this.getApiType(), model: this.config.model, configId: this.config.id, durationMs: Date.now() - startTime });
    }

    logger.info('ai', 'Using enhanced basic search with intelligent ranking');
    const fallbackResults = this.performEnhancedBasicSearch(repositories, query);
    logger.info('ai', 'Enhanced search completed', { resultCount: fallbackResults.length });

    return fallbackResults;
  }

  // Enhanced basic search with intelligent ranking (fallback when AI fails)
  private performEnhancedBasicSearch(repositories: Repository[], query: string): Repository[] {
    const normalizedQuery = query.toLowerCase();
    const queryWords = normalizedQuery.split(/\s+/).filter(word => word.length > 0);
    
    // Score repositories based on relevance
    const scoredRepos = repositories.map(repo => {
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
        customTags: (repo.custom_tags || []).join(' ').toLowerCase()
      };

      // Check if any query word matches any field
      const hasMatch = queryWords.some(word => {
        return Object.values(searchableFields).some(fieldValue => {
          return fieldValue.includes(word);
        });
      });

      if (!hasMatch) return { repo, score: 0 };

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
      });

      // Boost for exact matches
      if (searchableFields.name === normalizedQuery) score += 0.5;
      if (searchableFields.name.includes(normalizedQuery)) score += 0.3;
      
      // Popularity boost (logarithmic to avoid overwhelming other factors)
      const popularityScore = Math.log10(repo.stargazers_count + 1) * 0.05;
      score += popularityScore;

      return { repo, score };
    });

    // Filter out repositories with no matches and sort by relevance
    return scoredRepos
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(item => item.repo);
  }

  private createSearchPrompt(query: string): string {
    if (this.language === 'zh') {
      return `
用户搜索查询: "${query}"

请分析这个搜索查询并提供：
1. 主要关键词（中英文）
2. 相关的技术术语和同义词
3. 可能的应用类型或分类

以JSON格式回复：
{
  "keywords": ["关键词1", "keyword1", "关键词2", "keyword2"],
  "categories": ["分类1", "category1"],
  "synonyms": ["同义词1", "synonym1"]
}
      `.trim();
    } else {
      return `
User search query: "${query}"

Please analyze this search query and provide:
1. Main keywords (in English and Chinese)
2. Related technical terms and synonyms
3. Possible application types or categories

Reply in JSON format:
{
  "keywords": ["keyword1", "关键词1", "keyword2", "关键词2"],
  "categories": ["category1", "分类1"],
  "synonyms": ["synonym1", "同义词1"]
}
      `.trim();
    }
  }

  private parseSearchResponse(content: string): string[] {
    try {
      const parsed = this.extractAndParseAIJson(content);
      if (parsed) {
        const allTerms = [
          ...(Array.isArray(parsed.keywords) ? parsed.keywords : []),
          ...(Array.isArray(parsed.categories) ? parsed.categories : []),
          ...(Array.isArray(parsed.synonyms) ? parsed.synonyms : []),
        ];
        return allTerms.filter(term => typeof term === 'string' && term.length > 0);
      }
    } catch (error) {
      logger.warn('ai', 'Failed to parse AI search response', { error: String(error) });
    }
    return [];
  }

  private performEnhancedSearch(repositories: Repository[], originalQuery: string, aiTerms: string[]): Repository[] {
    const allSearchTerms = [originalQuery, ...aiTerms];
    
    return repositories.filter(repo => {
      const searchableText = [
        repo.name,
        repo.full_name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
      ].join(' ').toLowerCase();
      
      // Check if any of the AI-enhanced terms match
      return allSearchTerms.some(term => {
        const normalizedTerm = term.toLowerCase();
        return searchableText.includes(normalizedTerm) ||
               // Fuzzy matching for partial matches
               normalizedTerm.split(/\s+/).every(word => searchableText.includes(word));
      });
    });
  }

  private performBasicSearch(repositories: Repository[], query: string): Repository[] {
    const normalizedQuery = query.toLowerCase();
    
    return repositories.filter(repo => {
      const searchableText = [
        repo.name,
        repo.full_name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || '',
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
      ].join(' ').toLowerCase();
      
      // Split query into words and check if all words are present
      const queryWords = normalizedQuery.split(/\s+/);
      return queryWords.every(word => searchableText.includes(word));
    });
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
        ...(repo.ai_tags || []),
        ...(repo.ai_platforms || []),
      ].join(' ').toLowerCase();
      
      // Split query into words and check if all words are present
      const queryWords = normalizedQuery.split(/\s+/);
      return queryWords.every(word => searchableText.includes(word));
    });
  }
}
