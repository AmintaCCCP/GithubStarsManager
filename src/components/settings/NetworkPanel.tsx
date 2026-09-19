
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import React, { useEffect, useState } from 'react';
import { Wifi, Download, Eye, EyeOff, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { ProxyType } from '../../types';
import { useNetworkActions } from '../../features/settings/hooks/useNetworkActions';

interface NetworkPanelProps {
  t: TranslateFn;
}

export const NetworkPanel: React.FC<NetworkPanelProps> = ({ t }) => {
  const {
    canUseProxy, form, rpcForm, testing, saving, isProxyToggling, testResult,
    rpcTesting, rpcSaving, isRpcToggling, rpcTestResult, hasStoredSecret,
    isFormValid, isRpcFormValid, hasProxyChanges: hasChanges, hasRpcChanges: rpcHasChanges,
    setForm, setRpcForm, clearStoredSecret,
    saveProxy: handleSave, testProxy: handleTest, toggleProxy: handleProxyToggle,
    saveRpc: handleRpcSave, testRpc: handleRpcTest, toggleRpc: handleRpcToggle,
  } = useNetworkActions({ t });
  const [showPassword, setShowPassword] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (form.username || form.password) setShowAuth(true);
  }, [form.username, form.password]);

  return (
    <div className="space-y-4">
      {/* Network Proxy Card — only available with backend or Electron */}
      {canUseProxy && (
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Wifi className="w-5 h-5 text-muted-foreground dark:text-muted-foreground" />
            <h4 className="font-medium text-foreground dark:text-foreground">
              {t('networkPanel.network-proxy')}
            </h4>
          </div>
          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) => { void handleProxyToggle(checked); }}
            disabled={isProxyToggling}
            aria-label={t('networkPanel.enable-network-proxy')}
            className="shrink-0"
          />
        </div>

        {form.enabled && (
          <div className="space-y-4">
            {/* Proxy Type */}
            <div>
              <label id="proxy-type-label" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-2">
                {t('networkPanel.proxy-type')}
              </label>
              <RadioGroup aria-labelledby="proxy-type-label" value={form.type} onValueChange={(value) => setForm({ ...form, type: value as ProxyType })} className="grid max-w-md grid-cols-2 gap-3">
                {(['http', 'socks5'] as ProxyType[]).map((type) => (
                  <label key={type} onClick={() => setForm({ ...form, type })} className={`flex cursor-pointer items-center space-x-3 rounded-lg border p-3 transition-colors ${form.type === type ? 'border-primary bg-primary/5 dark:bg-primary/10' : 'border-border hover:bg-background dark:border-border dark:hover:bg-accent'}`}>
                    <RadioGroupItem value={type} id={`proxy-type-${type}`} aria-label={type.toUpperCase()} />
                    <span className="text-sm font-medium uppercase text-foreground dark:text-foreground">{type}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>

            {/* Host and Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="proxy-host" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('networkPanel.host')}
                </label>
                <Input
                  id="proxy-host"
                  type="text"
                  value={form.host}
                  onChange={(e) => setForm({ ...form, host: e.target.value })}
                  placeholder="127.0.0.1"
                  className="w-full px-3 py-2 bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg text-foreground dark:text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                />
              </div>
              <div>
                <label htmlFor="proxy-port" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('networkPanel.port')}
                </label>
                <NumberInput
                  id="proxy-port"
                  value={form.port || undefined}
                  onChange={(value) => setForm({ ...form, port: value ?? 0 })}
                  placeholder="7890"
                  min={1}
                  max={65535}
                  allowUndefined
                  className="w-full"
                />
              </div>
            </div>

            {/* Authentication (collapsible) */}
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowAuth(!showAuth)}
                className="h-auto p-0 text-sm text-muted-foreground dark:text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground transition-colors"
              >
                {showAuth ? t('networkPanel.hide-authentication') : t('networkPanel.authentication-optional')}
              </Button>

              {showAuth && (
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="proxy-username" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                      {t('networkPanel.username')}
                    </label>
                    <Input
                      id="proxy-username"
                      type="text"
                      value={form.username || ''}
                      onChange={(e) => setForm({ ...form, username: e.target.value || undefined })}
                      placeholder={t('networkPanel.optional')}
                      className="w-full px-3 py-2 bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg text-foreground dark:text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="proxy-password" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                      {t('networkPanel.password')}
                    </label>
                    <div className="relative">
                      <Input
                        id="proxy-password"
                        type={showPassword ? 'text' : 'password'}
                        value={form.password || ''}
                        onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
                        placeholder={t('networkPanel.optional')}
                        className="w-full px-3 py-2 pr-10 bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg text-foreground dark:text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={showPassword ? t('networkPanel.hide-password') : t('networkPanel.show-password')}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 p-0 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center space-x-3 pt-2">
              <Button
                onClick={handleTest}
                disabled={testing || !form.host || !form.port}
                className="px-4 py-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {testing ? (
                  <span className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('networkPanel.testing')}</span>
                  </span>
                ) : (
                  t('networkPanel.test-connection')
                )}
              </Button>

              <Button
                onClick={handleSave}
                disabled={saving || !hasChanges || !isFormValid}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <span className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('networkPanel.saving')}</span>
                  </span>
                ) : (
                  t('networkPanel.save')
                )}
              </Button>
            </div>

            {/* Test Result */}
            {testResult && (
              <div className={`flex items-start space-x-2 p-3 rounded-lg text-sm ${
                testResult.success
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive'
              }`}>
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <span>
                  {testResult.success
                    ? t('networkPanel.proxy-connection-successful')
                    : testResult.error || t('networkPanel.proxy-connection-failed')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      )}

      {/* RPC Download Card */}
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <Download className="w-5 h-5 text-muted-foreground dark:text-muted-foreground" />
            <h4 className="font-medium text-foreground dark:text-foreground">
              {t('networkPanel.remote-download')}
            </h4>
          </div>
          <Switch
            checked={rpcForm.enabled}
            onCheckedChange={(enabled) => void handleRpcToggle(enabled)}
            disabled={isRpcToggling}
            aria-label={t('networkPanel.enable-remote-download')}
            className="shrink-0"
          />
        </div>

        {rpcForm.enabled && (
          <div className="space-y-4">
            {/* Host and Port */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="rpc-host" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('networkPanel.host')}
                </label>
                <Input
                  id="rpc-host"
                  type="text"
                  value={rpcForm.host}
                  onChange={(e) => setRpcForm({ ...rpcForm, host: e.target.value })}
                  placeholder="127.0.0.1"
                  className="w-full px-3 py-2 bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg text-foreground dark:text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                />
              </div>
              <div>
                <label htmlFor="rpc-port" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                  {t('networkPanel.port')}
                </label>
                <NumberInput
                  id="rpc-port"
                  value={rpcForm.port || undefined}
                  onChange={(value) => setRpcForm({ ...rpcForm, port: value ?? 0 })}
                  placeholder="6800"
                  min={1}
                  max={65535}
                  allowUndefined
                  className="w-full"
                />
              </div>
            </div>

            {/* Secret */}
            <div>
              <label htmlFor="rpc-secret" className="block text-sm font-medium text-muted-foreground dark:text-muted-foreground mb-1">
                {t('networkPanel.secret')}
              </label>
              <div className="relative">
                <Input
                  id="rpc-secret"
                  type={showSecret ? 'text' : 'password'}
                  value={rpcForm.secret || ''}
                  onChange={(e) => {
                    setRpcForm({ ...rpcForm, secret: e.target.value || undefined });
                    if (e.target.value) clearStoredSecret();
                  }}
                  placeholder={hasStoredSecret
                    ? t('networkPanel.secret-saved-leave-blank-to-keep')
                    : t('networkPanel.optional-aria2-rpc-secret')}
                  className="w-full px-3 py-2 pr-10 bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg text-foreground dark:text-foreground text-sm focus:ring-2 focus:ring-ring focus:border-transparent outline-none"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={showSecret ? t('networkPanel.hide-secret') : t('networkPanel.show-secret')}
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground dark:hover:text-muted-foreground"
                >
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            {/* Hint */}
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('networkPanel.requires-aria2-with-rpc-enabled-aria2c-enable-rp')}
            </p>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground">
              {t('networkPanel.adjust-github-release-request-egress-under-setti')}
            </p>

            {/* Actions */}
            <div className="flex items-center space-x-3 pt-2">
              <Button
                onClick={handleRpcTest}
                disabled={rpcTesting || !rpcForm.host || !rpcForm.port}
                className="px-4 py-2 text-sm font-medium text-muted-foreground dark:text-muted-foreground bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rpcTesting ? (
                  <span className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('networkPanel.testing')}</span>
                  </span>
                ) : (
                  t('networkPanel.test-connection')
                )}
              </Button>

              <Button
                onClick={handleRpcSave}
                disabled={rpcSaving || !rpcHasChanges || !isRpcFormValid}
                className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {rpcSaving ? (
                  <span className="flex items-center space-x-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t('networkPanel.saving')}</span>
                  </span>
                ) : (
                  t('networkPanel.save')
                )}
              </Button>
            </div>

            {/* Test Result */}
            {rpcTestResult && (
              <div className={`flex items-start space-x-2 p-3 rounded-lg text-sm ${
                rpcTestResult.success
                  ? 'bg-success/10 text-success'
                  : 'bg-destructive/10 text-destructive'
              }`}>
                {rpcTestResult.success ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                )}
                <span>
                  {rpcTestResult.success
                    ? `${t('networkPanel.connection-successful')}${rpcTestResult.version ? ` (aria2 v${rpcTestResult.version})` : ''}`
                    : rpcTestResult.error || t('networkPanel.connection-failed')}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
