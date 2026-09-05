import { backend } from '../../../services/backendAdapter';

/**
 * 一次性同步读取 backend.isAvailable，无订阅、无本地状态——
 * 与原 SettingsPanel 直接内联读取的语义逐字等价（勿引入订阅/状态）。
 */
export const useBackendAvailability = (): boolean => backend.isAvailable;
