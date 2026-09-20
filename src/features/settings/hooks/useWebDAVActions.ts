
import { TranslateFn } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { WebDAVService } from '../../../services/webdavService';

interface UseWebDAVActionsOptions {
  t: TranslateFn;
}

export type WebDAVForm = Pick<WebDAVConfig, 'name' | 'url' | 'username' | 'password' | 'path'>;

export interface WebDAVActions {
  testingId: string | null;
  save: (form: WebDAVForm, editingId: string | null) => boolean;
  test: (config: WebDAVConfig) => Promise<void>;
}

/** Keeps WebDAV validation and remote connection work outside the settings view. */
export const useWebDAVActions = ({ t }: UseWebDAVActionsOptions): WebDAVActions => {
  const { webdavConfigs, addWebDAVConfig, updateWebDAVConfig } = useAppStore(useShallow((state) => ({
    webdavConfigs: state.webdavConfigs,
    addWebDAVConfig: state.addWebDAVConfig,
    updateWebDAVConfig: state.updateWebDAVConfig,
  })));
  const { toast } = useDialog();
  const [testingId, setTestingId] = useState<string | null>(null);

  const save = useCallback((form: WebDAVForm, editingId: string | null) => {
    const errors = WebDAVService.validateConfig(form);
    if (errors.length > 0) {
      const translated = errors.map((error) => {
        if (error === 'WebDAV URL是必需的') return t('useWebDAVActions.webdav-url-is-required');
        if (error === 'WebDAV URL必须以 http:// 或 https:// 开头') return t('useWebDAVActions.webdav-url-must-start-with-http-or-https');
        if (error === '用户名是必需的') return t('useWebDAVActions.username-is-required');
        if (error === '密码是必需的') return t('useWebDAVActions.password-is-required');
        if (error === '路径是必需的') return t('useWebDAVActions.path-is-required');
        if (error === '路径必须以 / 开头') return t('useWebDAVActions.path-must-start-with');
        return error;
      });
      toast(translated.join('\n'), 'error');
      return false;
    }

    const existingConfig = editingId ? webdavConfigs.find((config) => config.id === editingId) : undefined;
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
    return true;
  }, [addWebDAVConfig, t, toast, updateWebDAVConfig, webdavConfigs]);

  const test = useCallback(async (config: WebDAVConfig) => {
    setTestingId(config.id);
    try {
      const isConnected = await new WebDAVService(config).testConnection();
      toast(
        isConnected
          ? t('useWebDAVActions.webdav-connection-successful')
          : t('useWebDAVActions.webdav-connection-failed-please-check-configurat'),
        isConnected ? 'success' : 'error',
      );
    } catch (error) {
      console.error('WebDAV test failed:', error);
      toast(`${t('useWebDAVActions.webdav-test-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setTestingId(null);
    }
  }, [t, toast]);

  return { testingId, save, test };
};
