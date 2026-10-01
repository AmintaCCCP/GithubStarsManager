import type { DiscoveryChannelId } from '../types';
import { isElectron } from './electronProxy';

/**
 * X 推文/Telegram 频道抓取只能在桌面端（主进程 IPC）或配置了后端的 Web
 * （服务端路由代抓）中完成；纯浏览器模式两者都不可用。
 *
 * 后端可用性由 backendAdapter 在探测落定时通过 setBackendAvailability /
 * setBackendProbed 推送（不直接导入 backendAdapter，避免 store → 本模块 →
 * backendAdapter → store 的模块环）。UI 侧的响应式版本见 useWebScrapeSupport。
 */
let backendAvailable = false;
let backendProbed = false;

export const setBackendAvailability = (available: boolean): void => {
  backendAvailable = available;
};

/** backend.init() 至少完成一次探测后，可用性结论才算落定。 */
export const setBackendProbed = (): void => {
  backendProbed = true;
};

export const supportsWebScraping = (): boolean => isElectron() || backendAvailable;

/** 桌面端结论恒定可用；Web 端要等 init 探测结束后才确定支持与否。 */
export const isScrapeSupportSettled = (): boolean => isElectron() || backendProbed;

/**
 * 无抓取通道的浏览器环境会隐藏 x-tweet/telegram 频道；
 * store 的启用/回退判定同样只应统计可见频道。
 */
export const isChannelScrapable = (id: DiscoveryChannelId): boolean =>
  (id !== 'x-tweet' && id !== 'telegram') || supportsWebScraping();
