
import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { RadioGroup, RadioGroupItem } from '../ui/radio-group';
import React from 'react';
import { Server, TestTube, RefreshCw, Upload, Download, CheckCircle, AlertCircle, Route } from 'lucide-react';
import { useBackendSettingsActions } from '../../features/settings/hooks/useBackendSettingsActions';
import { useAppStore } from '../../store/useAppStore';
import type { RouteMode } from '../../types';

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
  } = useBackendSettingsActions({ t });
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
        return <CheckCircle className="w-5 h-5" />;
      case 'checking':
        return <RefreshCw className="w-5 h-5 animate-spin" />;
      default:
        return <AlertCircle className="w-5 h-5" />;
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Server className="w-6 h-6 text-muted-foreground dark:text-muted-foreground " />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('backendPanel.backend-server')}
          </h3>
        </div>
        <Badge
          variant={status === 'connected' ? 'default' : status === 'checking' ? 'secondary' : 'destructive'}
          className="gap-2 px-3 py-1 text-sm"
        >
          {getStatusIcon()}
          <span>{getStatusText()}</span>
        </Badge>
      </div>

      {health && (
        <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="w-5 h-5 text-muted-foreground dark:text-muted-foreground" />
            <span className="font-medium text-foreground dark:text-foreground">
              {t('backendPanel.connection-ok')}
            </span>
          </div>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('backendPanel.version')}: {health.version}
          </p>
        </div>
      )}

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <div className="flex items-center space-x-2 mb-1">
          <Route className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground dark:text-foreground">
            {t('backendPanel.network-request-routing')}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mb-3">
          {t('backendPanel.choose-where-backend-proxied-github-release-requ')}
        </p>
        <RadioGroup
          value={routeMode}
          onValueChange={(value) => setRouteMode(value as RouteMode)}
          className="gap-3"
        >
          {routeOptions.map((option) => (
            <label
              key={option.value}
              htmlFor={`route-mode-${option.value}`}
              className="flex items-start space-x-3 rounded-lg p-2 hover:bg-muted/50 dark:hover:bg-muted/30 cursor-pointer"
            >
              <RadioGroupItem value={option.value} id={`route-mode-${option.value}`} className="mt-0.5" />
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground dark:text-foreground">{option.label}</div>
                <div className="text-xs text-muted-foreground dark:text-muted-foreground">{option.hint}</div>
              </div>
            </label>
          ))}
        </RadioGroup>
        {!backendAvailable && (
          <p className="text-xs text-warning mt-3">
            {t('backendPanel.the-backend-is-unreachable-right-now-so-auto-pre')}
          </p>
        )}
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-3">
          {t('backendPanel.tip-pick-browser-direct-when-the-server-e-g-a-ma')}
        </p>
      </div>

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <label htmlFor="backend-url" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-2">
          {t('backendPanel.backend-url')}
        </label>
        <Input
          id="backend-url"
          type="url"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          className="w-full px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none mb-3"
          placeholder="https://example.com"
        />
        <label htmlFor="backend-api-secret" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-2">
          {t('backendPanel.api-secret')}
        </label>
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <Input
            id="backend-api-secret"
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            className="flex-1 px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
            placeholder={t('backendPanel.enter-backend-api-secret-optional')}
          />
          <Button
            onClick={handleTestConnection}
            disabled={status === 'checking'}
            className="flex items-center justify-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {status === 'checking' ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <TestTube className="w-4 h-4" />
            )}
            <span>{t('backendPanel.test-connection')}</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-2">
          {t('backendPanel.the-backend-url-is-shared-with-the-login-screen')}
        </p>
      </div>

      {backendAvailable && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
            <div className="flex items-center space-x-3 mb-4">
              <Upload className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">
                  {t('backendPanel.sync-to-backend')}
                </h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('backendPanel.upload-local-data-to-backend')}
                </p>
              </div>
            </div>
            <Button
              onClick={handleSyncToBackend}
              disabled={isSyncingToBackend}
              className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncingToBackend ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
              <span>{isSyncingToBackend ? t('backendPanel.syncing') : t('backendPanel.start-sync')}</span>
            </Button>
          </div>

          <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
            <div className="flex items-center space-x-3 mb-4">
              <Download className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">
                  {t('backendPanel.sync-from-backend')}
                </h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('backendPanel.download-data-from-backend-to-local')}
                </p>
              </div>
            </div>
            <Button
              onClick={handleSyncFromBackend}
              disabled={isSyncingFromBackend}
              className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSyncingFromBackend ? (
                <RefreshCw className="w-5 h-5 animate-spin" />
              ) : (
                <Download className="w-5 h-5" />
              )}
              <span>{isSyncingFromBackend ? t('backendPanel.syncing') : t('backendPanel.start-sync')}</span>
            </Button>
          </div>
        </div>
      )}

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg">
        <h4 className="font-medium text-foreground dark:text-foreground mb-2">
          {t('backendPanel.sync-includes')}
        </h4>
        <ul className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1">
          <li>• {t('backendPanel.github-stars-repository-list')}</li>
          <li>• {t('backendPanel.release-information')}</li>
          <li>• {t('backendPanel.ai-service-configurations')}</li>
          <li>• {t('backendPanel.webdav-configurations')}</li>
          <li>• {t('backendPanel.category-visibility-settings')}</li>
        </ul>
      </div>
    </div>
  );
};
