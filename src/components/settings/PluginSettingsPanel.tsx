import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AlertTriangle, FolderPlus, Loader2, Plug, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react';
import { useDialog } from '../../hooks/useDialog';
import { pluginClient } from '../../plugins/pluginClient';
import { pluginRegistry } from '../../plugins/pluginRegistry';
import { PluginPageViewer } from '../PluginPageViewer';
import type { InstalledPlugin } from '../../plugins/types';
import { Button } from '../ui/button';
import { Switch } from '../ui/switch';

interface PluginSettingsPanelProps {
  t: (zh: string, en: string) => string;
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
  const [searchEndpoint, setSearchEndpoint] = useState('');

  const refresh = async () => {
    setLoading(true);
    try {
      await pluginRegistry.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : t('插件列表加载失败', 'Failed to load plugins'), 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void pluginClient.getSearchEndpoint().then((result) => setSearchEndpoint(result.endpoint ?? '')).catch(() => {
      toast(t('搜索服务设置加载失败', 'Failed to load search service settings'), 'error');
    });
    // The registry is the source of truth; refresh only when this panel mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSearchEndpoint = async () => {
    const result = await pluginClient.configureWebSearch(searchEndpoint.trim() || null);
    toast(result.success
      ? t('搜索服务设置已保存', 'Search service settings saved')
      : result.error.message, result.success ? 'success' : 'error');
  };

  const enable = async (plugin: InstalledPlugin) => {
    const permissions = plugin.manifest.permissions;
    const permissionText = permissions.length > 0
      ? permissions.map((permission) => `• ${permission}`).join('\n')
      : t('无额外 Host 权限', 'No additional Host permissions');
    const approved = await confirm(
      t(`启用 ${plugin.manifest.name}`, `Enable ${plugin.manifest.name}`),
      `${t(
        '带 worker.js 的本地插件拥有 Node.js 权限，Worker 不是安全沙箱。仅启用你信任的代码。',
        'Local plugins with worker.js have Node.js access; a Worker is not a security sandbox. Enable only code you trust.'
      )}\n\n${t('请求权限：', 'Requested permissions:')}\n${permissionText}`,
      { confirmText: t('确认并启用', 'Confirm and enable'), type: 'warning' }
    );
    if (!approved) return;

    setBusyPluginId(plugin.manifest.id);
    const result = await pluginRegistry.enable(plugin.manifest.id, permissions);
    setBusyPluginId(null);
    if (!result.success) toast(result.error.message, 'error');
    else toast(t('插件已启用', 'Plugin enabled'), 'success');
  };

  const disable = async (plugin: InstalledPlugin) => {
    setBusyPluginId(plugin.manifest.id);
    const result = await pluginRegistry.disable(plugin.manifest.id);
    setBusyPluginId(null);
    if (!result.success) toast(result.error.message, 'error');
  };

  const uninstall = async (plugin: InstalledPlugin) => {
    const approved = await confirm(
      t('卸载插件', 'Uninstall plugin'),
      t(
        `将删除插件“${plugin.manifest.name}”的安装目录。插件数据暂时保留。是否继续？`,
        `The installed directory for “${plugin.manifest.name}” will be deleted. Plugin data is retained. Continue?`
      ),
      { confirmText: t('卸载', 'Uninstall'), type: 'danger' }
    );
    if (!approved) return;

    setBusyPluginId(plugin.manifest.id);
    const result = await pluginRegistry.uninstall(plugin.manifest.id);
    setBusyPluginId(null);
    if (!result.success) toast(result.error.message, 'error');
    else toast(t('插件已卸载', 'Plugin uninstalled'), 'success');
  };

  const install = async () => {
    setLoading(true);
    const result = await pluginRegistry.installFromDirectory();
    setLoading(false);
    if (!result.success && !result.canceled) {
      toast(result.error?.message || t('插件安装失败', 'Plugin installation failed'), 'error');
    } else if (result.success) {
      toast(t('插件已安装，启用前请检查权限', 'Plugin installed; review permissions before enabling'), 'success');
    }
  };

  if (!pluginClient.isSupported()) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
        {t('插件系统目前仅在 Electron 桌面端可用。', 'The plugin system is currently available only in the Electron desktop app.')}
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
          {t('插件网页搜索服务（SearXNG）', 'Plugin web search service (SearXNG)')}
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('填写你信任的 HTTPS 实例地址；实例需启用 JSON 输出。留空并保存可关闭网页搜索。插件发出搜索词前会逐次确认。',
            'Enter a trusted HTTPS instance URL with JSON output enabled. Save an empty value to disable search. Each plugin query requires confirmation.')}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <input id="plugin-search-endpoint" type="url" value={searchEndpoint}
            onChange={(event) => setSearchEndpoint(event.target.value)}
            placeholder="https://search.example.com"
            className="min-w-[240px] flex-1 rounded border border-border bg-background px-3 py-2 text-sm" />
          <Button type="button" variant="outline" onClick={() => void saveSearchEndpoint()}>
            {t('保存搜索服务', 'Save search service')}
          </Button>
        </div>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <Plug className="h-5 w-5" />
            {t('本地插件', 'Local plugins')}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('插件从应用数据目录的 plugins 文件夹加载，默认禁用。', 'Plugins load from the app-data plugins folder and are disabled by default.')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" size="sm" onClick={() => void install()} disabled={loading}>
            <FolderPlus className="mr-2 h-4 w-4" />
            {t('安装本地插件', 'Install local plugin')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('刷新', 'Refresh')}
          </Button>
        </div>
      </div>

      <div className="flex gap-3 rounded-lg border border-status-amber/40 bg-status-amber/5 p-4 text-sm">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-status-amber" />
        <p>{t(
          '带 worker.js 的本地插件属于受信任代码；页面插件在受限 iframe 中运行。Worker 不能阻止恶意代码访问本机资源。',
          'Local plugins with worker.js are trusted code; page plugins run in a restricted iframe. Workers cannot stop malicious code from accessing local resources.'
        )}</p>
      </div>

      {loading && snapshot.plugins.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('正在扫描插件…', 'Scanning plugins…')}
        </div>
      ) : snapshot.plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {t('尚未发现插件。', 'No plugins found.')}
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
                        {plugin.status === 'active' ? t('已启用', 'Active') : plugin.status === 'error' ? t('错误', 'Error') : t('已禁用', 'Disabled')}
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
                        {t('打开页面：', 'Open page: ')}{pageContribution.title}
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
                      aria-label={t(`启用 ${plugin.manifest.name}`, `Enable ${plugin.manifest.name}`)}
                      onCheckedChange={(checked) => void (checked ? enable(plugin) : disable(plugin))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={busy}
                      onClick={() => void uninstall(plugin)}
                      aria-label={t(`卸载 ${plugin.manifest.name}`, `Uninstall ${plugin.manifest.name}`)}
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
          <h4 className="font-medium text-destructive">{t('无法加载的插件', 'Invalid plugins')}</h4>
          {snapshot.invalidPlugins.map((plugin) => (
            <div key={`${plugin.directoryName}:${plugin.code}`} className="rounded border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium">{plugin.directoryName}</p>
              <p className="mt-1 text-destructive">{plugin.message} ({plugin.code})</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
