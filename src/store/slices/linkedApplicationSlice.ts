import { logger } from '../../services/logger';
import { normalizeLinkedApplication, repositoryFullNameKey } from '../../utils/linkedApplications';
import type { AppStoreSlice } from '../types';

/**
 * My Apps（开发守则 §3）的 Store 切片。
 *
 * 为什么进 Store 而不是 `src/services/linkedApplicationStorage.ts`：按阶段规划的判定口径，
 * 「需要本地持久化与跨功能一致性 → Core/Store」。后续阶段 2（更新检测）、阶段 3（版本选择器
 * 的 installed version 标记）、阶段 4（导入预览的「已在 My Apps」）都要读同一份数据，
 * 放 Store 才能共用同一条 migrate 链。ADR 0001 禁止第二个持久化 store，所以这里只贡献
 * state + action，持久化仍在 `src/store/persistence/options.ts` 一处。
 *
 * 边界：所有 action 只改内存 + 随快照持久化，不读写磁盘、不调用任何特权能力。
 * 「解除关联」因此天然不会碰用户装好的软件。
 */
export const createLinkedApplicationSlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'addLinkedApplication'
  | 'updateLinkedApplication'
  | 'removeLinkedApplication'
  | 'markLinkedApplicationChecked'
>> = (set) => ({
  /**
   * 新增一条关联。同一仓库（按全名小写比较）只保留一条：重复关联由上层在提交前提示，
   * 这里只做防御性忽略，保证任何调用路径都不会写出重复记录。
   */
  addLinkedApplication: (application) => set((state) => {
    const normalized = normalizeLinkedApplication(application);
    const key = repositoryFullNameKey(normalized?.repositoryFullName);
    if (!normalized || !key) {
      logger.warn('store.addLinkedApplication', 'Refusing to link an invalid application');
      return state;
    }
    const alreadyLinked = state.linkedApplications.some(
      (existing) => repositoryFullNameKey(existing.repositoryFullName) === key,
    );
    if (alreadyLinked) {
      logger.warn('store.addLinkedApplication', 'Refusing to link a repository that is already linked', { key });
      return state;
    }
    return { linkedApplications: [...state.linkedApplications, normalized] };
  }),

  /**
   * 只允许改写用户可编辑字段；`id` 与仓库归属不可被 patch 覆盖。
   * 没有命中任何记录时原样返回 state，避免无意义的新数组引用触发重渲染与持久化。
   */
  updateLinkedApplication: (id, patch) => set((state) => {
    let changed = false;
    const linkedApplications = state.linkedApplications.map((application) => {
      if (application.id !== id) return application;
      changed = true;
      return normalizeLinkedApplication({
        ...application,
        ...patch,
        id: application.id,
        repositoryFullName: application.repositoryFullName,
      }) ?? application;
    });
    return changed ? { linkedApplications } : state;
  }),

  /**
   * 解除关联：**只删这条本地记录**。刻意不接收任何「是否同时删除文件」的开关，
   * 也不调用 Electron/文件系统能力，避免把 1b 之外的卸载能力提前引进来。
   */
  removeLinkedApplication: (id) => set((state) => {
    const linkedApplications = state.linkedApplications.filter((application) => application.id !== id);
    return linkedApplications.length === state.linkedApplications.length ? state : { linkedApplications };
  }),

  /** 记录界面上一次真正查询 Release 的时间（阶段 1 只在用户打开界面时查询）。 */
  markLinkedApplicationChecked: (id, checkedAt) => set((state) => {
    if (!Number.isFinite(Date.parse(checkedAt))) {
      logger.warn('store.markLinkedApplicationChecked', 'Ignoring an invalid checked timestamp');
      return state;
    }
    let changed = false;
    const linkedApplications = state.linkedApplications.map((application) => {
      if (application.id !== id || application.lastCheckedAt === checkedAt) return application;
      changed = true;
      return { ...application, lastCheckedAt: checkedAt };
    });
    return changed ? { linkedApplications } : state;
  }),
});
