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
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import { PluginSourcesDialog } from './PluginSourcesDialog';
import { PluginUninstallDialog } from './PluginUninstallDialog';
import { SettingsCard, SettingsDivider } from './SettingsPrimitives';

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

  /**
   * 已撤销的已安装插件孤儿列表：这些插件不在任何源的目录条目里（源被删或
   * 目录里下架了），市场行不会渲染它们，但官方注册表仍判了撤销——必须独立
   * 提示"立即停用"，不能依赖市场行才看见。
   */
  const orphanRevoked = useMemo(() => {
    if (!officialRegistry) return [];
    const inMarketplace = new Set(groups.flatMap((entry) => entry.plugins.map((plugin) => plugin.manifest.id)));
    return snapshot.plugins
      .filter((installed) => !inMarketplace.has(installed.manifest.id))
      .map((installed) => ({
        installed,
        removal: findPluginRemoval(officialRegistry.removed, installed.manifest.id, installed.manifest.version),
      }))
      .filter((item) => item.removal?.action === 'revoke');
  }, [groups, snapshot.plugins, officialRegistry]);

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
      // 主进程明确说"替换后仍处于启用"时才展示保持启用的提示；
      // 其他情况（含停用插件更新、权限变化）提示检查权限后再启用。
      if (replace && result.keptEnabled === true) {
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
      <li key={key} className="flex items-start justify-between gap-4 px-3.5 py-3" data-testid={`marketplace-plugin-${manifest.id}`}>
        <div className="flex min-w-0 gap-3">
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-sunken text-tertiary shadow-elev-0">
            <Package className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-label font-medium text-foreground">{manifest.name}</span>
              <span className="shrink-0 text-label-sm text-tertiary tabular-nums">v{manifest.version}</span>
              {updateAvailable && (
                <Badge variant="outline" className="border-warning/30 bg-warning-tint text-warning">
                  {t('pluginSettingsPanel.update-available-v1', { v1: manifest.version })}
                </Badge>
              )}
              {removal && (
                <Badge variant="destructive">
                  {removal.action === 'revoke'
                    ? t('pluginSettingsPanel.revoked')
                    : t('pluginSettingsPanel.blocked')}
                </Badge>
              )}
            </div>
            {manifest.description && (
              <p className="mt-0.5 line-clamp-2 text-label-sm leading-[18px] text-secondary">{manifest.description}</p>
            )}
            {!apiSupported && (
              <p className="mt-1 flex items-center gap-1 text-label-sm text-destructive">
                <AlertTriangle className="size-3.5" />
                <span>{t('pluginSettingsPanel.marketplace-unsupported-api-v1', { v1: manifest.apiVersion })}</span>
              </p>
            )}
            {(removal?.reason || (installedRemoval?.action === 'revoke' ? installedRemoval.reason : null)) && (
              <p className="mt-1 text-label-sm text-destructive">
                {removal?.reason ?? installedRemoval?.reason}
              </p>
            )}
            {manifest.permissions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {visiblePermissions.map((permission) => (
                  <span key={permission} className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-caption text-secondary">{permission}</span>
                ))}
                {extraPermissionCount > 0 && (
                  <span className="rounded-xs bg-fill-hover px-1.5 py-0.5 text-caption text-tertiary">
                    {t('pluginSettingsPanel.marketplace-permissions-more-v1', { v1: extraPermissionCount })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {busyLifecycle && <Loader2 className="size-4 animate-spin text-tertiary" />}
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
                  variant="danger-solid"
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
                  {busyInstall && <Loader2 className="size-3.5 animate-spin" />}
                  <span>{t('pluginSettingsPanel.marketplace-update')}</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busyLifecycle}
                aria-label={t('pluginSettingsPanel.uninstall-v1', { v1: manifest.name })}
                onClick={() => setUninstallTarget(installed)}
                className="text-destructive hover:bg-destructive-tint hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </Button>
            </>
          ) : (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={!apiSupported || installBlocked || busyInstall}
              onClick={() => void install(entry.source.id, plugin, false)}
            >
              {busyInstall && <Loader2 className="size-3.5 animate-spin" />}
              <span>{t('pluginSettingsPanel.marketplace-install')}</span>
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
      <section key={entry.source.id} className="overflow-hidden rounded-lg bg-raised shadow-elev-1" data-testid={`marketplace-source-${entry.source.id}`}>
        <header className="flex items-center justify-between gap-2 border-b border-subtle px-3.5 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <Store className="size-4 shrink-0 text-tertiary" />
            <h4 className="truncate text-label font-medium text-foreground">{sourceLabel}</h4>
            <span className="shrink-0 text-label-sm text-tertiary tabular-nums">
              {t('pluginSettingsPanel.marketplace-plugin-count-v1', { v1: entry.plugins.length })}
            </span>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={loading}
            aria-label={t('pluginSettingsPanel.marketplace-refresh-source-v1', { v1: sourceLabel })}
            onClick={() => void refresh(entry.source.id)}
          >
            <RefreshCw className={`size-3.5 text-secondary ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </header>
        {entry.status === 'error' && entry.error && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-subtle bg-destructive-tint px-3.5 py-2 text-label-sm text-destructive">
            <span className="min-w-0 break-all">
              {t('pluginSettingsPanel.marketplace-source-error')}{describeMarketplaceError(t, entry.error)} ({entry.error.code})
            </span>
            <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh(entry.source.id)}>
              {t('pluginSettingsPanel.marketplace-retry')}
            </Button>
          </div>
        )}
        {entry.warnings.length > 0 && (
          <details className="border-b border-subtle px-3.5 py-2">
            <summary className="cursor-pointer text-label-sm text-secondary">
              {t('pluginSettingsPanel.marketplace-warnings-v1', { v1: entry.warnings.length })}
            </summary>
            <ul className="mt-1 space-y-1">
              {entry.warnings.map((warning, index) => (
                <li key={`${entry.source.id}-warning-${index}`} className="break-all text-label-sm text-secondary">{warning}</li>
              ))}
            </ul>
          </details>
        )}
        {visiblePlugins.length === 0 ? (
          <p className="px-3.5 py-5 text-center text-label-sm text-secondary">
            {entry.status === 'pending'
              ? t('pluginSettingsPanel.marketplace-source-pending')
              : query
                ? t('pluginSettingsPanel.marketplace-no-search-results')
                : t('pluginSettingsPanel.marketplace-source-empty')}
          </p>
        ) : (
          <ul className="divide-y divide-subtle">
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
        fullscreen
        scrollable
      >
        <p className="text-label text-secondary">{t('pluginSettingsPanel.marketplace-description')}</p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('pluginSettingsPanel.marketplace-search-placeholder')}
              className="pl-8"
              aria-label={t('pluginSettingsPanel.marketplace-search-placeholder')}
              data-testid="marketplace-search"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="md"
            disabled={loading || !hasSources}
            onClick={() => void refresh()}
            data-testid="marketplace-refresh"
          >
            <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{t('pluginSettingsPanel.refresh')}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={() => setSourcesOpen(true)}
            data-testid="marketplace-manage-sources"
          >
            <Settings2 className="size-3.5" />
            <span>{t('pluginSettingsPanel.marketplace-manage-sources')}</span>
          </Button>
        </div>

        <div className="mt-4 space-y-4" data-testid="marketplace-plugin-list">
          {initializing ? (
            <div className="flex items-center justify-center gap-2 py-12 text-label text-secondary">
              <Loader2 className="size-4 animate-spin text-tertiary" />
              <span>{t('pluginSettingsPanel.marketplace-loading')}</span>
            </div>
          ) : !hasSources ? (
            <SettingsCard className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <Store className="size-10 text-tertiary stroke-[1.5]" aria-hidden="true" />
              <p className="text-label font-medium text-foreground">{t('pluginSettingsPanel.marketplace-empty')}</p>
              <p className="max-w-sm text-label-sm text-secondary">{t('pluginSettingsPanel.marketplace-empty-hint')}</p>
              <Button type="button" variant="primary" size="sm" className="mt-2" onClick={() => setSourcesOpen(true)}>
                {t('pluginSettingsPanel.sources-add')}
              </Button>
            </SettingsCard>
          ) : !anyVisible ? (
            <SettingsCard className="px-6 py-10 text-center text-label-sm text-secondary">
              {query ? t('pluginSettingsPanel.marketplace-no-search-results') : t('pluginSettingsPanel.marketplace-empty')}
            </SettingsCard>
          ) : (
            groups.map(renderGroup)
          )}

          {orphanRevoked.length > 0 && (
            <section className="overflow-hidden rounded-lg bg-raised shadow-elev-1 ring-1 ring-destructive/30" data-testid="marketplace-revoked-section">
              <h4 className="border-b border-destructive/20 bg-destructive-tint px-3.5 py-2 text-label font-semibold text-destructive">
                {t('pluginSettingsPanel.marketplace-orphaned-revoked-title')}
              </h4>
              <div>
                {orphanRevoked.map(({ installed, removal }, index) => (
                  <React.Fragment key={installed.manifest.id}>
                    {index > 0 && <SettingsDivider />}
                    <div className="flex items-start justify-between gap-3 px-3.5 py-3" data-testid={`marketplace-revoked-${installed.manifest.id}`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-label font-medium text-foreground">{installed.manifest.name}</span>
                          <span className="shrink-0 text-label-sm text-tertiary tabular-nums">v{installed.manifest.version}</span>
                          <Badge variant="destructive">
                            {t('pluginSettingsPanel.revoked')}
                          </Badge>
                        </div>
                        {removal?.reason && <p className="mt-1 text-label-sm text-destructive">{removal.reason}</p>}
                      </div>
                      {installed.enabled && (
                        <Button
                          type="button"
                          variant="danger-solid"
                          size="sm"
                          disabled={busyPluginId === installed.manifest.id}
                          onClick={() => void disable(installed.manifest.id)}
                        >
                          {t('pluginSettingsPanel.disable-now')}
                        </Button>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </section>
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
