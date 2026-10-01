import { useSyncExternalStore } from 'react';
import { backend } from '../services/backendAdapter';
import { isScrapeSupportSettled, supportsWebScraping } from '../services/scrapeSupport';

export interface WebScrapeSupport {
  /** 当前环境是否具备 X 推文/Telegram 抓取通道（桌面 IPC 或后端路由）。 */
  supported: boolean;
  /** 结论是否已确定：Web 端要等 backend.init() 探测结束，之前请勿据其隐藏频道或迁移选中。 */
  settled: boolean;
}

/**
 * X 推文/Telegram 频道抓取只能在桌面端（主进程 IPC）或配置了后端的 Web
 * （服务端路由代抓）中完成；纯浏览器模式两者都不可用。该 hook 响应式地
 * 返回抓取通道支持情况：桌面端恒为 supported=true、settled=true；Web 端
 * 在 backend.init() 探测落定时通过订阅触发重渲染。
 */
export const useWebScrapeSupport = (): WebScrapeSupport => {
  const supported = useSyncExternalStore(
    listener => backend.subscribeAvailability(listener),
    () => supportsWebScraping(),
    () => false,
  );
  const settled = useSyncExternalStore(
    listener => backend.subscribeAvailability(listener),
    () => isScrapeSupportSettled(),
    () => false,
  );
  return { supported, settled };
};
