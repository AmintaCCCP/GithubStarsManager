import { useCallback } from 'react';
import { useDialog } from '../../../hooks/useDialog';
import { pluginClient } from '../../../plugins/pluginClient';

export function usePluginWebSearch() {
  const { confirm } = useDialog();

  return useCallback(async function search(
    pluginId: string,
    pluginName: string,
    pageId: string,
    args: Record<string, unknown>,
    t: (zh: string, en: string) => string,
    isCurrentPage: () => boolean,
  ) {
    const authorization = await pluginClient.requestPageCapability({ pluginId, pageId, method: 'web.search', args });
    if (!authorization.success || !isCurrentPage()) return authorization;
    const { endpoint } = await pluginClient.getSearchEndpoint();
    if (!endpoint) return { success: false as const, error: { code: 'PLUGIN_SEARCH_NOT_CONFIGURED', message: 'Web search service is not configured' } };
    const approved = await confirm(
      t('允许插件联网搜索？', 'Allow plugin web search?'),
      `${pluginName}\n${endpoint}\n\n${t('搜索词：', 'Search query:')}\n${args.query}`,
      { confirmText: t('发送搜索词', 'Send search query'), type: 'warning' },
    );
    if (!approved) return { success: false as const, error: { code: 'PLUGIN_SEARCH_CANCELLED', message: 'Web search was not approved' } };
    if (!isCurrentPage()) return { success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };
    return pluginClient.searchWeb({ pluginId, pageId, args: args as { query: string; limit?: number } });
  }, [confirm]);
}
