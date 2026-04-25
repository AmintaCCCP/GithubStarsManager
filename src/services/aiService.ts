import { Repository, AIConfig, AIApiType } from '../types';
import { backend } from './backendAdapter';
import { buildApiUrl, buildFinalApiUrl } from '../utils/apiUrlBuilder';

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

export class AIService {
  private config: AIConfig;
  private language: string;

  constructor(config: AIConfig, language: string = 'zh') {
    this.config = config;
    this.language = language;
  }

  private getApiType(): AIApiType {
    return this.config.apiType || 'openai';
  }

  private getOpenAIReasoningPayload(): { effort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' } | undefined {
    const effort = this.config.reasoningEffort;
    return effort ? { effort } : undefined;
  }

  private isDeepSeekReasonerModel(): boolean {
    return this.getApiType() === 'openai' && this.config.model.trim() === 'deepseek-reasoner';
  }

  private async requestText(options: {
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const apiType = this.getApiType();
    const reasoning = this.getOpenAIReasoningPayload();

    if (apiType === 'openai' || apiType === 'openai-responses' || apiType === 'openai-compatible') {
      const messages = [
        ...(options.system.trim()
          ? [{ role: 'system', content: options.system }]
          : []),
        { role: 'user', content: options.user },
      ];
      const isDeepSeekReasoner = this.isDeepSeekReasonerModel();

      const requestBody = apiType === 'openai-responses'
        ? {
            model: this.config.model,
            input: messages,
            temperature: options.temperature,
            max_output_tokens: options.maxTokens,
            ...(reasoning ? { reasoning } : {}),
          }
        : {
            model: this.config.model,
            messages,
            max_tokens: options.maxTokens,
            ...(!isDeepSeekReasoner ? { temperature: options.temperature } : {}),
            ...(!isDeepSeekReasoner && reasoning && apiType !== 'openai-compatible' ? { reasoning } : {}),
          };

      let data: Record<string, unknown>;
      if (backend.isAvailable && this.config.id) {
        data = await backend.proxyAIRequest(this.config.id, requestBody) as Record<string, unknown>;
      } else {
        const url = buildFinalApiUrl(this.config.baseUrl, apiType);
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: options.signal,
        });
        if (!response.ok) {
          throw new Error(`AI API error: ${response.status} ${response.statusText}`);
        }
        data = await response.json();
      }

      if (apiType === 'openai-responses') {
        const typedData = data as OpenAIResponse;
        const outputText = typedData.output_text;
        if (outputText) return outputText;

        const output = typedData.output;
        if (Array.isArray(output)) {
          const text = output
            .flatMap((item) => Array.isArray(item?.content) ? item.content : [])
            .map((part) => part?.text || '')
            .join('');
          if (text) return text;
        }
      } else {
        const typedData = data as { choices?: OpenAIResponseChoice[] };
        const choices = typedData.choices;
        const message = choices?.[0]?.message;
        const content = message?.content;
        if (content) return content;

        const reasoningContent = message?.reasoning_content;
        if (reasoningContent) return reasoningContent;
      }

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
      if (backend.isAvailable && this.config.id) {
        data = await backend.proxyAIRequest(this.config.id, requestBody);
      } else {
        const url = buildApiUrl(this.config.baseUrl, 'v1/messages');
        const response = await fetch(url, {
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
        if (!response.ok) {
          throw new Error(`AI API error: ${response.status} ${response.statusText}`);
        }
        data = await response.json();
      }

      const contentBlocks = (data as { content?: unknown }).content;
      if (Array.isArray(contentBlocks)) {
        const text = contentBlocks
          .map((b) => {
            if (!b || typeof b !== 'object') return '';
            const block = b as { type?: unknown; text?: unknown };
            return block.type === 'text' && typeof block.text === 'string' ? block.text : '';
          })
          .join('');
        if (text) return text;
      }
      throw new Error('No content received from AI service');
    }

    // gemini
    const rawModel = this.config.model.trim();
    const model = rawModel.startsWith('models/') ? rawModel.slice('models/'.length) : rawModel;
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
    if (backend.isAvailable && this.config.id) {
      data = await backend.proxyAIRequest(this.config.id, requestBody);
    } else {
      const path = `v1beta/models/${encodeURIComponent(model)}:generateContent`;
      const urlObj = new URL(buildApiUrl(this.config.baseUrl, path));
      urlObj.searchParams.set('key', this.config.apiKey);
      const response = await fetch(urlObj.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: options.signal,
      });
      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }
      data = await response.json();
    }

