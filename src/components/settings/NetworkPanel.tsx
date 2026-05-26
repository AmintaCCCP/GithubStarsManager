import React, { useState, useEffect } from 'react';
import { Wifi, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { backend } from '../../services/backendAdapter';
import { isElectron, electronProxy } from '../../services/electronProxy';
import type { ProxyConfig, ProxyType } from '../../types';

interface NetworkPanelProps {
  t: (zh: string, en: string) => string;
}

export const NetworkPanel: React.FC<NetworkPanelProps> = ({ t }) => {
  const { proxyConfig, setProxyConfig, backendApiSecret } = useAppStore();

  const [form, setForm] = useState<ProxyConfig>(proxyConfig);
  const [showPassword, setShowPassword] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync form when store changes externally
  useEffect(() => {
    setForm(proxyConfig);
    if (proxyConfig.username || proxyConfig.password) {
      setShowAuth(true);
    }
  }, [proxyConfig]);

  const canUseProxy = isElectron() || backend.isAvailable;

  if (!canUseProxy) {
    return null;
  }

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save to store
      setProxyConfig(form);

      // If Electron, sync to Electron main process
      if (isElectron()) {
        await electronProxy.setProxy(form);
      }

      // If backend is available, sync to backend
      if (backend.isAvailable) {
        try {
          const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
          if (backendApiSecret) {
            authHeaders['Authorization'] = `Bearer ${backendApiSecret}`;
          }
          await fetch('/api/settings/proxy', {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify(form),
          });
        } catch {
          // Backend sync is best-effort
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      if (isElectron()) {
        const result = await electronProxy.testProxy(form);
        setTestResult(result);
      } else if (backend.isAvailable) {
        try {
          const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
          if (backendApiSecret) {
            authHeaders['Authorization'] = `Bearer ${backendApiSecret}`;
          }
          const resp = await fetch('/api/settings/proxy/test', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify(form),
          });
          const data = await resp.json();
          setTestResult(data);
        } catch (e) {
          setTestResult({ success: false, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
    } finally {
      setTesting(false);
    }
  };

  const hasChanges = JSON.stringify(form) !== JSON.stringify(proxyConfig);

  return (
    <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <Wifi className="w-5 h-5 text-gray-700 dark:text-text-secondary" />
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('网络代理', 'Network Proxy')}
          </h4>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.enabled}
          onClick={() => setForm({ ...form, enabled: !form.enabled })}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.enabled ? 'bg-brand-indigo' : 'bg-gray-300 dark:bg-gray-600'}`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${form.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`}
          />
        </button>
      </div>

      {form.enabled && (
        <div className="space-y-4">
          {/* Proxy Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-2">
              {t('代理类型', 'Proxy Type')}
            </label>
            <div className="grid grid-cols-2 gap-3 max-w-md">
              {(['http', 'socks5'] as ProxyType[]).map((type) => (
                <label
                  key={type}
                  className={`flex items-center space-x-3 cursor-pointer p-3 rounded-lg border transition-colors ${
                    form.type === type
                      ? 'border-brand-indigo bg-brand-indigo/5 dark:bg-brand-indigo/10'
                      : 'border-black/[0.06] dark:border-white/[0.04] hover:bg-light-bg dark:hover:bg-white/10'
                  }`}
                >
                  <input
                    type="radio"
                    name="proxyType"
                    value={type}
                    checked={form.type === type}
                    onChange={() => setForm({ ...form, type })}
                    className="w-4 h-4 text-brand-violet bg-light-surface border-black/[0.06] focus:ring-brand-violet dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-white/[0.04] dark:border-white/[0.04]"
                  />
                  <span className="text-sm font-medium text-gray-900 dark:text-text-primary uppercase">
                    {type}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Host and Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('主机地址', 'Host')}
              </label>
              <input
                type="text"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="127.0.0.1"
                className="w-full px-3 py-2 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg text-gray-900 dark:text-text-primary text-sm focus:ring-2 focus:ring-brand-violet focus:border-transparent outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                {t('端口', 'Port')}
              </label>
              <input
                type="number"
                value={form.port || ''}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 0 })}
                placeholder="7890"
                min={1}
                max={65535}
                className="w-full px-3 py-2 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg text-gray-900 dark:text-text-primary text-sm focus:ring-2 focus:ring-brand-violet focus:border-transparent outline-none"
              />
            </div>
          </div>

          {/* Authentication (collapsible) */}
          <div>
            <button
              type="button"
              onClick={() => setShowAuth(!showAuth)}
              className="text-sm text-gray-500 dark:text-text-tertiary hover:text-gray-700 dark:hover:text-text-secondary transition-colors"
            >
              {showAuth ? t('隐藏认证', 'Hide Authentication') : t('需要认证（可选）', 'Authentication (optional)')}
            </button>

            {showAuth && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                    {t('用户名', 'Username')}
                  </label>
                  <input
                    type="text"
                    value={form.username || ''}
                    onChange={(e) => setForm({ ...form, username: e.target.value || undefined })}
                    placeholder={t('可选', 'Optional')}
                    className="w-full px-3 py-2 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg text-gray-900 dark:text-text-primary text-sm focus:ring-2 focus:ring-brand-violet focus:border-transparent outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-text-secondary mb-1">
                    {t('密码', 'Password')}
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password || ''}
                      onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
                      placeholder={t('可选', 'Optional')}
                      className="w-full px-3 py-2 pr-10 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg text-gray-900 dark:text-text-primary text-sm focus:ring-2 focus:ring-brand-violet focus:border-transparent outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-text-secondary"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={handleTest}
              disabled={testing || !form.host || !form.port}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-text-secondary bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg hover:bg-gray-200 dark:hover:bg-white/[0.08] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {testing ? (
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('测试中...', 'Testing...')}</span>
                </span>
              ) : (
                t('测试连接', 'Test Connection')
              )}
            </button>

            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="px-4 py-2 text-sm font-medium text-white bg-brand-indigo hover:bg-brand-hover rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <span className="flex items-center space-x-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{t('保存中...', 'Saving...')}</span>
                </span>
              ) : (
                t('保存', 'Save')
              )}
            </button>
          </div>

          {/* Test Result */}
          {testResult && (
            <div className={`flex items-start space-x-2 p-3 rounded-lg text-sm ${
              testResult.success
                ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400'
            }`}>
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <span>
                {testResult.success
                  ? t('代理连接成功', 'Proxy connection successful')
                  : testResult.error || t('代理连接失败', 'Proxy connection failed')}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
