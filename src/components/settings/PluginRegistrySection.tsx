import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Store } from 'lucide-react';
import { TranslateFn } from '../../i18n/useT';
import { pluginRegistry } from '../../plugins/pluginRegistry';
import { pluginMarketplaceService } from '../../services/pluginMarketplaceService';
import type { MarketplaceState } from '../../plugins/types';
import { comparePluginVersions } from '../../utils/pluginRegistryStatus';
import { Button } from '../ui/button';
import { SettingsCard, SettingsRow, SettingsSection } from './SettingsPrimitives';

interface PluginRegistrySectionProps {
  t: TranslateFn;
  onOpenMarketplace: () => void;
  /** 变化时重新读取本地状态：市场弹窗里管理源后，卡片上的统计要跟上。 */
  reloadSignal?: number;
}

/**
 * 社区插件注册表入口卡片。
 *
 * 这里只做入口与概览（源数量、可用插件数量），不直接列出具体插件：
 * 插件的浏览、安装与源的维护都在插件市场弹窗（PluginMarketplaceDialog）里完成。
 */
export const PluginRegistrySection: React.FC<PluginRegistrySectionProps> = ({ t, onOpenMarketplace, reloadSignal = 0 }) => {
  const [state, setState] = useState<MarketplaceState | null>(null);
  const available = pluginMarketplaceService.isAvailable();
  const installedSnapshot = useSyncExternalStore(
    pluginRegistry.subscribe,
    pluginRegistry.getSnapshot,
    pluginRegistry.getSnapshot,
  );

  useEffect(() => {
    if (!available) return;
    let disposed = false;
    pluginMarketplaceService.getState().then((result) => {
      if (!disposed) setState(result);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [available, reloadSignal]);

  if (!available) return null;

  const sourceCount = state?.sources.length ?? 0;
  const pluginCount = state?.entries.reduce((total, entry) => total + entry.plugins.length, 0) ?? 0;
  const firstEntryById = new Map<string, { version: string }>();
  for (const entry of state?.entries ?? []) {
    for (const plugin of entry.plugins) {
      if (!firstEntryById.has(plugin.manifest.id)) {
        firstEntryById.set(plugin.manifest.id, { version: plugin.manifest.version });
      }
    }
  }
  const updatableCount = new Set(
    installedSnapshot.plugins
      .filter((installed) => {
        const catalogEntry = firstEntryById.get(installed.manifest.id);
        return !!catalogEntry && comparePluginVersions(catalogEntry.version, installed.manifest.version) > 0;
      })
      .map((installed) => installed.manifest.id),
  ).size;

  return (
    <SettingsSection title={t('pluginSettingsPanel.community-registry')}>
      <SettingsCard data-testid="plugin-registry">
        <SettingsRow
          icon={<Store />}
          title={t('pluginSettingsPanel.community-registry')}
          description={(
            <>
              <span className="block">{t('pluginSettingsPanel.community-registry-hint')}</span>
              {sourceCount > 0 && (
                <span className="mt-1 block text-label-sm text-tertiary tabular-nums" data-testid="plugin-registry-stats">
                  {t('pluginSettingsPanel.marketplace-sources-count-v1', { v1: sourceCount })}
                  {pluginCount > 0
                    ? ` · ${t('pluginSettingsPanel.marketplace-plugins-count-v1', { v1: pluginCount })}`
                    : ''}
                  {updatableCount > 0
                    ? ` · ${t('pluginSettingsPanel.marketplace-updatable-count-v1', { v1: updatableCount })}`
                    : ''}
                </span>
              )}
            </>
          )}
        >
          <Button type="button" variant="primary" size="sm" onClick={onOpenMarketplace} data-testid="plugin-registry-open">
            {t('pluginSettingsPanel.browse-plugins')}
          </Button>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
};

export default PluginRegistrySection;