    const candidates = (data as { candidates?: unknown }).candidates;
    if (Array.isArray(candidates) && candidates.length > 0) {
      const parts = (candidates[0] as { content?: { parts?: unknown } }).content?.parts;
      if (Array.isArray(parts)) {
        const text = parts
          .map((p) => {
            if (!p || typeof p !== 'object') return '';
            const part = p as { text?: unknown };
            return typeof part.text === 'string' ? part.text : '';
          })
          .join('');
        if (text) return text;
      }
    }
    throw new Error('No content received from AI service');
  }

  async analyzeRepository(repository: Repository, readmeContent: string, customCategories?: string[], signal?: AbortSignal): Promise<{
    summary: string;
    tags: string[];
    platforms: string[];
  }> {
    const prompt = this.config.useCustomPrompt && this.config.customPrompt
      ? this.createCustomAnalysisPrompt(repository, readmeContent, customCategories)
      : this.createAnalysisPrompt(repository, readmeContent, customCategories);
    
    try {
      const system = this.language === 'zh'
        ? '你是一个专业的GitHub仓库分析助手。请严格按照用户指定的语言进行分析，无论原始内容是什么语言。请用中文简洁地分析仓库，提供实用的概述、分类标签和支持的平台类型。'
        : 'You are a professional GitHub repository analysis assistant. Please strictly analyze in the language specified by the user, regardless of the original content language. Please analyze repositories concisely in English, providing practical overviews, category tags, and supported platform types.';

      const content = await this.requestText({
        system,
        user: prompt,
        temperature: 0.3,
        maxTokens: 700,
        signal,
      });

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('AI analysis failed:', error);
      // 抛出错误，让调用方处理失败状态
      throw error;
    }
  }

  private createCustomAnalysisPrompt(repository: Repository, readmeContent: string, customCategories?: string[]): string {
    const repoInfo = `
${this.language === 'zh' ? '仓库名称' : 'Repository Name'}: ${repository.full_name}
${this.language === 'zh' ? '描述' : 'Description'}: ${repository.description || (this.language === 'zh' ? '无描述' : 'No description')}
${this.language === 'zh' ? '编程语言' : 'Programming Language'}: ${repository.language || (this.language === 'zh' ? '未知' : 'Unknown')}
${this.language === 'zh' ? 'Star数' : 'Stars'}: ${repository.stargazers_count}
${this.language === 'zh' ? '主题标签' : 'Topics'}: ${repository.topics?.join(', ') || (this.language === 'zh' ? '无' : 'None')}

${this.language === 'zh' ? 'README内容 (前2000字符)' : 'README Content (first 2000 characters)'}:
${readmeContent.substring(0, 2000)}
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
${this.language === 'zh' ? '描述' : 'Description'}: ${repository.description || (this.language === 'zh' ? '无描述' : 'No description')}
${this.language === 'zh' ? '编程语言' : 'Programming Language'}: ${repository.language || (this.language === 'zh' ? '未知' : 'Unknown')}
${this.language === 'zh' ? 'Star数' : 'Stars'}: ${repository.stargazers_count}
${this.language === 'zh' ? '主题标签' : 'Topics'}: ${repository.topics?.join(', ') || (this.language === 'zh' ? '无' : 'None')}

${this.language === 'zh' ? 'README内容 (前2000字符)' : 'README Content (first 2000 characters)'}:
${readmeContent.substring(0, 2000)}
    `.trim();

    const categoriesInfo = customCategories && customCategories.length > 0 
      ? `\n\n${this.language === 'zh' ? '可用的应用分类' : 'Available Application Categories'}: ${customCategories.join(', ')}`
      : '';

    if (this.language === 'zh') {
      return `
请分析这个GitHub仓库并提供：

1. 一个简洁的中文概述（不超过50字），说明这个仓库的主要功能和用途
2. 3-5个相关的应用类型标签（用中文，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等${customCategories ? '，请优先从提供的分类中选择' : ''}）
3. 支持的平台类型（从以下选择：mac、windows、linux、ios、android、docker、web、cli）

重要：请严格使用中文进行分析和回复，无论原始README是什么语言。

请以JSON格式回复：
{
  "summary": "你的中文概述",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

仓库信息：
${repoInfo}${categoriesInfo}

重点关注实用性和准确的分类，帮助用户快速理解仓库的用途和支持的平台。
      `.trim();
    } else {
      return `
Please analyze this GitHub repository and provide:

1. A concise English overview (no more than 50 words) explaining the main functionality and purpose of this repository
2. 3-5 relevant application type tags (in English, similar to app store categories, such as: development tools, web apps, mobile apps, database, AI tools, etc.${customCategories ? ', please prioritize from the provided categories' : ''})
3. Supported platform types (choose from: mac, windows, linux, ios, android, docker, web, cli)

Important: Please strictly use English for analysis and response, regardless of the original README language.

Please reply in JSON format:
{
  "summary": "Your English overview",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

Repository information:
${repoInfo}${categoriesInfo}

Focus on practicality and accurate categorization to help users quickly understand the repository's purpose and supported platforms.
      `.trim();
    }
  }

  private parseAIResponse(content: string): { summary: string; tags: string[]; platforms: string[] } {
    try {
      const cleaned = content
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

      const parsed = this.extractAndParseAIJson(cleaned);
      if (parsed) {
        return {
          summary: typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : (this.language === 'zh' ? '无法生成概述' : 'Unable to generate summary'),
          tags: Array.isArray(parsed.tags) ? parsed.tags.filter((v) => typeof v === 'string').slice(0, 5) : [],
          platforms: Array.isArray(parsed.platforms) ? parsed.platforms.filter((v) => typeof v === 'string').slice(0, 8) : [],
        };
      }

      return {
        summary: cleaned.substring(0, 50) + (cleaned.length > 50 ? '...' : ''),
        tags: [],
        platforms: [],
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        summary: this.language === 'zh' ? '分析失败' : 'Analysis failed',
        tags: [],
        platforms: [],
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

  async testConnection(): Promise<boolean> {
    try {
      const base = new URL(this.config.baseUrl);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') return false;

      const controller = new AbortController();
      const apiType = this.getApiType();
      const timeoutMs = apiType === 'openai-responses' || this.config.reasoningEffort ? 30000 : 10000;
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const content = await this.requestText({
          system: 'You are a connection test assistant.',
          user: 'Reply with exactly one word: OK',
          temperature: 0,
          maxTokens: 50,
          signal: controller.signal,
        });
        return !!content;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch {
      return false;
    }
  }

  async searchRepositories(repositories: Repository[], query: string): Promise<Repository[]> {
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
    } catch (error) {
      console.warn('AI search failed, falling back to basic search:', error);
    }

    // Fallback to basic search
    return this.performBasicSearch(repositories, query);
  }

  async searchRepositoriesWithReranking(repositories: Repository[], query: string): Promise<Repository[]> {
    console.log('🤖 AI Service: Starting enhanced search for:', query);
    if (!query.trim()) return repositories;

    // 直接使用增强的基础搜索，提供智能排序
    console.log('🔄 AI Service: Using enhanced basic search with intelligent ranking');
    const results = this.performEnhancedBasicSearch(repositories, query);
    console.log('✨ AI Service: Enhanced search completed, results:', results.length);
    
    return results;
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
      console.warn('Failed to parse AI search response:', error);
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
