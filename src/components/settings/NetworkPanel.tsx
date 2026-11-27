import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import React, { useEffect, useState } from 'react';
import { Wifi, Download, Eye, EyeOff, Loader2, CheckCircle2, XCircle, Plug } from 'lucide-react';
import type { ProxyType } from '../../types';
import { useNetworkActions } from '../../features/settings/hooks/useNetworkActions';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

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
  } = useNetworkActions();
  const [showPassword, setShowPassword] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    if (form.username || form.password) setShowAuth(true);
  }, [form.username, form.password]);

  return (
    <SettingsPageStack>
      {canUseProxy && (
        <SettingsSection title={t('networkPanel.network-proxy')}>
          <SettingsCard>
            <SettingsRow
              icon={<Wifi />}
              title={t('networkPanel.network-proxy')}
            >
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) => { void handleProxyToggle(checked); }}
                disabled={isProxyToggling}
                aria-label={t('networkPanel.enable-network-proxy')}
              />
            </SettingsRow>

            {form.enabled && (
              <>
                <SettingsDivider />
                <div className="space-y-4 px-3.5 py-3.5">
                  <div>
                    <label id="proxy-type-label" className="mb-2 block text-label font-medium text-foreground">
                      {t('networkPanel.proxy-type')}
                    </label>
                    <RadioGroup
                      aria-labelledby="proxy-type-label"
                      value={form.type}
                      onValueChange={(value) => setForm({ ...form, type: value as ProxyType })}
                      className="grid max-w-md grid-cols-2 gap-2"
                    >
                      {(['http', 'socks5'] as ProxyType[]).map((type) => {
                        const isSelected = form.type === type;
                        return (
                          <label
                            key={type}
                            onClick={() => setForm({ ...form, type })}
                            className={cn(
                              'flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 transition-[background-color,box-shadow] duration-micro ease-out-subtle hover:duration-instant',
                              isSelected
                                ? 'bg-fill-selected shadow-elev-0'
                                : 'bg-sunken/60 shadow-elev-0 hover:bg-fill-hover',
                            )}
                          >
                            <RadioGroupItem value={type} id={`proxy-type-${type}`} aria-label={type.toUpperCase()} />
                            <span className="text-label font-medium uppercase text-foreground">{type}</span>
                          </label>
                        );
                      })}
                    </RadioGroup>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label htmlFor="proxy-host" className="mb-1.5 block text-label font-medium text-foreground">
                        {t('networkPanel.host')}
                      </label>
                      <Input
                        id="proxy-host"
                        type="text"
                        value={form.host}
                        onChange={(e) => setForm({ ...form, host: e.target.value })}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div>
                      <label htmlFor="proxy-port" className="mb-1.5 block text-label font-medium text-foreground">
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

                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAuth(!showAuth)}
                      className="-ml-2 text-secondary hover:text-foreground"
                    >
                      {showAuth ? t('networkPanel.hide-authentication') : t('networkPanel.authentication-optional')}
                    </Button>

                    {showAuth && (
                      <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <label htmlFor="proxy-username" className="mb-1.5 block text-label font-medium text-foreground">
                            {t('networkPanel.username')}
                          </label>
                          <Input
                            id="proxy-username"
                            type="text"
                            value={form.username || ''}
                            onChange={(e) => setForm({ ...form, username: e.target.value || undefined })}
                            placeholder={t('networkPanel.optional')}
                          />
                        </div>
                        <div>
                          <label htmlFor="proxy-password" className="mb-1.5 block text-label font-medium text-foreground">
                            {t('networkPanel.password')}
                          </label>
                          <div className="relative">
                            <Input
                              id="proxy-password"
                              type={showPassword ? 'text' : 'password'}
                              value={form.password || ''}
                              onChange={(e) => setForm({ ...form, password: e.target.value || undefined })}
                              placeholder={t('networkPanel.optional')}
                              className="pr-9"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={showPassword ? t('networkPanel.hide-password') : t('networkPanel.show-password')}
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-1 top-1/2 -translate-y-1/2 text-secondary"
                            >
                              {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                            </Button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={handleTest}
                      disabled={testing || !form.host || !form.port}
                    >
                      {testing ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>{t('networkPanel.testing')}</span>
                        </>
                      ) : (
                        <>
                          <Plug className="size-4" />
                          <span>{t('networkPanel.test-connection')}</span>
                        </>
                      )}
                    </Button>

                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={handleSave}
                      disabled={saving || !hasChanges || !isFormValid}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          <span>{t('networkPanel.saving')}</span>
                        </>
                      ) : (
                        t('networkPanel.save')
                      )}
                    </Button>
                  </div>

                  {testResult && (
                    <SettingsNotice
                      tone={testResult.success ? 'success' : 'destructive'}
                      icon={testResult.success ? <CheckCircle2 /> : <XCircle />}
                    >
                      {testResult.success
                        ? t('networkPanel.proxy-connection-successful')
                        : testResult.error || t('networkPanel.proxy-connection-failed')}
                    </SettingsNotice>
                  )}
                </div>
              </>
            )}
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title={t('networkPanel.remote-download')}>
        <SettingsCard>
          <SettingsRow
            icon={<Download />}
            title={t('networkPanel.remote-download')}
          >
            <Switch
              checked={rpcForm.enabled}
              onCheckedChange={(enabled) => void handleRpcToggle(enabled)}
              disabled={isRpcToggling}
              aria-label={t('networkPanel.enable-remote-download')}
            />
          </SettingsRow>

          {rpcForm.enabled && (
            <>
              <SettingsDivider />
              <div className="space-y-4 px-3.5 py-3.5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label htmlFor="rpc-host" className="mb-1.5 block text-label font-medium text-foreground">
                      {t('networkPanel.host')}
                    </label>
                    <Input
                      id="rpc-host"
                      type="text"
                      value={rpcForm.host}
                      onChange={(e) => setRpcForm({ ...rpcForm, host: e.target.value })}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div>
                    <label htmlFor="rpc-port" className="mb-1.5 block text-label font-medium text-foreground">
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

                <div>
                  <label htmlFor="rpc-secret" className="mb-1.5 block text-label font-medium text-foreground">
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
                      className="pr-9"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={showSecret ? t('networkPanel.hide-secret') : t('networkPanel.show-secret')}
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-1 top-1/2 -translate-y-1/2 text-secondary"
                    >
                      {showSecret ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                    </Button>
                  </div>
                </div>

                <div className="space-y-1 text-label-sm text-secondary">
                  <p>{t('networkPanel.requires-aria2-with-rpc-enabled-aria2c-enable-rp')}</p>
                  <p>{t('networkPanel.adjust-github-release-request-egress-under-setti')}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleRpcTest}
                    disabled={rpcTesting || !rpcForm.host || !rpcForm.port}
                  >
                    {rpcTesting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t('networkPanel.testing')}</span>
                      </>
                    ) : (
                      <>
                        <Plug className="size-4" />
                        <span>{t('networkPanel.test-connection')}</span>
                      </>
                    )}
                  </Button>

                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    onClick={handleRpcSave}
                    disabled={rpcSaving || !rpcHasChanges || !isRpcFormValid}
                  >
                    {rpcSaving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        <span>{t('networkPanel.saving')}</span>
                      </>
                    ) : (
                      t('networkPanel.save')
                    )}
                  </Button>
                </div>

                {rpcTestResult && (
                  <SettingsNotice
                    tone={rpcTestResult.success ? 'success' : 'destructive'}
                    icon={rpcTestResult.success ? <CheckCircle2 /> : <XCircle />}
                  >
                    {rpcTestResult.success
                      ? `${t('networkPanel.connection-successful')}${rpcTestResult.version ? ` (aria2 v${rpcTestResult.version})` : ''}`
                      : rpcTestResult.error || t('networkPanel.connection-failed')}
                  </SettingsNotice>
                )}
              </div>
            </>
          )}
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
