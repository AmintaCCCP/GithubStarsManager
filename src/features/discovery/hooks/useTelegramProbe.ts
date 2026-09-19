



import { useT } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { probeTelegramSource } from '../../../services/telegramService';

/**
 * Telegram 频道"测试连接"的编排 hook：真实抓取一个频道最新页并解析，
 * 返回可展示的结果（消息数/仓库链接数或错误）。View 不直接触达服务。
 */
export const useTelegramProbe = () => {
  const [isProbing, setIsProbing] = useState(false);
  const t = useT('discovery');
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const probe = useCallback(async (channel: string) => {
    setIsProbing(true);
    setProbeResult(null);
    try {
      const result = await probeTelegramSource(channel);
      setProbeResult(result.ok
        ? `OK|${result.messageCount ?? 0}|${result.repoCount ?? 0}`
        : `FAIL|${result.error ?? '未知错误'}`);
    } catch (error) {
      setProbeResult(`FAIL|${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsProbing(false);
    }
  }, []);

  const message = probeResult === null
    ? null
    : probeResult.startsWith('OK|')
      ? (() => {
          const [, messageCount, repoCount] = probeResult.split('|');
          return t('useTelegramProbe.connected-parsed-messagecount-channel-messages-w', { messageCount: messageCount, repoCount: repoCount });
        })()
      : (() => {
          const [, error] = probeResult.split('|');
          return t('useTelegramProbe.failed-error', { error: error });
        })();
  const probeOk = probeResult?.startsWith('OK|') ?? null;

  return { probe, isProbing, message, probeOk };
};
