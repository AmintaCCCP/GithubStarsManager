import { Repository, AIConfig } from '../types';

export class AIService {
  private config: AIConfig;
  private language: string;

  constructor(config: AIConfig, language: string = 'zh') {
    this.config = config;
    this.language = language;
  }

  async analyzeRepository(repository: Repository, readmeContent: string, customCategories?: string[]): Promise<{
    summary: string;
    tags: string[];
    platforms: string[];
  }> {
    const prompt = this.createAnalysisPrompt(repository, readmeContent, customCategories);
    
    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: this.language === 'zh' 
                ? '你是一个专业的GitHub仓库分析助手。请严格按照用户指定的语言进行分析，无论原始内容是什么语言。请用中文简洁地分析仓库，提供实用的概述、分类标签和支持的平台类型。'
                : 'You are a professional GitHub repository analysis assistant. Please strictly analyze in the language specified by the user, regardless of the original content language. Please analyze repositories concisely in English, providing practical overviews, category tags, and supported platform types.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.3,
          max_tokens: 400,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content;
      
      if (!content) {
        throw new Error('No content received from AI service');
      }

      return this.parseAIResponse(content);
    } catch (error) {
      console.error('AI analysis failed:', error);
      // Fallback to basic analysis
      return this.fallbackAnalysis(repository);
    }
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
      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
      });
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async searchRepositories(repositories: Repository[], query: string): Promise<Repository[]> {
    if (!query.trim()) return repositories;

    try {
      // Use AI to understand and translate the search query
      const searchPrompt = this.createSearchPrompt(query);
      
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: 'system',
              content: this.language === 'zh'
                ? '你是一个智能搜索助手。请分析用户的搜索意图，提取关键词并提供多语言翻译。'
                : 'You are an intelligent search assistant. Please analyze user search intent, extract keywords and provide multilingual translations.',
            },
            {
              role: 'user',
              content: searchPrompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 200,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const content = data.choices[0]?.message?.content;
        
        if (content) {
          const searchTerms = this.parseSearchResponse(content);
          return this.performEnhancedSearch(repositories, query, searchTerms);
        }
      }
    } catch (error) {
      console.warn('AI search failed, falling back to basic search:', error);
    }

    // Fallback to basic search
    return this.performBasicSearch(repositories, query);
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