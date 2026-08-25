import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { WebDAVConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { useDialog } from '../../../hooks/useDialog';
import { WebDAVService } from '../../../services/webdavService';

interface UseWebDAVActionsOptions {
  t: (zh: string, en: string) => string;
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
        if (error === 'WebDAV URL是必需的') return t('WebDAV URL是必需的', 'WebDAV URL is required');
        if (error === 'WebDAV URL必须以 http:// 或 https:// 开头') return t('WebDAV URL必须以 http:// or https:// 开头', 'WebDAV URL must start with http:// or https://');
        if (error === '用户名是必需的') return t('用户名是必需的', 'Username is required');
        if (error === '密码是必需的') return t('密码是必需的', 'Password is required');
        if (error === '路径是必需的') return t('路径是必需的', 'Path is required');
        if (error === '路径必须以 / 开头') return t('路径必须以 / 开头', 'Path must start with /');
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
          ? t('WebDAV连接成功！', 'WebDAV connection successful!')
          : t('WebDAV连接失败，请检查配置。', 'WebDAV connection failed. Please check configuration.'),
        isConnected ? 'success' : 'error',
      );
    } catch (error) {
      console.error('WebDAV test failed:', error);
      toast(`${t('WebDAV测试失败', 'WebDAV test failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setTestingId(null);
    }
  }, [t, toast]);

  return { testingId, save, test };
};
