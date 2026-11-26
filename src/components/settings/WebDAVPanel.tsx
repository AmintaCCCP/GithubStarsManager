import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React, { useRef, useState } from 'react';
import { Check, Cloud, Plus, Edit3, Trash2, X, Plug, RefreshCw } from 'lucide-react';
import { WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useWebDAVActions } from '../../features/settings/hooks/useWebDAVActions';
import { useDialog } from '../../hooks/useDialog';
import { Modal } from '../Modal';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsPageStack,
  SettingsSection,
} from './SettingsPrimitives';

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
  const { testingId, save, test } = useWebDAVActions();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 弹窗没有 DialogTrigger，Radix 会把焦点丢到 body；关闭时还给打开它的按钮。
  const openerRef = useRef<HTMLElement | null>(null);

  const [form, setForm] = useState({
    name: '',
    url: '',
    username: '',
    password: '',
    path: '/',
    customUserAgent: '',
  });

  const resetForm = () => {
    setForm({
      name: '',
      url: '',
      username: '',
      password: '',
      path: '/',
      customUserAgent: '',
    });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSave = () => {
    if (save(form, editingId)) resetForm();
  };

  const handleAdd = (opener: HTMLElement) => {
    openerRef.current = opener;
    resetForm();
    setShowForm(true);
  };

  const handleClose = () => {
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
    resetForm();
  };

  const handleCloseAutoFocus = (event: Event) => {
    if (openerRef.current?.isConnected) event.preventDefault();
    handleClose();
  };

  const handleEdit = (config: WebDAVConfig, opener: HTMLElement) => {
    openerRef.current = opener;
    setForm({
      name: config.name,
      url: config.url,
      username: config.username,
      password: config.password,
      path: config.path,
      customUserAgent: config.customUserAgent ?? '',
    });
    setEditingId(config.id);
    setShowForm(true);
  };

  const handleTest = (config: WebDAVConfig) => test(config);

  return (
    <SettingsPageStack>
      <SettingsSection
        title={t('webDAVPanel.active-webdav-configuration')}
        actions={(
          <div className="flex items-center gap-2">
            {showForm && (
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                <X className="size-3.5" />
                <span>{t('webDAVPanel.cancel')}</span>
              </Button>
            )}
            <Button type="button" variant="primary" size="sm" onClick={(event) => handleAdd(event.currentTarget)}>
              <Plus className="size-3.5" />
              <span>{t('webDAVPanel.add-webdav')}</span>
            </Button>
          </div>
        )}
      >
        {webdavConfigs.length === 0 ? (
          <SettingsCard className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Cloud className="size-10 text-tertiary stroke-[1.5]" aria-hidden="true" />
            <p className="text-label font-medium text-foreground">
              {t('webDAVPanel.no-webdav-services-configured-yet')}
            </p>
            <p className="max-w-sm text-label-sm text-secondary">
              {t('webDAVPanel.click-the-button-above-to-add-webdav-configurati')}
            </p>
          </SettingsCard>
        ) : (
          <SettingsCard>
            <RadioGroup
              value={activeWebDAVConfig || ''}
              onValueChange={setActiveWebDAVConfig}
              aria-label={t('webDAVPanel.active-webdav-configuration')}
              className="gap-0"
            >
              {webdavConfigs.map((config, index) => {
                const isSelected = config.id === activeWebDAVConfig;
                return (
                  <React.Fragment key={config.id}>
                    {index > 0 && <SettingsDivider />}
                    <div
                      className={cn(
                        'flex min-h-14 items-center justify-between gap-4 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant',
                        isSelected && 'bg-fill-selected/50',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <RadioGroupItem
                          value={config.id}
                          id={`active-webdav-${config.id}`}
                          aria-label={config.name || t('webDAVPanel.webdav-configuration-2')}
                        />
                        <div className="min-w-0 flex-1">
                          <h4 className="truncate text-label font-medium text-foreground">{config.name}</h4>
                          <p className="mt-px truncate text-label-sm text-secondary">
                            {config.url} • {config.path}
                          </p>
                          {config.passwordStatus === 'decrypt_failed' && (
                            <p className="mt-1 text-label-sm text-warning">
                              {t('webDAVPanel.the-stored-webdav-password-could-not-be-decrypte')}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleTest(config)}
                          disabled={testingId === config.id}
                          aria-label={t('webDAVPanel.test-connection')}
                          title={t('webDAVPanel.test-connection')}
                        >
                          {testingId === config.id ? (
                            <RefreshCw className="size-4 animate-spin text-secondary" />
                          ) : (
                            <Plug className="size-4 text-secondary" />
                          )}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={(event) => handleEdit(config, event.currentTarget)}
                          aria-label={t('webDAVPanel.edit')}
                          title={t('webDAVPanel.edit')}
                        >
                          <Edit3 className="size-4 text-secondary" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={async () => {
                            const confirmed = await confirm(
                              t('webDAVPanel.delete-webdav-configuration'),
                              t('webDAVPanel.this-action-cannot-be-undone'),
                              { type: 'danger', confirmText: t('webDAVPanel.delete') },
                            );
                            if (confirmed) {
                              deleteWebDAVConfig(config.id);
                            }
                          }}
                          aria-label={t('webDAVPanel.delete')}
                          title={t('webDAVPanel.delete')}
                          className="text-destructive hover:bg-destructive-tint hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </RadioGroup>
          </SettingsCard>
        )}
      </SettingsSection>

      <Modal
        isOpen={showForm}
        onClose={handleClose}
        onCloseAutoFocus={handleCloseAutoFocus}
        title={editingId ? t('webDAVPanel.edit-webdav-configuration') : t('webDAVPanel.add-webdav-configuration')}
        maxWidth="max-w-2xl"
        scrollable
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="md" onClick={handleClose}>
              <X className="size-4" />
              <span>{t('webDAVPanel.cancel')}</span>
            </Button>
            <Button type="button" variant="primary" size="md" onClick={handleSave}>
              <Check className="size-4" />
              <span>{t('webDAVPanel.save')}</span>
            </Button>
          </div>
        )}
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="webdav-name" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.configuration-name')} *
            </label>
            <Input
              id="webdav-name"
              type="text"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder={t('webDAVPanel.e-g-nutstore')}
            />
          </div>

          <div>
            <label htmlFor="webdav-url" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.webdav-url')} *
            </label>
            <Input
              id="webdav-url"
              type="url"
              value={form.url}
              onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              placeholder="https://dav.jianguoyun.com/dav/"
            />
          </div>

          <div>
            <label htmlFor="webdav-username" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.username')} *
            </label>
            <Input
              id="webdav-username"
              type="text"
              value={form.username}
              onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
              placeholder={t('webDAVPanel.webdav-username')}
            />
          </div>

          <div>
            <label htmlFor="webdav-password" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.password')} *
            </label>
            <Input
              id="webdav-password"
              type="password"
              value={form.password}
              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
              placeholder={t('webDAVPanel.webdav-password')}
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="webdav-path" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.path')} *
            </label>
            <Input
              id="webdav-path"
              type="text"
              value={form.path}
              onChange={(e) => setForm((prev) => ({ ...prev, path: e.target.value }))}
              placeholder="/github-stars-manager/"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="webdav-custom-user-agent" className="mb-1.5 block text-label font-medium text-foreground">
              {t('webDAVPanel.custom-user-agent')}
            </label>
            <Input
              id="webdav-custom-user-agent"
              type="text"
              value={form.customUserAgent}
              onChange={(e) => setForm((prev) => ({ ...prev, customUserAgent: e.target.value }))}
              placeholder="rclone/v1.68.0"
            />
            <p className="mt-1.5 text-label-sm text-secondary">
              {t('webDAVPanel.custom-user-agent-hint')}
            </p>
          </div>
        </div>
      </Modal>
    </SettingsPageStack>
  );
};
