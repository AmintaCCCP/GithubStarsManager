



import { useT } from '../../../i18n/useT';
import { useCallback, useState } from 'react';
import { probeXTweetSource } from '../../../services/xTweetService';
import { useAppStore } from '../../../store/useAppStore';

/**
 * X 推文频道"测试连接"的编排 hook：真实抓取一位博主主页并解析，
 * 返回可展示的结果（推文数/仓库链接数或错误）。View 不直接触达服务。
 */
export const useXTweetProbe = () => {
  const [isProbing, setIsProbing] = useState(false);
  const t = useT('discovery');
  const [probeResult, setProbeResult] = useState<string | null>(null);

  const probe = useCallback(async (handle: string) => {
    setIsProbing(true);
    setProbeResult(null);
    const auth = useAppStore.getState().xTweetAuth;
    try {
      const result = await probeXTweetSource(handle, undefined, auth);
      setProbeResult(result.ok
        ? `OK|${result.tweetCount ?? 0}|${result.repoCount ?? 0}`
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
          const [, tweetCount, repoCount] = probeResult.split('|');
          return t('useXTweetProbe.connected-parsed-tweetcount-tweets-with-repocoun', { tweetCount: tweetCount, repoCount: repoCount });
        })()
      : (() => {
          const [, error] = probeResult.split('|');
          return t('useXTweetProbe.failed-error', { error: error });
        })();
  const probeOk = probeResult?.startsWith('OK|') ?? null;

  return { probe, isProbing, message, probeOk };
};
