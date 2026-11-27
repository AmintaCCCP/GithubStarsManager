import { TranslateFn } from '../../i18n/useT';
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, FolderPlus, Loader2, Palette, Plug, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { pluginClient } from '../../plugins/pluginClient';
import { pluginRegistry } from '../../plugins/pluginRegistry';
import { buildPluginEnablePrompt } from '../../plugins/pluginEnablePrompt';
import { PluginIcon } from '../../plugins/pluginIcons';
import { PluginPageViewer } from '../PluginPageViewer';
import { PluginIconPickerDialog } from './PluginIconPickerDialog';
import { PluginMarketplaceDialog } from './PluginMarketplaceDialog';
import { PluginRegistrySection } from './PluginRegistrySection';
import { PluginUninstallDialog } from './PluginUninstallDialog';
import type { InstalledPlugin } from '../../plugins/types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Switch } from '../ui/switch';
import {
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsPageStack,
  SettingsSection,
} from './SettingsPrimitives';

interface PluginSettingsPanelProps {
  t: TranslateFn;
}

export const PluginSettingsPanel: React.FC<PluginSettingsPanelProps> = ({ t }) => {
  const snapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot,
  );
  const { confirm, toast } = useDialog();
  const [loading, setLoading] = useState(true);
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<{ pluginId: string; pageId: string } | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<InstalledPlugin | null>(null);
  const [iconPickerTarget, setIconPickerTarget] = useState<InstalledPlugin | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const [marketplaceReloadSignal, setMarketplaceReloadSignal] = useState(0);
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
        'error',
      );
    }
  };

  const enable = async (plugin: InstalledPlugin) => {
    const prompt = buildPluginEnablePrompt(t, plugin.manifest);
    const approved = await confirm(prompt.title, prompt.message, { confirmText: prompt.confirmText, type: 'warning' });
    if (!approved) return;

    setBusyPluginId(plugin.manifest.id);
    try {
      const result = await pluginRegistry.enable(plugin.manifest.id, plugin.manifest.permissions);
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
      <SettingsNotice tone="neutral">
        {t('pluginSettingsPanel.the-plugin-system-is-currently-available-only-in')}
      </SettingsNotice>
    );
  }

  const pagePlugin = snapshot.plugins.find((plugin) => plugin.manifest.id === selectedPage?.pluginId);

  const page = pagePlugin?.manifest.contributes.pages?.find((item) => item.id === selectedPage?.pageId);
  if (selectedPage && pagePlugin && page) {
    return (
      <PluginPageViewer
        key={`${pagePlugin.manifest.id}:${page.id}`}
        pluginId={pagePlugin.manifest.id}
        pluginName={pagePlugin.manifest.name}
        pageId={page.id}
        pageTitle={page.title}
        onClose={() => setSelectedPage(null)}
        t={t}
      />
    );
  }

  return (
    <SettingsPageStack>
      <SettingsSection title={t('pluginSettingsPanel.plugin-web-search-service-searxng')}>
        <SettingsCard className="space-y-3 p-3.5">
          <div>
            <label htmlFor="plugin-search-endpoint" className="block text-label font-medium text-foreground">
              {t('pluginSettingsPanel.plugin-web-search-service-searxng')}
            </label>
            <p className="mt-px text-label-sm text-secondary">
              {t('pluginSettingsPanel.enter-a-trusted-https-instance-url-with-json-out')}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Input
              id="plugin-search-endpoint"
              type="url"
              value={searchEndpoint}
              onChange={(event) => setSearchEndpoint(event.target.value)}
              placeholder="https://search.example.com"
              className="min-w-[240px] flex-1"
            />
            <Button type="button" variant="outline" size="lg" onClick={() => void saveSearchEndpoint()}>
              {t('pluginSettingsPanel.save-search-service')}
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      <PluginRegistrySection
        t={t}
        onOpenMarketplace={() => setMarketplaceOpen(true)}
        reloadSignal={marketplaceReloadSignal}
      />

      <SettingsSection
        title={t('pluginSettingsPanel.local-plugins')}
        description={t('pluginSettingsPanel.plugins-load-from-the-app-data-plugins-folder-an')}
        actions={(
          <div className="flex items-center gap-2">
            <Button type="button" variant="primary" size="sm" onClick={() => void install()} disabled={loading}>
              <FolderPlus className="size-3.5" />
              <span>{t('pluginSettingsPanel.install-local-plugin')}</span>
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
              <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('pluginSettingsPanel.refresh')}</span>
            </Button>
          </div>
        )}
      >
        <SettingsNotice tone="warning" icon={<ShieldAlert />}>
          {t('pluginSettingsPanel.local-plugins-with-worker-js-are-trusted-code-pa')}
        </SettingsNotice>

        {loading && snapshot.plugins.length === 0 ? (
          <SettingsCard className="flex items-center justify-center gap-2 py-12 text-label text-secondary">
            <Loader2 className="size-4 animate-spin text-tertiary" />
            <span>{t('pluginSettingsPanel.scanning-plugins')}</span>
          </SettingsCard>
        ) : snapshot.plugins.length === 0 ? (
          <SettingsCard className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
            <Plug className="size-9 text-tertiary stroke-[1.5]" aria-hidden="true" />
            <p className="text-label text-secondary">
              {t('pluginSettingsPanel.no-plugins-found')}
            </p>
          </SettingsCard>
        ) : (
          <SettingsCard>
            {snapshot.plugins.map((plugin, index) => {
              const busy = busyPluginId === plugin.manifest.id;
              return (
                <React.Fragment key={plugin.manifest.id}>
                  {index > 0 && <SettingsDivider />}
                  <div className="px-3.5 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <PluginIcon pluginId={plugin.manifest.id} className="size-4 shrink-0 text-tertiary" />
                          <h4 className="text-label font-medium text-foreground">{plugin.manifest.name}</h4>
                          <span className="text-label-sm text-tertiary tabular-nums">v{plugin.manifest.version}</span>
                          <Badge
                            variant={
                              plugin.status === 'active'
                                ? 'success'
                                : plugin.status === 'error'
                                  ? 'destructive'
                                  : 'secondary'
                            }
                          >
                            {plugin.status === 'active'
                              ? t('pluginSettingsPanel.active')
                              : plugin.status === 'error'
                                ? t('pluginSettingsPanel.error')
                                : t('pluginSettingsPanel.disabled')}
                          </Badge>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setIconPickerTarget(plugin)}
                            className="text-secondary hover:text-foreground"
                            aria-label={t('pluginSettingsPanel.customize-icon')}
                            title={t('pluginSettingsPanel.customize-icon')}
                          >
                            <Palette className="size-3.5" />
                            <span>{t('pluginSettingsPanel.customize-icon')}</span>
                          </Button>
                        </div>
                        <p className="mt-1 break-all font-mono text-caption text-tertiary">{plugin.manifest.id}</p>
                        {plugin.manifest.description && (
                          <p className="mt-1.5 text-label-sm leading-[18px] text-secondary">{plugin.manifest.description}</p>
                        )}
                        {plugin.manifest.permissions.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            {plugin.manifest.permissions.map((permission) => (
                              <span
                                key={permission}
                                className="rounded-xs bg-fill-hover px-1.5 py-0.5 font-mono text-caption text-secondary"
                              >
                                {permission}
                              </span>
                            ))}
                          </div>
                        )}
                        {plugin.status === 'active' && plugin.manifest.contributes.pages && plugin.manifest.contributes.pages.length > 0 && (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            {plugin.manifest.contributes.pages.map((pageContribution) => (
                              <Button
                                key={pageContribution.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => setSelectedPage({ pluginId: plugin.manifest.id, pageId: pageContribution.id })}
                              >
                                {t('pluginSettingsPanel.open-page-named', { name: pageContribution.title })}
                              </Button>
                            ))}
                          </div>
                        )}
                        {plugin.lastError && (
                          <p className="mt-2.5 flex items-start gap-2 text-label-sm text-destructive">
                            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                            <span>{plugin.lastError.message}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {busy && <Loader2 className="size-4 animate-spin text-tertiary" />}
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
                          className="text-destructive hover:bg-destructive-tint hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </SettingsCard>
        )}
      </SettingsSection>

      {snapshot.invalidPlugins.length > 0 && (
        <SettingsSection title={<span className="text-destructive">{t('pluginSettingsPanel.invalid-plugins')}</span>}>
          <SettingsCard className="ring-1 ring-destructive/25">
            {snapshot.invalidPlugins.map((plugin, index) => (
              <React.Fragment key={`${plugin.directoryName}:${plugin.code}`}>
                {index > 0 && <SettingsDivider />}
                <div className="bg-destructive-tint/50 px-3.5 py-2.5 text-label-sm">
                  <p className="font-medium text-foreground">{plugin.directoryName}</p>
                  <p className="mt-0.5 text-destructive">{plugin.message} ({plugin.code})</p>
                </div>
              </React.Fragment>
            ))}
          </SettingsCard>
        </SettingsSection>
      )}

      <PluginUninstallDialog
        target={uninstallTarget}
        t={t}
        onClose={() => setUninstallTarget(null)}
        onUninstall={(removePluginData) => {
          if (uninstallTarget) void removePlugin(uninstallTarget, removePluginData);
        }}
      />

      <PluginIconPickerDialog
        target={iconPickerTarget}
        t={t}
        onClose={() => setIconPickerTarget(null)}
      />

      <PluginMarketplaceDialog
        isOpen={marketplaceOpen}
        onClose={() => {
          setMarketplaceOpen(false);
          setMarketplaceReloadSignal((signal) => signal + 1);
        }}
        t={t}
      />
    </SettingsPageStack>
  );
};
