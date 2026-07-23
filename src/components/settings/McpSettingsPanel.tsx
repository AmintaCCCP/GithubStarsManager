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
import { backend } from '../../services/backendAdapter';
import { isElectron } from '../../services/electronProxy';
import { useDialog } from '../../hooks/useDialog';

interface McpSettingsPanelProps {
  t: (zh: string, en: string) => string;
}

function generateLocalToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const b64 = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `gsm_mcp_${b64}`;
}

export const McpSettingsPanel: React.FC<McpSettingsPanelProps> = ({ t }) => {
  const { mcpConfig, setMcpConfig, language } = useAppStore();
  const { toast, confirm } = useDialog();

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [backendMode, setBackendMode] = useState(false);
  const [vectorAvailable, setVectorAvailable] = useState<boolean | null>(null);
  const [endpoints, setEndpoints] = useState({
    streamableHttp: '/mcp',
    sse: '/sse',
    messages: '/messages',
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const isElectronApp = isElectron();

  const baseUrl = useMemo(() => {
    // Electron local MCP always listens on loopback
    if (isElectronApp && !backendMode) {
      const host =
        mcpConfig.host === '0.0.0.0' || !mcpConfig.host ? '127.0.0.1' : mcpConfig.host;
      return `http://${host}:${mcpConfig.port || 3927}`;
    }
    // Backend / Docker: agents should hit the same origin nginx proxies (/mcp)
    if (backendMode) {
      return window.location.origin;
    }
    return window.location.origin;
  }, [backendMode, isElectronApp, mcpConfig.host, mcpConfig.port]);

  const mcpHttpUrl = `${baseUrl}${endpoints.streamableHttp}`;
  const mcpSseUrl = `${baseUrl}${endpoints.sse}`;

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

  const refreshFromBackend = useCallback(async () => {
    if (!backend.isAvailable) {
      setBackendMode(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const status = await backend.getMcpStatus();
      setBackendMode(true);
      setMcpConfig({
        enabled: status.enabled,
        token: status.token,
      });
      setEndpoints(status.endpoints);
      setVectorAvailable(status.vectorAvailable);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setMcpConfig]);

  useEffect(() => {
    void refreshFromBackend();
  }, [refreshFromBackend]);

  // Electron: ensure local token exists when enabling without backend.
  // Lifecycle (start/stop/snapshot) lives in mcpElectronBridge (App session).
  useEffect(() => {
    if (!backendMode && isElectronApp && mcpConfig.enabled && !mcpConfig.token) {
      const token = generateLocalToken();
      setMcpConfig({ token });
    }
  }, [backendMode, isElectronApp, mcpConfig.enabled, mcpConfig.token, setMcpConfig]);

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast(t('已复制', 'Copied'), 'success');
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      toast(t('复制失败', 'Copy failed'), 'error');
    }
  };

  const handleToggle = async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      if (backendMode && backend.isAvailable) {
        const result = await backend.updateMcpConfig({ enabled });
        setMcpConfig({ enabled: result.enabled, token: result.token });
        setEndpoints(result.endpoints);
        toast(
          enabled
            ? t('MCP 服务已开启', 'MCP server enabled')
            : t('MCP 服务已关闭', 'MCP server disabled'),
          'success'
        );
      } else if (isElectronApp) {
        let token = mcpConfig.token;
        if (enabled && !token) token = generateLocalToken();
        setMcpConfig({ enabled, token });
        toast(
          enabled
            ? t('MCP 服务已开启（本地）', 'MCP server enabled (local)')
            : t('MCP 服务已关闭', 'MCP server disabled'),
          'success'
        );
      } else {
        toast(t('需要后端或客户端才能使用 MCP', 'Backend or desktop client required for MCP'), 'error');
      }
    } catch (err) {
      setError((err as Error).message);
      toast(t('操作失败', 'Operation failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleResetToken = async () => {
    const ok = await confirm(
      t('重置 MCP Token', 'Reset MCP Token'),
      t(
        '重置后旧 Token 立即失效，需要更新 Agent 配置。是否继续？',
        'The old token will stop working immediately. Update your agent config. Continue?'
      )
    );
    if (!ok) return;

    setSaving(true);
    try {
      if (backendMode && backend.isAvailable) {
        const result = await backend.updateMcpConfig({ resetToken: true, enabled: mcpConfig.enabled });
        setMcpConfig({ token: result.token, enabled: result.enabled });
      } else {
        setMcpConfig({ token: generateLocalToken() });
      }
      toast(t('Token 已重置', 'Token reset'), 'success');
    } catch (err) {
      setError((err as Error).message);
      toast(t('重置失败', 'Reset failed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const statusLabel = mcpConfig.enabled
    ? t('运行中', 'Running')
    : t('已停止', 'Stopped');

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cable className="w-6 h-6 text-gray-700 dark:text-text-secondary" />
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary">
          {t('MCP 服务', 'MCP Server')}
        </h3>
      </div>

      <p className="text-sm text-gray-600 dark:text-text-tertiary">
        {t(
          '让 Claude Code / Cursor 等 Agent 通过 Streamable HTTP 读取本应用中的星标仓库、AI 摘要与标签。默认关闭；开启后无需安装额外软件。',
          'Let agents (Claude Code, Cursor, etc.) read your starred repos, AI summaries, and tags via Streamable HTTP. Off by default; no extra install when enabled.'
        )}
      </p>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Enable + status */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-text-primary">
              {t('启用 MCP 服务', 'Enable MCP Server')}
            </h4>
            <p className="text-xs text-gray-500 dark:text-text-tertiary mt-1">
              {backendMode
                ? t('后端模式：挂载于 /mcp', 'Backend mode: mounted at /mcp')
                : isElectronApp
                  ? t('客户端本地模式：127.0.0.1', 'Desktop local mode: 127.0.0.1')
                  : t('需要后端连接', 'Requires backend connection')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={mcpConfig.enabled}
            disabled={saving || loading}
            onClick={() => void handleToggle(!mcpConfig.enabled)}
            className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-violet focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
              mcpConfig.enabled ? 'bg-brand-violet' : 'bg-gray-200 dark:bg-white/10'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                mcpConfig.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        <div className="flex items-center gap-2 text-sm">
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
          ) : mcpConfig.enabled ? (
            <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400" />
          ) : (
            <AlertCircle className="w-4 h-4 text-gray-400" />
          )}
          <span className="text-gray-700 dark:text-text-secondary">
            {t('状态', 'Status')}: {statusLabel}
          </span>
          {backendMode && (
            <button
              type="button"
              onClick={() => void refreshFromBackend()}
              className="ml-auto p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
              aria-label={t('刷新', 'Refresh')}
            >
              <RefreshCw className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {vectorAvailable === false && (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            {t(
              '向量搜索未配置：Agent 不会看到 gsm_vector_search 工具。可在「向量搜索」中配置。',
              'Vector search not configured: gsm_vector_search will not be listed. Configure under Vector Search.'
            )}
          </p>
        )}
        {vectorAvailable === true && (
          <p className="text-xs text-green-700 dark:text-green-300">
            {t('向量搜索已启用，将暴露 gsm_vector_search。', 'Vector search enabled; gsm_vector_search is listed.')}
          </p>
        )}
      </div>

      {/* Electron local port */}
      {isElectronApp && !backendMode && (
        <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] space-y-3">
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('本地监听', 'Local Listen')}
          </h4>
          <div className="grid grid-cols-2 gap-3 max-w-md">
            <label className="text-sm text-gray-600 dark:text-text-tertiary">
              {t('主机', 'Host')}
              <input
                type="text"
                value={mcpConfig.host}
                onChange={(e) => setMcpConfig({ host: e.target.value })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.08] bg-light-surface dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm"
              />
            </label>
            <label className="text-sm text-gray-600 dark:text-text-tertiary">
              {t('端口', 'Port')}
              <input
                type="number"
                min={1}
                max={65535}
                value={mcpConfig.port}
                onChange={(e) => setMcpConfig({ port: Number(e.target.value) || 3927 })}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.08] bg-light-surface dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500 dark:text-text-tertiary">
            {t('默认仅绑定 127.0.0.1，仅本机 Agent 可访问。', 'Binds to 127.0.0.1 by default; local agents only.')}
          </p>
        </div>
      )}

      {/* Token */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-gray-900 dark:text-text-primary">
            {t('访问 Token', 'Access Token')}
          </h4>
          <button
            type="button"
            onClick={() => void handleResetToken()}
            disabled={saving}
            className="text-sm px-3 py-1.5 rounded-lg border border-black/[0.06] dark:border-white/[0.08] hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-text-secondary"
          >
            {t('重置 Token', 'Reset Token')}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-text-tertiary">
          {t(
            'Token 可随时查看与复制（非一次性）。请勿泄露；重置后旧配置失效。',
            'Token is always viewable and copyable (not one-time). Do not share it; reset invalidates old configs.'
          )}
        </p>
        <div className="flex items-center gap-2">
          <input
            type={showToken ? 'text' : 'password'}
            readOnly
            value={mcpConfig.token || ''}
            placeholder={t('开启服务后自动生成', 'Generated when enabled')}
            className="flex-1 px-3 py-2 rounded-lg border border-black/[0.06] dark:border-white/[0.08] bg-light-surface dark:bg-white/[0.04] text-gray-900 dark:text-text-primary text-sm font-mono"
          />
          <button
            type="button"
            onClick={() => setShowToken((v) => !v)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
            aria-label={showToken ? t('隐藏', 'Hide') : t('显示', 'Show')}
          >
            {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={() => void copyText('token', mcpConfig.token)}
            disabled={!mcpConfig.token}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-40"
            aria-label={t('复制 Token', 'Copy token')}
          >
            {copiedKey === 'token' ? (
              <CheckCircle className="w-4 h-4 text-green-600" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* URLs + copy config */}
      <div className="p-6 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] space-y-4">
        <h4 className="font-medium text-gray-900 dark:text-text-primary">
          {t('连接信息', 'Connection')}
        </h4>
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-text-tertiary w-36 flex-shrink-0">
              Streamable HTTP
            </span>
            <code className="flex-1 truncate text-xs font-mono text-gray-800 dark:text-text-primary">
              {mcpHttpUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyText('http', mcpHttpUrl)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-gray-500 dark:text-text-tertiary w-36 flex-shrink-0">
              SSE ({t('兼容', 'legacy')})
            </span>
            <code className="flex-1 truncate text-xs font-mono text-gray-800 dark:text-text-primary">
              {mcpSseUrl}
            </code>
            <button
              type="button"
              onClick={() => void copyText('sse', mcpSseUrl)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10"
            >
              <Copy className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-700 dark:text-text-secondary">
              {t('一键复制 Agent 配置 (JSON)', 'Copy agent config (JSON)')}
            </span>
            <button
              type="button"
              onClick={() => void copyText('json', agentConfigJson)}
              className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-gray-900 dark:bg-white text-white dark:text-gray-900 hover:opacity-90"
            >
              <Copy className="w-3.5 h-3.5" />
              {copiedKey === 'json' ? t('已复制', 'Copied') : t('复制 JSON', 'Copy JSON')}
            </button>
          </div>
          <pre className="text-xs font-mono p-3 rounded-lg bg-light-bg dark:bg-black/30 overflow-x-auto text-gray-800 dark:text-text-secondary border border-black/[0.04] dark:border-white/[0.04]">
            {agentConfigJson}
          </pre>
          <p className="text-xs text-gray-500 dark:text-text-tertiary mt-2">
            {language === 'zh'
              ? '粘贴到 Claude Code / Cursor 的 MCP 配置中。Header 使用上面的 Token。'
              : 'Paste into Claude Code / Cursor MCP settings. Use the token above in the Authorization header.'}
          </p>
        </div>
      </div>

      <div className="p-4 rounded-xl border border-black/[0.06] dark:border-white/[0.04] bg-light-bg/50 dark:bg-white/[0.02] text-xs text-gray-600 dark:text-text-tertiary space-y-1">
        <p>
          {t(
            '只读工具：gsm_status / gsm_search_repos / gsm_get_repo / gsm_list_categories / gsm_list_repos_by_category / gsm_stats',
            'Read-only tools: gsm_status / gsm_search_repos / gsm_get_repo / gsm_list_categories / gsm_list_repos_by_category / gsm_stats'
          )}
        </p>
        <p>
          {t(
            '可选：gsm_vector_search（需已配置向量搜索）',
            'Optional: gsm_vector_search (when vector search is configured)'
          )}
        </p>
      </div>
    </div>
  );
};
