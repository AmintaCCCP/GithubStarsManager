
import React, { Suspense, useSyncExternalStore } from 'react';
import { useT } from '../i18n/useT';
import { pluginPageSession } from '../plugins/pluginPageSession';
import { ErrorBoundary } from './ErrorBoundary';

const LazyPluginPageModal = React.lazy(() =>
  import('./PluginPageModal').then((module) => ({ default: module.PluginPageModal }))
);

/**
 * 应用级插件页面弹窗。会话存在期间常驻应用根，卡片和菜单卸载不影响它。
 */
export const PluginPageHost: React.FC = () => {
  const session = useSyncExternalStore(
    pluginPageSession.subscribe,
    pluginPageSession.getSnapshot,
    pluginPageSession.getSnapshot,
  );
  // 页面文案在 app 命名空间；卡片菜单用的是 repositories，不能混用。
  const t = useT('app');
  if (!session?.repository) return null;

  const { repository, ...page } = session;
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <LazyPluginPageModal
          {...page}
          repository={repository}
          onClose={() => pluginPageSession.close()}
          t={t}
        />
      </Suspense>
    </ErrorBoundary>
  );
};
