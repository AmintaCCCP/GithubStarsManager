import React, { useState, useRef } from 'react';
import { Plus, Save, Trash2, Check, X, Settings, Bot, Key, TestTube, Globe, Cloud, Upload, Download, AlertTriangle, CheckCircle, Info, FileDown, FileUp, Edit3 } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { AIConfig, WebDAVConfig } from '../types';
import { AIService } from '../services/aiService';
import { WebDAVService } from '../services/webdavService';

export const SettingsPanel: React.FC = () => {
  const {
    aiConfigs,
    activeAIConfig,
    webdavConfigs,
    activeWebDAVConfig,
    lastBackup,
    githubToken,
    language,
    repositories,
    releaseSubscriptions,
    addAIConfig,
    updateAIConfig,
    deleteAIConfig,
    setActiveAIConfig,
    addWebDAVConfig,
    updateWebDAVConfig,
    deleteWebDAVConfig,
    setActiveWebDAVConfig,
    setLastBackup,
    setGitHubToken,
    setLanguage,
    setRepositories,
    setReleases,
  } = useAppStore();

  const [isAddingAIConfig, setIsAddingAIConfig] = useState(false);
  const [isAddingWebDAVConfig, setIsAddingWebDAVConfig] = useState(false);
  const [editingAIConfigId, setEditingAIConfigId] = useState<string | null>(null);
  const [editingWebDAVConfigId, setEditingWebDAVConfigId] = useState<string | null>(null);
  const [testingConfigId, setTestingConfigId] = useState<string | null>(null);
  const [testingWebDAVId, setTestingWebDAVId] = useState<string | null>(null);
  const [backupStatus, setBackupStatus] = useState<'idle' | 'backing-up' | 'restoring' | 'exporting' | 'importing'>('idle');
  const [newAIConfig, setNewAIConfig] = useState<Partial<AIConfig>>({
    name: '',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-3.5-turbo',
  });
  const [newWebDAVConfig, setNewWebDAVConfig] = useState<Partial<WebDAVConfig>>({
    name: '',
    url: '',
    username: '',
    password: '',
    path: '/github-stars-backup',
  });
  const [editingAIConfig, setEditingAIConfig] = useState<Partial<AIConfig>>({});
  const [editingWebDAVConfig, setEditingWebDAVConfig] = useState<Partial<WebDAVConfig>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveAIConfig = () => {
    if (!newAIConfig.name || !newAIConfig.baseUrl || !newAIConfig.apiKey || !newAIConfig.model) {
      alert(language === 'zh' ? '请填写所有字段' : 'Please fill in all fields');
      return;
    }

    const config: AIConfig = {
      id: Date.now().toString(),
      name: newAIConfig.name,
      baseUrl: newAIConfig.baseUrl,
      apiKey: newAIConfig.apiKey,
      model: newAIConfig.model,
      isActive: aiConfigs.length === 0,
    };

    addAIConfig(config);
    if (config.isActive) {
      setActiveAIConfig(config.id);
    }

    setNewAIConfig({
      name: '',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-3.5-turbo',
    });
    setIsAddingAIConfig(false);
  };

  const handleSaveWebDAVConfig = () => {
    const errors = WebDAVService.validateConfig(newWebDAVConfig);
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    const config: WebDAVConfig = {
      id: Date.now().toString(),
      name: newWebDAVConfig.name!,
      url: newWebDAVConfig.url!,
      username: newWebDAVConfig.username!,
      password: newWebDAVConfig.password!,
      path: newWebDAVConfig.path!,
      isActive: webdavConfigs.length === 0,
    };

    addWebDAVConfig(config);
    if (config.isActive) {
      setActiveWebDAVConfig(config.id);
    }

    setNewWebDAVConfig({
      name: '',
      url: '',
      username: '',
      password: '',
      path: '/github-stars-backup',
    });
    setIsAddingWebDAVConfig(false);
  };

  const handleEditAIConfig = (config: AIConfig) => {
    setEditingAIConfigId(config.id);
    setEditingAIConfig({ ...config });
  };

  const handleSaveEditingAIConfig = () => {
    if (!editingAIConfig.name || !editingAIConfig.baseUrl || !editingAIConfig.apiKey || !editingAIConfig.model) {
      alert(language === 'zh' ? '请填写所有字段' : 'Please fill in all fields');
      return;
    }

    updateAIConfig(editingAIConfigId!, editingAIConfig);
    setEditingAIConfigId(null);
    setEditingAIConfig({});
  };

  const handleEditWebDAVConfig = (config: WebDAVConfig) => {
    setEditingWebDAVConfigId(config.id);
    setEditingWebDAVConfig({ ...config });
  };

  const handleSaveEditingWebDAVConfig = () => {
    const errors = WebDAVService.validateConfig(editingWebDAVConfig);
    if (errors.length > 0) {
      alert(errors.join('\n'));
      return;
    }

    updateWebDAVConfig(editingWebDAVConfigId!, editingWebDAVConfig);
    setEditingWebDAVConfigId(null);
    setEditingWebDAVConfig({});
  };

  const handleTestAIConfig = async (config: AIConfig) => {
    setTestingConfigId(config.id);
    try {
      const aiService = new AIService(config, language);
      const isWorking = await aiService.testConnection();
      
      const successMessage = language === 'zh' 
        ? '✅ 连接成功！AI配置正常工作。'
        : '✅ Connection successful! AI configuration is working.';
      
      const failMessage = language === 'zh'
        ? '❌ 连接失败。请检查您的配置。'
        : '❌ Connection failed. Please check your configuration.';
      
      alert(isWorking ? successMessage : failMessage);
    } catch (error) {
      const errorMessage = language === 'zh'
        ? `❌ 连接失败: ${error instanceof Error ? error.message : '未知错误'}`
        : `❌ Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      alert(errorMessage);
    } finally {
      setTestingConfigId(null);
    }
  };

  const handleTestWebDAVConfig = async (config: WebDAVConfig) => {
    setTestingWebDAVId(config.id);
    try {
      const webdavService = new WebDAVService(config);
      const isWorking = await webdavService.testConnection();
      
      if (isWorking) {
        // 获取服务器信息
        const serverInfo = await webdavService.getServerInfo();
        let message = language === 'zh' 
          ? '✅ WebDAV连接成功！'
          : '✅ WebDAV connection successful!';
        
        if (serverInfo.server) {
          message += `\n${language === 'zh' ? '服务器' : 'Server'}: ${serverInfo.server}`;
        }
        if (serverInfo.davLevel) {
          message += `\n${language === 'zh' ? 'DAV级别' : 'DAV Level'}: ${serverInfo.davLevel}`;
        }
        
        alert(message);
      } else {
        alert(language === 'zh'
          ? '❌ WebDAV连接失败。请检查您的配置。'
          : '❌ WebDAV connection failed. Please check your configuration.');
      }
    } catch (error) {
      const errorMessage = language === 'zh'
        ? `❌ WebDAV连接测试失败:\n\n${error instanceof Error ? error.message : '未知错误'}`
        : `❌ WebDAV connection test failed:\n\n${error instanceof Error ? error.message : 'Unknown error'}`;
      alert(errorMessage);
    } finally {
      setTestingWebDAVId(null);
    }
  };

  const handleSetActiveAI = (configId: string) => {
    aiConfigs.forEach(config => {
      updateAIConfig(config.id, { isActive: config.id === configId });
    });
    setActiveAIConfig(configId);
  };

  const handleSetActiveWebDAV = (configId: string) => {
    webdavConfigs.forEach(config => {
      updateWebDAVConfig(config.id, { isActive: config.id === configId });
    });
    setActiveWebDAVConfig(configId);
  };

  const handleBackupToWebDAV = async () => {
    const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);
    if (!activeConfig) {
      alert(language === 'zh' ? '请先配置并激活WebDAV服务。' : 'Please configure and activate WebDAV service first.');
      return;
    }

    setBackupStatus('backing-up');
    try {
      const webdavService = new WebDAVService(activeConfig);
      
      // 准备备份数据 - 保留真实的敏感信息
      const backupData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        repositories: repositories,
        aiConfigs: aiConfigs, // 保留完整的AI配置包括API密钥
        webdavConfigs: webdavConfigs, // 保留完整的WebDAV配置包括密码
        releaseSubscriptions: Array.from(releaseSubscriptions),
        settings: {
          language,
          lastBackup,
          activeAIConfig,
          activeWebDAVConfig,
        }
      };

      const filename = `github-stars-backup-${new Date().toISOString().split('T')[0]}.json`;
      const content = JSON.stringify(backupData, null, 2);
      
      await webdavService.uploadFile(filename, content);
      
      const now = new Date().toISOString();
      setLastBackup(now);
      
      alert(language === 'zh' 
        ? `✅ 备份成功！\n文件名: ${filename}\n备份时间: ${new Date(now).toLocaleString()}`
        : `✅ Backup successful!\nFilename: ${filename}\nBackup time: ${new Date(now).toLocaleString()}`
      );
    } catch (error) {
      console.error('Backup failed:', error);
      const errorMessage = language === 'zh'
        ? `❌ 备份失败:\n\n${error instanceof Error ? error.message : '未知错误'}`
        : `❌ Backup failed:\n\n${error instanceof Error ? error.message : 'Unknown error'}`;
      alert(errorMessage);
    } finally {
      setBackupStatus('idle');
    }
  };

  const handleRestoreFromWebDAV = async () => {
    const activeConfig = webdavConfigs.find(config => config.id === activeWebDAVConfig);
    if (!activeConfig) {
      alert(language === 'zh' ? '请先配置并激活WebDAV服务。' : 'Please configure and activate WebDAV service first.');
      return;
    }

    const confirmMessage = language === 'zh'
      ? '⚠️ 恢复操作将覆盖当前的仓库数据和配置。\n\n确定要继续吗？'
      : '⚠️ Restore operation will overwrite current repository data and configurations.\n\nAre you sure you want to continue?';
    
    if (!confirm(confirmMessage)) return;

    setBackupStatus('restoring');
    try {
      const webdavService = new WebDAVService(activeConfig);
      
      // 列出可用的备份文件
      const files = await webdavService.listFiles();
      const backupFiles = files.filter(file => file.startsWith('github-stars-backup-'));
      
      if (backupFiles.length === 0) {
        alert(language === 'zh' ? '没有找到备份文件。' : 'No backup files found.');
        return;
      }

      // 选择最新的备份文件
      const latestBackup = backupFiles.sort().reverse()[0];
      const content = await webdavService.downloadFile(latestBackup);
      
      if (!content) {
        alert(language === 'zh' ? '无法读取备份文件。' : 'Unable to read backup file.');
        return;
      }

      const backupData = JSON.parse(content);
      
      // 恢复数据
      if (backupData.repositories) {
        setRepositories(backupData.repositories);
      }
      if (backupData.releases) {
        setReleases(backupData.releases);
      }
      
      alert(language === 'zh' 
        ? `✅ 恢复成功！\n备份文件: ${latestBackup}\n备份时间: ${new Date(backupData.timestamp).toLocaleString()}\n仓库数量: ${backupData.repositories?.length || 0}\n\n页面将刷新以应用更改。`
        : `✅ Restore successful!\nBackup file: ${latestBackup}\nBackup time: ${new Date(backupData.timestamp).toLocaleString()}\nRepositories: ${backupData.repositories?.length || 0}\n\nPage will refresh to apply changes.`
      );
      
      // 刷新页面以确保所有状态正确更新
      setTimeout(() => window.location.reload(), 2000);
    } catch (error) {
      console.error('Restore failed:', error);
      const errorMessage = language === 'zh'
        ? `❌ 恢复失败:\n\n${error instanceof Error ? error.message : '未知错误'}`
        : `❌ Restore failed:\n\n${error instanceof Error ? error.message : 'Unknown error'}`;
      alert(errorMessage);
    } finally {
      setBackupStatus('idle');
    }
  };

  const handleExportConfig = () => {
    setBackupStatus('exporting');
    try {
      // 准备导出数据 - 保留真实的敏感信息用于本地备份
      const exportData = {
        version: '1.0',
        timestamp: new Date().toISOString(),
        aiConfigs: aiConfigs, // 保留完整的AI配置包括API密钥
        webdavConfigs: webdavConfigs, // 保留完整的WebDAV配置包括密码
        settings: {
          language,
          activeAIConfig,
          activeWebDAVConfig,
        }
      };

      const content = JSON.stringify(exportData, null, 2);
      const blob = new Blob([content], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `github-stars-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      alert(language === 'zh' 
        ? '✅ 配置导出成功！文件已下载到您的设备。\n\n注意：此文件包含敏感信息（API密钥、密码），请妥善保管。'
        : '✅ Configuration exported successfully! File has been downloaded to your device.\n\nNote: This file contains sensitive information (API keys, passwords), please keep it secure.'
      );
    } catch (error) {
      console.error('Export failed:', error);
      alert(language === 'zh'
        ? `❌ 导出失败: ${error instanceof Error ? error.message : '未知错误'}`
        : `❌ Export failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setBackupStatus('idle');
    }
  };

  const handleImportConfig = () => {
    fileInputRef.current?.click();
  };

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBackupStatus('importing');
    try {
      const content = await file.text();
      const importData = JSON.parse(content);
      
      // 验证导入数据格式
      if (!importData.version || !importData.timestamp) {
        throw new Error(language === 'zh' ? '无效的配置文件格式' : 'Invalid configuration file format');
      }

      const confirmMessage = language === 'zh'
        ? `⚠️ 导入配置将覆盖当前的AI和WebDAV配置。\n\n配置文件信息:\n• 创建时间: ${new Date(importData.timestamp).toLocaleString()}\n• AI配置: ${importData.aiConfigs?.length || 0} 个\n• WebDAV配置: ${importData.webdavConfigs?.length || 0} 个\n\n确定要继续吗？`
        : `⚠️ Importing configuration will overwrite current AI and WebDAV configurations.\n\nConfiguration file info:\n• Created: ${new Date(importData.timestamp).toLocaleString()}\n• AI configs: ${importData.aiConfigs?.length || 0}\n• WebDAV configs: ${importData.webdavConfigs?.length || 0}\n\nAre you sure you want to continue?`;
      
      if (!confirm(confirmMessage)) return;

      // 导入AI配置（包含完整信息）
      if (importData.aiConfigs && Array.isArray(importData.aiConfigs)) {
        importData.aiConfigs.forEach((config: any) => {
          if (config.name && config.baseUrl && config.model) {
            const newConfig: AIConfig = {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              name: `${config.name} (导入)`,
              baseUrl: config.baseUrl,
              apiKey: config.apiKey || '', // 保留原始API密钥
              model: config.model,
              isActive: false,
            };
            addAIConfig(newConfig);
          }
        });
      }

      // 导入WebDAV配置（包含完整信息）
      if (importData.webdavConfigs && Array.isArray(importData.webdavConfigs)) {
        importData.webdavConfigs.forEach((config: any) => {
          if (config.name && config.url && config.username && config.path) {
            const newConfig: WebDAVConfig = {
              id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
              name: `${config.name} (导入)`,
              url: config.url,
              username: config.username,
              password: config.password || '', // 保留原始密码
              path: config.path,
              isActive: false,
            };
            addWebDAVConfig(newConfig);
          }
        });
      }

      // 导入设置
      if (importData.settings) {
        if (importData.settings.language) {
          setLanguage(importData.settings.language);
        }
      }

      const hasCredentials = importData.aiConfigs?.some((c: any) => c.apiKey && c.apiKey !== '***') || 
                            importData.webdavConfigs?.some((c: any) => c.password && c.password !== '***');

      alert(language === 'zh' 
        ? `✅ 配置导入成功！${hasCredentials ? '\n\n所有配置信息（包括API密钥和密码）已完整导入。' : '\n\n注意：如果配置中缺少API密钥和密码，请手动补充。'}`
        : `✅ Configuration imported successfully!${hasCredentials ? '\n\nAll configuration information (including API keys and passwords) has been imported completely.' : '\n\nNote: If API keys and passwords are missing from the configuration, please add them manually.'}`
      );
    } catch (error) {
      console.error('Import failed:', error);
      alert(language === 'zh'
        ? `❌ 导入失败: ${error instanceof Error ? error.message : '未知错误'}`
        : `❌ Import failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setBackupStatus('idle');
      // 清除文件输入
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const presetAIConfigs = [
    {
      name: 'OpenAI GPT-3.5',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-3.5-turbo',
    },
    {
      name: 'OpenAI GPT-4',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
    },
    {
      name: 'Anthropic Claude',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-3-sonnet-20240229',
    },
  ];

  const presetWebDAVConfigs = [
    {
      name: 'Nextcloud',
      url: 'https://your-nextcloud.com/remote.php/dav/files/username',
      path: '/github-stars-backup',
    },
    {
      name: 'ownCloud',
      url: 'https://your-owncloud.com/remote.php/webdav',
      path: '/github-stars-backup',
    },
    {
      name: '坚果云',
      url: 'https://dav.jianguoyun.com/dav',
      path: '/github-stars-backup',
    },
  ];

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          {t('设置', 'Settings')}
        </h2>
        <p className="text-gray-600 dark:text-gray-400">
          {t('配置您的AI服务、WebDAV备份和应用程序偏好', 'Configure your AI services, WebDAV backup, and application preferences')}
        </p>
      </div>

      {/* Configuration Import/Export Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 bg-indigo-100 dark:bg-indigo-900 rounded-lg">
            <Settings className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('配置管理', 'Configuration Management')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('导入和导出您的应用配置', 'Import and export your application configurations')}
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-4">
          <button
            onClick={handleExportConfig}
            disabled={backupStatus !== 'idle'}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-4 h-4" />
            <span>
              {backupStatus === 'exporting' 
                ? t('导出中...', 'Exporting...')
                : t('导出配置', 'Export Configuration')
              }
            </span>
          </button>
          
          <button
            onClick={handleImportConfig}
            disabled={backupStatus !== 'idle'}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileUp className="w-4 h-4" />
            <span>
              {backupStatus === 'importing' 
                ? t('导入中...', 'Importing...')
                : t('导入配置', 'Import Configuration')
              }
            </span>
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileImport}
          className="hidden"
        />

        <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <div className="flex items-start space-x-2">
            <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-blue-700 dark:text-blue-300">
              <p className="font-medium mb-1">{t('配置导入导出说明', 'Configuration Import/Export Notes')}</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>{t('导出的配置文件包含完整的API密钥和密码信息', 'Exported configuration files contain complete API keys and password information')}</li>
                <li>{t('请妥善保管导出的配置文件，避免泄露敏感信息', 'Please keep exported configuration files secure to avoid leaking sensitive information')}</li>
                <li>{t('导入配置将完整恢复所有设置，包括敏感信息', 'Importing configuration will completely restore all settings, including sensitive information')}</li>
                <li>{t('建议定期导出配置作为备份', 'It is recommended to export configuration regularly as backup')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Language Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg">
            <Globe className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('语言设置', 'Language Settings')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('选择界面语言和AI分析语言', 'Choose interface language and AI analysis language')}
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {t('界面语言', 'Interface Language')}
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'zh' | 'en')}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="zh">中文</option>
              <option value="en">English</option>
            </select>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t(
              '此设置将影响界面显示语言和AI分析生成的标签、描述的语言。',
              'This setting affects the interface display language and the language of AI-generated tags and descriptions.'
            )}
          </p>
        </div>
      </div>

      {/* GitHub Token Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center space-x-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 bg-gray-100 dark:bg-gray-700 rounded-lg">
            <Key className="w-5 h-5 text-gray-600 dark:text-gray-400" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {t('GitHub访问令牌', 'GitHub Access Token')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('用于GitHub API的个人访问令牌', 'Personal access token for GitHub API')}
            </p>
          </div>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center space-x-3">
            <input
              type="password"
              placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
              value={githubToken || ''}
              onChange={(e) => setGitHubToken(e.target.value)}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <span className={`px-3 py-2 rounded-lg text-sm ${
              githubToken 
                ? 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300'
                : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
            }`}>
              {githubToken ? t('已连接', 'Connected') : t('未设置', 'Not Set')}
            </span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t('在', 'Create a personal access token at')}{' '}
            <a 
              href="https://github.com/settings/tokens" 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t('GitHub设置', 'GitHub Settings')}
            </a>{' '}
            {t('创建个人访问令牌，需要\'repo\'和\'user\'权限。', 'with \'repo\' and \'user\' scopes.')}
          </p>
        </div>
      </div>

      {/* WebDAV Backup Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-green-100 dark:bg-green-900 rounded-lg">
              <Cloud className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('WebDAV备份', 'WebDAV Backup')}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('配置WebDAV服务器以备份和恢复数据', 'Configure WebDAV server for data backup and restore')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddingWebDAVConfig(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t('添加WebDAV', 'Add WebDAV')}</span>
          </button>
        </div>

        {/* WebDAV Status and Actions */}
        {webdavConfigs.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${
                  activeWebDAVConfig ? 'bg-green-500' : 'bg-gray-400'
                }`}></div>
                <span className="text-sm font-medium text-gray-900 dark:text-white">
                  {activeWebDAVConfig 
                    ? t('WebDAV已配置', 'WebDAV Configured')
                    : t('WebDAV未激活', 'WebDAV Not Active')
                  }
                </span>
                {lastBackup && (
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {t('上次备份:', 'Last backup:')} {new Date(lastBackup).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={handleBackupToWebDAV}
                  disabled={!activeWebDAVConfig || backupStatus !== 'idle'}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  <span>
                    {backupStatus === 'backing-up' 
                      ? t('备份中...', 'Backing up...')
                      : t('备份', 'Backup')
                    }
                  </span>
                </button>
                <button
                  onClick={handleRestoreFromWebDAV}
                  disabled={!activeWebDAVConfig || backupStatus !== 'idle'}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 rounded-lg hover:bg-orange-200 dark:hover:bg-orange-800 transition-colors text-sm disabled:opacity-50"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {backupStatus === 'restoring' 
                      ? t('恢复中...', 'Restoring...')
                      : t('恢复', 'Restore')
                    }
                  </span>
                </button>
              </div>
            </div>

            {/* CORS Warning */}
            <div className="flex items-start space-x-3 p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <AlertTriangle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-yellow-800 dark:text-yellow-200 mb-1">
                  {t('重要提示：CORS配置', 'Important: CORS Configuration')}
                </p>
                <p className="text-yellow-700 dark:text-yellow-300">
                  {t(
                    '如果遇到连接错误，请确保您的WebDAV服务器配置了正确的CORS头。点击测试连接按钮查看详细的错误信息和解决方案。',
                    'If you encounter connection errors, ensure your WebDAV server is configured with proper CORS headers. Click the test connection button for detailed error messages and solutions.'
                  )}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Existing WebDAV Configurations */}
        <div className="space-y-4">
          {webdavConfigs.map(config => (
            <div
              key={config.id}
              className={`p-4 border rounded-lg transition-colors ${
                config.id === activeWebDAVConfig
                  ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              {editingWebDAVConfigId === config.id ? (
                // Edit mode
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('配置名称', 'Configuration Name')} *
                      </label>
                      <input
                        type="text"
                        value={editingWebDAVConfig.name || ''}
                        onChange={(e) => setEditingWebDAVConfig(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('用户名', 'Username')} *
                      </label>
                      <input
                        type="text"
                        value={editingWebDAVConfig.username || ''}
                        onChange={(e) => setEditingWebDAVConfig(prev => ({ ...prev, username: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('WebDAV服务器URL', 'WebDAV Server URL')} *
                    </label>
                    <input
                      type="url"
                      value={editingWebDAVConfig.url || ''}
                      onChange={(e) => setEditingWebDAVConfig(prev => ({ ...prev, url: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('密码', 'Password')} *
                      </label>
                      <input
                        type="password"
                        value={editingWebDAVConfig.password || ''}
                        onChange={(e) => setEditingWebDAVConfig(prev => ({ ...prev, password: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('备份路径', 'Backup Path')} *
                      </label>
                      <input
                        type="text"
                        value={editingWebDAVConfig.path || ''}
                        onChange={(e) => setEditingWebDAVConfig(prev => ({ ...prev, path: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleSaveEditingWebDAVConfig}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                    >
                      <Check className="w-4 h-4" />
                      <span>{t('保存', 'Save')}</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditingWebDAVConfigId(null);
                        setEditingWebDAVConfig({});
                      }}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                    >
                      <X className="w-4 h-4" />
                      <span>{t('取消', 'Cancel')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      {config.name}
                      {config.id === activeWebDAVConfig && (
                        <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded text-xs">
                          {t('活跃', 'Active')}
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {config.url} • {config.path}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleTestWebDAVConfig(config)}
                      disabled={testingWebDAVId === config.id}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                    >
                      <TestTube className="w-4 h-4" />
                      <span>{testingWebDAVId === config.id ? t('测试中...', 'Testing...') : t('测试', 'Test')}</span>
                    </button>
                    <button
                      onClick={() => handleEditWebDAVConfig(config)}
                      className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {config.id !== activeWebDAVConfig && (
                      <button
                        onClick={() => handleSetActiveWebDAV(config.id)}
                        className="px-3 py-1.5 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-sm"
                      >
                        {t('设为活跃', 'Set Active')}
                      </button>
                    )}
                    <button
                      onClick={() => deleteWebDAVConfig(config.id)}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add New WebDAV Configuration Form */}
        {isAddingWebDAVConfig && (
          <div className="mt-6 p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-750">
            <h4 className="font-medium text-gray-900 dark:text-white mb-4">
              {t('添加新的WebDAV配置', 'Add New WebDAV Configuration')}
            </h4>
            
            {/* Preset Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('快速设置（可选）', 'Quick Setup (Optional)')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {presetWebDAVConfigs.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => setNewWebDAVConfig(prev => ({
                      ...prev,
                      ...preset,
                    }))}
                    className="p-3 text-left border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <p className="font-medium text-sm text-gray-900 dark:text-white">
                      {preset.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {preset.url}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('配置名称', 'Configuration Name')} *
                </label>
                <input
                  type="text"
                  placeholder={t('我的WebDAV服务器', 'My WebDAV Server')}
                  value={newWebDAVConfig.name || ''}
                  onChange={(e) => setNewWebDAVConfig(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('用户名', 'Username')} *
                </label>
                <input
                  type="text"
                  placeholder="username"
                  value={newWebDAVConfig.username || ''}
                  onChange={(e) => setNewWebDAVConfig(prev => ({ ...prev, username: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('WebDAV服务器URL', 'WebDAV Server URL')} *
              </label>
              <input
                type="url"
                placeholder="https://your-server.com/webdav"
                value={newWebDAVConfig.url || ''}
                onChange={(e) => setNewWebDAVConfig(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('密码', 'Password')} *
                </label>
                <input
                  type="password"
                  placeholder="password"
                  value={newWebDAVConfig.password || ''}
                  onChange={(e) => setNewWebDAVConfig(prev => ({ ...prev, password: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('备份路径', 'Backup Path')} *
                </label>
                <input
                  type="text"
                  placeholder="/github-stars-backup"
                  value={newWebDAVConfig.path || ''}
                  onChange={(e) => setNewWebDAVConfig(prev => ({ ...prev, path: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleSaveWebDAVConfig}
                className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{t('保存配置', 'Save Configuration')}</span>
              </button>
              <button
                onClick={() => {
                  setIsAddingWebDAVConfig(false);
                  setNewWebDAVConfig({
                    name: '',
                    url: '',
                    username: '',
                    password: '',
                    path: '/github-stars-backup',
                  });
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>{t('取消', 'Cancel')}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* AI Configurations Section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="flex items-center justify-center w-10 h-10 bg-purple-100 dark:bg-purple-900 rounded-lg">
              <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('AI配置', 'AI Configurations')}
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t('管理用于仓库分析的AI服务配置', 'Manage your AI service configurations for repository analysis')}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsAddingAIConfig(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t('添加配置', 'Add Configuration')}</span>
          </button>
        </div>

        {/* Existing AI Configurations */}
        <div className="space-y-4">
          {aiConfigs.map(config => (
            <div
              key={config.id}
              className={`p-4 border rounded-lg transition-colors ${
                config.id === activeAIConfig
                  ? 'border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-950'
                  : 'border-gray-200 dark:border-gray-600'
              }`}
            >
              {editingAIConfigId === config.id ? (
                // Edit mode
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('配置名称', 'Configuration Name')}
                      </label>
                      <input
                        type="text"
                        value={editingAIConfig.name || ''}
                        onChange={(e) => setEditingAIConfig(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        {t('模型', 'Model')}
                      </label>
                      <input
                        type="text"
                        value={editingAIConfig.model || ''}
                        onChange={(e) => setEditingAIConfig(prev => ({ ...prev, model: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('API基础URL', 'API Base URL')}
                    </label>
                    <input
                      type="url"
                      value={editingAIConfig.baseUrl || ''}
                      onChange={(e) => setEditingAIConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      {t('API密钥', 'API Key')}
                    </label>
                    <input
                      type="password"
                      value={editingAIConfig.apiKey || ''}
                      onChange={(e) => setEditingAIConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={handleSaveEditingAIConfig}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
                    >
                      <Check className="w-4 h-4" />
                      <span>{t('保存', 'Save')}</span>
                    </button>
                    <button
                      onClick={() => {
                        setEditingAIConfigId(null);
                        setEditingAIConfig({});
                      }}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                    >
                      <X className="w-4 h-4" />
                      <span>{t('取消', 'Cancel')}</span>
                    </button>
                  </div>
                </div>
              ) : (
                // View mode
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">
                      {config.name}
                      {config.id === activeAIConfig && (
                        <span className="ml-2 px-2 py-1 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded text-xs">
                          {t('活跃', 'Active')}
                        </span>
                      )}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {config.baseUrl} • {config.model}
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleTestAIConfig(config)}
                      disabled={testingConfigId === config.id}
                      className="flex items-center space-x-2 px-3 py-1.5 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm"
                    >
                      <TestTube className="w-4 h-4" />
                      <span>{testingConfigId === config.id ? t('测试中...', 'Testing...') : t('测试', 'Test')}</span>
                    </button>
                    <button
                      onClick={() => handleEditAIConfig(config)}
                      className="p-1.5 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition-colors"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    {config.id !== activeAIConfig && (
                      <button
                        onClick={() => handleSetActiveAI(config.id)}
                        className="px-3 py-1.5 bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 rounded-lg hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors text-sm"
                      >
                        {t('设为活跃', 'Set Active')}
                      </button>
                    )}
                    <button
                      onClick={() => deleteAIConfig(config.id)}
                      className="p-1.5 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add New AI Configuration Form */}
        {isAddingAIConfig && (
          <div className="mt-6 p-4 border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-750">
            <h4 className="font-medium text-gray-900 dark:text-white mb-4">
              {t('添加新的AI配置', 'Add New AI Configuration')}
            </h4>
            
            {/* Preset Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('快速设置（可选）', 'Quick Setup (Optional)')}
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {presetAIConfigs.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => setNewAIConfig(prev => ({
                      ...prev,
                      ...preset,
                    }))}
                    className="p-3 text-left border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <p className="font-medium text-sm text-gray-900 dark:text-white">
                      {preset.name}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {preset.model}
                    </p>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('配置名称', 'Configuration Name')}
                </label>
                <input
                  type="text"
                  placeholder={t('我的OpenAI配置', 'My OpenAI Config')}
                  value={newAIConfig.name || ''}
                  onChange={(e) => setNewAIConfig(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  {t('模型', 'Model')}
                </label>
                <input
                  type="text"
                  placeholder="gpt-3.5-turbo"
                  value={newAIConfig.model || ''}
                  onChange={(e) => setNewAIConfig(prev => ({ ...prev, model: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                />
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('API基础URL', 'API Base URL')}
              </label>
              <input
                type="url"
                placeholder="https://api.openai.com/v1"
                value={newAIConfig.baseUrl || ''}
                onChange={(e) => setNewAIConfig(prev => ({ ...prev, baseUrl: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {t('API密钥', 'API Key')}
              </label>
              <input
                type="password"
                placeholder="sk-xxxxxxxxxxxxxxxxxxxx"
                value={newAIConfig.apiKey || ''}
                onChange={(e) => setNewAIConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleSaveAIConfig}
                className="flex items-center space-x-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                <Save className="w-4 h-4" />
                <span>{t('保存配置', 'Save Configuration')}</span>
              </button>
              <button
                onClick={() => {
                  setIsAddingAIConfig(false);
                  setNewAIConfig({
                    name: '',
                    baseUrl: 'https://api.openai.com/v1',
                    apiKey: '',
                    model: 'gpt-3.5-turbo',
                  });
                }}
                className="flex items-center space-x-2 px-4 py-2 bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <X className="w-4 h-4" />
                <span>{t('取消', 'Cancel')}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};