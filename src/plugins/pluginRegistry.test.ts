import { beforeEach, describe, expect, it, vi } from 'vitest';

const { list, enable } = vi.hoisted(() => ({
  list: vi.fn(),
  enable: vi.fn(),
}));

vi.mock('./pluginClient', () => ({
  pluginClient: {
    list,
    enable,
    disable: vi.fn(),
    uninstall: vi.fn(),
    installFromDirectory: vi.fn(),
  },
}));

import { pluginRegistry } from './pluginRegistry';

describe('pluginRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginRegistry.resetForTests();
    list.mockResolvedValue({ plugins: [], invalidPlugins: [] });
  });

  it('deduplicates concurrent initial scans from many repository cards', async () => {
    await Promise.all([
      pluginRegistry.ensureLoaded(),
      pluginRegistry.ensureLoaded(),
      pluginRegistry.ensureLoaded(),
    ]);

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('refreshes the registry after a lifecycle mutation', async () => {
    enable.mockResolvedValue({ success: true });

    await pluginRegistry.enable('com.example.plugin', []);

    expect(enable).toHaveBeenCalledWith('com.example.plugin', []);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
