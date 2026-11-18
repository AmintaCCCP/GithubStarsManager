import { clearPendingSyncState } from '../../../services/autoSync';

export interface DataResetActions {
  /**
   * 「清空全部数据」流程的账号级待推状态清理入口（审计修复 C51）。
   * 视图组件不得直接 import 业务服务（ADR 0001 分层守则）：本 hook 是
   * services/autoSync.clearPendingSyncState 的转出口——清除
   * gsm.pendingSyncAccounts / gsm.pushedRepoIds 的持久化与内存记录、
   * 会话删除集合，并取消在途退避重试与待推防抖。
   */
  clearPendingSyncState: () => void;
}

/** 数据治理面板「清空全部数据」流程的后端同步状态清理动作。 */
export const useDataResetActions = (): DataResetActions => ({
  clearPendingSyncState,
});
