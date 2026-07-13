import React, { useCallback, useMemo, useState } from 'react';
import { Plug, Copy, RefreshCw, Check, KeyRound } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';
import { isElectron } from '../../services/electronProxy';
import { backend } from '../../services/backendAdapter';

interface McpSettingsProps {
  t: (zh: string, en: string) => string;
}

function generateToken(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const McpSettings: React.FC<McpSettingsProps> = ({ t }) => {
  const mcpConfig = useAppStore((s) => s.mcpConfig);
  const setMcpConfig = useAppStore((s) => s.setMcpConfig);

  const [copied, setCopied] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);

  const endpoint = useMemo(() => {
    if (isElectron()) {
      return `http://127.0.0.1:${mcpConfig.port || 18789}/mcp`;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    return `${origin}/mcp`;
  }, [mcpConfig.port]);

  const clientConfig = useMemo(
    () => ({
      mcpServers: {
        'github-stars-manager': {
          type: 'http',
          url: endpoint,
          headers: { Authorization: `Bearer ${mcpConfig.token || '<your-token>'}` },
        },
      },
    }),
    [endpoint, mcpConfig.token]
  );

  const isElectronMode = isElectron();

  const applyConfig = useCallback(
    (next: Partial<typeof mcpConfig>) => {
      const merged = { ...mcpConfig, ...next };
      setMcpConfig(merged);
      if (backend.isAvailable) {
        backend.syncMcpConfig(merged).catch(() => undefined);
      }
      if (isElectronMode) {
        if (merged.enabled) {
          window.electronAPI?.startMcp?.({ port: merged.port, token: merged.token });
        } else {
          window.electronAPI?.stopMcp?.();
        }
      }
    },
    [mcpConfig, isElectronMode, setMcpConfig]
  );

  const handleToggle = useCallback(() => {
    const enabled = !mcpConfig.enabled;
    const token = enabled && !mcpConfig.token ? generateToken() : mcpConfig.token;
    applyConfig({ enabled, token });
  }, [mcpConfig.enabled, mcpConfig.token, applyConfig]);

  const handleResetToken = useCallback(async () => {
    const token = generateToken();
    applyConfig({ token });
    try {
      await navigator.clipboard.writeText(
        JSON.stringify(
          {
            mcpServers: {
              'github-stars-manager': {
                type: 'http',
                url: endpoint,
                headers: { Authorization: `Bearer ${token}` },
              },
            },
          },
          null,
          2
        )
      );
      setTokenCopied(true);
      setTimeout(() => setTokenCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  }, [applyConfig, endpoint]);

  const handleCopyConfig = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(clientConfig, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be unavailable */
    }
  }, [clientConfig]);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-text-primary flex items-center gap-2">
          <Plug className="w-5 h-5" />
          {t('MCP 服务', 'MCP Server')}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          {t(
            '允许 AI Agent（如 Claude Desktop、Cursor）通过 MCP 协议读取你收藏并加工过的仓库信息，无需手动使用命令行。',
            'Let AI agents (e.g. Claude Desktop, Cursor) read your curated starred repositories over MCP — no manual CLI needed.'
          )}
        </p>
      </div>

      {/* 启用开关 */}
      <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <div>
          <div className="font-medium text-gray-900 dark:text-gray-100">
            {t('启用 MCP 服务', 'Enable MCP Server')}
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t('开启后，Agent 可通过下方端点连接本软件', 'Once enabled, agents can connect via the endpoint below')}
          </div>
        </div>
        <button
          onClick={handleToggle}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            mcpConfig.enabled ? 'bg-brand-indigo' : 'bg-gray-300 dark:bg-gray-600'
          }`}
          aria-label={t('启用 MCP 服务', 'Enable MCP Server')}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              mcpConfig.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {mcpConfig.enabled && (
        <div className="space-y-4">
          {/* 端点信息 */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                {t('Streamable HTTP 端点', 'Streamable HTTP Endpoint')}
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded text-sm break-all text-gray-800 dark:text-gray-200">
                  {endpoint}
                </code>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                {t(
                  '支持 Streamable HTTP；旧客户端可回退到 SSE：',
                  'Streamable HTTP is primary; older clients may fall back to SSE at:'
                )}{' '}
                <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">
                  {endpoint.replace(/\/mcp$/, '/mcp/sse')}
                </code>
              </p>
            </div>

            {/* 桌面端端口 */}
            {isElectronMode && (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  {t('监听端口', 'Listen Port')}
                </label>
                <input
                  type="number"
                  value={mcpConfig.port || 18789}
                  onChange={(e) => applyConfig({ port: Number(e.target.value) || 18789 })}
                  className="w-32 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-indigo/50"
                />
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5">
                  {t('仅绑定 127.0.0.1，仅本机可访问', 'Bound to 127.0.0.1 — localhost only')}
                </p>
              </div>
            )}
          </div>

          {/* 令牌 */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300">
              <KeyRound className="w-4 h-4" />
              {t('访问令牌', 'Access Token')}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t(
                'Agent 连接时需携带此令牌（Bearer）。如需更换，点击重置即可生成新令牌。',
                'Agents must present this token as Bearer. Click reset to generate a new one whenever you like.'
              )}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-gray-100 dark:bg-gray-800 rounded text-sm break-all text-gray-800 dark:text-gray-200">
                {mcpConfig.token ? `${mcpConfig.token.slice(0, 8)}…${mcpConfig.token.slice(-4)}` : t('未生成', 'not generated')}
              </code>
              <button
                onClick={handleResetToken}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                {tokenCopied ? <Check className="w-4 h-4 text-green-500" /> : <RefreshCw className="w-4 h-4" />}
                {t('重置并复制', 'Reset & Copy')}
              </button>
            </div>
          </div>

          {/* 一键复制配置 */}
          <div className="border border-gray-200 dark:border-gray-700 rounded-lg p-4 space-y-3">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('客户端配置（一键复制）', 'Client Config (copy in one click)')}
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t(
                '将以下 JSON 粘贴到支持 MCP 的客户端（如 Claude Desktop、Cursor）的配置文件中即可使用。',
                'Paste this JSON into your MCP-capable client (e.g. Claude Desktop, Cursor) config file.'
              )}
            </p>
            <pre className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto text-gray-800 dark:text-gray-200">
              {JSON.stringify(clientConfig, null, 2)}
            </pre>
            <button
              onClick={handleCopyConfig}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-indigo text-white text-sm hover:opacity-90 transition-opacity"
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {t('复制配置', 'Copy Config')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default McpSettings;
