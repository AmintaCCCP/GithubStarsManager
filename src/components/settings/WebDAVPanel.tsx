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
          <Cloud className="w-6 h-6 text-brand-violet dark:text-brand-violet" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
            {t('WebDAV配置', 'WebDAV Configuration')}
          </h3>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加WebDAV', 'Add WebDAV')}</span>
        </button>
      </div>

      {showForm && (
        <div className="p-4 bg-light-bg dark:bg-white/[0.04] rounded-lg border border-black/[0.06] dark:border-white/[0.04]">
          <h4 className="font-medium text-gray-900 dark:text-text-primary mb-4">
            {editingId ? t('编辑WebDAV配置', 'Edit WebDAV Configuration') : t('添加WebDAV配置', 'Add WebDAV Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('例如: 坚果云', 'e.g., Nutstore')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('WebDAV URL', 'WebDAV URL')} *
              </label>
              <input
                type="url"
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('用户名', 'Username')} *
              </label>
              <input
                type="text"
                value={form.username}
                onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('WebDAV用户名', 'WebDAV username')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('密码', 'Password')} *
              </label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder={t('WebDAV密码', 'WebDAV password')}
              />
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-900 dark:text-text-secondary mb-1">
                {t('路径', 'Path')} *
              </label>
              <input
                type="text"
                value={form.path}
                onChange={(e) => setForm(prev => ({ ...prev, path: e.target.value }))}
                className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg bg-white dark:bg-panel-dark text-gray-900 dark:text-text-primary"
                placeholder="/github-stars-manager/"
              />
            </div>
          </div>

          <div className="flex space-x-3">
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </button>
            <button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-light-surface hover:bg-gray-200 dark:bg-white/[0.04] dark:hover:bg-white/[0.08] text-gray-900 dark:text-text-primary rounded-lg border border-black/[0.06] dark:border-white/[0.04] transition-colors"
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
                ? 'border-brand-violet bg-brand-indigo/10 dark:border-brand-violet/50 dark:bg-brand-indigo/20'
                : 'border-black/[0.06] dark:border-white/[0.04] hover:border-black/[0.06] dark:hover:border-gray-500'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <input
                  type="radio"
                  name="activeWebDAV"
                  checked={config.id === activeWebDAVConfig}
                  onChange={() => setActiveWebDAVConfig(config.id)}
                  className="w-4 h-4 text-brand-violet bg-light-surfaceborder-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
                />
                <div>
                  <h4 className="font-medium text-gray-900 dark:text-text-primary">{config.name}</h4>
                  <p className="text-sm text-gray-500 dark:text-text-tertiary">
                    {config.url} • {config.path}
                  </p>
                  {config.passwordStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-gray-700 dark:text-text-secondary ">
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
                  className="p-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors disabled:opacity-50"
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
                  className="p-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
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
                  className="p-2 rounded-lg bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary transition-colors"
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
