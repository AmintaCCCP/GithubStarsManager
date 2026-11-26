



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
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsRow,
  SettingsSection,
} from './SettingsPrimitives';

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
  const { loading, saving, error, backendMode, vectorAvailable, endpoints, refresh: refreshFromBackend, toggle: handleToggle, resetToken: handleResetToken } = useMcpActions();
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
    <SettingsPageStack>
      <p className="text-label text-secondary">
        {t('mcpSettingsPanel.let-agents-claude-code-cursor-etc-read-your-star')}
      </p>

      {error && (
        <SettingsNotice tone="destructive" icon={<AlertCircle />}>
          {error}
        </SettingsNotice>
      )}

      <SettingsSection title={t('mcpSettingsPanel.mcp-server')}>
        <SettingsCard>
          <SettingsRow
            icon={<Cable />}
            title={t('mcpSettingsPanel.enable-mcp-server')}
            description={backendMode
              ? t('mcpSettingsPanel.backend-mode-mounted-at-mcp')
              : isElectronApp
                ? t('mcpSettingsPanel.desktop-local-mode-127-0-0-1')
                : t('mcpSettingsPanel.requires-backend-connection')}
          >
            <Switch
              checked={mcpConfig.enabled}
              disabled={saving || loading}
              onCheckedChange={(checked) => void handleToggle(checked)}
              aria-label={t('mcpSettingsPanel.enable-mcp-service')}
            />
          </SettingsRow>
          <SettingsDivider />
          <SettingsRow
            icon={loading
              ? <Loader2 className="animate-spin text-tertiary" />
              : mcpConfig.enabled
                ? <CheckCircle className="text-status-green" />
                : <AlertCircle className="text-tertiary" />}
            title={t('mcpSettingsPanel.status-with-value', { status: statusLabel })}
          >
            {backendMode && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => void refreshFromBackend()}
                aria-label={t('mcpSettingsPanel.refresh')}
              >
                <RefreshCw className="size-4 text-secondary" />
              </Button>
            )}
          </SettingsRow>
        </SettingsCard>

        {vectorAvailable === false && (
          <SettingsNotice tone="warning" icon={<AlertCircle />}>
            {t('mcpSettingsPanel.vector-search-not-configured-gsm-vector-search-w')}
          </SettingsNotice>
        )}
        {vectorAvailable === true && (
          <SettingsNotice tone="success" icon={<CheckCircle />}>
            {t('mcpSettingsPanel.vector-search-enabled-gsm-vector-search-is-liste')}
          </SettingsNotice>
        )}
      </SettingsSection>

      {isElectronApp && !backendMode && (
        <SettingsSection
          title={t('mcpSettingsPanel.local-listen')}
          description={t('mcpSettingsPanel.binds-to-127-0-0-1-by-default-local-agents-only')}
        >
          <SettingsCard className="px-3.5 py-3.5">
            <div className="grid max-w-md grid-cols-2 gap-3">
              <label className="block text-label font-medium text-foreground">
                {t('mcpSettingsPanel.host')}
                <Input
                  type="text"
                  value={mcpConfig.host}
                  onChange={(e) => setMcpConfig({ host: e.target.value })}
                  className="mt-1.5"
                />
              </label>
              <label className="block text-label font-medium text-foreground">
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
                  className="mt-1.5 w-full"
                />
              </label>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      <SettingsSection
        title={t('mcpSettingsPanel.access-token')}
        description={t('mcpSettingsPanel.token-is-stored-permanently-and-stays-the-same-a')}
        actions={(
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleResetToken()}
            disabled={saving || !mcpConfig.enabled}
            title={!mcpConfig.enabled ? t('mcpSettingsPanel.enable-mcp-first') : undefined}
          >
            {t('mcpSettingsPanel.reset-token')}
          </Button>
        )}
      >
        <SettingsCard className="px-3.5 py-3">
          <div className="flex items-center gap-2">
            <Input
              aria-label={t('mcpSettingsPanel.access-token')}
              type={showToken ? 'text' : 'password'}
              readOnly
              value={mcpConfig.token || ''}
              placeholder={t('mcpSettingsPanel.generated-when-enabled')}
              className="flex-1 font-mono text-mono-ui"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowToken((v) => !v)}
              aria-label={showToken ? t('mcpSettingsPanel.hide') : t('mcpSettingsPanel.show')}
            >
              {showToken ? <EyeOff className="size-4 text-secondary" /> : <Eye className="size-4 text-secondary" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => void copyText('token', mcpConfig.token)}
              disabled={!mcpConfig.token}
              aria-label={t('mcpSettingsPanel.copy-token')}
            >
              {copiedKey === 'token' ? (
                <CheckCircle className="size-4 text-status-green" />
              ) : (
                <Copy className="size-4 text-secondary" />
              )}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('mcpSettingsPanel.connection')}>
        <SettingsCard>
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="w-36 shrink-0 text-label-sm font-medium text-secondary">
              Streamable HTTP {/* i18n-allow-literal */}
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-mono-ui text-foreground">
              {mcpHttpUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void copyText('http', mcpHttpUrl)}
              aria-label={t('mcpSettingsPanel.copy-streamable-http-url')}
            >
              <Copy className="size-3.5 text-secondary" />
            </Button>
          </div>
          <SettingsDivider />
          <div className="flex items-center gap-3 px-3.5 py-2.5">
            <span className="w-36 shrink-0 text-label-sm font-medium text-secondary">
              SSE ({t('mcpSettingsPanel.legacy')})
            </span>
            <code className="min-w-0 flex-1 truncate font-mono text-mono-ui text-foreground">
              {mcpSseUrl}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => void copyText('sse', mcpSseUrl)}
              aria-label={t('mcpSettingsPanel.copy-sse-url')}
            >
              <Copy className="size-3.5 text-secondary" />
            </Button>
          </div>
          <SettingsDivider />
          <div className="space-y-3 px-3.5 py-3.5">
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-label font-medium text-foreground">
                  {t('mcpSettingsPanel.copy-agent-config-json')}
                </span>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => void copyText('json', agentConfigJson)}
                >
                  <Copy className="size-3.5" />
                  <span>{copiedKey === 'json' ? t('mcpSettingsPanel.copied') : t('mcpSettingsPanel.copy-json')}</span>
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-mono-ui text-secondary shadow-elev-0">
                {maskToken(agentConfigJson)}
              </pre>
              <p className="mt-1.5 text-label-sm text-secondary">
                {t('mcpSettingsPanel.prefer-streamable-http-json-above-if-the-client')}
              </p>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-label font-medium text-foreground">
                  {t('mcpSettingsPanel.sse-compatible-config-json')}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyText('sse-json', agentSseConfigJson)}
                >
                  <Copy className="size-3.5" />
                  <span>{copiedKey === 'sse-json' ? t('mcpSettingsPanel.copied') : t('mcpSettingsPanel.copy-sse-json')}</span>
                </Button>
              </div>
              <pre className="overflow-x-auto rounded-md bg-sunken p-3 font-mono text-mono-ui text-secondary shadow-elev-0">
                {maskToken(agentSseConfigJson)}
              </pre>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsNotice tone="neutral">
        <p>{t('mcpSettingsPanel.read-only-tools-gsm-status-gsm-search-repos-gsm')}</p>
        <p className="mt-1">{t('mcpSettingsPanel.optional-gsm-vector-search-when-vector-search-is')}</p>
      </SettingsNotice>
    </SettingsPageStack>
  );
};
