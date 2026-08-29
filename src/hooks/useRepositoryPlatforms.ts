import { useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import type { Repository } from '../types';
import { resolveRepositoryPlatforms } from '../utils/repoPlatformDetection';

/**
 * 仓库展示用平台列表：优先采用 release 资产 + 仓库元数据的确定性识别，
 * 无确定性信号时回退 ai_platforms。详见 utils/repoPlatformDetection.ts。
 * 只订阅 releases 数组引用，release 未变化时不触发卡片重渲染。
 */
export function useRepositoryPlatforms(repository: Repository): string[] {
  const releases = useAppStore((state) => state.releases);
  return useMemo(
    () => resolveRepositoryPlatforms(repository, releases ?? []),
    [repository, releases],
  );
}
