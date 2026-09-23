import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw, ShieldAlert } from 'lucide-react';
import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import type { InstalledPlugin } from '../../plugins/types';
import { pluginRegistryService, type PluginRegistry } from '../../services/pluginRegistryService';
import { assessInstalledPlugins } from '../../utils/pluginRegistryStatus';

interface PluginRegistrySectionProps {
  plugins: InstalledPlugin[];
  t: TranslateFn;
  /** 停用一个插件——撤销/拉黑只提示，是否停用由用户点。 */
  onDisable: (plugin: InstalledPlugin) => void | Promise<void>;
}

/**
 * 社区插件注册表对照区块（开发守则 §17 / §18）。
 *
 * 只做只读对照：显示每个已安装插件相对注册表的更新与撤销状态，**不下载、不安装、不自动停用**。
 * 独立成组件是为了把取数用的 hooks 收在一处：宿主面板在插件系统不可用时会有一次早返回，
 * hooks 放在宿主里会被规则检查判为条件调用。
 */
export const PluginRegistrySection: React.FC<PluginRegistrySectionProps> = ({ plugins, t, onDisable }) => {
  const [registry, setRegistry] = useState<PluginRegistry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const available = pluginRegistryService.isAvailable();

  const load = useCallback(async () => {
    if (!available) return;
    setLoading(true);
    setError(null);
    try {
      const result = await pluginRegistryService.load();
      if (result.success) {
        setRegistry(result.registry);
        setError(result.registry.error?.message ?? null);
      } else {
        setRegistry(null);
        setError(result.error.message);
      }
    } catch (cause) {
      setRegistry(null);
      setError(cause instanceof Error ? cause.message : 'Plugin registry request failed');
    } finally {
      setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void load();
  }, [load]);

  const assessments = useMemo(() => assessInstalledPlugins(
    plugins.map((plugin) => ({
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      grantedPermissions: plugin.grantedPermissions,
      declaredPermissions: plugin.manifest.permissions,
    })),
    registry,
  ), [plugins, registry]);

  if (!available) return null;

  return (
    <div className="rounded-lg border border-border p-4" data-testid="plugin-registry">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="h-4 w-4" />
            {t('pluginSettingsPanel.community-registry')}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t('pluginSettingsPanel.community-registry-hint')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          aria-label={t('pluginSettingsPanel.refresh')}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </div>

      {error && (
        <p className="mt-3 text-xs text-destructive" data-testid="plugin-registry-error">{error}</p>
      )}

      {registry && (
        <ul className="mt-3 space-y-2">
          {assessments.map((assessment) => (
            <li
              key={assessment.pluginId}
              className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2"
              data-testid={`plugin-registry-${assessment.pluginId}`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{assessment.pluginId}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {assessment.status === 'update-available'
                    ? t('pluginSettingsPanel.update-available-v1', { v1: assessment.latestVersion ?? '' })
                    : assessment.status === 'version-unknown'
                      ? t('pluginSettingsPanel.version-unknown')
                    : assessment.status === 'up-to-date'
                      ? t('pluginSettingsPanel.up-to-date')
                      : assessment.status === 'revoked'
                        ? t('pluginSettingsPanel.revoked')
                        : assessment.status === 'blocked'
                          ? t('pluginSettingsPanel.blocked')
                          : t('pluginSettingsPanel.not-in-registry')}
                  {assessment.permissionDiff.added.length > 0
                    ? ` · ${t('pluginSettingsPanel.new-permissions-v1', { v1: assessment.permissionDiff.added.join(', ') })}`
                    : ''}
                  {assessment.reason ? ` · ${assessment.reason}` : ''}
                </span>
              </span>
              {(assessment.status === 'revoked' || assessment.status === 'blocked') && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    const plugin = plugins.find((candidate) => candidate.manifest.id === assessment.pluginId);
                    if (plugin) void onDisable(plugin);
                  }}
                >
                  {t('pluginSettingsPanel.disable-now')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {registry && registry.rejected.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground" data-testid="plugin-registry-rejected">
          {t('pluginSettingsPanel.v1-entries-failed-validation', { v1: registry.rejected.length })}
        </p>
      )}
    </div>
  );
};

export default PluginRegistrySection;
