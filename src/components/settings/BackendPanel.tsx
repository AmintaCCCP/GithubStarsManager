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
  t: (zh: string, en: string) => string;
}

export const BackendPanel: React.FC<BackendPanelProps> = ({ t }) => {
  const {
    status,
    health,
    secretInput,
    backendAvailable,
    isSyncingToBackend,
    isSyncingFromBackend,
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
      label: t('智能', 'Auto'),
      hint: t('有后端走后端，无后端走本机网络', 'Use backend when available, otherwise this device'),
    },
    {
      value: 'backend',
      label: t('优先走后端', 'Prefer backend'),
      hint: t('支持后端代理的请求族优先经后端服务器出站', 'Backend-proxied request families prefer the backend egress'),
    },
    {
      value: 'browser',
      label: t('浏览器直连', 'Browser direct'),
      hint: t('跳过后端代理，走当前设备网络', 'Skip backend proxying and use this device network'),
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
        return t('已连接', 'Connected');
      case 'checking':
        return t('检查中...', 'Checking...');
      default:
        return t('未连接', 'Not Connected');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Server className="w-6 h-6 text-muted-foreground dark:text-muted-foreground " />
          <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
            {t('后端服务器', 'Backend Server')}
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
              {t('连接正常', 'Connection OK')}
            </span>
          </div>
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            {t('版本', 'Version')}: {health.version}
          </p>
        </div>
      )}

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <div className="flex items-center space-x-2 mb-1">
          <Route className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
          <h4 className="text-sm font-medium text-foreground dark:text-foreground">
            {t('网络请求路由', 'Network Request Routing')}
          </h4>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mb-3">
          {t(
            '选择支持后端代理的 GitHub/Release 请求从哪里发出。此项仅影响本设备，不参与后端与自动同步。',
            'Choose where backend-proxied GitHub/Release requests originate. This only affects this device and is never synced.'
          )}
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
            {t(
              '当前后端不可达，「智能 / 优先走后端」与「浏览器直连」实际效果一致（都从本设备网络发出），切换不会改变现状。',
              'The backend is unreachable right now, so "Auto / Prefer backend" and "Browser direct" behave identically (both use this device). Switching will not change current behavior.'
            )}
          </p>
        )}
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-3">
          {t(
            '提示：服务器（如境内 VPS）访问不了 GitHub 时选「浏览器直连」。aria2 的下载流量由 aria2 进程所在机器发出，与本设置无关。浏览器直连下载有鉴权的大体积资产会占用标签页内存。',
            'Tip: pick "Browser direct" when the server (e.g. a mainland-China VPS) cannot reach GitHub. aria2 download traffic leaves from wherever aria2 runs and is unaffected. Authenticated large assets downloaded via browser direct consume tab memory.'
          )}
        </p>
      </div>

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
        <label htmlFor="backend-api-secret" className="block text-sm font-medium text-foreground dark:text-muted-foreground mb-2">
          {t('API 密钥', 'API Secret')}
        </label>
        <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-3">
          <Input
            id="backend-api-secret"
            type="password"
            value={secretInput}
            onChange={(e) => setSecretInput(e.target.value)}
            className="flex-1 px-3 py-2 border border-border dark:border-border rounded-lg bg-card dark:bg-card text-foreground dark:text-foreground focus:ring-2 focus:ring-ring focus:border-transparent focus:outline-none"
            placeholder={t('输入后端 API_SECRET（可选）', 'Enter backend API_SECRET (optional)')}
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
            <span>{t('测试连接', 'Test Connection')}</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-2">
          {t(
            '如果后端设置了 API_SECRET 环境变量，在此输入相同的值。未设置则留空。',
            'If the backend has API_SECRET env var set, enter the same value here. Leave empty if not set.'
          )}
        </p>
      </div>

      {backendAvailable && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
            <div className="flex items-center space-x-3 mb-4">
              <Upload className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">
                  {t('同步到后端', 'Sync to Backend')}
                </h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('将本地数据上传到后端', 'Upload local data to backend')}
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
              <span>{isSyncingToBackend ? t('同步中...', 'Syncing...') : t('开始同步', 'Start Sync')}</span>
            </Button>
          </div>

          <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
            <div className="flex items-center space-x-3 mb-4">
              <Download className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
              <div>
                <h4 className="font-medium text-foreground dark:text-foreground">
                  {t('从后端同步', 'Sync from Backend')}
                </h4>
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {t('从后端下载数据到本地', 'Download data from backend to local')}
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
              <span>{isSyncingFromBackend ? t('同步中...', 'Syncing...') : t('开始同步', 'Start Sync')}</span>
            </Button>
          </div>
        </div>
      )}

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg">
        <h4 className="font-medium text-foreground dark:text-foreground mb-2">
          {t('同步内容包括：', 'Sync includes:')}
        </h4>
        <ul className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1">
          <li>• {t('GitHub Stars 仓库列表', 'GitHub Stars repository list')}</li>
          <li>• {t('Release 发布信息', 'Release information')}</li>
          <li>• {t('AI 服务配置', 'AI service configurations')}</li>
          <li>• {t('WebDAV 配置', 'WebDAV configurations')}</li>
          <li>• {t('分类显示设置', 'Category visibility settings')}</li>
        </ul>
      </div>
    </div>
  );
};
