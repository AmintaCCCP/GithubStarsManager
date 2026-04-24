import React, { useState } from 'react';
import { Cloud, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw } from 'lucide-react';
import { WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { WebDAVService } from '../../services/webdavService';

interface WebDAVPanelProps {
  t: (zh: string, en: string) => string;
}

export const WebDAVPanel: React.FC<WebDAVPanelProps> = ({ t }) => {
  const {
    webdavConfigs,
    activeWebDAVConfig,
    addWebDAVConfig,
    updateWebDAVConfig,
    deleteWebDAVConfig,
    setActiveWebDAVConfig,
  } = useAppStore();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const [form, setForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    path: '/',
  });

  const resetForm = () => {
    setForm({
      name: '',
      url: '',
      username: '',
      password: '',
      path: '/',
    });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = () => {
    const errors = WebDAVService.validateConfig(form);
    if (errors.length > 0) {
      const translated = errors.map(err => {
        if (err === 'WebDAV URL是必需的') return t('WebDAV URL是必需的', 'WebDAV URL is required');
        if (err === 'WebDAV URL必须以 http:// 或 https:// 开头') return t('WebDAV URL必须以 http:// 或 https:// 开头', 'WebDAV URL must start with http:// or https://');
        if (err === '用户名是必需的') return t('用户名是必需的', 'Username is required');
        if (err === '密码是必需的') return t('密码是必需的', 'Password is required');
        if (err === '路径是必需的') return t('路径是必需的', 'Path is required');
        if (err === '路径必须以 / 开头') return t('路径必须以 / 开头', 'Path must start with /');
        return err;
      });
      alert(translated.join('\n'));
      return;
    }

    // When editing, preserve existing isActive value from current config
    const existingConfig = editingId ? webdavConfigs.find(c => c.id === editingId) : undefined;
    const config: WebDAVConfig = {
      id: editingId || Date.now().toString(),
      name: form.name,
      url: form.url.replace(/\/$/, ''),
      username: form.username,
      password: form.password,
      path: form.path,
      isActive: existingConfig?.isActive ?? false,
    };

    if (editingId) {
      updateWebDAVConfig(editingId, config);
    } else {
      addWebDAVConfig(config);
    }

    resetForm();
  };

  const handleEdit = (config: WebDAVConfig) => {
    setForm({
      name: config.name,
      url: config.url,
      username: config.username,
      password: config.password,
      path: config.path,
    });
    setEditingId(config.id);
    setShowForm(true);
  };

  const handleTest = async (config: WebDAVConfig) => {
    setTestingId(config.id);
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
      alert(`${t('WebDAV测试失败', 'WebDAV test failed')}: ${(error as Error).message}`);
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Cloud className="w-6 h-6 text-blue-600 dark:text-brand-violet" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('WebDAV配置', 'WebDAV Configuration')}
          </h3>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加WebDAV', 'Add WebDAV')}</span>
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-gray-50 dark:bg-white/[0.04] rounded-lg border border-gray-200 dark:border-white/8">
          <h4 className="font-medium text-gray-900 dark:text-text-primary mb-4">
            {editingId ? t('编辑WebDAV配置', 'Edit WebDAV Configuration') : t('添加WebDAV配置', 'Add WebDAV Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-white/8 rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('例如: 坚果云', 'e.g., Nutstore')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('WebDAV URL', 'WebDAV URL')} *
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-white/8 rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('用户名', 'Username')} *
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-white/8 rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('WebDAV用户名', 'WebDAV username')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('密码', 'Password')} *
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-white/8 rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('WebDAV密码', 'WebDAV password')}
              />
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('路径', 'Path')} *
              </label>
              <input
                type="text"
                value={form.path}
                onChange={(e) => setForm(prev => ({ ...prev, path: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-white/8 rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="/github-stars-manager/"
              />
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {webdavConfigs.map(config => (
          <div
            key={config.id}
            className={`p-4 rounded-lg border transition-colors ${
              config.id === activeWebDAVConfig
                ? 'border-blue-300 bg-blue-50 dark:border-blue-600 dark:bg-blue-900/20'
                : 'border-gray-200 dark:border-white/8 hover:border-gray-300 dark:hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="activeWebDAV"
                  checked={config.id === activeWebDAVConfig}
                  onChange={() => setActiveWebDAVConfig(config.id)}
                  className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/8"
                />
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-text-primary">{config.name}</h4>
                  <p className="text-sm text-gray-500 dark:text-text-tertiary">
                    {config.url} • {config.path}
                  </p>
                  {config.passwordStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                      {t(
                        '存储的 WebDAV 密码无法解密，请重新输入并保存该配置。',
                        'The stored WebDAV password could not be decrypted. Please re-enter and save this configuration.'
                      )}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleTest(config)}
                  disabled={testingId === config.id}
                  className="p-2 rounded-lg bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-brand-violet hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors disabled:opacity-50"
                  title={t('测试连接', 'Test Connection')}
                >
                  {testingId === config.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                </button>
                <button
                  onClick={() => handleEdit(config)}
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
          <div className="text-center py-8 text-gray-500 dark:text-text-tertiary">
            <Cloud className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('还没有配置WebDAV服务', 'No WebDAV services configured yet')}</p>
            <p className="text-sm">{t('点击上方按钮添加WebDAV配置', 'Click the button above to add WebDAV configuration')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
