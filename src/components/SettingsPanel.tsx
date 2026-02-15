import React, { useState } from 'react';
import { 
  Bot, 
  Plus, 
  Edit3, 
  Trash2, 
  Save, 
  X, 
  TestTube, 
  CheckCircle, 
  AlertCircle,
  Cloud,
  Download,
  Upload,
  RefreshCw,
  Globe,
  MessageSquare,
  Package,
  ExternalLink,
  Mail,
  Github,
  Twitter
} from 'lucide-react';
import { AIConfig, WebDAVConfig } from '../types';
import { useAppStore } from '../store/useAppStore';
import { AIService } from '../services/aiService';
import { WebDAVService } from '../services/webdavService';
import { UpdateChecker } from './UpdateChecker';

export const SettingsPanel: React.FC = () => {
  const {
    aiConfigs,
    activeAIConfig,
    webdavConfigs,
    activeWebDAVConfig,
    lastBackup,
    repositories,
    releases,
    customCategories,
    theme,
    language,
    addAIConfig,
    updateAIConfig,
    deleteAIConfig,
    setActiveAIConfig,
    addWebDAVConfig,
    updateWebDAVConfig,
    deleteWebDAVConfig,
    setActiveWebDAVConfig,
    setLastBackup,
    setLanguage,
    setRepositories,
    setReleases,
    addCustomCategory,
    deleteCustomCategory,
  } = useAppStore();

  const [showAIForm, setShowAIForm] = useState(false);
  const [showWebDAVForm, setShowWebDAVForm] = useState(false);
  const [editingAIId, setEditingAIId] = useState<string | null>(null);
  const [editingWebDAVId, setEditingWebDAVId] = useState<string | null>(null);
  const [testingAIId, setTestingAIId] = useState<string | null>(null);
  const [testingWebDAVId, setTestingWebDAVId] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  type AIFormState = {
    name: string;
    apiType: 'openai' | 'claude' | 'gemini';
    baseUrl: string;
    apiKey: string;
    model: string;
    customPrompt: string;
    useCustomPrompt: boolean;
    concurrency: number;
  };

  const [aiForm, setAIForm] = useState<AIFormState>({
    name: '',
    apiType: 'openai',
    baseUrl: '',
    apiKey: '',
    model: '',
    customPrompt: '',
    useCustomPrompt: false,
    concurrency: 1,
  });

  const [webdavForm, setWebDAVForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    path: '/',
  });

  const resetAIForm = () => {
    setAIForm({
      name: '',
      apiType: 'openai',
      baseUrl: '',
      apiKey: '',
      model: '',
      customPrompt: '',
      useCustomPrompt: false,
      concurrency: 1,
    });
    setShowAIForm(false);
    setEditingAIId(null);
    setShowCustomPrompt(false);
  };

  const resetWebDAVForm = () => {
    setWebDAVForm({
      name: '',
      url: '',
      username: '',
      password: '',
      path: '/',
    });
    setShowWebDAVForm(false);
    setEditingWebDAVId(null);
  };

  const handleSaveAI = () => {
    if (!aiForm.name || !aiForm.baseUrl || !aiForm.apiKey || !aiForm.model) {
      alert(t('请填写所有必填字段', 'Please fill in all required fields'));
      return;
    }

    const config: AIConfig = {
      id: editingAIId || Date.now().toString(),
      name: aiForm.name,
      apiType: aiForm.apiType,
      baseUrl: aiForm.baseUrl.replace(/\/$/, ''), // Remove trailing slash
      apiKey: aiForm.apiKey,
      model: aiForm.model,
      isActive: false,
      customPrompt: aiForm.customPrompt || undefined,
      useCustomPrompt: aiForm.useCustomPrompt,
      concurrency: aiForm.concurrency,
    };

    if (editingAIId) {
      updateAIConfig(editingAIId, config);
    } else {
      addAIConfig(config);
    }

    resetAIForm();
  };

  const handleEditAI = (config: AIConfig) => {
    setAIForm({
      name: config.name,
      apiType: config.apiType || 'openai',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      customPrompt: config.customPrompt || '',
      useCustomPrompt: config.useCustomPrompt || false,
      concurrency: config.concurrency || 1,
    });
    setEditingAIId(config.id);
    setShowAIForm(true);
    setShowCustomPrompt(config.useCustomPrompt || false);
  };

  const handleTestAI = async (config: AIConfig) => {
    setTestingAIId(config.id);
    try {
      const aiService = new AIService(config, language);
      const isConnected = await aiService.testConnection();
      
      if (isConnected) {
        alert(t('AI服务连接成功！', 'AI service connection successful!'));
      } else {
        alert(t('AI服务连接失败，请检查配置。', 'AI service connection failed. Please check configuration.'));
      }
    } catch (error) {
      console.error('AI test failed:', error);
      alert(t('AI服务测试失败，请检查网络连接和配置。', 'AI service test failed. Please check network connection and configuration.'));
    } finally {
      setTestingAIId(null);
    }
  };

  const handleSaveWebDAV = () => {
    const errors = WebDAVService.validateConfig(webdavForm);
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    const config: WebDAVConfig = {
      id: editingWebDAVId || Date.now().toString(),
      name: webdavForm.name,
      url: webdavForm.url.replace(/\/$/, ''), // Remove trailing slash
      username: webdavForm.username,
      password: webdavForm.password,
      path: webdavForm.path,
      isActive: false,
    };

    if (editingWebDAVId) {
      updateWebDAVConfig(editingWebDAVId, config);
    } else {
      addWebDAVConfig(config);
    }

    resetWebDAVForm();
  };

  const handleEditWebDAV = (config: WebDAVConfig) => {
    setWebDAVForm({
      name: config.name,
      url: config.url,
      username: config.username,
      password: config.password,
      path: config.path,
    });
    setEditingWebDAVId(config.id);
    setShowWebDAVForm(true);
  };

  const handleTestWebDAV = async (config: WebDAVConfig) => {
    setTestingWebDAVId(config.id);
    try {
      const webdavService = new WebDAVService(config);
      const isConnected = await webdavService.testConnection();
      
      if (isConnected) {
        alert(t('WebDAV连接成功！', 'WebDAV connection successful!'));
      } else {
        alert(t('WebDAV连接失败，请检查配置。', 'WebDAV connection failed. Please check configuration.'));
      }
    } catch (error) {
      console.error('WebDAV test failed:', error);
      alert(`${t('WebDAV测试失败', 'WebDAV test failed')}: ${error.message}`);
    } finally {
      setTestingWebDAVId(null);
    }
  };

  const handleBackup = async () => {
    const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);
    if (!activeConfig) {
      alert(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'));
      return;
    }

    setIsBackingUp(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      
      const backupData = {
        repositories,
        releases,
        customCategories,
        aiConfigs: aiConfigs.map(config => ({
          ...config,
          apiKey: '***' // Don't backup API keys for security
        })),
        webdavConfigs: webdavConfigs.map(config => ({
          ...config,
          password: '***' // Don't backup passwords for security
        })),
        exportedAt: new Date().toISOString(),
        version: '1.0'
      };

      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const success = await webdavService.uploadFile(filename, JSON.stringify(backupData, null, 2));
      
      if (success) {
        setLastBackup(new Date().toISOString());
        alert(t('数据备份成功！', 'Data backup successful!'));
      }
    } catch (error) {
      console.error('Backup failed:', error);
      alert(`${t('备份失败', 'Backup failed')}: ${error.message}`);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async () => {
    const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);
    if (!activeConfig) {
      alert(t('请先配置并激活WebDAV服务。', 'Please configure and activate WebDAV service first.'));
      return;
    }

    const confirmMessage = t(
      '恢复数据将覆盖当前所有数据，是否继续？',
      'Restoring data will overwrite all current data. Continue?'
    );
    
    if (!confirm(confirmMessage)) return;

    setIsRestoring(true);
    try {
      const webdavService = new WebDAVService(activeConfig);
      const files = await webdavService.listFiles();
      
      const backupFiles = files.filter(file => file.startsWith('github-stars-backup-'));
      if (backupFiles.length === 0) {
        alert(t('未找到备份文件。', 'No backup files found.'));
        return;
      }

      // Use the most recent backup file
      const latestBackup = backupFiles.sort().reverse()[0];
      const backupContent = await webdavService.downloadFile(latestBackup);
      
      if (backupContent) {
        const backupData = JSON.parse(backupContent);

        // 1) 恢复仓库与发布
        if (Array.isArray(backupData.repositories)) {
          setRepositories(backupData.repositories);
        }
        if (Array.isArray(backupData.releases)) {
          setReleases(backupData.releases);
        }

        // 2) 恢复自定义分类（全部替换）
        try {
          // 先清空现有自定义分类
          if (Array.isArray(customCategories)) {
            for (const cat of customCategories) {
              if (cat && cat.id) {
                deleteCustomCategory(cat.id);
              }
            }
          }
          // 再添加备份中的自定义分类
          if (Array.isArray(backupData.customCategories)) {
            for (const cat of backupData.customCategories) {
              if (cat && cat.id && cat.name) {
                addCustomCategory({ ...cat, isCustom: true });
              }
            }
          }
        } catch (e) {
          console.warn('恢复自定义分类时发生问题：', e);
        }

        // 3) 合并 AI 配置（保留现有密钥；备份中密钥为***时不覆盖）
        try {
          if (Array.isArray(backupData.aiConfigs)) {
            const currentMap = new Map(aiConfigs.map((c: AIConfig) => [c.id, c]));
            for (const cfg of backupData.aiConfigs as AIConfig[]) {
              if (!cfg || !cfg.id) continue;
              const existing = currentMap.get(cfg.id);
              const isMasked = cfg.apiKey === '***';
              if (existing) {
                updateAIConfig(cfg.id, {
                  name: cfg.name,
                  baseUrl: cfg.baseUrl,
                  model: cfg.model,
                  customPrompt: cfg.customPrompt,
                  useCustomPrompt: cfg.useCustomPrompt,
                  concurrency: cfg.concurrency,
                  // 仅当备份未掩码时才覆盖 apiKey
                  apiKey: isMasked ? existing.apiKey : cfg.apiKey,
                  // 保留现有 isActive 状态
                  isActive: existing.isActive,
                });
              } else {
                addAIConfig({
                  ...cfg,
                  apiKey: isMasked ? '' : cfg.apiKey,
                  isActive: false,
                });
              }
            }
          }
        } catch (e) {
          console.warn('恢复 AI 配置时发生问题：', e);
        }

        // 4) 合并 WebDAV 配置（保留现有密码；备份中密码为***时不覆盖）
        try {
          if (Array.isArray(backupData.webdavConfigs)) {
            const currentMap = new Map(webdavConfigs.map((c: WebDAVConfig) => [c.id, c]));
            for (const cfg of backupData.webdavConfigs as WebDAVConfig[]) {
              if (!cfg || !cfg.id) continue;
              const existing = currentMap.get(cfg.id);
              const isMasked = cfg.password === '***';
              if (existing) {
                updateWebDAVConfig(cfg.id, {
                  name: cfg.name,
                  url: cfg.url,
                  username: cfg.username,
                  path: cfg.path,
                  // 仅当备份未掩码时才覆盖密码
                  password: isMasked ? existing.password : cfg.password,
                  // 保留现有 isActive 状态
                  isActive: existing.isActive,
                });
              } else {
                addWebDAVConfig({
                  ...cfg,
                  password: isMasked ? '' : cfg.password,
                  isActive: false,
                });
              }
            }
          }
        } catch (e) {
          console.warn('恢复 WebDAV 配置时发生问题：', e);
        }

        alert(t(
          `已从备份恢复数据：仓库 ${backupData.repositories?.length ?? 0}，发布 ${backupData.releases?.length ?? 0}，自定义分类 ${backupData.customCategories?.length ?? 0}。`,
          `Data restored from backup: repositories ${backupData.repositories?.length ?? 0}, releases ${backupData.releases?.length ?? 0}, custom categories ${backupData.customCategories?.length ?? 0}.`
        ));
      }
    } catch (error) {
      console.error('Restore failed:', error);
      alert(`${t('恢复失败', 'Restore failed')}: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  const getDefaultPrompt = () => {
    if (language === 'zh') {
      return `请分析这个GitHub仓库并提供：

1. 一个简洁的中文概述（不超过50字），说明这个仓库的主要功能和用途
2. 3-5个相关的应用类型标签（用中文，类似应用商店的分类，如：开发工具、Web应用、移动应用、数据库、AI工具等{CATEGORIES_INFO ? '，请优先从提供的分类中选择' : ''}）
3. 支持的平台类型（从以下选择：mac、windows、linux、ios、android、docker、web、cli）

重要：请严格使用中文进行分析和回复，无论原始README是什么语言。

请以JSON格式回复：
{
  "summary": "你的中文概述",
  "tags": ["标签1", "标签2", "标签3", "标签4", "标签5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

仓库信息：
{REPO_INFO}{CATEGORIES_INFO}

重点关注实用性和准确的分类，帮助用户快速理解仓库的用途和支持的平台。`;
    } else {
      return `Please analyze this GitHub repository and provide:

1. A concise English overview (no more than 50 words) explaining the main functionality and purpose of this repository
2. 3-5 relevant application type tags (in English, similar to app store categories, such as: development tools, web apps, mobile apps, database, AI tools, etc.{CATEGORIES_INFO ? ', please prioritize from the provided categories' : ''})
3. Supported platform types (choose from: mac, windows, linux, ios, android, docker, web, cli)

Important: Please strictly use English for analysis and response, regardless of the original README language.

Please reply in JSON format:
{
  "summary": "Your English overview",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "platforms": ["platform1", "platform2", "platform3"]
}

Repository information:
{REPO_INFO}{CATEGORIES_INFO}

Focus on practicality and accurate categorization to help users quickly understand the repository's purpose and supported platforms.`;
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Update Check */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Package className="w-6 h-6 text-green-600 dark:text-green-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('检查更新', 'Check for Updates')}
          </h3>
        </div>
        
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              {t('当前版本: v0.1.8', 'Current Version: v0.1.8')}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {t('检查是否有新版本可用', 'Check if a new version is available')}
            </p>
          </div>
          <UpdateChecker />
        </div>
      </div>

      {/* Language Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Globe className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('语言设置', 'Language Settings')}
          </h3>
        </div>
        
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name="language"
              value="zh"
              checked={language === 'zh'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              中文
            </span>
          </label>
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="radio"
              name="language"
              value="en"
              checked={language === 'en'}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              English
            </span>
          </label>
        </div>
      </div>

      {/* Contact Information */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <Mail className="w-6 h-6 text-green-600 dark:text-green-400" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('联系方式', 'Contact Information')}
          </h3>
        </div>
        
        <div className="space-y-3">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t('如果您在使用过程中遇到任何问题或有建议，欢迎通过以下方式联系我：', 'If you encounter any issues or have suggestions while using the app, feel free to contact me through:')}
          </p>
          
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => window.open('https://x.com/GoodMan_Lee', '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
            >
              <Twitter className="w-5 h-5" />
              <span>Twitter</span>
              <ExternalLink className="w-4 h-4" />
            </button>
            
            <button
              onClick={() => window.open('https://github.com/AmintaCCCP/GithubStarsManager', '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors"
            >
              <Github className="w-5 h-5" />
              <span>GitHub</span>
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* AI Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Bot className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('AI服务配置', 'AI Service Configuration')}
            </h3>
          </div>
          <button
            onClick={() => setShowAIForm(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t('添加AI配置', 'Add AI Config')}</span>
          </button>
        </div>

        {/* AI Config Form */}
        {showAIForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
            <h4 className="font-medium text-gray-900 dark:text-white mb-4">
              {editingAIId ? t('编辑AI配置', 'Edit AI Configuration') : t('添加AI配置', 'Add AI Configuration')}
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('配置名称', 'Configuration Name')} *
                </label>
                <input
                  type="text"
                  value={aiForm.name}
                  onChange={(e) => setAIForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('例如: OpenAI GPT-4', 'e.g., OpenAI GPT-4')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('接口格式', 'API Format')} *
                </label>
                <select
                  value={aiForm.apiType}
                  onChange={(e) => setAIForm(prev => ({ ...prev, apiType: e.target.value as 'openai' | 'claude' | 'gemini' }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="openai">OpenAI</option>
                  <option value="claude">Claude</option>
                  <option value="gemini">Gemini</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('API端点', 'API Endpoint')} *
                </label>
                <input
                  type="url"
                  value={aiForm.baseUrl}
                  onChange={(e) => setAIForm(prev => ({ ...prev, baseUrl: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={
                    aiForm.apiType === 'openai'
                      ? 'https://api.openai.com/v1'
                      : aiForm.apiType === 'claude'
                        ? 'https://api.anthropic.com/v1'
                        : 'https://generativelanguage.googleapis.com/v1beta'
                  }
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t(
                    '只填到版本号即可（如 .../v1 或 .../v1beta），不要包含 /chat/completions、/messages 或 :generateContent',
                    'Only include the version prefix (e.g. .../v1 or .../v1beta). Do not include /chat/completions, /messages, or :generateContent.'
                  )}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('API密钥', 'API Key')} *
                </label>
                <input
                  type="password"
                  value={aiForm.apiKey}
                  onChange={(e) => setAIForm(prev => ({ ...prev, apiKey: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('输入API密钥', 'Enter API key')}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('模型名称', 'Model Name')} *
                </label>
                <input
                  type="text"
                  value={aiForm.model}
                  onChange={(e) => setAIForm(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="gpt-4"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('并发数', 'Concurrency')}
                </label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  value={aiForm.concurrency}
                  onChange={(e) => setAIForm(prev => ({ ...prev, concurrency: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="1"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t('同时进行AI分析的仓库数量 (1-10)', 'Number of repositories to analyze simultaneously (1-10)')}
                </p>
              </div>
            </div>

            {/* Custom Prompt Section */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiForm.useCustomPrompt}
                    onChange={(e) => {
                      setAIForm(prev => ({ ...prev, useCustomPrompt: e.target.checked }));
                      setShowCustomPrompt(e.target.checked);
                    }}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t('使用自定义提示词', 'Use Custom Prompt')}
                  </span>
                </label>
                {showCustomPrompt && (
                  <button
                    onClick={() => setAIForm(prev => ({ ...prev, customPrompt: getDefaultPrompt() }))}
                    className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    {t('使用默认模板', 'Use Default Template')}
                  </button>
                )}
              </div>
              
              {showCustomPrompt && (
                <div>
                  <textarea
                    value={aiForm.customPrompt}
                    onChange={(e) => setAIForm(prev => ({ ...prev, customPrompt: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono"
                    rows={12}
                    placeholder={t('输入自定义提示词...', 'Enter custom prompt...')}
                  />
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    <p className="mb-1">{t('可用占位符:', 'Available placeholders:')}</p>
                    <div className="flex flex-wrap gap-2">
                      <code className="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded">{'{{REPO_INFO}}'}</code>
                      <code className="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded">{'{{CATEGORIES_INFO}}'}</code>
                      <code className="px-2 py-1 bg-gray-200 dark:bg-gray-600 rounded">{'{{LANGUAGE}}'}</code>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleSaveAI}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{t('保存', 'Save')}</span>
              </button>
              <button
                onClick={resetAIForm}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>{t('取消', 'Cancel')}</span>
              </button>
            </div>
          </div>
        )}

        {/* AI Configs List */}
        <div className="space-y-3">
          {aiConfigs.map(config => (
            <div
              key={config.id}
              className={`p-4 rounded-lg border transition-colors ${
                config.id === activeAIConfig
                  ? 'border-purple-300 bg-purple-50 dark:border-purple-600 dark:bg-purple-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="activeAI"
                    checked={config.id === activeAIConfig}
                    onChange={() => setActiveAIConfig(config.id)}
                    className="w-4 h-4 text-purple-600 bg-gray-100 border-gray-300 focus:ring-purple-500 dark:focus:ring-purple-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      {config.name}
                      {config.useCustomPrompt && (
                        <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          <MessageSquare className="w-3 h-3 mr-1" />
                          {t('自定义提示词', 'Custom Prompt')}
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {(config.apiType || 'openai').toUpperCase()} • {config.baseUrl} • {config.model} • {t('并发数', 'Concurrency')}: {config.concurrency || 1}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleTestAI(config)}
                    disabled={testingAIId === config.id}
                    className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
                    title={t('测试连接', 'Test Connection')}
                  >
                    {testingAIId === config.id ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleEditAI(config)}
                    className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
                    title={t('编辑', 'Edit')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t('确定要删除这个AI配置吗？', 'Are you sure you want to delete this AI configuration?'))) {
                        deleteAIConfig(config.id);
                      }
                    }}
                    className="p-2 rounded-lg bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                    title={t('删除', 'Delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          
          {aiConfigs.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Bot className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t('还没有配置AI服务', 'No AI services configured yet')}</p>
              <p className="text-sm">{t('点击上方按钮添加AI配置', 'Click the button above to add AI configuration')}</p>
            </div>
          )}
        </div>
      </div>

      {/* WebDAV Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Cloud className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('WebDAV备份配置', 'WebDAV Backup Configuration')}
            </h3>
          </div>
          <div className="flex items-center space-x-3">
            {lastBackup && (
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {t('上次备份:', 'Last backup:')} {new Date(lastBackup).toLocaleString()}
              </span>
            )}
            <button
              onClick={() => setShowWebDAVForm(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>{t('添加WebDAV', 'Add WebDAV')}</span>
            </button>
          </div>
        </div>

        {/* WebDAV Config Form */}
        {showWebDAVForm && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600">
            <h4 className="font-medium text-gray-900 dark:text-white mb-4">
              {editingWebDAVId ? t('编辑WebDAV配置', 'Edit WebDAV Configuration') : t('添加WebDAV配置', 'Add WebDAV Configuration')}
            </h4>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('配置名称', 'Configuration Name')} *
                </label>
                <input
                  type="text"
                  value={webdavForm.name}
                  onChange={(e) => setWebDAVForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('例如: 坚果云', 'e.g., Nutstore')}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('WebDAV URL', 'WebDAV URL')} *
                </label>
                <input
                  type="url"
                  value={webdavForm.url}
                  onChange={(e) => setWebDAVForm(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="https://dav.jianguoyun.com/dav/"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('用户名', 'Username')} *
                </label>
                <input
                  type="text"
                  value={webdavForm.username}
                  onChange={(e) => setWebDAVForm(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('WebDAV用户名', 'WebDAV username')}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('密码', 'Password')} *
                </label>
                <input
                  type="password"
                  value={webdavForm.password}
                  onChange={(e) => setWebDAVForm(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('WebDAV密码', 'WebDAV password')}
                />
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  {t('路径', 'Path')} *
                </label>
                <input
                  type="text"
                  value={webdavForm.path}
                  onChange={(e) => setWebDAVForm(prev => ({ ...prev, path: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="/github-stars-manager/"
                />
              </div>
            </div>

            <div className="flex space-x-3">
              <button
                onClick={handleSaveWebDAV}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{t('保存', 'Save')}</span>
              </button>
              <button
                onClick={resetWebDAVForm}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>{t('取消', 'Cancel')}</span>
              </button>
            </div>
          </div>
        )}

        {/* WebDAV Configs List */}
        <div className="space-y-3 mb-6">
          {webdavConfigs.map(config => (
            <div
              key={config.id}
              className={`p-4 rounded-lg border transition-colors ${
                config.id === activeWebDAVConfig
                  ? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <input
                    type="radio"
                    name="activeWebDAV"
                    checked={config.id === activeWebDAVConfig}
                    onChange={() => setActiveWebDAVConfig(config.id)}
                    className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">{config.name}</h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {config.url} • {config.path}
                    </p>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleTestWebDAV(config)}
                    disabled={testingWebDAVId === config.id}
                    className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
                    title={t('测试连接', 'Test Connection')}
                  >
                    {testingWebDAVId === config.id ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <TestTube className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => handleEditWebDAV(config)}
                    className="p-2 rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors"
                    title={t('编辑', 'Edit')}
                  >
                    <Edit3 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(t('确定要删除这个WebDAV配置吗？', 'Are you sure you want to delete this WebDAV configuration?'))) {
                        deleteWebDAVConfig(config.id);
                      }
                    }}
                    className="p-2 rounded-lg bg-red-100 text-red-600 dark:bg-red-900 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                    title={t('删除', 'Delete')}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}
          
          {webdavConfigs.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              <Cloud className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>{t('还没有配置WebDAV服务', 'No WebDAV services configured yet')}</p>
              <p className="text-sm">{t('点击上方按钮添加WebDAV配置', 'Click the button above to add WebDAV configuration')}</p>
            </div>
          )}
        </div>

        {/* Backup Actions */}
        {webdavConfigs.length > 0 && (
          <div className="flex items-center justify-center space-x-4 pt-6 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleBackup}
              disabled={isBackingUp || !activeWebDAVConfig}
              className="flex items-center space-x-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBackingUp ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
              <span>{isBackingUp ? t('备份中...', 'Backing up...') : t('备份数据', 'Backup Data')}</span>
            </button>
            
            <button
              onClick={handleRestore}
              disabled={isRestoring || !activeWebDAVConfig}
              className="flex items-center space-x-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRestoring ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Download className="w-5 h-5" />
              )}
              <span>{isRestoring ? t('恢复中...', 'Restoring...') : t('恢复数据', 'Restore Data')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
