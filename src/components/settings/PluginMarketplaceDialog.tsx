import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, Loader2, Package, RefreshCw, Search, Settings2, Store, Trash2 } from 'lucide-react';
import { TranslateFn } from '../../i18n/useT';
import { useDialog } from '../../hooks/useDialog';
import { pluginRegistry } from '../../plugins/pluginRegistry';
import { buildPluginEnablePrompt } from '../../plugins/pluginEnablePrompt';
import { pluginMarketplaceService } from '../../services/pluginMarketplaceService';
import { pluginRegistryService, type PluginRegistry } from '../../services/pluginRegistryService';
import { SUPPORTED_API_VERSIONS, comparePluginVersions, findPluginRemoval } from '../../utils/pluginRegistryStatus';
import type {
  InstalledPlugin,
  MarketplacePluginEntry,
  MarketplaceState,
  MarketplaceSourceEntry,
  PluginError,
} from '../../plugins/types';
import { Modal } from '../Modal';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { PluginSourcesDialog } from './PluginSourcesDialog';
import { PluginUninstallDialog } from './PluginUninstallDialog';

interface PluginMarketplaceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  t: TranslateFn;
}

/**
 * 把主进程的市场错误码翻译成用户能懂的提示；没有对应文案时回退到原始消息
 * （与本地插件面板展示 pluginManager 错误消息的约定一致）。
 */
const describeMarketplaceError = (t: TranslateFn, error: PluginError): string => {
  if (error.code.includes('RATE_LIMITED')) return t('pluginSettingsPanel.marketplace-error-rate-limited');
  if (error.code === 'SOURCE_PATH_NOT_FOUND') return t('pluginSettingsPanel.marketplace-error-source-missing');
  if (error.code.endsWith('TIMEOUT')) return t('pluginSettingsPanel.marketplace-error-timeout');
  if (error.code === 'SOURCE_URL_INVALID') return t('pluginSettingsPanel.marketplace-error-url-invalid');
  if (error.code === 'SOURCE_ALREADY_EXISTS') return t('pluginSettingsPanel.marketplace-error-duplicate-source');
  if (error.code === 'PLUGIN_ALREADY_INSTALLED') return t('pluginSettingsPanel.marketplace-error-already-installed');
  if (error.code === 'MARKETPLACE_PACKAGE_TOO_LARGE') return t('pluginSettingsPanel.marketplace-error-package-too-large');
  if (error.code === 'MARKETPLACE_VERSION_REVOKED') return t('pluginSettingsPanel.marketplace-error-revoked');
  if (error.code === 'MARKETPLACE_VERSION_BLOCKED') return t('pluginSettingsPanel.marketplace-error-blocked');
  if (error.code === 'MARKETPLACE_PLUGIN_CHANGED') return t('pluginSettingsPanel.marketplace-error-changed');
  return error.message;
};

/**
 * 插件市场弹窗：遍历所有插件源并列出插件，支持在线安装、更新、启用/停用、卸载；
 * "管理插件源"打开二级弹窗。官方注册表的撤销/拉黑状态在这里叠加显示。
 */
