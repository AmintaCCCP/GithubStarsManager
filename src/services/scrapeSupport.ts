import type { DiscoveryChannelId } from '../types';
import { isElectron } from './electronProxy';

/**
 * X 推文/Telegram 频道抓取只能在桌面端（主进程 IPC）或配置了后端的 Web
 * （服务端路由代抓）中完成；纯浏览器模式两者都不可用。
 *
 * 后端可用性由 backendAdapter 在探测落定时通过 setBackendAvailability 推送
 * （不直接导入 backendAdapter，避免 store → 本模块 → backendAdapter → store
 * 的模块环）。UI 侧的响应式版本见 useWebScrapeSupport。
 */
let backendAvailable = false;

export const setBackendAvailability = (available: boolean): void => {
  backendAvailable = available;
};

export const supportsWebScraping = (): boolean => isElectron() || backendAvailable;

/**
 * 无抓取通道的浏览器环境会隐藏 x-tweet/telegram 频道；
 * store 的启用/回退判定同样只应统计可见频道。
 */
export const isChannelScrapable = (id: DiscoveryChannelId): boolean =>
  (id !== 'x-tweet' && id !== 'telegram') || supportsWebScraping();
