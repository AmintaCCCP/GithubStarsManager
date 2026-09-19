



import { TranslateFn } from '../../i18n/useT';
import { Input } from '../ui/input';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import { NumberInput } from '../ui/NumberInput';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cable,
  CheckCircle,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { isElectron } from '../../services/electronProxy';
import { useDialog } from '../../hooks/useDialog';
import { useMcpActions } from '../../features/settings/hooks/useMcpActions';
import { MCP_DEFAULT_PORT, normalizeMcpHost } from '../../utils/mcpHost';

interface McpSettingsPanelProps {
  t: TranslateFn;
}

export const McpSettingsPanel: React.FC<McpSettingsPanelProps> = ({ t }) => {
  const { mcpConfig, setMcpConfig } = useAppStore(useShallow((state) => ({
    mcpConfig: state.mcpConfig,
    setMcpConfig: state.setMcpConfig,
    language: state.language,
  })));
  const { toast } = useDialog();
  const { loading, saving, error, backendMode, vectorAvailable, endpoints, refresh: refreshFromBackend, toggle: handleToggle, resetToken: handleResetToken } = useMcpActions({ t });
  const [showToken, setShowToken] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [portInput, setPortInput] = useState(String(mcpConfig.port || MCP_DEFAULT_PORT));

  const isElectronApp = isElectron();

  useEffect(() => {
    setPortInput(String(mcpConfig.port || MCP_DEFAULT_PORT));
  }, [mcpConfig.port]);

  const baseUrl = useMemo(() => {
    // Electron local MCP always listens on loopback (shared host normalizer)
    if (isElectronApp && !backendMode) {
      const host = normalizeMcpHost(mcpConfig.host);
      return `http://${host}:${mcpConfig.port || MCP_DEFAULT_PORT}`;
    }
    // Backend / Docker: agents should hit the same origin nginx proxies (/mcp)
    return window.location.origin;
  }, [backendMode, isElectronApp, mcpConfig.host, mcpConfig.port]);

  const mcpHttpUrl = `${baseUrl}${endpoints.streamableHttp}`;
  const mcpSseUrl = `${baseUrl}${endpoints.sse}`;

  // Streamable HTTP is primary. Legacy SSE config is shown separately for clients that still need it.
  const agentConfigJson = useMemo(() => {
    const config = {
      mcpServers: {
        'github-stars-manager': {
          url: mcpHttpUrl,
          headers: {
            Authorization: `Bearer ${mcpConfig.token || '<token>'}`,
          },
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }, [mcpHttpUrl, mcpConfig.token]);

  const agentSseConfigJson = useMemo(() => {
    const config = {
      mcpServers: {
        'github-stars-manager': {
          // Some older MCP clients expect the SSE GET URL (not Streamable HTTP)
          url: mcpSseUrl,
          headers: {
            Authorization: `Bearer ${mcpConfig.token || '<token>'}`,
          },
        },
      },
    };
    return JSON.stringify(config, null, 2);
  }, [mcpSseUrl, mcpConfig.token]);

  const maskToken = useCallback((json: string) => (
    showToken || !mcpConfig.token ? json : json.replace(mcpConfig.token, '••••••••')
  ), [mcpConfig.token, showToken]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast(t('mcpSettingsPanel.copied'), 'success');
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      toast(t('mcpSettingsPanel.copy-failed'), 'error');
    }
  };

  const statusLabel = mcpConfig.enabled
    ? t('mcpSettingsPanel.running')
    : t('mcpSettingsPanel.stopped');

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cable className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
          {t('mcpSettingsPanel.mcp-server')}
        </h3>
      </div>

      <p className="text-sm text-muted-foreground dark:text-muted-foreground">
        {t('mcpSettingsPanel.let-agents-claude-code-cursor-etc-read-your-star')}
      </p>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Enable + status */}
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-foreground dark:text-foreground">
              {t('mcpSettingsPanel.enable-mcp-server')}
            </h4>
            <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
              {backendMode
                ? t('mcpSettingsPanel.backend-mode-mounted-at-mcp')
                : isElectronApp
                  ? t('mcpSettingsPanel.desktop-local-mode-127-0-0-1')
                  : t('mcpSettingsPanel.requires-backend-connection')}
            </p>
          </div>
          <Switch
            checked={mcpConfig.enabled}
            disabled={saving || loading}
            onCheckedChange={(checked) => void handleToggle(checked)}
            aria-label={t('mcpSettingsPanel.enable-mcp-service')}
          />
        </div>

        <div className="flex items-center gap-2 text-sm">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          ) : mcpConfig.enabled ? (
            <CheckCircle className="w-4 h-4 text-success" />
          ) : (
            <AlertCircle className="w-4 h-4 text-muted-foreground" />
          )}
          <span className="text-muted-foreground dark:text-muted-foreground">
            {t('mcpSettingsPanel.status-with-value', { status: statusLabel })}
          </span>
          {backendMode && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void refreshFromBackend()}
              className="ml-auto h-8 w-8 p-1.5 rounded-lg hover:bg-accent dark:hover:bg-accent"
              aria-label={t('mcpSettingsPanel.refresh')}
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </Button>
          )}
        </div>

        {vectorAvailable === false && (
          <p className="text-xs text-warning">
            {t('mcpSettingsPanel.vector-search-not-configured-gsm-vector-search-w')}
          </p>
        )}
        {vectorAvailable === true && (
          <p className="text-xs text-success">
            {t('mcpSettingsPanel.vector-search-enabled-gsm-vector-search-is-liste')}
          </p>
        )}
      </div>

      {/* Electron local port */}
      {isElectronApp && !backendMode && (
        <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border space-y-3">
          <h4 className="font-medium text-foreground dark:text-foreground">
            {t('mcpSettingsPanel.local-listen')}
          </h4>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <label className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('mcpSettingsPanel.host')}
              <Input
                type="text"
                value={mcpConfig.host}
                onChange={(e) => setMcpConfig({ host: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-border dark:border-border bg-muted dark:bg-muted/40 text-foreground dark:text-foreground text-sm"
              />
            </label>
            <label className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('mcpSettingsPanel.port')}
              <NumberInput
                min={1}
                max={65535}
                draftValue={portInput}
                onDraftChange={(value) => {
                  setPortInput(value);
                  const parsed = Number(value);
                  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
                    setMcpConfig({ port: parsed });
                  }
                }}
                onDraftCommit={(parsed) => {
                  const port = parsed ?? MCP_DEFAULT_PORT;
                  setPortInput(String(port));
                  setMcpConfig({ port });
                }}
                className="mt-1 w-full"
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground">
            {t('mcpSettingsPanel.binds-to-127-0-0-1-by-default-local-agents-only')}
          </p>
        </div>
      )}

      {/* Token */}
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-foreground dark:text-foreground">
            {t('mcpSettingsPanel.access-token')}
          </h4>
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleResetToken()}
            disabled={saving || !mcpConfig.enabled}
            title={
              !mcpConfig.enabled
                ? t('mcpSettingsPanel.enable-mcp-first')
                : undefined
            }
            className="text-sm px-3 py-1.5 rounded-lg border border-border dark:border-border hover:bg-accent dark:hover:bg-accent text-muted-foreground dark:text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t('mcpSettingsPanel.reset-token')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground dark:text-muted-foreground">
          {t('mcpSettingsPanel.token-is-stored-permanently-and-stays-the-same-a')}
        </p>
        <div className="flex items-center gap-2">
          <Input
            aria-label={t('mcpSettingsPanel.access-token')}
            type={showToken ? 'text' : 'password'}
            readOnly
            value={mcpConfig.token || ''}
            placeholder={t('mcpSettingsPanel.generated-when-enabled')}
            className="flex-1 px-3 py-2 rounded-lg border border-border dark:border-border bg-muted dark:bg-muted/40 text-foreground dark:text-foreground text-sm font-mono"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setShowToken((v) => !v)}
            className="h-8 w-8 p-2 rounded-lg hover:bg-accent dark:hover:bg-accent"
            aria-label={showToken ? t('mcpSettingsPanel.hide') : t('mcpSettingsPanel.show')}
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void copyText('token', mcpConfig.token)}
            disabled={!mcpConfig.token}
            className="h-8 w-8 p-2 rounded-lg hover:bg-accent dark:hover:bg-accent disabled:opacity-40"
            aria-label={t('mcpSettingsPanel.copy-token')}
          >
            {copiedKey === 'token' ? (
              <CheckCircle className="w-4 h-4 text-success" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>

      {/* URLs + copy config */}
      <div className="p-6 bg-card dark:bg-card rounded-xl border border-border dark:border-border space-y-4">
        <h4 className="font-medium text-foreground dark:text-foreground">
          {t('mcpSettingsPanel.connection')}
        </h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground dark:text-muted-foreground w-36 flex-shrink-0">
              Streamable HTTP
            </span>
            <code className="flex-1 truncate text-xs font-mono text-foreground dark:text-foreground">
              {mcpHttpUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void copyText('http', mcpHttpUrl)}
              className="h-8 w-8 p-1.5 rounded-lg hover:bg-accent dark:hover:bg-accent"
              aria-label={t('mcpSettingsPanel.copy-streamable-http-url')}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground dark:text-muted-foreground w-36 flex-shrink-0">
              SSE ({t('mcpSettingsPanel.legacy')})
            </span>
            <code className="flex-1 truncate text-xs font-mono text-foreground dark:text-foreground">
              {mcpSseUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void copyText('sse', mcpSseUrl)}
              className="h-8 w-8 p-1.5 rounded-lg hover:bg-accent dark:hover:bg-accent"
              aria-label={t('mcpSettingsPanel.copy-sse-url')}
            >
              <Copy className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('mcpSettingsPanel.copy-agent-config-json')}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => void copyText('json', agentConfigJson)}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedKey === 'json' ? t('mcpSettingsPanel.copied') : t('mcpSettingsPanel.copy-json')}
            </Button>
          </div>
          <pre className="text-xs font-mono p-3 rounded-lg bg-background dark:bg-muted/40 overflow-x-auto text-foreground dark:text-muted-foreground border border-border/60 dark:border-border">
            {maskToken(agentConfigJson)}
          </pre>
          <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-2">
            {t('mcpSettingsPanel.prefer-streamable-http-json-above-if-the-client')}
          </p>
          <div className="flex items-center justify-between mb-2 mt-4">
            <span className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('mcpSettingsPanel.sse-compatible-config-json')}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={() => void copyText('sse-json', agentSseConfigJson)}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border dark:border-border hover:bg-accent dark:hover:bg-accent text-muted-foreground dark:text-muted-foreground"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedKey === 'sse-json' ? t('mcpSettingsPanel.copied') : t('mcpSettingsPanel.copy-sse-json')}
            </Button>
          </div>
          <pre className="text-xs font-mono p-3 rounded-lg bg-background dark:bg-muted/40 overflow-x-auto text-foreground dark:text-muted-foreground border border-border/60 dark:border-border">
            {maskToken(agentSseConfigJson)}
          </pre>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-border dark:border-border bg-background/50 dark:bg-muted/20 text-xs text-muted-foreground dark:text-muted-foreground space-y-1">
        <p>
          {t('mcpSettingsPanel.read-only-tools-gsm-status-gsm-search-repos-gsm')}
        </p>
        <p>
          {t('mcpSettingsPanel.optional-gsm-vector-search-when-vector-search-is')}
        </p>
      </div>
    </div>
  );
};
