import { Repository, AIConfig } from '../types';

export class AIService {
  private config: AIConfig;
  private language: string;

  constructor(config: AIConfig, language: string = 'zh') {
    this.config = config;
    this.language = language;
  }

  private getApiType(): 'openai' | 'claude' | 'gemini' {
    return this.config.apiType || 'openai';
  }

  private buildApiUrl(pathWithVersion: string): string {
    const baseUrlWithSlash = this.config.baseUrl.endsWith('/')
      ? this.config.baseUrl
      : `${this.config.baseUrl}/`;

    const versionPrefix = pathWithVersion.split('/')[0] || '';

    try {
      const base = new URL(baseUrlWithSlash);
      const basePath = base.pathname.replace(/\/$/, '');

      // 兼容用户把 baseUrl 写成 .../v1 或 .../v1beta 的情况，避免拼成 /v1/v1/...
      if (versionPrefix) {
        const versionRe = new RegExp(`/${versionPrefix}$`);
        if (versionRe.test(basePath) && pathWithVersion.startsWith(`${versionPrefix}/`)) {
          const rest = pathWithVersion.slice(versionPrefix.length + 1); // remove "v1/"
          return new URL(rest, baseUrlWithSlash).toString();
        }
      }

      return new URL(pathWithVersion, baseUrlWithSlash).toString();
    } catch {
      // baseUrl 非绝对 URL 时这里会抛错；上层会在 testConnection/调用处处理失败
      return `${baseUrlWithSlash}${pathWithVersion}`;
    }
  }

  private async requestText(options: {
    system: string;
    user: string;
    temperature: number;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<string> {
    const apiType = this.getApiType();

    if (apiType === 'openai') {
      const url = this.buildApiUrl('v1/chat/completions');
      const messages = [
        ...(options.system.trim()
          ? [{ role: 'system', content: options.system }]
          : []),
        { role: 'user', content: options.user },
      ];
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: options.temperature,
          max_tokens: options.maxTokens,
        }),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('No content received from AI service');
      }
      return content;
    }

    if (apiType === 'claude') {
      const url = this.buildApiUrl('v1/messages');
      const body = {
        model: this.config.model,
        ...(options.system.trim() ? { system: options.system } : {}),
        messages: [{ role: 'user', content: options.user }],
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      };
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data: unknown = await response.json();
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
    const path = `v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const urlObj = new URL(this.buildApiUrl(path));
    urlObj.searchParams.set('key', this.config.apiKey);

    const prompt = options.system ? `${options.system}\n\n${options.user}` : options.user;
    const response = await fetch(urlObj.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
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
      }),
      signal: options.signal,
    });

    if (!response.ok) {
      throw new Error(`AI API error: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
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

  async analyzeRepository(repository: Repository, readmeContent: string, customCategories?: string[]): Promise<{
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
        maxTokens: 400,
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
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || (this.language === 'zh' ? '无法生成概述' : 'Unable to generate summary'),
          tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
          platforms: Array.isArray(parsed.platforms) ? parsed.platforms.slice(0, 8) : [],
        };
      }
      
