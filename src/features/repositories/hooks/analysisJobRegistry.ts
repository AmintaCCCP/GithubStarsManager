/**
 * 批分析任务的中止登记表（R12 审计修复，CodeRabbit Major）。
 *
 * 场景：账号 A 在后端 X 上发起批量分析，后续批次仍在等待；恢复流程会先
 * 启用候选后端 Y 再验证身份。此刻 Store 用户仍是 A、会话代次尚未变化，
 * 分析优化器若继续执行，会读取实时 backend 把 A 的仓库标识（owner/repo）
 * 发给 Y——即使 Y 拒绝请求或恢复最终回滚，这些标识已经外发。
 *
 * 因此账号/后端恢复类流程必须在候选连接提交前中止依赖旧连接的分析任务。
 * 本模块只保存挂载中的分析任务的中止入口（模块级，不依赖 React 上下文），
 * 由 useRepositoryAnalysisJob 注册、卸载时注销；没有活动任务时调用是空操作。
 */
const activeJobAborts = new Set<() => void>();

/** 注册一个分析任务的中止入口，返回注销函数（组件卸载时调用）。 */
export const registerActiveAnalysisJobAbort = (abort: () => void): (() => void) => {
  activeJobAborts.add(abort);
  return () => {
    activeJobAborts.delete(abort);
  };
};

/** 中止当前所有挂载中的批分析任务（候选后端连接提交前调用）。 */
export const abortActiveAnalysisJobs = (): void => {
  for (const abort of [...activeJobAborts]) {
    try {
      abort();
    } catch {
      // 中止入口的异常不得阻断账号/后端恢复流程
    }
  }
};
