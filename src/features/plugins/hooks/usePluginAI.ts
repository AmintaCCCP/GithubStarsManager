import { useDialog } from '../../../hooks/useDialog';
import { useCallback } from 'react';
import { pluginClient } from '../../../plugins/pluginClient';
import { AIService } from '../../../services/aiService';
import { useAppStore } from '../../../store/useAppStore';

export function usePluginAI() {
  const { confirm } = useDialog();

  return useCallback(async function generate(
    pluginId: string,
    pluginName: string,
    pageId: string,
    args: Record<string, unknown>,
    t: (zh: string, en: string) => string,
    isCurrentPage: () => boolean,
    signal: AbortSignal,
  ) {
    const authorize = () => pluginClient.requestPageCapability({ pluginId, pageId, method: 'ai.generate', args });
    let result = await authorize();
    if (!result.success || !isCurrentPage() || signal.aborted) return result;

    const { aiConfigs, activeAIConfig, language } = useAppStore.getState();
    const config = aiConfigs.find((item) => item.id === activeAIConfig);
    if (!config) {
      return { success: false as const, error: { code: 'PLUGIN_AI_NOT_CONFIGURED', message: 'No active AI provider is configured' } };
    }

    const { system, user, maxTokens } = args as { system: string; user: string; maxTokens?: number };
    let destination = t('自定义服务', 'Custom endpoint');
    try { destination = new URL(config.baseUrl).origin; } catch { /* Provider name remains visible. */ }
    const approved = await confirm(
      t('允许插件调用 AI？', 'Allow plugin AI request?'),
      `${pluginName}\n${config.name} · ${config.model}\n${destination}\n${t('可能经已启用的宿主后端代理转发。', 'The Host may relay this through its configured backend.')}\n\nSystem:\n${system}\n\nUser:\n${user}`,
      { confirmText: t('发送给 AI', 'Send to AI'), type: 'warning' },
    );
    if (!approved) {
      return { success: false as const, error: { code: 'PLUGIN_AI_CANCELLED', message: 'AI request was not approved' } };
    }
    if (!isCurrentPage() || signal.aborted) return { success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };

    result = await authorize();
    if (!result.success) return result;
    if (!isCurrentPage() || signal.aborted) return { success: false as const, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };
    const text = await new AIService(config, language, true).generateChatText({ system, user, maxTokens, signal });
    return text.length <= 65536
      ? { success: true as const, value: text }
      : { success: false as const, error: { code: 'PLUGIN_AI_RESULT_TOO_LARGE', message: 'AI response is too large' } };
  }, [confirm]);
}
