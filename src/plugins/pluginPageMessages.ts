export interface PluginPageRequest {
  type: 'plugin-page:request';
  pluginId: string;
  pageId: string;
  requestId: string;
  token: string;
  method: string;
  args: Record<string, unknown>;
  /** 页面自己的来源。宿主窗口来源不固定，页面发往宿主只能用 '*'，靠它核对。 */
  origin: string;
}

export function validatePluginPageMessage(
  event: MessageEvent,
  frameWindow: Window | null,
  pluginId: string,
  pageId: string,
  token: string,
): PluginPageRequest | null {
  // 只接受页面自己的 plugin-page 来源。allow-scripts 不阻止页面把 iframe 导航走，
  // 导航后 WindowProxy 不变、来源仍是不透明的 null，按 null 校验会把 token 和
  // 仓库上下文交给替换后的文档。精确来源要求 iframe 具备 allow-same-origin。
  if (!frameWindow || event.source !== frameWindow ||
    event.origin !== `plugin-page://${pluginId}`) return null;
  const data: unknown = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (Object.keys(message).some((key) => !['type', 'pluginId', 'pageId', 'requestId', 'token', 'method', 'args', 'origin'].includes(key))) return null;
  if (message.type !== 'plugin-page:request' || message.pluginId !== pluginId ||
    message.pageId !== pageId || message.token !== token ||
    message.origin !== `plugin-page://${pluginId}` ||
    typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(message.requestId) ||
    typeof message.method !== 'string' || message.method.length > 80 ||
    !message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return null;
  return message as unknown as PluginPageRequest;
}
