import React, { useEffect, useState } from 'react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { TranslateFn } from '../../i18n/useT';
import { useDialog } from '../../hooks/useDialog';
import { pluginMarketplaceService } from '../../services/pluginMarketplaceService';
import type { MarketplaceSourceEntry, MarketplaceState } from '../../plugins/types';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Modal } from '../Modal';

interface PluginSourcesDialogProps {
  isOpen: boolean;
  onClose: () => void;
  t: TranslateFn;
  entries: MarketplaceSourceEntry[];
  /** 源增删改成功后把主进程返回的最新状态交给父级（父级据此刷新插件列表）。 */
  onChanged: (state: MarketplaceState) => void;
}

interface EditingSource {
  /** null 表示新增；否则是编辑中的源 id。 */
  id: string | null;
  url: string;
  name: string;
}

// 宽松预检：只拦明显的非 GitHub 地址；完整形态校验（含 tree 解析）由主进程负责。
const GITHUB_URL_PATTERN = /^https:\/\/github\.com\/[^\s/]+\/[^\s/]+(?:\/[^\s]+)?\/?$/i;

/**
 * 插件源管理弹窗：源是 GitHub 仓库目录，增删改后主进程会立即重新遍历。
 * "查"由列表本身承担；插件的浏览在父级市场弹窗里。
 */
export const PluginSourcesDialog: React.FC<PluginSourcesDialogProps> = ({ isOpen, onClose, t, entries, onChanged }) => {
  const { confirm, toast } = useDialog();
  const [editing, setEditing] = useState<EditingSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 弹窗关闭时清掉未提交的表单，避免下次打开带着半截输入。
  useEffect(() => {
    if (!isOpen) {
      setEditing(null);
      setFormError(null);
    }
  }, [isOpen]);

  const startAdd = () => {
    setFormError(null);
    setEditing({ id: null, url: '', name: '' });
  };

  const startEdit = (entry: MarketplaceSourceEntry) => {
    setFormError(null);
    setEditing({ id: entry.source.id, url: entry.source.url, name: entry.source.name ?? '' });
  };

  const submit = async () => {
    if (!editing) return;
    const url = editing.url.trim();
    if (!GITHUB_URL_PATTERN.test(url)) {
      setFormError(t('pluginSettingsPanel.sources-url-invalid'));
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const name = editing.name.trim();
      const result = editing.id
        ? await pluginMarketplaceService.updateSource({
          id: editing.id,
          url,
          ...(name ? { name } : { name: '' }),
        })
        : await pluginMarketplaceService.addSource({
          url,
          ...(name ? { name } : {}),
        });
      if (!result.success) {
        setFormError(result.error.message);
        return;
      }
      onChanged(result.state);
      setEditing(null);
      toast(t('pluginSettingsPanel.sources-saved'), 'success');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t('pluginSettingsPanel.marketplace-install-failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: MarketplaceSourceEntry) => {
    const sourceLabel = entry.source.name ?? entry.source.url;
    const approved = await confirm(
      t('pluginSettingsPanel.sources-remove-title'),
      t('pluginSettingsPanel.sources-remove-message-v1', { v1: sourceLabel }),
      { confirmText: t('pluginSettingsPanel.sources-remove-confirm'), type: 'warning' }
    );
    if (!approved) return;
    setBusy(true);
    try {
      const result = await pluginMarketplaceService.removeSource({ id: entry.source.id });
      if (result.success) {
        onChanged(result.state);
        toast(t('pluginSettingsPanel.sources-removed'), 'success');
      } else {
        toast(result.error.message, 'error');
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : t('pluginSettingsPanel.marketplace-install-failed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('pluginSettingsPanel.sources-title')}
      maxWidth="max-w-2xl"
      scrollable
    >
      <p className="text-sm text-muted-foreground">{t('pluginSettingsPanel.sources-description')}</p>

      {editing === null ? (
        <div className="mt-4">
          <Button type="button" size="sm" onClick={startAdd} disabled={busy} data-testid="plugin-sources-add">
            <Plus className="mr-2 h-4 w-4" />
            {t('pluginSettingsPanel.sources-add')}
          </Button>
        </div>
      ) : null}

      {editing !== null ? (
        <form
          className="mt-4 space-y-3 rounded-lg border border-border p-4"
          data-testid="plugin-sources-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor="plugin-source-name" className="block text-sm font-medium">
              {t('pluginSettingsPanel.sources-name')}
            </label>
            <Input
              id="plugin-source-name"
              value={editing.name}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              placeholder={t('pluginSettingsPanel.sources-name-placeholder')}
              className="mt-1"
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="plugin-source-url" className="block text-sm font-medium">
              {t('pluginSettingsPanel.sources-url')}
            </label>
            <Input
              id="plugin-source-url"
              value={editing.url}
              onChange={(event) => setEditing({ ...editing, url: event.target.value })}
              placeholder={t('pluginSettingsPanel.sources-url-placeholder')}
              className="mt-1 font-mono text-xs"
              maxLength={2048}
              required
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('pluginSettingsPanel.sources-url-hint')}</p>
          </div>
          {formError && <p className="text-xs text-destructive" data-testid="plugin-sources-form-error">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)} disabled={busy}>
              {t('pluginSettingsPanel.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('pluginSettingsPanel.sources-save')}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mt-4 space-y-2" data-testid="plugin-sources-list">
        {entries.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {t('pluginSettingsPanel.sources-empty')}
          </div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.source.id}
              className="flex items-center justify-between gap-3 rounded border border-border px-3 py-2"
              data-testid={`plugin-source-${entry.source.id}`}
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{entry.source.name ?? entry.source.url}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{entry.source.url}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={t('pluginSettingsPanel.sources-edit-source-v1', { v1: entry.source.name ?? entry.source.url })}
                  onClick={() => startEdit(entry)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  aria-label={t('pluginSettingsPanel.sources-remove-source-v1', { v1: entry.source.name ?? entry.source.url })}
                  onClick={() => void remove(entry)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
};

export default PluginSourcesDialog;
