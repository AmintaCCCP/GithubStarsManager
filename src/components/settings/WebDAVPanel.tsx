import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React, { useState } from 'react';
import { Cloud, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw } from 'lucide-react';
import { WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { WebDAVService } from '../../services/webdavService';
import { useDialog } from '../../hooks/useDialog';

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

  const { toast, confirm } = useDialog();

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
      toast(translated.join('\n'), 'error');
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
        toast(t('WebDAV连接成功！', 'WebDAV connection successful!'), 'success');
      } else {
        toast(t('WebDAV连接失败，请检查配置。', 'WebDAV connection failed. Please check configuration.'), 'error');
      }
    } catch (error) {
      console.error('WebDAV test failed:', error);
      toast(`${t('WebDAV测试失败', 'WebDAV test failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Cloud className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('WebDAV配置', 'WebDAV Configuration')}
          </h3>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('添加WebDAV', 'Add WebDAV')}</span>
        </Button>
      </div>

      {showForm && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <h4 className="font-medium text-foreground dark:text-foreground mb-4">
            {editingId ? t('编辑WebDAV配置', 'Edit WebDAV Configuration') : t('添加WebDAV配置', 'Add WebDAV Configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('配置名称', 'Configuration Name')} *
              </label>
              <Input
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('例如: 坚果云', 'e.g., Nutstore')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('WebDAV URL', 'WebDAV URL')} *
              </label>
              <Input
                type="url"
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('用户名', 'Username')} *
              </label>
              <Input
                type="text"
                value={form.username}
                onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('WebDAV用户名', 'WebDAV username')}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('密码', 'Password')} *
              </label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('WebDAV密码', 'WebDAV password')}
              />
            </div>
            
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('路径', 'Path')} *
              </label>
              <Input
                type="text"
                value={form.path}
                onChange={(e) => setForm(prev => ({ ...prev, path: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-white dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder="/github-stars-manager/"
              />
            </div>
          </div>

          <div className="flex space-x-3">
            <Button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{t('保存', 'Save')}</span>
            </Button>
            <Button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent dark:bg-muted/40 dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:border-border transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('取消', 'Cancel')}</span>
            </Button>
          </div>
        </div>
      )}

      <RadioGroup value={activeWebDAVConfig || ''} onValueChange={setActiveWebDAVConfig} className="space-y-3">
        {webdavConfigs.map(config => (
          <div
            key={config.id}
            className={`p-4 rounded-lg border transition-colors ${
              config.id === activeWebDAVConfig
                ? 'border-gray-300 bg-accent/50 dark:border-white/[0.12] dark:bg-accent/60'
                : 'border-border dark:border-border hover:border-border dark:hover:border-white/[0.08]'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value={config.id}
                  id={`active-webdav-${config.id}`}
                  aria-label={config.name || t('WebDAV 配置', 'WebDAV configuration')}
                />
                <div>
                  <h4 className="font-medium text-foreground dark:text-foreground">{config.name}</h4>
                  <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                    {config.url} • {config.path}
                  </p>
                  {config.passwordStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground ">
                      {t(
                        '存储的 WebDAV 密码无法解密，请重新输入并保存该配置。',
                        'The stored WebDAV password could not be decrypted. Please re-enter and save this configuration.'
                      )}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => handleTest(config)}
                  disabled={testingId === config.id}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors disabled:opacity-50"
                  title={t('测试连接', 'Test Connection')}
                >
                  {testingId === config.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <TestTube className="w-4 h-4" />
                  )}
                </Button>
                <Button
                  onClick={() => handleEdit(config)}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
                  title={t('编辑', 'Edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('确定要删除这个WebDAV配置吗？', 'Delete WebDAV Configuration?'),
                      t('此操作无法撤销。', 'This action cannot be undone.'),
                      { type: 'danger', confirmText: t('删除', 'Delete') }
                    );
                    if (confirmed) {
                      deleteWebDAVConfig(config.id);
                    }
                  }}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
                  title={t('删除', 'Delete')}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </RadioGroup>
        {webdavConfigs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground dark:text-muted-foreground">
            <Cloud className="w-12 h-12 mx-auto mb-3 opacity-50" />
            <p>{t('还没有配置WebDAV服务', 'No WebDAV services configured yet')}</p>
            <p className="text-sm">{t('点击上方按钮添加WebDAV配置', 'Click the button above to add WebDAV configuration')}</p>
          </div>
        )}
    </div>
  );
};
