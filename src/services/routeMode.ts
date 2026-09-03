import type { RouteMode } from '../types';
import { useAppStore } from '../store/useAppStore';

/**
 * 本地路由偏好辅助函数。
 * routeMode 决定 GitHub / Release 数据面请求的出站方向：
 * - 'auto'    ：保持现有行为（有后端用后端，无后端直连）
 * - 'backend' ：仅在有后端时走后端（保留现有默认顺序，不重排）
 * - 'browser' ：跳过后端代理，直接走当前设备网络
 *
 * 读取通过 `useAppStore.getState()`，每次调用都拉取最新值；
 * 路径上**不**订阅响应式变化，避免在已构造的 service / 已发起的请求
 * 中途切换路由策略。routeMode 变更只对新发起的请求生效。
 */

/**
 * 解析当前 routeMode，缺失或非合法枚举时一律视为 'auto'。
 * 防止初始化/测试环境拿到 undefined 时误判为 browser 绕过默认行为。
 */
function resolveRouteMode(): RouteMode {
  const raw = useAppStore.getState().routeMode;
  return raw === 'backend' || raw === 'browser' ? raw : 'auto';
}

/** 是否应走当前设备网络（绕开后端代理）。 */
export const shouldBypassBackend = (): boolean => resolveRouteMode() === 'browser';
