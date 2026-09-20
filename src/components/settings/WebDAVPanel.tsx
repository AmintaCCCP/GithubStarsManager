
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React, { useState } from 'react';
import { Cloud, Plus, Edit3, Trash2, Save, X, TestTube, RefreshCw } from 'lucide-react';
import { WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useWebDAVActions } from '../../features/settings/hooks/useWebDAVActions';
import { useDialog } from '../../hooks/useDialog';

interface WebDAVPanelProps {
  t: TranslateFn;
}

export const WebDAVPanel: React.FC<WebDAVPanelProps> = ({ t }) => {
  const {
    webdavConfigs,
    activeWebDAVConfig,
    deleteWebDAVConfig,
    setActiveWebDAVConfig,
  } = useAppStore(useShallow((state) => ({
    webdavConfigs: state.webdavConfigs,
    activeWebDAVConfig: state.activeWebDAVConfig,
    deleteWebDAVConfig: state.deleteWebDAVConfig,
    setActiveWebDAVConfig: state.setActiveWebDAVConfig,
  })));

  const { confirm } = useDialog();
  const { testingId, save, test } = useWebDAVActions({ t });

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

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
    if (save(form, editingId)) resetForm();
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

  const handleTest = (config: WebDAVConfig) => test(config);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Cloud className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('webDAVPanel.webdav-configuration')}
          </h3>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>{t('webDAVPanel.add-webdav')}</span>
        </Button>
      </div>

      {showForm && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <h4 className="font-medium text-foreground dark:text-foreground mb-4">
            {editingId ? t('webDAVPanel.edit-webdav-configuration') : t('webDAVPanel.add-webdav-configuration')}
          </h4>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label htmlFor="webdav-name" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('webDAVPanel.configuration-name')} *
              </label>
              <Input
                id="webdav-name"
                type="text"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('webDAVPanel.e-g-nutstore')}
              />
            </div>
            
            <div>
              <label htmlFor="webdav-url" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('webDAVPanel.webdav-url')} *
              </label>
              <Input
                id="webdav-url"
                type="url"
                value={form.url}
                onChange={(e) => setForm(prev => ({ ...prev, url: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder="https://dav.jianguoyun.com/dav/"
              />
            </div>
            
            <div>
              <label htmlFor="webdav-username" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('webDAVPanel.username')} *
              </label>
              <Input
                id="webdav-username"
                type="text"
                value={form.username}
                onChange={(e) => setForm(prev => ({ ...prev, username: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('webDAVPanel.webdav-username')}
              />
            </div>
            
            <div>
              <label htmlFor="webdav-password" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('webDAVPanel.password')} *
              </label>
              <Input
                id="webdav-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm(prev => ({ ...prev, password: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
                placeholder={t('webDAVPanel.webdav-password')}
              />
            </div>
            
            <div className="md:col-span-2">
              <label htmlFor="webdav-path" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-1">
                {t('webDAVPanel.path')} *
              </label>
              <Input
                id="webdav-path"
                type="text"
                value={form.path}
                onChange={(e) => setForm(prev => ({ ...prev, path: e.target.value }))}
                className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
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
              <span>{t('webDAVPanel.save')}</span>
            </Button>
            <Button
              onClick={resetForm}
              className="flex items-center space-x-2 px-4 py-2 bg-muted hover:bg-accent dark:bg-muted/40 dark:hover:bg-accent text-foreground dark:text-foreground rounded-lg border border-border dark:border-border transition-colors"
            >
              <X className="w-4 h-4" />
              <span>{t('webDAVPanel.cancel')}</span>
            </Button>
          </div>
        </div>
      )}

      <RadioGroup
        value={activeWebDAVConfig || ''}
        onValueChange={setActiveWebDAVConfig}
        aria-label={t('webDAVPanel.active-webdav-configuration')}
        className="space-y-3"
      >
        {webdavConfigs.map(config => (
          <div
            key={config.id}
            className={`p-4 rounded-lg border transition-colors ${
              config.id === activeWebDAVConfig
                ? 'border-border bg-accent/50 dark:border-border/[0.12] dark:bg-accent/60'
                : 'border-border dark:border-border hover:border-border dark:hover:border-border-strong'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <RadioGroupItem
                  value={config.id}
                  id={`active-webdav-${config.id}`}
                  aria-label={config.name || t('webDAVPanel.webdav-configuration-2')}
                />
                <div>
                  <h4 className="font-medium text-foreground dark:text-foreground">{config.name}</h4>
                  <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                    {config.url} • {config.path}
                  </p>
                  {config.passwordStatus === 'decrypt_failed' && (
                    <p className="mt-1 text-sm text-muted-foreground dark:text-muted-foreground ">
                      {t('webDAVPanel.the-stored-webdav-password-could-not-be-decrypte')}
                    </p>
                  )}
                </div>
              </div>
              
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => handleTest(config)}
                  disabled={testingId === config.id}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors disabled:opacity-50"
                  aria-label={t('webDAVPanel.test-connection')}
                  title={t('webDAVPanel.test-connection')}
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
                  aria-label={t('webDAVPanel.edit')}
                  title={t('webDAVPanel.edit')}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
                <Button
                  onClick={async () => {
                    const confirmed = await confirm(
                      t('webDAVPanel.delete-webdav-configuration'),
                      t('webDAVPanel.this-action-cannot-be-undone'),
                      { type: 'danger', confirmText: t('webDAVPanel.delete') }
                    );
                    if (confirmed) {
                      deleteWebDAVConfig(config.id);
                    }
                  }}
                  className="p-2 rounded-lg bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground transition-colors"
                  aria-label={t('webDAVPanel.delete')}
                  title={t('webDAVPanel.delete')}
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
            <p>{t('webDAVPanel.no-webdav-services-configured-yet')}</p>
            <p className="text-sm">{t('webDAVPanel.click-the-button-above-to-add-webdav-configurati')}</p>
          </div>
        )}
    </div>
  );
};
