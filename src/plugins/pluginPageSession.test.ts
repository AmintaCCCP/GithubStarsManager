import { describe, expect, it, vi } from 'vitest';
import { pluginPageSession } from './pluginPageSession';
import type { Repository } from '../types';

const repository = { id: 1, full_name: 'owner/repo' } as Repository;

describe('pluginPageSession display mode (V1.6)', () => {
  it('carries the display mode to subscribers and defaults to fullscreen semantics', () => {
    const listener = vi.fn();
    const unsubscribe = pluginPageSession.subscribe(listener);

    pluginPageSession.open({
      pluginId: 'com.example.popup',
      pluginName: 'Popup Plugin',
      pageId: 'fields',
      pageTitle: 'Custom Fields',
      repository,
      display: 'popup',
    });
    expect(listener).toHaveBeenCalled();
    expect(pluginPageSession.getSnapshot()?.display).toBe('popup');

    pluginPageSession.open({
      pluginId: 'com.example.full',
      pluginName: 'Full Plugin',
      pageId: 'insights',
      pageTitle: 'Insights',
      repository,
    });
    // 未声明 display 的动作保持 undefined：宿主按 fullscreen 处理，旧插件不变。
    expect(pluginPageSession.getSnapshot()?.display).toBeUndefined();

    pluginPageSession.close();
    expect(pluginPageSession.getSnapshot()).toBeNull();
    unsubscribe();
  });
});
