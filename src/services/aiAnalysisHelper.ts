import { Repository, AIConfig, Category, DiscoveryRepo } from '../types';
import { GitHubApiService } from './githubApi';
import { AIService } from './aiService';
import { backend } from './backendAdapter';
import { resolveCategoryAssignment } from '../utils/categoryUtils';

export interface AIAnalysisResult {
  summary: string;
  tags: string[];
  platforms: string[];
  custom_category?: string;
  category_locked?: boolean;
  analyzed_at: string;
  analysis_failed: boolean;
}

export interface AnalyzeRepositoryOptions {
  repository: Repository | DiscoveryRepo;
  githubToken: string;
  aiConfig: AIConfig;
  language: string;
  categories: Category[];
  onProgress?: (status: string) => void;
}

export const analyzeRepository = async (options: AnalyzeRepositoryOptions): Promise<AIAnalysisResult> => {
  const { repository, githubToken, aiConfig, language, categories, onProgress } = options;

  onProgress?.('Initializing...');
  
  const githubApi = new GitHubApiService(githubToken);
  const aiService = new AIService(aiConfig, language);

  const [owner, name] = repository.full_name.split('/');
  
  onProgress?.('Fetching README...');
  const readmeContent = backend.isAvailable
    ? await backend.getRepositoryReadme(owner, name)
    : await githubApi.getRepositoryReadme(owner, name);

  const categoryNames = categories
    .filter(cat => cat.id !== 'all')
    .map(cat => cat.name);

  onProgress?.('Analyzing with AI...');
  const analysis = await aiService.analyzeRepository(repository, readmeContent, categoryNames);

  const resolvedCategory = resolveCategoryAssignment(repository as Repository, analysis.tags, categories);

  const wasCategoryLocked = !!(repository as Repository).category_locked;
  const shouldKeepLocked = wasCategoryLocked && resolvedCategory !== undefined && resolvedCategory !== '';

  return {
    summary: analysis.summary,
    tags: analysis.tags,
    platforms: analysis.platforms,
    custom_category: resolvedCategory,
    category_locked: shouldKeepLocked || wasCategoryLocked,
    analyzed_at: new Date().toISOString(),
    analysis_failed: false,
  };
};

export const createFailedAnalysisResult = (): AIAnalysisResult => ({
  summary: '',
  tags: [],
  platforms: [],
  analyzed_at: new Date().toISOString(),
  analysis_failed: true,
});

export const getDefaultCategoryNames = (customCategories: Category[]): string[] => {
  const customNames = customCategories.map(c => c.name);
  return [
    ...customNames,
    '全部分类', 'Web应用', '移动应用', '桌面应用', '数据库',
    'AI/机器学习', '开发工具', '安全工具', '游戏', '设计工具',
    '效率工具', '教育学习', '社交网络', '数据分析',
  ];
};
