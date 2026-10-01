import { useSyncExternalStore } from 'react';
import { backend } from '../services/backendAdapter';
import { supportsWebScraping } from '../services/scrapeSupport';

/**
 * X 推文/Telegram 频道抓取只能在桌面端（主进程 IPC）或配置了后端的 Web
 * （服务端路由代抓）中完成；纯浏览器模式两者都不可用。该 hook 响应式地
 * 返回当前环境是否具备抓取通道：桌面端恒为 true，Web 跟随后端探测结果
 * （init 探测是异步的，落定时通过订阅触发重渲染）。
 */
export const useWebScrapeSupport = (): boolean => {
  return useSyncExternalStore(
    listener => backend.subscribeAvailability(listener),
    () => supportsWebScraping(),
    () => false,
  );
};
