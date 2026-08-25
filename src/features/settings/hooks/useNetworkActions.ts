import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { ProxyConfig, RpcDownloadConfig } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import { backend } from '../../../services/backendAdapter';
import { electronProxy, isElectron } from '../../../services/electronProxy';
import { testRpcDownload } from '../../../services/rpcDownloadService';

interface UseNetworkActionsOptions {
  t: (zh: string, en: string) => string;
}

type ConnectionResult = { success: boolean; error?: string };
type RpcConnectionResult = ConnectionResult & { version?: string };

export interface NetworkActions {
  canUseProxy: boolean;
  form: ProxyConfig;
  rpcForm: RpcDownloadConfig;
  testing: boolean;
  saving: boolean;
  isProxyToggling: boolean;
  testResult: ConnectionResult | null;
  rpcTesting: boolean;
  rpcSaving: boolean;
  isRpcToggling: boolean;
  rpcTestResult: RpcConnectionResult | null;
  hasStoredSecret: boolean;
  isFormValid: boolean;
  isRpcFormValid: boolean;
  hasProxyChanges: boolean;
  hasRpcChanges: boolean;
  setForm: (config: ProxyConfig) => void;
  setRpcForm: (config: RpcDownloadConfig) => void;
  clearStoredSecret: () => void;
  saveProxy: () => Promise<void>;
  testProxy: () => Promise<void>;
  toggleProxy: (enabled: boolean) => Promise<void>;
  saveRpc: () => Promise<void>;
  testRpc: () => Promise<void>;
  toggleRpc: (enabled: boolean) => Promise<void>;
}

/**
 * Owns all service-facing network settings operations. Local persistence remains
 * in the existing store, preserving its intentional proxy-password/RPC-secret
 * asymmetry.
 */
