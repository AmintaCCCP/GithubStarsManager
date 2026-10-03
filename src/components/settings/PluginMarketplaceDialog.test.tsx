import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginMarketplaceDialog } from './PluginMarketplaceDialog';
import { makeT } from '../../i18n/useT';
import type { InstalledPlugin, MarketplaceState } from '../../plugins/types';

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot = { plugins: [] as InstalledPlugin[], invalidPlugins: [] };
  return {
    isAvailable: vi.fn(() => true),
    getState: vi.fn(),
    refresh: vi.fn(),
    install: vi.fn(),
    addSource: vi.fn(),
    updateSource: vi.fn(),
    removeSource: vi.fn(),
    loadOfficialRegistry: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
    uninstall: vi.fn(),
    refreshInstalled: vi.fn(),
    toast: vi.fn(),
    confirm: vi.fn(),
    setStoreSnapshot(next: { plugins: InstalledPlugin[]; invalidPlugins: never[] }) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    store: {
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      getSnapshot() {
        return snapshot;
      },
    },
  };
});

vi.mock('../../services/pluginMarketplaceService', () => ({
  pluginMarketplaceService: {
    isAvailable: mocks.isAvailable,
    getState: mocks.getState,
    refresh: mocks.refresh,
    install: mocks.install,
    addSource: mocks.addSource,
    updateSource: mocks.updateSource,
    removeSource: mocks.removeSource,
  },
}));

vi.mock('../../services/pluginRegistryService', () => ({
  pluginRegistryService: {
    load: mocks.loadOfficialRegistry,
  },
}));

vi.mock('../../plugins/pluginRegistry', () => ({
  pluginRegistry: {
    subscribe: mocks.store.subscribe,
    getSnapshot: mocks.store.getSnapshot,
    enable: mocks.enable,
    disable: mocks.disable,
    uninstall: mocks.uninstall,
    refresh: mocks.refreshInstalled,
  },
}));

vi.mock('../../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast, confirm: mocks.confirm }),
}));

const t = makeT('zh', 'app');

const sourceEntry = (sourceId: string, url: string, name?: string) => ({
  source: { id: sourceId, url, ...(name ? { name } : {}), addedAt: '2026-10-01T00:00:00.000Z' },
});

const entryManifest = (overrides: Record<string, unknown> = {}) => ({
  manifestVersion: 1,
  id: 'com.example.fixture',
  name: 'Fixture',
  version: '1.0.0',
  apiVersion: '1',
  permissions: ['storage'],
  contributes: {},
  ...overrides,
});

const marketplaceState = (): MarketplaceState => ({
  sources: [{ id: 'src-1', url: 'https://github.com/owner/repo/tree/main/plugins', name: 'owner/repo', addedAt: '2026-10-01T00:00:00.000Z' }],
  entries: [{
    ...sourceEntry('src-1', 'https://github.com/owner/repo/tree/main/plugins', 'owner/repo'),
    status: 'ok',
    plugins: [
      { directoryName: 'fixture', manifest: entryManifest() },
      { directoryName: 'next-version', manifest: entryManifest({ id: 'com.example.updatable', name: 'Updatable', version: '2.0.0' }) },
    ],
    warnings: [],
    error: null,
    fetchedAt: '2026-10-01T00:00:00.000Z',
  }],
});

const installedPlugin = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  directoryName: 'com.example.fixture',
  enabled: false,
  status: 'disabled',
  grantedPermissions: ['storage'],
  manifest: entryManifest(),
  ...overrides,
} as InstalledPlugin);

const renderDialog = () => render(<PluginMarketplaceDialog isOpen onClose={() => {}} t={t} />);

/** 等到目录数据真正渲染出第一行插件（列表容器始终存在，不能作为就绪信号）。 */
const waitForCatalog = async () => {
  await waitFor(() => expect(screen.getByTestId('marketplace-plugin-com.example.fixture')).toBeInTheDocument());
};

