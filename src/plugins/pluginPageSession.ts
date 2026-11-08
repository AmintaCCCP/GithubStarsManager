import type { Repository } from '../types';

import type { PluginPageDisplay } from './types';

/**
 * 弹窗动作打开的插件页面。会话挂在应用根上，不随仓库卡片或下拉菜单卸载。
 * repository 缺省时页面没有仓库上下文（例如从设置页打开）。
 * display 决定宿主容器形态：fullscreen（缺省，既有插件不变）或 popup（非全屏小弹窗）。
 */
export interface PluginPageSession {
  pluginId: string;
  pluginName: string;
  pageId: string;
  pageTitle: string;
  repository?: Repository;
  display?: PluginPageDisplay;
}

let session: PluginPageSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export const pluginPageSession = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): PluginPageSession | null {
    return session;
  },
  open(next: PluginPageSession) {
    session = next;
    emit();
  },
  close() {
    if (!session) return;
    session = null;
    emit();
  },
};
