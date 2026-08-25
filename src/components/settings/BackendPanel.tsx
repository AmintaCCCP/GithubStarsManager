import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import React from 'react';
import { Server, TestTube, RefreshCw, Upload, Download, CheckCircle, AlertCircle } from 'lucide-react';
import { useBackendSettingsActions } from '../../features/settings/hooks/useBackendSettingsActions';

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
