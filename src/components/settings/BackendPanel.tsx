import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React from 'react';
import { Server, Plug, RefreshCw, Upload, Download, CheckCircle, AlertCircle, Route } from 'lucide-react';
import { useBackendSettingsActions } from '../../features/settings/hooks/useBackendSettingsActions';
import { useAppStore } from '../../store/useAppStore';
import type { RouteMode } from '../../types';
import { cn } from '../../lib/utils';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

interface BackendPanelProps {
  t: TranslateFn;
}

export const BackendPanel: React.FC<BackendPanelProps> = ({ t }) => {
  const {
    status,
    health,
    urlInput,
    secretInput,
    backendAvailable,
    isSyncingToBackend,
    isSyncingFromBackend,
    setUrlInput,
    setSecretInput,
    testConnection: handleTestConnection,
    syncToBackend: handleSyncToBackend,
    syncFromBackend: handleSyncFromBackend,
  } = useBackendSettingsActions();
  const routeMode = useAppStore((state) => state.routeMode);
  const setRouteMode = useAppStore((state) => state.setRouteMode);

  const routeOptions: Array<{ value: RouteMode; label: string; hint: string }> = [
    {
      value: 'auto',
      label: t('backendPanel.auto'),
      hint: t('backendPanel.use-backend-when-available-otherwise-this-device'),
    },
    {
      value: 'backend',
      label: t('backendPanel.prefer-backend'),
      hint: t('backendPanel.backend-proxied-request-families-prefer-the-back'),
    },
    {
      value: 'browser',
      label: t('backendPanel.browser-direct'),
      hint: t('backendPanel.skip-backend-proxying-and-use-this-device-networ'),
    },
  ];

  const getStatusIcon = () => {
    switch (status) {
      case 'connected':
        return <CheckCircle className="size-3.5" />;
      case 'checking':
        return <RefreshCw className="size-3.5 animate-spin" />;
      default:
        return <AlertCircle className="size-3.5" />;
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return t('backendPanel.connected');
      case 'checking':
        return t('backendPanel.checking');
      default:
        return t('backendPanel.not-connected');
    }
  };

  return (
    <SettingsPageStack>
      <SettingsSection title={t('backendPanel.backend-server')}>
        <SettingsCard>
          <SettingsRow
            icon={<Server />}
            title={t('backendPanel.backend-server')}
            description={health ? `${t('backendPanel.connection-ok')} · ${t('backendPanel.version')}: ${health.version}` : t('backendPanel.the-backend-url-is-shared-with-the-login-screen')}
          >
            <Badge
              variant={status === 'connected' ? 'success' : status === 'checking' ? 'secondary' : 'destructive'}
              className="gap-1.5 px-2 py-0.5 text-label-sm"
            >
              {getStatusIcon()}
              <span>{getStatusText()}</span>
            </Badge>
          </SettingsRow>
          <SettingsDivider />
          <div className="space-y-3 px-3.5 py-3">
            <div>
              <label htmlFor="backend-url" className="mb-1.5 block text-label font-medium text-foreground">
                {t('backendPanel.backend-url')}
              </label>
              <Input
                id="backend-url"
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com"
              />
            </div>
            <div>
              <label htmlFor="backend-api-secret" className="mb-1.5 block text-label font-medium text-foreground">
                {t('backendPanel.api-secret')}
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Input
                  id="backend-api-secret"
                  type="password"
                  value={secretInput}
                  onChange={(e) => setSecretInput(e.target.value)}
                  className="flex-1"
                  placeholder={t('backendPanel.enter-backend-api-secret-optional')}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={handleTestConnection}
                  disabled={status === 'checking'}
                >
                  {status === 'checking' ? (
                    <RefreshCw className="size-4 animate-spin" />
                  ) : (
                    <Plug className="size-4" />
                  )}
                  <span>{t('backendPanel.test-connection')}</span>
                </Button>
              </div>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('backendPanel.network-request-routing')}
        description={t('backendPanel.choose-where-backend-proxied-github-release-requ')}
      >
        <SettingsCard>
          <RadioGroup
            value={routeMode}
            onValueChange={(value) => setRouteMode(value as RouteMode)}
            className="gap-0"
          >
            {routeOptions.map((option, index) => (
              <React.Fragment key={option.value}>
                {index > 0 && <SettingsDivider />}
                <label
                  htmlFor={`route-mode-${option.value}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 px-3.5 py-2.5 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant',
                    routeMode === option.value && 'bg-fill-selected/50',
                  )}
                >
                  <RadioGroupItem value={option.value} id={`route-mode-${option.value}`} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-label font-medium text-foreground">
                      <Route className="size-3.5 text-tertiary" aria-hidden="true" />
                      <span>{option.label}</span>
                    </div>
                    <div className="mt-px text-label-sm leading-[18px] text-secondary">{option.hint}</div>
                  </div>
                </label>
              </React.Fragment>
            ))}
          </RadioGroup>
        </SettingsCard>
        {!backendAvailable && (
          <SettingsNotice tone="warning" icon={<AlertCircle />}>
            {t('backendPanel.the-backend-is-unreachable-right-now-so-auto-pre')}
          </SettingsNotice>
        )}
        <p className="px-0.5 text-label-sm text-tertiary">
          {t('backendPanel.tip-pick-browser-direct-when-the-server-e-g-a-ma')}
        </p>
      </SettingsSection>

      {backendAvailable && (
        <SettingsSection title={t('backendPanel.sync-to-backend')}>
          <SettingsCard>
            <SettingsRow
              icon={<Upload />}
              title={t('backendPanel.sync-to-backend')}
              description={t('backendPanel.upload-local-data-to-backend')}
            >
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleSyncToBackend}
                disabled={isSyncingToBackend}
              >
                {isSyncingToBackend ? <RefreshCw className="size-4 animate-spin" /> : <Upload className="size-4" />}
                <span>{isSyncingToBackend ? t('backendPanel.syncing') : t('backendPanel.start-sync')}</span>
              </Button>
            </SettingsRow>
            <SettingsDivider />
            <SettingsRow
              icon={<Download />}
              title={t('backendPanel.sync-from-backend')}
              description={t('backendPanel.download-data-from-backend-to-local')}
            >
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={handleSyncFromBackend}
                disabled={isSyncingFromBackend}
              >
                {isSyncingFromBackend ? <RefreshCw className="size-4 animate-spin" /> : <Download className="size-4" />}
                <span>{isSyncingFromBackend ? t('backendPanel.syncing') : t('backendPanel.start-sync')}</span>
              </Button>
            </SettingsRow>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection title={t('backendPanel.sync-includes')}>
        <SettingsCard className="px-3.5 py-3">
          <ul className="space-y-1 text-label-sm text-secondary">
            <li>• {t('backendPanel.github-stars-repository-list')}</li>
            <li>• {t('backendPanel.release-information')}</li>
            <li>• {t('backendPanel.ai-service-configurations')}</li>
            <li>• {t('backendPanel.webdav-configurations')}</li>
            <li>• {t('backendPanel.category-visibility-settings')}</li>
          </ul>
        </SettingsCard>
      </SettingsSection>
    </SettingsPageStack>
  );
};