      // Fallback parsing
      return {
        summary: content.substring(0, 50) + '...',
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

  private fallbackAnalysis(repository: Repository): { summary: string; tags: string[]; platforms: string[] } {
    const summary = repository.description 
      ? `${repository.description}（${repository.language || (this.language === 'zh' ? '未知语言' : 'Unknown language')}${this.language === 'zh' ? '项目' : ' project'}）`
      : (this.language === 'zh' 
          ? `一个${repository.language || '软件'}项目，拥有${repository.stargazers_count}个星标`
          : `A ${repository.language || 'software'} project with ${repository.stargazers_count} stars`
        );

    const tags: string[] = [];
    const platforms: string[] = [];
    
    // Add language-based tags and platforms
    if (repository.language) {
      const langMap: Record<string, { tag: string; platforms: string[] }> = this.language === 'zh' ? {
        'JavaScript': { tag: 'Web应用', platforms: ['web', 'cli'] },
        'TypeScript': { tag: 'Web应用', platforms: ['web', 'cli'] }, 
        'Python': { tag: 'Python工具', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'Java': { tag: 'Java应用', platforms: ['linux', 'mac', 'windows'] },
        'Go': { tag: '系统工具', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'Rust': { tag: '系统工具', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'C++': { tag: '系统软件', platforms: ['linux', 'mac', 'windows'] },
        'C': { tag: '系统软件', platforms: ['linux', 'mac', 'windows'] },
        'Swift': { tag: '移动应用', platforms: ['ios', 'mac'] },
        'Kotlin': { tag: '移动应用', platforms: ['android'] },
        'Dart': { tag: '移动应用', platforms: ['ios', 'android'] },
        'PHP': { tag: 'Web应用', platforms: ['web', 'linux'] },
        'Ruby': { tag: 'Web应用', platforms: ['web', 'linux', 'mac'] },
        'Shell': { tag: '脚本工具', platforms: ['linux', 'mac', 'cli'] }
      } : {
        'JavaScript': { tag: 'Web App', platforms: ['web', 'cli'] },
        'TypeScript': { tag: 'Web App', platforms: ['web', 'cli'] }, 
        'Python': { tag: 'Python Tool', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'Java': { tag: 'Java App', platforms: ['linux', 'mac', 'windows'] },
        'Go': { tag: 'System Tool', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'Rust': { tag: 'System Tool', platforms: ['linux', 'mac', 'windows', 'cli'] },
        'C++': { tag: 'System Software', platforms: ['linux', 'mac', 'windows'] },
        'C': { tag: 'System Software', platforms: ['linux', 'mac', 'windows'] },
        'Swift': { tag: 'Mobile App', platforms: ['ios', 'mac'] },
        'Kotlin': { tag: 'Mobile App', platforms: ['android'] },
        'Dart': { tag: 'Mobile App', platforms: ['ios', 'android'] },
        'PHP': { tag: 'Web App', platforms: ['web', 'linux'] },
        'Ruby': { tag: 'Web App', platforms: ['web', 'linux', 'mac'] },
        'Shell': { tag: 'Script Tool', platforms: ['linux', 'mac', 'cli'] }
      };
      
      const langInfo = langMap[repository.language];
      if (langInfo) {
        tags.push(langInfo.tag);
        platforms.push(...langInfo.platforms);
      }
    }
    
    // Add category based on keywords
    const desc = (repository.description || '').toLowerCase();
    const name = repository.name.toLowerCase();
    const searchText = `${desc} ${name}`;
    
    const keywordMap = this.language === 'zh' ? {
      web: { keywords: ['web', 'frontend', 'website'], tag: 'Web应用', platforms: ['web'] },
      api: { keywords: ['api', 'backend', 'server'], tag: '后端服务', platforms: ['linux', 'docker'] },
      cli: { keywords: ['cli', 'command', 'tool'], tag: '命令行工具', platforms: ['cli', 'linux', 'mac', 'windows'] },
      library: { keywords: ['library', 'framework', 'sdk'], tag: '开发库', platforms: [] },
      mobile: { keywords: ['mobile', 'android', 'ios'], tag: '移动应用', platforms: [] },
      game: { keywords: ['game', 'gaming'], tag: '游戏', platforms: ['windows', 'mac', 'linux'] },
      ai: { keywords: ['ai', 'ml', 'machine learning'], tag: 'AI工具', platforms: ['linux', 'mac', 'windows'] },
      database: { keywords: ['database', 'db', 'storage'], tag: '数据库', platforms: ['linux', 'docker'] },
      docker: { keywords: ['docker', 'container'], tag: '容器化', platforms: ['docker'] }
    } : {
      web: { keywords: ['web', 'frontend', 'website'], tag: 'Web App', platforms: ['web'] },
      api: { keywords: ['api', 'backend', 'server'], tag: 'Backend Service', platforms: ['linux', 'docker'] },
      cli: { keywords: ['cli', 'command', 'tool'], tag: 'CLI Tool', platforms: ['cli', 'linux', 'mac', 'windows'] },
      library: { keywords: ['library', 'framework', 'sdk'], tag: 'Development Library', platforms: [] },
      mobile: { keywords: ['mobile', 'android', 'ios'], tag: 'Mobile App', platforms: [] },
      game: { keywords: ['game', 'gaming'], tag: 'Game', platforms: ['windows', 'mac', 'linux'] },
      ai: { keywords: ['ai', 'ml', 'machine learning'], tag: 'AI Tool', platforms: ['linux', 'mac', 'windows'] },
      database: { keywords: ['database', 'db', 'storage'], tag: 'Database', platforms: ['linux', 'docker'] },
      docker: { keywords: ['docker', 'container'], tag: 'Containerized', platforms: ['docker'] }
    };

    Object.values(keywordMap).forEach(({ keywords, tag, platforms: keywordPlatforms }) => {
      if (keywords.some(keyword => searchText.includes(keyword))) {
        tags.push(tag);
        platforms.push(...keywordPlatforms);
      }
    });

    // Handle specific mobile platforms
    if (searchText.includes('android')) platforms.push('android');
    if (searchText.includes('ios')) platforms.push('ios');

    return {
      summary: summary.substring(0, 50),
      tags: [...new Set(tags)].slice(0, 5), // Remove duplicates and limit to 5
      platforms: [...new Set(platforms)].slice(0, 8), // Remove duplicates and limit to 8
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const base = new URL(this.config.baseUrl);
      if (base.protocol !== 'http:' && base.protocol !== 'https:') return false;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 秒超时，避免长时间卡住
      try {
        const content = await this.requestText({
          system: 'You are a connection test assistant.',
          user: 'Reply with exactly one word: OK',
          temperature: 0,
          maxTokens: 10,
          signal: controller.signal,
        });
        return !!content;
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
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

  private createEnhancedSearchPrompt(query: string): string {
    if (this.language === 'zh') {
      return `
用户搜索查询: "${query}"

请深度分析这个搜索查询并提供：
1. 核心搜索意图和目标
2. 多语言关键词（中文、英文、技术术语）
3. 相关的应用类型、技术栈、平台类型
4. 同义词和相关概念
5. 重要性权重（用于排序）

以JSON格式回复：
{
  "intent": "用户的核心搜索意图",
  "keywords": {
    "primary": ["主要关键词1", "primary keyword1"],
    "secondary": ["次要关键词1", "secondary keyword1"],
    "technical": ["技术术语1", "technical term1"]
  },
  "categories": ["应用分类1", "category1"],
  "platforms": ["平台类型1", "platform1"],
  "synonyms": ["同义词1", "synonym1"],
  "weights": {
    "name_match": 0.4,
    "description_match": 0.3,
    "tags_match": 0.2,
    "summary_match": 0.1
  }
}

注意：请确保能够跨语言匹配，即使用户用中文搜索，也要能匹配到英文仓库，反之亦然。
      `.trim();
    } else {
      return `
User search query: "${query}"

Please deeply analyze this search query and provide:
1. Core search intent and objectives
2. Multilingual keywords (Chinese, English, technical terms)
3. Related application types, tech stacks, platform types
4. Synonyms and related concepts
5. Importance weights (for ranking)

Reply in JSON format:
{
  "intent": "User's core search intent",
  "keywords": {
    "primary": ["primary keyword1", "主要关键词1"],
    "secondary": ["secondary keyword1", "次要关键词1"],
    "technical": ["technical term1", "技术术语1"]
  },
  "categories": ["category1", "应用分类1"],
  "platforms": ["platform1", "平台类型1"],
  "synonyms": ["synonym1", "同义词1"],
  "weights": {
    "name_match": 0.4,
    "description_match": 0.3,
    "tags_match": 0.2,
    "summary_match": 0.1
  }
}

Note: Ensure cross-language matching, so Chinese queries can match English repositories and vice versa.
      `.trim();
    }
  }

  private parseSearchResponse(content: string): string[] {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const allTerms = [
          ...(parsed.keywords || []),
          ...(parsed.categories || []),
          ...(parsed.synonyms || [])
        ];
        return allTerms.filter(term => typeof term === 'string' && term.length > 0);
      }
    } catch (error) {
      console.warn('Failed to parse AI search response:', error);
    }
    return [];
  }

  private parseEnhancedSearchResponse(content: string): {
    intent: string;
    keywords: {
      primary: string[];
      secondary: string[];
      technical: string[];
    };
    categories: string[];
    platforms: string[];
    synonyms: string[];
    weights: {
      name_match: number;
      description_match: number;
      tags_match: number;
      summary_match: number;
    };
  } {
    const defaultResponse = {
      intent: '',
      keywords: { primary: [], secondary: [], technical: [] },
      categories: [],
      platforms: [],
      synonyms: [],
      weights: { name_match: 0.4, description_match: 0.3, tags_match: 0.2, summary_match: 0.1 }
    };

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          intent: parsed.intent || '',
          keywords: {
            primary: Array.isArray(parsed.keywords?.primary) ? parsed.keywords.primary : [],
            secondary: Array.isArray(parsed.keywords?.secondary) ? parsed.keywords.secondary : [],
            technical: Array.isArray(parsed.keywords?.technical) ? parsed.keywords.technical : []
          },
          categories: Array.isArray(parsed.categories) ? parsed.categories : [],
          platforms: Array.isArray(parsed.platforms) ? parsed.platforms : [],
          synonyms: Array.isArray(parsed.synonyms) ? parsed.synonyms : [],
          weights: {
            name_match: parsed.weights?.name_match || 0.4,
            description_match: parsed.weights?.description_match || 0.3,
            tags_match: parsed.weights?.tags_match || 0.2,
            summary_match: parsed.weights?.summary_match || 0.1
          }
        };
      }
    } catch (error) {
      console.warn('Failed to parse enhanced AI search response:', error);
    }
    
    return defaultResponse;
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

  private performSemanticSearchWithReranking(
    repositories: Repository[], 
    originalQuery: string, 
    searchAnalysis: any
  ): Repository[] {
    // Collect all search terms from the analysis
    const allSearchTerms = [
      originalQuery,
      ...searchAnalysis.keywords.primary,
      ...searchAnalysis.keywords.secondary,
      ...searchAnalysis.keywords.technical,
      ...searchAnalysis.categories,
      ...searchAnalysis.platforms,
      ...searchAnalysis.synonyms
    ].filter(term => term && typeof term === 'string');

    // First, filter repositories that match any search terms
    const matchedRepos = repositories.filter(repo => {
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

      // Check if any search term matches any field
      return allSearchTerms.some(term => {
        const normalizedTerm = term.toLowerCase();
        return Object.values(searchableFields).some(fieldValue => {
          return fieldValue.includes(normalizedTerm) ||
                 // Fuzzy matching for partial matches
                 normalizedTerm.split(/\s+/).every(word => fieldValue.includes(word));
        });
      });
    });

    // If no matches found, return empty array (don't show irrelevant results)
    if (matchedRepos.length === 0) {
      return [];
    }

    // Calculate relevance scores for matched repositories
    const scoredRepos = matchedRepos.map(repo => {
      let score = 0;
      const weights = searchAnalysis.weights;

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

      // Score based on different types of matches
      allSearchTerms.forEach(term => {
        const normalizedTerm = term.toLowerCase();
        
        // Name matches (highest weight)
        if (searchableFields.name.includes(normalizedTerm) || searchableFields.fullName.includes(normalizedTerm)) {
          score += weights.name_match;
        }

        // Description matches
        if (searchableFields.description.includes(normalizedTerm) || searchableFields.customDescription.includes(normalizedTerm)) {
          score += weights.description_match;
        }

        // Tags and topics matches
        if (searchableFields.topics.includes(normalizedTerm) || 
            searchableFields.aiTags.includes(normalizedTerm) || 
            searchableFields.customTags.includes(normalizedTerm)) {
          score += weights.tags_match;
        }

        // AI summary matches
        if (searchableFields.aiSummary.includes(normalizedTerm)) {
          score += weights.summary_match;
        }

        // Platform matches
        if (searchableFields.aiPlatforms.includes(normalizedTerm)) {
          score += weights.tags_match * 0.8; // Slightly lower than tags
        }

        // Language matches
        if (searchableFields.language.includes(normalizedTerm)) {
          score += weights.tags_match * 0.6;
        }
      });

      // Boost score for primary keywords
      searchAnalysis.keywords.primary.forEach(primaryTerm => {
        const normalizedTerm = primaryTerm.toLowerCase();
        Object.values(searchableFields).forEach(fieldValue => {
          if (fieldValue.includes(normalizedTerm)) {
            score += 0.2; // Additional boost for primary keywords
          }
        });
      });

      // Boost score for exact matches
      const exactMatch = allSearchTerms.some(term => {
        const normalizedTerm = term.toLowerCase();
        return searchableFields.name === normalizedTerm || 
               searchableFields.name.includes(` ${normalizedTerm} `) ||
               searchableFields.name.startsWith(`${normalizedTerm} `) ||
               searchableFields.name.endsWith(` ${normalizedTerm}`);
      });
      
      if (exactMatch) {
        score += 0.5;
      }

      // Consider repository popularity as a tie-breaker
      const popularityScore = Math.log10(repo.stargazers_count + 1) * 0.05;
      score += popularityScore;

      return { repo, score };
    });

    // Sort by relevance score (descending) and return only repositories with meaningful scores
    return scoredRepos
      .filter(item => item.score > 0.1) // Filter out very low relevance matches
      .sort((a, b) => b.score - a.score)
      .map(item => item.repo);
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