export const PluginMarketplaceDialog: React.FC<PluginMarketplaceDialogProps> = ({ isOpen, onClose, t }) => {
  const { confirm, toast } = useDialog();
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot
  );

  const [state, setState] = useState<MarketplaceState | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPlugin | null>(null);
  const [busyInstallKey, setBusyInstallKey] = useState<string | null>(null);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [officialRegistry, setOfficialRegistry] = useState<PluginRegistry | null>(null);
  /** 并发刷新计数：归零才清除 loading/initializing。 */
  const pendingRefreshCount = useRef(0);

  const refresh = useCallback(async (sourceId?: string) => {
    // 多个源并发刷新：按未完成计数管理加载态，先完成的源不能提前关掉 loading。
    pendingRefreshCount.current += 1;
    setLoading(true);
    try {
      const result = await pluginMarketplaceService.refresh(sourceId ? { sourceId } : undefined);
      if (result.success) setState(result.state);
      else toast(describeMarketplaceError(t, result.error), 'error');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.marketplace-refresh-failed'), 'error');
    } finally {
      pendingRefreshCount.current = Math.max(0, pendingRefreshCount.current - 1);
      if (pendingRefreshCount.current === 0) {
        setLoading(false);
        setInitializing(false);
      }
    }
  }, [t, toast]);

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    setSearch('');
    setSourcesOpen(false);
    setInitializing(true);
    pluginMarketplaceService.getState().then((initial) => {
      if (disposed) return;
      setState(initial);
      // 只补拉还没有目录缓存的源，避免每次打开都把全部源重新遍历一遍
      // （GitHub API 匿名配额很有限）。已有缓存则直接展示，用户可手动刷新。
      for (const entry of initial.entries) {
        if (entry.status === 'pending') void refresh(entry.source.id);
      }
      if (!initial.entries.some((entry) => entry.status === 'pending')) setInitializing(false);
    }).catch(() => {
      if (!disposed) setInitializing(false);
    });
    // 官方注册表撤销/拉黑对照：静默加载，失败不阻塞市场。
    pluginRegistryService.load().then((result) => {
      if (!disposed && result.success) setOfficialRegistry(result.registry);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const installedByPluginId = useMemo(
    () => new Map(snapshot.plugins.map((plugin) => [plugin.manifest.id, plugin])),
    [snapshot.plugins],
  );

  /** 跨源去重：同一插件 id 只保留先遇到的源里的那份。 */
  const groups = useMemo(() => {
    if (!state) return [];
    const seen = new Set<string>();
    return state.entries.map((entry) => ({
      ...entry,
      plugins: entry.plugins.filter((plugin) => {
        if (seen.has(plugin.manifest.id)) return false;
        seen.add(plugin.manifest.id);
        return true;
      }),
    }));
  }, [state]);

  const query = search.trim().toLowerCase();
  const filterPlugin = useCallback((plugin: MarketplacePluginEntry) => !query
    || plugin.manifest.name.toLowerCase().includes(query)
    || plugin.manifest.id.toLowerCase().includes(query)
    || (plugin.manifest.description ?? '').toLowerCase().includes(query), [query]);

  const enable = async (installed: InstalledPlugin) => {
    // 以本地已安装版本的 manifest 为准：目录里的版本可能更新，权限集不一定相同，
    // 而 pluginManager.enable 要求与已安装 manifest 的权限完全一致。
    const prompt = buildPluginEnablePrompt(t, installed.manifest);
    const approved = await confirm(prompt.title, prompt.message, { confirmText: prompt.confirmText, type: 'warning' });
    if (!approved) return;
    setBusyPluginId(installed.manifest.id);
    try {
      const result = await pluginRegistry.enable(installed.manifest.id, installed.manifest.permissions);
      if (!result.success) toast(result.error.message, 'error');
      else toast(t('pluginSettingsPanel.plugin-enabled'), 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-enable-plugin'), 'error');
    } finally {
      setBusyPluginId(null);
    }
  };

  const disable = async (pluginId: string) => {
    setBusyPluginId(pluginId);
    try {
      const result = await pluginRegistry.disable(pluginId);
      if (!result.success) toast(result.error.message, 'error');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-disable-plugin'), 'error');
    } finally {
      setBusyPluginId(null);
    }
  };

  const uninstall = async (removePluginData: boolean) => {
    const target = uninstallTarget;
    setUninstallTarget(null);
    if (!target) return;
    setBusyPluginId(target.manifest.id);
    let result;
    try {
      result = await pluginRegistry.uninstall(target.manifest.id, removePluginData);
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.plugin-uninstall-failed'), 'error');
      return;
    } finally {
      setBusyPluginId(null);
    }
    if (!result.success) {
      toast(result.error.message, 'error');
      return;
    }
    if (removePluginData && result.dataRemoved === false) {
      toast(t('pluginSettingsPanel.plugin-uninstalled-but-some-data-could-not-be-de'), 'warning');
      return;
    }
    toast(removePluginData
      ? t('pluginSettingsPanel.plugin-uninstalled-and-its-data-was-deleted')
      : t('pluginSettingsPanel.plugin-uninstalled-its-data-was-kept'), 'success');
  };

  const install = async (sourceId: string, plugin: MarketplacePluginEntry, replace: boolean) => {
    const key = `${sourceId}:${plugin.directoryName}`;
    setBusyInstallKey(key);
    try {
      const result = await pluginMarketplaceService.install({
        sourceId,
        directoryName: plugin.directoryName,
        // 绑定用户在界面上看到的插件身份：主进程校验下载到的 manifest 与之一致。
        expectedPluginId: plugin.manifest.id,
        expectedVersion: plugin.manifest.version,
        replace,
      });
      if (!result.success) {
        // 某些失败路径（如更新后激活失败）会修改本地插件状态，列表也要跟上。
        await pluginRegistry.refresh();
        toast(describeMarketplaceError(t, result.error), 'error');
        return;
      }
      await pluginRegistry.refresh();
      // 权限一致时主进程会恢复启用状态，此时不需要"请检查权限"的提示。
      if (replace && result.permissionsChanged === false) {
        toast(t('pluginSettingsPanel.marketplace-update-success-still-enabled-v1', { v1: plugin.manifest.name }), 'success');
      } else {
        toast(replace
          ? t('pluginSettingsPanel.marketplace-update-success-v1', { v1: plugin.manifest.name })
          : t('pluginSettingsPanel.marketplace-install-success-v1', { v1: plugin.manifest.name }), 'success');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.plugin-installation-failed'), 'error');
    } finally {
      setBusyInstallKey(null);
    }
  };

  const renderRow = (entry: MarketplaceSourceEntry, plugin: MarketplacePluginEntry) => {
    const manifest = plugin.manifest;
    const installed = installedByPluginId.get(manifest.id);
    const key = `${entry.source.id}:${plugin.directoryName}`;
    const busyInstall = busyInstallKey === key;
    const busyLifecycle = busyPluginId === manifest.id;
    // 防御纵深：目录遍历阶段的 manifest 校验本就会拒绝不支持的 apiVersion，
    // 这里再拦一次，保证未来放宽校验时安装按钮不会放行不兼容版本。
    const apiSupported = SUPPORTED_API_VERSIONS.has(manifest.apiVersion);
    const removal = officialRegistry
      ? findPluginRemoval(officialRegistry.removed, manifest.id, manifest.version)
      : null;
    const updateAvailable = !!installed
      && comparePluginVersions(manifest.version, installed.manifest.version) > 0;
    // block/revoke 针对的是"这个具体版本"：目标版本命中记录时禁止安装与更新；
    // 已安装版本被 revoke 时额外提示立即停用（block 不强制停用已装版本）。
    const installedRemoval = installed
      ? findPluginRemoval(officialRegistry?.removed ?? [], installed.manifest.id, installed.manifest.version)
      : null;
    const installBlocked = removal !== null;

    const visiblePermissions = manifest.permissions.slice(0, 3);
    const extraPermissionCount = manifest.permissions.length - visiblePermissions.length;

    return (
      <li key={key} className="flex items-start justify-between gap-4 px-3 py-3" data-testid={`marketplace-plugin-${manifest.id}`}>
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted">
            <Package className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{manifest.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">v{manifest.version}</span>
              {updateAvailable && (
                <span className="rounded-full bg-status-amber/10 px-2 py-0.5 text-xs text-status-amber">
                  {t('pluginSettingsPanel.update-available-v1', { v1: manifest.version })}
                </span>
              )}
              {removal && (
                <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
                  {removal.action === 'revoke'
                    ? t('pluginSettingsPanel.revoked')
                    : t('pluginSettingsPanel.blocked')}
                </span>
              )}
            </div>
            {manifest.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{manifest.description}</p>
            )}
            {!apiSupported && (
              <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t('pluginSettingsPanel.marketplace-unsupported-api-v1', { v1: manifest.apiVersion })}
              </p>
            )}
            {(removal?.reason || (installedRemoval?.action === 'revoke' ? installedRemoval.reason : null)) && (
              <p className="mt-1 text-xs text-destructive">
                {removal?.reason ?? installedRemoval?.reason}
              </p>
            )}
            {manifest.permissions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visiblePermissions.map((permission) => (
                  <span key={permission} className="rounded bg-muted px-2 py-0.5 font-mono text-[11px]">{permission}</span>
                ))}
                {extraPermissionCount > 0 && (
                  <span className="rounded bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                    {t('pluginSettingsPanel.marketplace-permissions-more-v1', { v1: extraPermissionCount })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busyLifecycle && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {installed ? (
            <>
              <Switch
                checked={installed.enabled}
                disabled={busyLifecycle}
                aria-label={t('pluginSettingsPanel.enable-v1', { v1: manifest.name })}
                onCheckedChange={(checked) => void (checked ? enable(installed) : disable(manifest.id))}
              />
              {installedRemoval?.action === 'revoke' && installed.enabled && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => void disable(manifest.id)}
                >
                  {t('pluginSettingsPanel.disable-now')}
                </Button>
              )}
              {updateAvailable && apiSupported && !installBlocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busyInstall || busyLifecycle}
                  onClick={() => void install(entry.source.id, plugin, true)}
                >
                  {busyInstall && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('pluginSettingsPanel.marketplace-update')}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busyLifecycle}
                aria-label={t('pluginSettingsPanel.uninstall-v1', { v1: manifest.name })}
                onClick={() => setUninstallTarget(installed)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!apiSupported || installBlocked || busyInstall}
              onClick={() => void install(entry.source.id, plugin, false)}
            >
              {busyInstall && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('pluginSettingsPanel.marketplace-install')}
            </Button>
          )}
        </div>
      </li>
    );
  };

  const renderGroup = (entry: MarketplaceSourceEntry) => {
    const sourceLabel = entry.source.name ?? entry.source.url;
    const visiblePlugins = entry.plugins.filter(filterPlugin);
    return (
      <section key={entry.source.id} className="rounded-lg border border-border" data-testid={`marketplace-source-${entry.source.id}`}>
        <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Store className="h-4 w-4 shrink-0 text-muted-foreground" />
            <h4 className="truncate text-sm font-medium">{sourceLabel}</h4>
            <span className="shrink-0 text-xs text-muted-foreground">
              {t('pluginSettingsPanel.marketplace-plugin-count-v1', { v1: entry.plugins.length })}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={loading}
            aria-label={t('pluginSettingsPanel.marketplace-refresh-source-v1', { v1: sourceLabel })}
            onClick={() => void refresh(entry.source.id)}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </header>
        {entry.status === 'error' && entry.error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-destructive/5 px-3 py-2 text-xs text-destructive">
            <span className="min-w-0 break-all">
              {t('pluginSettingsPanel.marketplace-source-error')}{describeMarketplaceError(t, entry.error)} ({entry.error.code})
            </span>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh(entry.source.id)}>
              {t('pluginSettingsPanel.marketplace-retry')}
            </Button>
          </div>
        )}
        {entry.warnings.length > 0 && (
          <details className="border-b border-border px-3 py-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {t('pluginSettingsPanel.marketplace-warnings-v1', { v1: entry.warnings.length })}
            </summary>
            <ul className="mt-1 space-y-1">
              {entry.warnings.map((warning, index) => (
                <li key={`${entry.source.id}-warning-${index}`} className="break-all text-xs text-muted-foreground">{warning}</li>
              ))}
            </ul>
          </details>
        )}
        {visiblePlugins.length === 0 ? (
          <p className="px-3 py-4 text-center text-xs text-muted-foreground">
            {entry.status === 'pending'
              ? t('pluginSettingsPanel.marketplace-source-pending')
              : query
                ? t('pluginSettingsPanel.marketplace-no-search-results')
                : t('pluginSettingsPanel.marketplace-source-empty')}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visiblePlugins.map((plugin) => renderRow(entry, plugin))}
          </ul>
        )}
      </section>
    );
  };

  const hasSources = (state?.sources.length ?? 0) > 0;
  // 没有搜索词时始终渲染源分组：出错或为空的源也要展示各自的错误与空状态。
  const anyVisible = query
    ? groups.some((entry) => entry.plugins.some(filterPlugin))
    : groups.length > 0;

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t('pluginSettingsPanel.community-registry')}
        maxWidth="max-w-4xl"
        scrollable
      >
        <p className="text-sm text-muted-foreground">{t('pluginSettingsPanel.marketplace-description')}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pluginSettingsPanel.marketplace-search-placeholder')}
              className="pl-9"
              aria-label={t('pluginSettingsPanel.marketplace-search-placeholder')}
              data-testid="marketplace-search"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loading || !hasSources}
            onClick={() => void refresh()}
            data-testid="marketplace-refresh"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('pluginSettingsPanel.refresh')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSourcesOpen(true)}
            data-testid="marketplace-manage-sources"
          >
            <Settings2 className="mr-2 h-4 w-4" />
            {t('pluginSettingsPanel.marketplace-manage-sources')}
          </Button>
        </div>

        <div className="mt-4 space-y-4" data-testid="marketplace-plugin-list">
          {initializing ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              {t('pluginSettingsPanel.marketplace-loading')}
            </div>
          ) : !hasSources ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <p className="text-sm text-muted-foreground">{t('pluginSettingsPanel.marketplace-empty')}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t('pluginSettingsPanel.marketplace-empty-hint')}</p>
              <Button type="button" size="sm" className="mt-4" onClick={() => setSourcesOpen(true)}>
                {t('pluginSettingsPanel.sources-add')}
              </Button>
            </div>
          ) : !anyVisible ? (
            <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              {query ? t('pluginSettingsPanel.marketplace-no-search-results') : t('pluginSettingsPanel.marketplace-empty')}
            </div>
          ) : (
            groups.map(renderGroup)
          )}
        </div>
      </Modal>

      <PluginSourcesDialog
        isOpen={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        t={t}
        entries={state?.entries ?? []}
        onChanged={(next) => setState(next)}
      />

      <PluginUninstallDialog
        target={uninstallTarget}
        t={t}
        onClose={() => setUninstallTarget(null)}
        onUninstall={(removePluginData) => void uninstall(removePluginData)}
      />
    </>
  );
};

export default PluginMarketplaceDialog;
