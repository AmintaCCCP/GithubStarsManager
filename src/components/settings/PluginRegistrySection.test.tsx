import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistrySection } from './PluginRegistrySection';
import { makeT } from '../../i18n/useT';
import type { InstalledPlugin } from '../../plugins/types';
import type { PluginRegistryLoadResult, PluginRemovalEntry } from '../../services/pluginRegistryService';

const mocks = vi.hoisted(() => ({
  isAvailable: vi.fn(() => true),
  load: vi.fn(),
  onDisable: vi.fn(),
}));

vi.mock('../../services/pluginRegistryService', () => ({
  pluginRegistryService: {
    isAvailable: mocks.isAvailable,
    load: mocks.load,
  },
}));

const t = makeT('zh', 'app');

const plugin = (overrides: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  directoryName: 'health',
  enabled: true,
  status: 'active',
  grantedPermissions: ['storage'],
  manifest: {
    manifestVersion: 1,
    id: 'com.example.health',
    name: 'Health',
    version: '1.0.0',
    apiVersion: '1',
    permissions: ['storage'],
    contributes: {},
  },
  ...overrides,
} as InstalledPlugin);

const loadedRegistry = (removed: PluginRemovalEntry[] = []): PluginRegistryLoadResult => ({
  success: true,
  registry: {
    fetchedAt: '2026-09-21T04:00:00.000Z',
    plugins: [{
      id: 'com.example.health',
      versions: [{
        id: 'com.example.health',
        version: '1.3.0',
        apiVersion: '1',
        source: 'https://github.com/example/health',
        releaseUrl: 'https://github.com/example/health/releases/download/v1.3.0/health.zip',
        sha256: 'a'.repeat(64),
        permissions: ['storage', 'repositories:read'],
        networkTargets: [],
        dataUsage: '只读本地仓库元数据，不外发。',
        review: { status: 'approved', date: '2026-09-21', commit: 'b'.repeat(40) },
      }],
    }],
    removed,
    rejected: [{ code: 'REGISTRY_ID_INVALID', message: 'bad id' }],
    error: null,
  },
});

describe('PluginRegistrySection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isAvailable.mockReturnValue(true);
  });

  it('renders nothing when the desktop bridge is unavailable', () => {
    mocks.isAvailable.mockReturnValue(false);
    const { container } = render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);
    expect(container).toBeEmptyDOMElement();
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('shows the update with the permissions the new version would need', async () => {
    mocks.load.mockResolvedValue(loadedRegistry());
    render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-com.example.health')).toBeInTheDocument());
    const row = screen.getByTestId('plugin-registry-com.example.health');
    expect(row).toHaveTextContent('有新版本 1.3.0');
    expect(row).toHaveTextContent('新增权限：repositories:read');
    expect(screen.getByTestId('plugin-registry-rejected')).toHaveTextContent('1 条记录没通过校验');
    // 有更新只提示，不提供"停用"按钮
    expect(screen.queryByRole('button', { name: '立即停用' })).not.toBeInTheDocument();
  });

  it('asks for confirmation-free manual action only for revoked plugins', async () => {
    const user = userEvent.setup();
    mocks.load.mockResolvedValue({
      success: true,
      registry: {
        fetchedAt: '2026-09-21T04:00:00.000Z',
        plugins: [],
        removed: [{ id: 'com.example.health', versions: ['1.0.0'], reason: '向第三方发送了仓库列表', date: '2026-09-21', action: 'revoke' }],
        rejected: [],
        error: null,
      },
    });
    render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-com.example.health')).toHaveTextContent('已被撤销'));
    expect(screen.getByTestId('plugin-registry-com.example.health')).toHaveTextContent('向第三方发送了仓库列表');

    await user.click(screen.getByRole('button', { name: '立即停用' }));
    expect(mocks.onDisable).toHaveBeenCalledWith(expect.objectContaining({ manifest: expect.objectContaining({ id: 'com.example.health' }) }));
  });

  it('hides the disable action for a plugin that is already disabled', async () => {
    mocks.load.mockResolvedValue({
      success: true,
      registry: {
        fetchedAt: '2026-09-21T04:00:00.000Z',
        plugins: [],
        removed: [{ id: 'com.example.health', versions: ['1.0.0'], reason: '向第三方发送了仓库列表', date: '2026-09-21', action: 'revoke' }],
        rejected: [],
        error: null,
      },
    });
    render(<PluginRegistrySection plugins={[plugin({ enabled: false, status: 'disabled' })]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-com.example.health')).toHaveTextContent('已被撤销'));
    expect(screen.queryByRole('button', { name: '立即停用' })).not.toBeInTheDocument();
    expect(mocks.onDisable).not.toHaveBeenCalled();
  });

  it('surfaces a registry load failure instead of staying silent', async () => {
    mocks.load.mockResolvedValue({ success: false, error: { code: 'REGISTRY_UNREACHABLE', message: 'offline' } });
    render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-error')).toHaveTextContent('offline'));
  });

  it('surfaces a partial registry failure while keeping the valid half', async () => {
    const partial = loadedRegistry();
    if (!partial.success) throw new Error('expected a successful fixture');
    partial.registry.error = { code: 'REGISTRY_HTTP_ERROR', message: 'Removal list unavailable' };
    mocks.load.mockResolvedValue(partial);

    render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-com.example.health')).toBeInTheDocument());
    expect(screen.getByTestId('plugin-registry-error')).toHaveTextContent('Removal list unavailable');
  });

  it('surfaces an unexpected bridge rejection and clears stale data', async () => {
    mocks.load.mockRejectedValue(new Error('IPC unavailable'));
    render(<PluginRegistrySection plugins={[plugin()]} t={t} onDisable={mocks.onDisable} />);

    await waitFor(() => expect(screen.getByTestId('plugin-registry-error')).toHaveTextContent('IPC unavailable'));
    expect(screen.queryByTestId('plugin-registry-com.example.health')).not.toBeInTheDocument();
  });
});
