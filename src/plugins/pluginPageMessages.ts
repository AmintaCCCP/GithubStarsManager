export interface PluginPageRequest {
  type: 'plugin-page:request';
  pluginId: string;
  pageId: string;
  requestId: string;
  token: string;
  method: string;
  args: Record<string, unknown>;
}

export function validatePluginPageMessage(
  event: MessageEvent,
  frameWindow: Window | null,
  pluginId: string,
  pageId: string,
  token: string,
): PluginPageRequest | null {
  if (!frameWindow || event.source !== frameWindow || event.origin !== 'null') return null;
  const data: unknown = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const message = data as Record<string, unknown>;
  if (Object.keys(message).some((key) => !['type', 'pluginId', 'pageId', 'requestId', 'token', 'method', 'args'].includes(key))) return null;
  if (message.type !== 'plugin-page:request' || message.pluginId !== pluginId ||
    message.pageId !== pageId || message.token !== token ||
    typeof message.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(message.requestId) ||
    typeof message.method !== 'string' || message.method.length > 80 ||
    !message.args || typeof message.args !== 'object' || Array.isArray(message.args)) return null;
  return message as unknown as PluginPageRequest;
}
