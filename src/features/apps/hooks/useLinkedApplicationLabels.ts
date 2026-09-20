import { useMemo } from 'react';
import { useT } from '../../../i18n/useT';
import type {
  LinkedApplicationArchitecture,
  LinkedApplicationLinkSource,
  LinkedApplicationPlatform,
} from '../../../types/linkedApplication';
import type { LinkedApplicationUpdateStatus } from '../../../utils/linkedApplications';

export interface LinkedApplicationLabels {
  platform: Record<LinkedApplicationPlatform, string>;
  architecture: Record<LinkedApplicationArchitecture, string>;
  updateStatus: Record<LinkedApplicationUpdateStatus, string>;
  linkSource: Record<LinkedApplicationLinkSource, string>;
}

/**
 * 把枚举值翻成界面文案。集中在这里的原因：列表、详情、关联表单三处都要用，
 * 而 key 必须是字面量才能被 `scripts/check-i18n.cjs` 的 key 引用检查覆盖，
 * 所以不用模板拼接（`myApps.platform-${value}`），而是逐项写出。
 */
export const useLinkedApplicationLabels = (): LinkedApplicationLabels => {
  const t = useT('app');

  const updateStatus = useMemo<Record<LinkedApplicationUpdateStatus, string>>(() => ({
    'update-available': t('myApps.update-available'),
    'up-to-date': t('myApps.up-to-date'),
    unknown: t('myApps.status-unknown'),
  }), [t]);

  const platform = useMemo<Record<LinkedApplicationPlatform, string>>(() => ({
    windows: t('myApps.platform-windows'),
    macos: t('myApps.platform-macos'),
    linux: t('myApps.platform-linux'),
    other: t('myApps.platform-other'),
    unknown: t('myApps.platform-unknown'),
  }), [t]);

  const architecture = useMemo<Record<LinkedApplicationArchitecture, string>>(() => ({
    x64: t('myApps.architecture-x64'),
    arm64: t('myApps.architecture-arm64'),
    x86: t('myApps.architecture-x86'),
    arm: t('myApps.architecture-arm'),
    unknown: t('myApps.architecture-unknown'),
  }), [t]);

  const linkSource = useMemo<Record<LinkedApplicationLinkSource, string>>(() => ({
    manual: t('myApps.source-manual'),
    detected: t('myApps.source-detected'),
  }), [t]);

  return { platform, architecture, updateStatus, linkSource };
};
