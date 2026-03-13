import React, { useState, useEffect } from 'react';
import { 
  Bot, 
  Plus, 
  Edit3, 
  Trash2, 
  Save, 
  X, 
  TestTube, 
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
  Bell,
  Key,
  User,
  Clock,
} from 'lucide-react';
import { AIConfig, WebDAVConfig } from '../types';
import { useAppStore } from '../store/useAppStore';
import { AIService } from '../services/aiService';
import { WebDAVService } from '../services/webdavService';
import { UpdateChecker } from './UpdateChecker';
import { backend } from '../services/backendAdapter';
import { authService } from '../services/auth';

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
    backendUser,
  } = useAppStore();

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  const [showAIForm, setShowAIForm] = useState(false);
  const [showWebDAVForm, setShowWebDAVForm] = useState(false);
  const [editingAIId, setEditingAIId] = useState<string | null>(null);
  const [editingWebDAVId, setEditingWebDAVId] = useState<string | null>(null);
  const [testingAIId, setTestingAIId] = useState<string | null>(null);
  const [testingWebDAVId, setTestingWebDAVId] = useState<string | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);

  const [appriseUrlInput, setAppriseUrlInput] = useState(backendUser?.apprise_url || '');
  const [newPasswordSync, setNewPasswordSync] = useState('');
  const [githubTokenInput, setGithubTokenInput] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [isUpdatingGithubToken, setIsUpdatingGithubToken] = useState(false);
  const [isUpdatingApprise, setIsUpdatingApprise] = useState(false);
  const [isTestingApprise, setIsTestingApprise] = useState(false);

  const [scheduledTasks, setScheduledTasks] = useState<Array<{
    id: string;
    task_type: string;
    enabled: number;
    cron_expression: string;
    last_run: string | null;
    next_run: string | null;
  }>>([]);
  const [notificationPrefs, setNotificationPrefs] = useState<{
    notify_new_release: number;
    notify_star_added: number;
    notify_star_removed: number;
  }>({
    notify_new_release: 1,
    notify_star_added: 1,
    notify_star_removed: 1,
  });
  const [isUpdatingTask, setIsUpdatingTask] = useState<string | null>(null);
  const [isUpdatingPrefs, setIsUpdatingPrefs] = useState(false);

  useEffect(() => {
    setAppriseUrlInput(backendUser?.appriseUrl || '');
  }, [backendUser?.appriseUrl]);

  useEffect(() => {
    const fetchGithubToken = async () => {
      try {
        const settings = await backend.fetchSettings();
        const token = settings.github_token as string;
        if (token && !token.startsWith('***')) {
          setGithubTokenInput('');
        } else if (token) {
          setGithubTokenInput(token);
        }
      } catch (err) {
        console.error('Failed to fetch github token:', err);
      }
    };
    if (backend.isAvailable) {
      fetchGithubToken();
    }
  }, []);

  useEffect(() => {
    const fetchScheduledTasks = async () => {
      try {
        const response = await fetch('/api/scheduled-tasks', {
          headers: backend.getAuthHeaders(),
        });
        if (response.ok) {
          const tasks = await response.json();
          setScheduledTasks(tasks);
        }
      } catch (err) {
        console.error('Failed to fetch scheduled tasks:', err);
      }
    };

    const fetchNotificationPrefs = async () => {
      try {
        const response = await fetch('/api/notification-preferences', {
          headers: backend.getAuthHeaders(),
        });
        if (response.ok) {
          const prefs = await response.json();
          if (prefs) {
            setNotificationPrefs({
              notify_new_release: prefs.notify_new_release ?? 1,
              notify_star_added: prefs.notify_star_added ?? 1,
              notify_star_removed: prefs.notify_star_removed ?? 1,
            });
          }
        }
      } catch (err) {
        console.error('Failed to fetch notification preferences:', err);
      }
    };

    if (backend.isAvailable && backendUser) {
      fetchScheduledTasks();
      fetchNotificationPrefs();
    }
  }, [backend.isAvailable, backendUser]);

  type AIFormState = {
    name: string;
    apiType: 'openai' | 'openai-responses' | 'claude' | 'gemini';
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
      baseUrl: aiForm.baseUrl.replace(/\/$/, ''),
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
    } catch (error: any) {
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
      url: webdavForm.url.replace(/\/$/, ''),
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
    } catch (error: any) {
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
          apiKey: '***'
        })),
        webdavConfigs: webdavConfigs.map(config => ({
          ...config,
          password: '***'
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
    } catch (error: any) {
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

      const latestBackup = backupFiles.sort().reverse()[0];
      const backupContent = await webdavService.downloadFile(latestBackup);
      
      if (backupContent) {
        const backupData = JSON.parse(backupContent);

        if (Array.isArray(backupData.repositories)) {
          setRepositories(backupData.repositories);
        }
        if (Array.isArray(backupData.releases)) {
          setReleases(backupData.releases);
        }

        try {
          if (Array.isArray(customCategories)) {
            for (const cat of customCategories) {
              if (cat && cat.id) {
                deleteCustomCategory(cat.id);
              }
            }
          }
          if (Array.isArray(backupData.customCategories)) {
            for (const cat of backupData.customCategories) {
              if (cat && cat.id && cat.name) {
                addCustomCategory({ ...cat, isCustom: true });
              }
            }
          }
        } catch (e: any) {
          console.warn('恢复自定义分类时发生问题：', e);
        }

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
                  apiKey: isMasked ? existing.apiKey : cfg.apiKey,
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
        } catch (e: any) {
          console.warn('恢复 AI 配置时发生问题：', e);
        }

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
                  password: isMasked ? existing.password : cfg.password,
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
        } catch (e: any) {
          console.warn('恢复 WebDAV 配置时发生问题：', e);
        }

        alert(t(
          `已从备份恢复数据：仓库 ${backupData.repositories?.length ?? 0}，发布 ${backupData.releases?.length ?? 0}，自定义分类 ${backupData.customCategories?.length ?? 0}。`,
          `Data restored from backup: repositories ${backupData.repositories?.length ?? 0}, releases ${backupData.releases?.length ?? 0}, custom categories ${backupData.customCategories?.length ?? 0}.`
        ));
      }
    } catch (error: any) {
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

  const handleUpdatePassword = async () => {
    if (!newPasswordSync.trim()) {
      alert(t('请输入新密码', 'Please enter a new password'));
      return;
    }
    setIsUpdatingPassword(true);
    try {
      await authService.updateProfile({ password: newPasswordSync });
      setNewPasswordSync('');
      alert(t('密码更新成功！', 'Password updated successfully!'));
    } catch (error: any) {
      console.error('Update password failed:', error);
      alert(`${t('更新失败', 'Update failed')}: ${(error as Error).message}`);
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const handleUpdateGithubToken = async () => {
    if (!githubTokenInput.trim()) {
      alert(t('请输入GitHub Token', 'Please enter GitHub Token'));
      return;
    }
    setIsUpdatingGithubToken(true);
    try {
      await backend.syncSettings({ github_token: githubTokenInput });
      setGithubTokenInput('***' + githubTokenInput.slice(-4));
      alert(t('GitHub Token 更新成功！', 'GitHub Token updated successfully!'));
    } catch (error: any) {
      console.error('Update GitHub token failed:', error);
      alert(`${t('更新失败', 'Update failed')}: ${(error as Error).message}`);
    } finally {
      setIsUpdatingGithubToken(false);
    }
  };

  const handleUpdateApprise = async () => {
    setIsUpdatingApprise(true);
    try {
      const updated = await authService.updateProfile({ 
        apprise_url: appriseUrlInput || undefined 
      });
      useAppStore.setState(state => ({
        backendUser: state.backendUser ? {
          ...state.backendUser,
          apprise_url: updated.appriseUrl || null
        } : null
      }));
      alert(t('通知URL更新成功！', 'Notification URL updated successfully!'));
    } catch (error: any) {
      console.error('Update apprise failed:', error);
      alert(`${t('更新失败', 'Update failed')}: ${(error as Error).message}`);
    } finally {
      setIsUpdatingApprise(false);
    }
  };

  const handleTestApprise = async () => {
    setIsTestingApprise(true);
    try {
      const response = await fetch('/api/notifications/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...backend.getAuthHeaders(),
        },
        body: JSON.stringify({ url: appriseUrlInput || undefined }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Test notification failed');
      }

      alert(t('测试通知发送成功！', 'Test notification sent successfully!'));
    } catch (error: any) {
      console.error('Test notification failed:', error);
      alert(`${t('测试通知失败', 'Test notification failed')}: ${error.message}`);
    } finally {
      setIsTestingApprise(false);
    }
  };

  const handleUpdateTask = async (taskType: string, updates: { enabled?: number; cron_expression?: string }) => {
    setIsUpdatingTask(taskType);
    try {
      const response = await fetch(`/api/scheduled-tasks/${taskType}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...backend.getAuthHeaders(),
        },
        body: JSON.stringify(updates),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update task');
      }

      const updatedTask = await response.json();
      setScheduledTasks(prev => prev.map(t => t.task_type === taskType ? updatedTask : t));
      alert(t('定时任务更新成功！', 'Scheduled task updated successfully!'));
    } catch (error: any) {
      console.error('Update task failed:', error);
      alert(`${t('更新失败', 'Update failed')}: ${error.message}`);
    } finally {
      setIsUpdatingTask(null);
    }
  };

  const handleUpdateNotificationPrefs = async () => {
    setIsUpdatingPrefs(true);
    try {
      const response = await fetch('/api/notification-preferences', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...backend.getAuthHeaders(),
        },
        body: JSON.stringify(notificationPrefs),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to update preferences');
      }

      alert(t('通知偏好更新成功！', 'Notification preferences updated successfully!'));
    } catch (error: any) {
      console.error('Update notification preferences failed:', error);
      alert(`${t('更新失败', 'Update failed')}: ${error.message}`);
    } finally {
      setIsUpdatingPrefs(false);
    }
  };

  const getTaskName = (taskType: string) => {
    switch (taskType) {
      case 'sync_stars':
        return t('同步Stars', 'Sync Stars');
      case 'check_releases':
        return t('检查Release', 'Check Releases');
      default:
        return taskType;
    }
  };

  const getTaskDescription = (taskType: string) => {
    switch (taskType) {
      case 'sync_stars':
        return t('定时同步GitHub Stars，检测新增和移除的仓库，自动进行AI分析并发送通知', 'Periodically sync GitHub Stars, detect added and removed repos, auto AI analysis and send notifications');
      case 'check_releases':
        return t('检查订阅仓库的新Release发布', 'Check for new releases of subscribed repos');
      default:
        return '';
    }
  };

  const getCronDescription = (cron: string) => {
    const parts = cron.split(' ');
    if (parts.length !== 5) return cron;
    
    const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
    
    if (minute === '0' && hour === '*') {
      return t('每小时', 'Every hour');
    }
    if (minute === '0' && hour.startsWith('*/')) {
      const hours = hour.replace('*/', '');
      return t(`每${hours}小时`, `Every ${hours} hours`);
    }
    if (minute === '0' && hour.match(/^\d+$/)) {
      return t(`每天 ${hour}:00`, `Daily at ${hour}:00`);
    }
    if (minute === '0' && hour === '3') {
      return t('每天凌晨3点', 'Daily at 3:00 AM');
    }
    
    return cron;
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* 1. AI Configuration */}
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
                  onChange={(e) => setAIForm(prev => ({ ...prev, apiType: e.target.value as 'openai' | 'openai-responses' | 'claude' | 'gemini' }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                >
                  <option value="openai">OpenAI (Chat Completions)</option>
                  <option value="openai-responses">OpenAI (Responses)</option>
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
                    aiForm.apiType === 'openai' || aiForm.apiType === 'openai-responses'
                      ? 'https://api.openai.com/v1'
                      : aiForm.apiType === 'claude'
                        ? 'https://api.anthropic.com/v1'
                        : 'https://generativelanguage.googleapis.com/v1beta'
                  }
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {t(
                    '只填到版本号即可（如 .../v1 或 .../v1beta），不要包含 /chat/completions、/responses、/messages 或 :generateContent',
                    'Only include the version prefix (e.g. .../v1 or .../v1beta). Do not include /chat/completions, /responses, /messages, or :generateContent.'
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

      {/* 2. WebDAV Configuration */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <Cloud className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('个人云端备份 (WebDAV)', 'Personal Cloud Backup (WebDAV)')}
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

        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
          {t(
            'WebDAV 用于将您的本地数据（仓库、分类、配置等）备份到您自己的云端存储（如坚果云、Nextcloud、AList 等）。这有助于在多台设备间同步数据或进行数据迁移。',
            'WebDAV is used to backup your local data (repositories, categories, configs, etc.) to your own cloud storage (e.g., Jianguoyun, Nextcloud, AList, etc.). This helps synchronize data across multiple devices or perform data migration.'
          )}
        </p>

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

      {/* 3. Scheduled Tasks */}
      {backend.isAvailable && scheduledTasks.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Clock className="w-6 h-6 text-teal-600 dark:text-teal-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('定时任务', 'Scheduled Tasks')}
            </h3>
          </div>

          <div className="space-y-4">
            {scheduledTasks.map(task => (
              <div key={task.id} className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center space-x-3">
                    <label className="flex items-center space-x-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={task.enabled === 1}
                        onChange={(e) => handleUpdateTask(task.task_type, { enabled: e.target.checked ? 1 : 0 })}
                        disabled={isUpdatingTask === task.task_type}
                        className="w-4 h-4 text-teal-600 bg-gray-100 border-gray-300 rounded focus:ring-teal-500 dark:focus:ring-teal-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                      />
                      <span className="font-medium text-gray-900 dark:text-white">
                        {getTaskName(task.task_type)}
                      </span>
                    </label>
                  </div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">
                    {getCronDescription(task.cron_expression)}
                  </div>
                </div>
                
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  {getTaskDescription(task.task_type)}
                </p>
                
                <div className="flex items-center space-x-4">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
                      {t('Cron表达式', 'Cron Expression')}
                    </label>
                    <input
                      type="text"
                      value={task.cron_expression}
                      onChange={(e) => {
                        setScheduledTasks(prev => prev.map(t => 
                          t.task_type === task.task_type 
                            ? { ...t, cron_expression: e.target.value }
                            : t
                        ));
                      }}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                      placeholder="0 * * * *"
                    />
                  </div>
                  <button
                    onClick={() => handleUpdateTask(task.task_type, { cron_expression: task.cron_expression })}
                    disabled={isUpdatingTask === task.task_type}
                    className="mt-4 px-3 py-1.5 text-sm bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors disabled:opacity-50"
                  >
                    {isUpdatingTask === task.task_type ? t('保存中...', 'Saving...') : t('保存', 'Save')}
                  </button>
                </div>
                
                {task.last_run && (
                  <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                    {t('上次运行: ', 'Last run: ')}{new Date(task.last_run).toLocaleString()}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
            {t(
              'Cron表达式格式: 分 时 日 月 周。例如: "0 * * * *" 表示每小时执行，"0 */6 * * *" 表示每6小时执行，"0 3 * * *" 表示每天凌晨3点执行。',
              'Cron format: minute hour day month weekday. E.g., "0 * * * *" = hourly, "0 */6 * * *" = every 6 hours, "0 3 * * *" = daily at 3 AM.'
            )}
          </p>
        </div>
      )}

      {/* 4. Notification Settings */}
      {backend.isAvailable && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <Bell className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('通知设置', 'Notification Settings')}
            </h3>
          </div>

          <div className="space-y-6">
            {/* Notification Preferences */}
            <div className="pb-6 border-b border-gray-100 dark:border-gray-700">
              <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {t('通知事件', 'Notification Events')}
              </h4>
              <div className="space-y-2">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationPrefs.notify_new_release === 1}
                    onChange={(e) => setNotificationPrefs(prev => ({ ...prev, notify_new_release: e.target.checked ? 1 : 0 }))}
                    className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 dark:focus:ring-orange-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('新Release发布', 'New Release')}
                  </span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationPrefs.notify_star_added === 1}
                    onChange={(e) => setNotificationPrefs(prev => ({ ...prev, notify_star_added: e.target.checked ? 1 : 0 }))}
                    className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 dark:focus:ring-orange-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('新增Star', 'Star Added')}
                  </span>
                </label>
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={notificationPrefs.notify_star_removed === 1}
                    onChange={(e) => setNotificationPrefs(prev => ({ ...prev, notify_star_removed: e.target.checked ? 1 : 0 }))}
                    className="w-4 h-4 text-orange-600 bg-gray-100 border-gray-300 rounded focus:ring-orange-500 dark:focus:ring-orange-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t('移除Star', 'Star Removed')}
                  </span>
                </label>
              </div>
              <button
                onClick={handleUpdateNotificationPrefs}
                disabled={isUpdatingPrefs}
                className="mt-3 flex items-center space-x-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {isUpdatingPrefs ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{t('保存偏好', 'Save Preferences')}</span>
              </button>
            </div>

            {/* Apprise URL */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                {t('通知URL', 'Notification URL')}
              </label>
              <div className="flex space-x-3">
                <input
                  type="text"
                  value={appriseUrlInput}
                  onChange={(e) => setAppriseUrlInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder="gotifys://gotify.example.com/token"
                />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t(
                  '支持的通知格式：gotifys://gotify.example.com/token、discord://webhook_id/webhook_token、telegram://bot_token/chat_id、https://webhook.url（直接POST）',
                  'Supported formats: gotifys://gotify.example.com/token, discord://webhook_id/webhook_token, telegram://bot_token/chat_id, https://webhook.url (direct POST)'
                )}
              </p>
            </div>

            <div className="flex justify-end space-x-3">
              <button
                onClick={handleTestApprise}
                disabled={isTestingApprise || !appriseUrlInput}
                className="flex items-center space-x-2 px-4 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors disabled:opacity-50"
              >
                {isTestingApprise ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <TestTube className="w-4 h-4" />
                )}
                <span>{t('测试通知', 'Test Notification')}</span>
              </button>
              <button
                onClick={handleUpdateApprise}
                disabled={isUpdatingApprise}
                className="flex items-center space-x-2 px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors disabled:opacity-50"
              >
                {isUpdatingApprise ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>{t('保存', 'Save')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Account Settings */}
      {backend.isAvailable && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3 mb-6">
            <User className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('账户设置', 'Account Settings')}
            </h3>
          </div>

          <div className="space-y-6">
            {/* GitHub Token */}
            <div className="pb-6 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center space-x-2 mb-2">
                <Github className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('GitHub Token', 'GitHub Token')}
                </label>
              </div>
              <div className="flex space-x-3">
                <input
                  type="password"
                  value={githubTokenInput}
                  onChange={(e) => setGithubTokenInput(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('输入新的 GitHub Personal Access Token', 'Enter new GitHub Personal Access Token')}
                />
                <button
                  onClick={handleUpdateGithubToken}
                  disabled={isUpdatingGithubToken}
                  className="flex items-center space-x-2 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors disabled:opacity-50"
                >
                  {isUpdatingGithubToken ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('保存', 'Save')}</span>
                </button>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t(
                  '需要 repo 和 user 权限。用于同步仓库和获取 Release 信息。',
                  'Requires repo and user permissions. Used for syncing repositories and fetching release information.'
                )}
              </p>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center space-x-2 mb-2">
                <Key className="w-4 h-4 text-gray-600 dark:text-gray-400" />
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('修改密码', 'Change Password')}
                </label>
              </div>
              <div className="flex space-x-3">
                <input
                  type="password"
                  value={newPasswordSync}
                  onChange={(e) => setNewPasswordSync(e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  placeholder={t('输入新密码', 'Enter new password')}
                />
                <button
                  onClick={handleUpdatePassword}
                  disabled={isUpdatingPassword}
                  className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  {isUpdatingPassword ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  <span>{t('保存', 'Save')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 6. Language Settings */}
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

      {/* 7. Update Check */}
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
              {t(`当前版本: v${__APP_VERSION__}`, `Current Version: v${__APP_VERSION__}`)}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500">
              {t('检查是否有新版本可用', 'Check if a new version is available')}
            </p>
          </div>
          <UpdateChecker />
        </div>
      </div>

      {/* 8. Contact Information */}
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
              onClick={() => window.open('https://weibo.com/n/聒聒并不噪', '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
            >
              <Globe className="w-5 h-5" />
              <span>{t('微博', 'Weibo')} (@聒聒并不噪)</span>
              <ExternalLink className="w-4 h-4" />
            </button>
            
            <button
              onClick={() => window.open('https://github.com/banjuer/GithubStarsManager', '_blank')}
              className="flex items-center justify-center space-x-2 px-4 py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-lg transition-colors"
            >
              <Github className="w-5 h-5" />
              <span>GitHub</span>
              <ExternalLink className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
