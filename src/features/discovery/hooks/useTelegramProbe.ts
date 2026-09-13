import { useCallback, useState } from 'react';
import { probeTelegramSource } from '../../../services/telegramService';
import { useAppStore } from '../../../store/useAppStore';

/**
 * Telegram 频道"测试连接"的编排 hook：真实抓取一个频道最新页并解析，
 * 返回可展示的结果（消息数/仓库链接数或错误）。View 不直接触达服务。
 */
export const useTelegramProbe = () => {
  const [isProbing, setIsProbing] = useState(false);
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

  const language = useAppStore((state) => state.language);
  const message = probeResult === null
    ? null
    : probeResult.startsWith('OK|')
      ? (() => {
          const [, messageCount, repoCount] = probeResult.split('|');
          return language === 'zh'
            ? `连接成功：解析到 ${messageCount} 条频道消息，其中 ${repoCount} 个 GitHub 仓库链接。`
            : `Connected: parsed ${messageCount} channel messages with ${repoCount} GitHub repo links.`;
        })()
      : (() => {
          const [, error] = probeResult.split('|');
          return language === 'zh' ? `连接失败：${error}` : `Failed: ${error}`;
        })();
  const probeOk = probeResult?.startsWith('OK|') ?? null;

  return { probe, isProbing, message, probeOk };
};