describe('PluginMarketplaceDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAvailable.mockReturnValue(true);
    mocks.getState.mockResolvedValue(marketplaceState());
    mocks.loadOfficialRegistry.mockResolvedValue({
      success: true,
      registry: { fetchedAt: '', plugins: [], removed: [], rejected: [], error: null },
    });
    mocks.refreshInstalled.mockResolvedValue(undefined);
    mocks.confirm.mockResolvedValue(true);
  });

  it('lists plugins grouped by source with their version and permissions', async () => {
    renderDialog();
    await waitForCatalog();

    expect(screen.getByText('owner/repo')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-plugin-com.example.fixture')).toHaveTextContent('Fixture');
    expect(screen.getByTestId('marketplace-plugin-com.example.fixture')).toHaveTextContent('v1.0.0');
    expect(screen.getByTestId('marketplace-plugin-com.example.fixture')).toHaveTextContent('storage');
    expect(within(screen.getByTestId('marketplace-plugin-com.example.fixture')).getByRole('button', { name: '安装' })).toBeInTheDocument();
  });

  it('installs an available plugin and refreshes the installed list', async () => {
    mocks.install.mockResolvedValue({ success: true, pluginId: 'com.example.fixture' });
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    const row = screen.getByTestId('marketplace-plugin-com.example.fixture');
    await user.click(within(row).getByRole('button', { name: '安装' }));

    await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledWith({
      sourceId: 'src-1',
      directoryName: 'fixture',
      expectedPluginId: 'com.example.fixture',
      expectedVersion: '1.0.0',
      replace: false,
    }));
    await vi.waitFor(() => expect(mocks.refreshInstalled).toHaveBeenCalled());
    expect(mocks.toast).toHaveBeenCalledWith('已安装 Fixture，启用前请检查权限。', 'success');
  });

  it('enables an installed plugin only after the permission confirmation', async () => {
    mocks.setStoreSnapshot({ plugins: [installedPlugin()], invalidPlugins: [] });
    mocks.enable.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.click(screen.getByRole('switch', { name: '启用 Fixture' }));

    expect(mocks.confirm).toHaveBeenCalledWith(
      '启用 Fixture',
      expect.stringContaining('storage'),
      expect.objectContaining({ type: 'warning' }),
    );
    await vi.waitFor(() => expect(mocks.enable).toHaveBeenCalledWith('com.example.fixture', ['storage']));
  });

  it('does not enable when the user declines the confirmation', async () => {
    mocks.setStoreSnapshot({ plugins: [installedPlugin()], invalidPlugins: [] });
    mocks.confirm.mockResolvedValue(false);
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.click(screen.getByRole('switch', { name: '启用 Fixture' }));

    expect(mocks.enable).not.toHaveBeenCalled();
  });

  it('shows the update action when the source has a newer version and installs with replace', async () => {
    mocks.setStoreSnapshot({
      plugins: [installedPlugin({
        manifest: entryManifest({ id: 'com.example.updatable', name: 'Updatable', version: '1.0.0' }),
      })],
      invalidPlugins: [],
    });
    mocks.install.mockResolvedValue({ success: true, pluginId: 'com.example.updatable' });
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    const row = screen.getByTestId('marketplace-plugin-com.example.updatable');
    expect(row).toHaveTextContent('有新版本 2.0.0');

    await user.click(screen.getByRole('button', { name: '更新' }));
    await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledWith({
      sourceId: 'src-1',
      directoryName: 'next-version',
      expectedPluginId: 'com.example.updatable',
      expectedVersion: '2.0.0',
      replace: true,
    }));
  });

  it('filters plugins by the search query', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.type(screen.getByTestId('marketplace-search'), 'Updatable');

    expect(screen.getByTestId('marketplace-plugin-com.example.updatable')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-plugin-com.example.fixture')).not.toBeInTheDocument();
  });

  it('surfaces a source error and retries just that source', async () => {
    mocks.getState.mockResolvedValue({
      sources: [{ id: 'src-1', url: 'https://github.com/owner/repo/tree/main/plugins', name: 'owner/repo', addedAt: '' }],
      entries: [{
        ...sourceEntry('src-1', 'https://github.com/owner/repo/tree/main/plugins'),
        status: 'error',
        plugins: [],
        warnings: [],
        error: { code: 'SOURCE_LIST_TIMEOUT', message: 'Request timed out' },
        fetchedAt: null,
      }],
    });
    mocks.refresh.mockResolvedValue({ success: true, state: marketplaceState() });
    const user = userEvent.setup();
    renderDialog();
    // SOURCE_LIST_TIMEOUT 会被映射成用户可读的超时提示，而非透传原始消息。
    await waitFor(() => expect(screen.getByTestId('marketplace-plugin-list')).toHaveTextContent('请求超时'));

    await user.click(screen.getByRole('button', { name: '重试' }));
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledWith({ sourceId: 'src-1' }));
  });

  it('blocks installing a version that the official registry revoked and shows the reason', async () => {
    mocks.loadOfficialRegistry.mockResolvedValue({
      success: true,
      registry: {
        fetchedAt: '',
        plugins: [],
        removed: [{ id: 'com.example.fixture', versions: ['1.0.0'], reason: '向第三方发送了仓库列表', date: '2026-10-01', action: 'revoke' }],
        rejected: [],
        error: null,
      },
    });
    renderDialog();
    await waitForCatalog();

    const row = screen.getByTestId('marketplace-plugin-com.example.fixture');
    expect(row).toHaveTextContent('已被撤销');
    expect(row).toHaveTextContent('向第三方发送了仓库列表');
    expect(screen.getByRole('button', { name: '安装' })).toBeDisabled();
  });

  it('offers a direct disable for an enabled plugin that was revoked', async () => {
    mocks.setStoreSnapshot({ plugins: [installedPlugin({ enabled: true, status: 'active' })], invalidPlugins: [] });
    mocks.loadOfficialRegistry.mockResolvedValue({
      success: true,
      registry: {
        fetchedAt: '',
        plugins: [],
        removed: [{ id: 'com.example.fixture', versions: [], reason: '全版本撤销', date: '2026-10-01', action: 'revoke' }],
        rejected: [],
        error: null,
      },
    });
    mocks.disable.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.click(screen.getByRole('button', { name: '立即停用' }));
    await vi.waitFor(() => expect(mocks.disable).toHaveBeenCalledWith('com.example.fixture'));
  });

  it('surfaces a disable-now prompt for a revoked installed plugin even if no source lists it', async () => {
    // 插件唯一来源已被删除：市场行不会渲染该插件，但官方撤销提示必须独立出现。
    mocks.setStoreSnapshot({ plugins: [installedPlugin({ enabled: true, status: 'active' })], invalidPlugins: [] });
    mocks.getState.mockResolvedValue({ sources: [], entries: [] });
    mocks.loadOfficialRegistry.mockResolvedValue({
      success: true,
      registry: {
        fetchedAt: '',
        plugins: [],
        removed: [{ id: 'com.example.fixture', versions: ['1.0.0'], reason: '向第三方发送了仓库列表', date: '2026-10-01', action: 'revoke' }],
        rejected: [],
        error: null,
      },
    });
    mocks.disable.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    renderDialog();
    await waitFor(() => expect(screen.getByTestId('marketplace-revoked-com.example.fixture')).toBeInTheDocument());

    expect(screen.getByTestId('marketplace-revoked-section')).toHaveTextContent('已撤销的已安装插件');
    expect(screen.getByTestId('marketplace-revoked-com.example.fixture')).toHaveTextContent('向第三方发送了仓库列表');

    await user.click(within(screen.getByTestId('marketplace-revoked-com.example.fixture')).getByRole('button', { name: '立即停用' }));
    await vi.waitFor(() => expect(mocks.disable).toHaveBeenCalledWith('com.example.fixture'));
  });

  it('shows the empty state with an add-source action when no sources exist', async () => {
    mocks.getState.mockResolvedValue({ sources: [], entries: [] });
    renderDialog();
    await waitFor(() => expect(screen.getByText('还没有可安装的插件。')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '添加源' })).toBeInTheDocument();
  });

  it('manages sources through the nested dialog', async () => {
    mocks.addSource.mockResolvedValue({ success: true, state: marketplaceState() });
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.click(screen.getByTestId('marketplace-manage-sources'));
    expect(await screen.findByRole('heading', { name: '管理插件源' })).toBeInTheDocument();

    await user.click(screen.getByTestId('plugin-sources-add'));
    await user.type(screen.getByLabelText('源地址'), 'https://github.com/owner/other/tree/main/plugins');
    await user.click(screen.getByRole('button', { name: '保存' }));

    await vi.waitFor(() => expect(mocks.addSource).toHaveBeenCalledWith({
      url: 'https://github.com/owner/other/tree/main/plugins',
    }));
  });

  it('rejects an invalid source URL locally before touching the bridge', async () => {
    const user = userEvent.setup();
    renderDialog();
    await waitForCatalog();

    await user.click(screen.getByTestId('marketplace-manage-sources'));
    await user.click(screen.getByTestId('plugin-sources-add'));
    await user.type(screen.getByLabelText('源地址'), 'https://gitlab.com/owner/repo');
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(screen.getByTestId('plugin-sources-form-error')).toHaveTextContent('请输入有效的 GitHub 仓库目录地址');
    expect(mocks.addSource).not.toHaveBeenCalled();
  });
});