export const useNetworkActions = ({ t }: UseNetworkActionsOptions): NetworkActions => {
  const { proxyConfig, setProxyConfig, rpcDownloadConfig, setRpcDownloadConfig, backendApiSecret } = useAppStore(useShallow((state) => ({
    proxyConfig: state.proxyConfig,
    setProxyConfig: state.setProxyConfig,
    rpcDownloadConfig: state.rpcDownloadConfig,
    setRpcDownloadConfig: state.setRpcDownloadConfig,
    backendApiSecret: state.backendApiSecret,
  })));
  const [form, setForm] = useState<ProxyConfig>(proxyConfig);
  const [rpcForm, setRpcForm] = useState<RpcDownloadConfig>(rpcDownloadConfig);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [isProxyToggling, setIsProxyToggling] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionResult | null>(null);
  const [rpcTesting, setRpcTesting] = useState(false);
  const [rpcSaving, setRpcSaving] = useState(false);
  const [isRpcToggling, setIsRpcToggling] = useState(false);
  const [rpcTestResult, setRpcTestResult] = useState<RpcConnectionResult | null>(null);
  const [hasStoredSecret, setHasStoredSecret] = useState(() => !!rpcDownloadConfig.secret);

  useEffect(() => {
    setForm((current) => ({ ...current, enabled: proxyConfig.enabled }));
  }, [proxyConfig]);
  useEffect(() => {
    setRpcForm((current) => ({ ...current, enabled: rpcDownloadConfig.enabled }));
  }, [rpcDownloadConfig]);

  const getRpcBaseUrl = useCallback(async (): Promise<string> => {
    if (!backend.isAvailable) await backend.init();
    if (!backend.backendUrl) throw new Error('Backend not available');
    return backend.backendUrl;
  }, []);

  useEffect(() => {
    const loadRpcConfig = async () => {
      try {
        const base = await getRpcBaseUrl();
        const headers: Record<string, string> = backendApiSecret ? { Authorization: `Bearer ${backendApiSecret}` } : {};
        const response = await fetch(`${base}/settings/rpc-download`, { headers });
        if (!response.ok) return;
        const data = await response.json() as Partial<RpcDownloadConfig> & { hasSecret?: boolean };
        if (data.hasSecret) setHasStoredSecret(true);
        if (data.enabled !== undefined || data.host || data.port) {
          const currentStoreConfig = useAppStore.getState().rpcDownloadConfig;
          const hydratedConfig = {
            ...currentStoreConfig,
            enabled: data.enabled ?? currentStoreConfig.enabled,
            host: data.host || currentStoreConfig.host,
            port: data.port || currentStoreConfig.port,
          };
          setRpcForm((current) => JSON.stringify(current) === JSON.stringify(currentStoreConfig) ? hydratedConfig : current);
          setRpcDownloadConfig(hydratedConfig);
        }
      } catch {
        // Backend RPC state is optional and should never prevent settings use.
      }
    };
    void loadRpcConfig();
  }, [backendApiSecret, getRpcBaseUrl, setRpcDownloadConfig]);

  const backendHeaders = useCallback((): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(backendApiSecret ? { Authorization: `Bearer ${backendApiSecret}` } : {}),
  }), [backendApiSecret]);

  const putProxy = useCallback(async (config: ProxyConfig) => {
    if (isElectron()) await electronProxy.setProxy(config);
    if (backend.isAvailable) {
      const response = await fetch('/api/settings/proxy', {
        method: 'PUT', headers: backendHeaders(), body: JSON.stringify(config),
      });
      if (!response.ok) throw new Error(`Backend returned ${response.status}`);
    }
  }, [backendHeaders]);

  const saveProxy = useCallback(async () => {
    const valid = !form.enabled || (form.host.trim() && form.port >= 1 && form.port <= 65535);
    if (!valid) return;
    setSaving(true);
    setTestResult(null);
    const previous = proxyConfig;
    try {
      await putProxy(form);
      // This store action is intentionally responsible for omitting password from persistence.
      setProxyConfig(form);
    } catch (reason) {
      if (isElectron()) {
        try { await electronProxy.setProxy(previous); } catch { /* best-effort rollback */ }
      }
      setTestResult({ success: false, error: reason instanceof Error ? reason.message : t('保存失败', 'Save failed') });
    } finally {
      setSaving(false);
    }
  }, [form, proxyConfig, putProxy, setProxyConfig, t]);

  const testProxy = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (isElectron()) {
        setTestResult(await electronProxy.testProxy(form));
      } else if (backend.isAvailable) {
        const response = await fetch('/api/settings/proxy/test', {
          method: 'POST', headers: backendHeaders(), body: JSON.stringify(form),
        });
        setTestResult(await response.json() as ConnectionResult);
      }
    } catch (reason) {
      setTestResult({ success: false, error: reason instanceof Error ? reason.message : 'Unknown error' });
    } finally {
      setTesting(false);
    }
  }, [backendHeaders, form]);

  const toggleProxy = useCallback(async (enabled: boolean) => {
    if (isProxyToggling) return;
    const previousForm = form;
    const previousConfig = proxyConfig;
    const nextConfig = { ...proxyConfig, enabled };
    setIsProxyToggling(true);
    setForm((current) => ({ ...current, enabled }));
    setTestResult(null);
    try {
      await putProxy(nextConfig);
      setProxyConfig(nextConfig);
    } catch (reason) {
      if (isElectron()) {
        try { await electronProxy.setProxy(previousConfig); } catch { /* best-effort rollback */ }
      }
      setForm(previousForm);
      setTestResult({ success: false, error: reason instanceof Error ? reason.message : t('保存失败', 'Save failed') });
    } finally {
      setIsProxyToggling(false);
    }
  }, [form, isProxyToggling, proxyConfig, putProxy, setProxyConfig, t]);

  const putRpc = useCallback(async (config: RpcDownloadConfig) => {
    if (!backend.isAvailable) return;
    const base = await getRpcBaseUrl();
    const body: Record<string, unknown> = { enabled: config.enabled, host: config.host, port: config.port };
    // Empty field means retain existing backend secret; non-empty updates it.
    if (config.secret) body.secret = config.secret;
    const response = await fetch(`${base}/settings/rpc-download`, {
      method: 'PUT', headers: backendHeaders(), body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Backend returned ${response.status}`);
  }, [backendHeaders, getRpcBaseUrl]);

  const saveRpc = useCallback(async () => {
    const valid = !rpcForm.enabled || (rpcForm.host.trim() && rpcForm.port >= 1 && rpcForm.port <= 65535);
    if (!valid) return;
    setRpcSaving(true);
    setRpcTestResult(null);
    try {
      await putRpc(rpcForm);
      // Unlike proxy passwords, secret is intentionally retained by store partialize.
      setRpcDownloadConfig(rpcForm);
      if (rpcForm.secret) setHasStoredSecret(true);
    } catch (reason) {
      setRpcTestResult({ success: false, error: reason instanceof Error ? reason.message : t('保存失败', 'Save failed') });
    } finally {
      setRpcSaving(false);
    }
  }, [putRpc, rpcForm, setRpcDownloadConfig, t]);

  const testRpc = useCallback(async () => {
    setRpcTesting(true);
    setRpcTestResult(null);
    try {
      setRpcTestResult(await testRpcDownload(rpcForm, backendApiSecret || undefined));
    } catch (reason) {
      setRpcTestResult({ success: false, error: reason instanceof Error ? reason.message : 'Unknown error' });
    } finally {
      setRpcTesting(false);
    }
  }, [backendApiSecret, rpcForm]);

  const toggleRpc = useCallback(async (enabled: boolean) => {
    if (isRpcToggling) return;
    const previous = rpcForm;
    const nextConfig = { ...rpcDownloadConfig, enabled };
    setIsRpcToggling(true);
    setRpcForm((current) => ({ ...current, enabled }));
    setRpcTestResult(null);
    try {
      await putRpc(nextConfig);
      setRpcDownloadConfig(nextConfig);
    } catch (reason) {
      setRpcForm(previous);
      setRpcTestResult({ success: false, error: reason instanceof Error ? reason.message : t('保存失败', 'Save failed') });
    } finally {
      setIsRpcToggling(false);
    }
  }, [isRpcToggling, putRpc, rpcDownloadConfig, rpcForm, setRpcDownloadConfig, t]);

  const isFormValid = !form.enabled || Boolean(form.host.trim() && form.port >= 1 && form.port <= 65535);
  const isRpcFormValid = !rpcForm.enabled || Boolean(rpcForm.host.trim() && rpcForm.port >= 1 && rpcForm.port <= 65535);

  return {
    canUseProxy: isElectron() || backend.isAvailable,
    form, rpcForm, testing, saving, isProxyToggling, testResult,
    rpcTesting, rpcSaving, isRpcToggling, rpcTestResult, hasStoredSecret,
    isFormValid, isRpcFormValid,
    hasProxyChanges: JSON.stringify(form) !== JSON.stringify(proxyConfig),
    hasRpcChanges: JSON.stringify(rpcForm) !== JSON.stringify(rpcDownloadConfig),
    setForm, setRpcForm, clearStoredSecret: () => setHasStoredSecret(false),
    saveProxy, testProxy, toggleProxy, saveRpc, testRpc, toggleRpc,
  };
};
