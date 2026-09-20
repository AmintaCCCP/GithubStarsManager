import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Repository } from '../../../types';
import type {
  CreateLinkedApplicationInput,
  LinkedApplication,
  LinkedApplicationEditablePatch,
  LinkedApplicationPlatform,
} from '../../../types/linkedApplication';
import { useAppStore } from '../../../store/useAppStore';
import {
  createLinkedApplication,
  createLinkedApplicationId,
  detectPlatformFromUserAgent,
  repositoryFullNameKey,
} from '../../../utils/linkedApplications';

/** 关联尝试的结果：UI 据此给出「重复关联 / 未选择仓库」提示，而不是静默失败。 */
export type LinkApplicationOutcome = 'linked' | 'duplicate' | 'invalid';

export interface UseLinkedApplicationsResult {
  linkedApplications: LinkedApplication[];
  /** 已收藏仓库里还没有被关联的那些，供关联表单选择。 */
  linkableRepositories: Repository[];
  /** 手动关联表单的默认平台（按当前设备的 userAgent 猜测，用户可改）。 */
  defaultPlatform: LinkedApplicationPlatform;
  isRepositoryLinked: (fullName: string) => boolean;
  linkApplication: (input: CreateLinkedApplicationInput) => LinkApplicationOutcome;
  updateApplication: (id: string, patch: LinkedApplicationEditablePatch) => void;
  unlinkApplication: (id: string) => void;
}

/**
 * My Apps 页面的编排 hook（ADR 0001：View 只渲染，Store 与业务判断在这一层）。
 *
 * 只暴露这一页需要的最小选择器子集：`linkedApplications`（列表）与 `repositories`
 * （可关联的已收藏仓库）。跨功能读写都走 Store action，不直接引 service。
 */
export const useLinkedApplications = (): UseLinkedApplicationsResult => {
  const {
    linkedApplications,
    repositories,
    addLinkedApplication,
    updateLinkedApplication,
    removeLinkedApplication,
  } = useAppStore(useShallow((state) => ({
    linkedApplications: state.linkedApplications,
    repositories: state.repositories,
    addLinkedApplication: state.addLinkedApplication,
    updateLinkedApplication: state.updateLinkedApplication,
    removeLinkedApplication: state.removeLinkedApplication,
  })));

  const linkedKeys = useMemo(
    () => new Set(linkedApplications.map((application) => repositoryFullNameKey(application.repositoryFullName))),
    [linkedApplications],
  );

  const linkableRepositories = useMemo(
    () => repositories.filter((repository) => !linkedKeys.has(repositoryFullNameKey(repository.full_name))),
    [repositories, linkedKeys],
  );

  const defaultPlatform = useMemo(
    () => detectPlatformFromUserAgent(typeof navigator === 'undefined' ? '' : navigator.userAgent),
    [],
  );

  const isRepositoryLinked = useCallback(
    (fullName: string) => linkedKeys.has(repositoryFullNameKey(fullName)),
    [linkedKeys],
  );

  const linkApplication = useCallback((input: CreateLinkedApplicationInput): LinkApplicationOutcome => {
    const key = repositoryFullNameKey(input.repositoryFullName);
    if (!key) return 'invalid';
    // Store 侧还有一道防御性去重；这里先判一次是为了能给用户明确的「已关联」提示。
    if (linkedKeys.has(key)) return 'duplicate';
    addLinkedApplication(createLinkedApplication(input, {
      id: createLinkedApplicationId(),
      now: new Date().toISOString(),
    }));
    return 'linked';
  }, [addLinkedApplication, linkedKeys]);

  const updateApplication = useCallback(
    (id: string, patch: LinkedApplicationEditablePatch) => updateLinkedApplication(id, patch),
    [updateLinkedApplication],
  );

  /**
   * 解除关联 = 只删本地记录。这里不调用任何 Electron/文件系统能力，
   * `installPath` 只是用户笔记，绝不会被用来删除或移动文件。
   */
  const unlinkApplication = useCallback(
    (id: string) => removeLinkedApplication(id),
    [removeLinkedApplication],
  );

  return {
    linkedApplications,
    linkableRepositories,
    defaultPlatform,
    isRepositoryLinked,
    linkApplication,
    updateApplication,
    unlinkApplication,
  };
};
