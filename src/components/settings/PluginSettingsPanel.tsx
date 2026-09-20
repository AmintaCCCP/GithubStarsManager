
import { TranslateFn } from '../../i18n/useT';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, FolderPlus, Loader2, Plug, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { pluginClient } from '../../plugins/pluginClient';
import { pluginRegistry } from '../../plugins/pluginRegistry';
import { PluginPageViewer } from '../PluginPageViewer';
import type { InstalledPlugin } from '../../plugins/types';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

interface PluginSettingsPanelProps {
  t: TranslateFn;
}

export const PluginSettingsPanel: React.FC<PluginSettingsPanelProps> = ({ t }) => {
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot
  );
  const { confirm, toast } = useDialog();
  const [loading, setLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<{ pluginId: string; pageId: string } | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPlugin | null>(null);
  const [searchEndpoint, setSearchEndpoint] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      await pluginRegistry.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-load-plugins'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void pluginClient.getSearchEndpoint().then((result) => setSearchEndpoint(result.endpoint ?? '')).catch(() => {
      toast(t('pluginSettingsPanel.failed-to-load-search-service-settings'), 'error');
    });
    // The registry is the source of truth; refresh only when this panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSearchEndpoint = async () => {
    try {
      const result = await pluginClient.configureWebSearch(searchEndpoint.trim() || null);
      toast(result.success
        ? t('pluginSettingsPanel.search-service-settings-saved')
        : result.error.message, result.success ? 'success' : 'error');
    } catch (error) {
      toast(
        error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-save-search-service-settings'),
        'error'
      );
    }
  };

  const enable = async (plugin: InstalledPlugin) => {
    const permissions = plugin.manifest.permissions;
    const permissionText = permissions.length > 0
      ? permissions.map((permission) => `• ${permission}`).join('\n')
      : t('pluginSettingsPanel.no-additional-host-permissions');
    const repositoryDataNotice = permissions.some((permission) =>
      permission === 'repositories:read' || permission === 'privateRepositories:read')
      ? t('pluginSettingsPanel.note-repository-read-access-includes-metadata-of')
      : '';
    const approved = await confirm(
      t('pluginSettingsPanel.enable-v1', { v1: plugin.manifest.name }),
      `${t('pluginSettingsPanel.local-plugins-with-worker-js-have-node-js-access')}\n\n${t('pluginSettingsPanel.requested-permissions')}\n${permissionText}${repositoryDataNotice}`,
      { confirmText: t('pluginSettingsPanel.confirm-and-enable'), type: 'warning' }
    );
    if (!approved) return;

    setBusyPluginId(plugin.manifest.id);
    try {
      const result = await pluginRegistry.enable(plugin.manifest.id, permissions);
      if (!result.success) toast(result.error.message, 'error');
      else toast(t('pluginSettingsPanel.plugin-enabled'), 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-enable-plugin'), 'error');
    } finally {
      setBusyPluginId(null);
    }
  };

  const disable = async (plugin: InstalledPlugin) => {
    setBusyPluginId(plugin.manifest.id);
    try {
      const result = await pluginRegistry.disable(plugin.manifest.id);
      if (!result.success) toast(result.error.message, 'error');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.failed-to-disable-plugin'), 'error');
    } finally {
      setBusyPluginId(null);
    }
  };

  const removePlugin = async (plugin: InstalledPlugin, removePluginData: boolean) => {
    setUninstallTarget(null);
    setBusyPluginId(plugin.manifest.id);
    let result;
    try {
      result = await pluginRegistry.uninstall(plugin.manifest.id, removePluginData);
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

  const install = async () => {
    setLoading(true);
    try {
      const result = await pluginRegistry.installFromDirectory();
      if (!result.success && !result.canceled) {
        toast(result.error?.message || t('pluginSettingsPanel.plugin-installation-failed'), 'error');
      } else if (result.success) {
        toast(t('pluginSettingsPanel.plugin-installed-review-permissions-before-enabl'), 'success');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.plugin-installation-failed'), 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!pluginClient.isSupported()) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        {t('pluginSettingsPanel.the-plugin-system-is-currently-available-only-in')}
      </div>
    );
  }

  const pagePlugin = snapshot.plugins.find((plugin) => plugin.manifest.id === selectedPage?.pluginId);
  const page = pagePlugin?.manifest.contributes.pages?.find((item) => item.id === selectedPage?.pageId);
  if (selectedPage && pagePlugin && page) {
    return <PluginPageViewer
      key={`${pagePlugin.manifest.id}:${page.id}`}
      pluginId={pagePlugin.manifest.id}
      pluginName={pagePlugin.manifest.name}
      pageId={page.id}
      pageTitle={page.title}
      onClose={() => setSelectedPage(null)}
      t={t}
    />;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-border p-4">
        <label htmlFor="plugin-search-endpoint" className="block text-sm font-medium">
          {t('pluginSettingsPanel.plugin-web-search-service-searxng')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('pluginSettingsPanel.enter-a-trusted-https-instance-url-with-json-out')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input id="plugin-search-endpoint" type="url" value={searchEndpoint}
            onChange={(event) => setSearchEndpoint(event.target.value)}
            placeholder="https://search.example.com"
            className="min-w-[240px] flex-1 rounded border border-border bg-background px-3 py-2 text-sm" />
          <Button type="button" variant="outline" onClick={() => void saveSearchEndpoint()}>
            {t('pluginSettingsPanel.save-search-service')}
          </Button>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="h-5 w-5" />
            {t('pluginSettingsPanel.local-plugins')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('pluginSettingsPanel.plugins-load-from-the-app-data-plugins-folder-an')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void install()} disabled={loading}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t('pluginSettingsPanel.install-local-plugin')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('pluginSettingsPanel.refresh')}
          </Button>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-status-amber/40 bg-status-amber/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-amber" />
        <p>{t('pluginSettingsPanel.local-plugins-with-worker-js-are-trusted-code-pa')}</p>
      </div>

      {loading && snapshot.plugins.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('pluginSettingsPanel.scanning-plugins')}
        </div>
      ) : snapshot.plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('pluginSettingsPanel.no-plugins-found')}
        </div>
      ) : (
        <div className="space-y-3">
          {snapshot.plugins.map((plugin) => {
            const busy = busyPluginId === plugin.manifest.id;
            return (
              <div key={plugin.manifest.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">{plugin.manifest.name}</h4>
                      <span className="text-xs text-muted-foreground">v{plugin.manifest.version}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${
                        plugin.status === 'active'
                          ? 'bg-status-green/10 text-status-green'
                          : plugin.status === 'error'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-muted text-muted-foreground'
                      }`}>
                        {plugin.status === 'active' ? t('pluginSettingsPanel.active') : plugin.status === 'error' ? t('pluginSettingsPanel.error') : t('pluginSettingsPanel.disabled')}
                      </span>
                    </div>
                    <p className="mt-1 break-all text-xs text-muted-foreground">{plugin.manifest.id}</p>
                    {plugin.manifest.description && <p className="mt-2 text-sm text-muted-foreground">{plugin.manifest.description}</p>}
                    {plugin.manifest.permissions.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {plugin.manifest.permissions.map((permission) => (
                          <span key={permission} className="rounded bg-muted px-2 py-1 font-mono text-xs">{permission}</span>
                        ))}
                      </div>
                    )}
                    {plugin.status === 'active' && plugin.manifest.contributes.pages?.map((pageContribution) => (
                      <Button
                        key={pageContribution.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 mr-2"
                        onClick={() => setSelectedPage({ pluginId: plugin.manifest.id, pageId: pageContribution.id })}
                      >
                        {t('pluginSettingsPanel.open-page-named', { name: pageContribution.title })}
                      </Button>
                    ))}
                    {plugin.lastError && (
                      <p className="mt-3 flex items-start gap-2 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {plugin.lastError.message}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                    <Switch
                      checked={plugin.enabled}
                      disabled={busy}
                      aria-label={t('pluginSettingsPanel.enable-v1', { v1: plugin.manifest.name })}
                      onCheckedChange={(checked) => void (checked ? enable(plugin) : disable(plugin))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => setUninstallTarget(plugin)}
                      aria-label={t('pluginSettingsPanel.uninstall-v1', { v1: plugin.manifest.name })}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {snapshot.invalidPlugins.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-destructive">{t('pluginSettingsPanel.invalid-plugins')}</h4>
          {snapshot.invalidPlugins.map((plugin) => (
            <div key={`${plugin.directoryName}:${plugin.code}`} className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">{plugin.directoryName}</p>
              <p className="mt-1 text-destructive">{plugin.message} ({plugin.code})</p>
            </div>
          ))}
        </div>
      )}

      <AlertDialog open={uninstallTarget !== null} onOpenChange={(open) => { if (!open) setUninstallTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('pluginSettingsPanel.uninstall-v1', { v1: uninstallTarget?.manifest.name ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap break-all">
              {t('pluginSettingsPanel.the-installed-plugin-directory-is-deleted-choose')}
              {uninstallTarget ? `\n\n${uninstallTarget.manifest.id}` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('pluginSettingsPanel.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (uninstallTarget) void removePlugin(uninstallTarget, false); }}
            >
              {t('pluginSettingsPanel.uninstall-keep-data')}
            </AlertDialogAction>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => { if (uninstallTarget) void removePlugin(uninstallTarget, true); }}
            >
              {t('pluginSettingsPanel.uninstall-and-delete-data')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
