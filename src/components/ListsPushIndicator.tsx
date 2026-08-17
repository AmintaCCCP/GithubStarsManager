import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';

/**
 * 全局 GitHub Lists 回写进度指示器。
 * 进程运行于 store 级 action，切换页面不中断；此处提供跨页面可见的
 * 进度浮层，并在完成/失败时给出 toast 反馈。
 */
export const ListsPushIndicator: React.FC = () => {
  const { language, listsPush, resetListsPush } = useAppStore();
  const { toast } = useDialog();
  const t = (zh: string, en: string) => (language === 'zh' ? zh : en);

  const prevRunningRef = useRef(listsPush.isRunning);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = listsPush.isRunning;

    if (wasRunning && !listsPush.isRunning) {
      if (listsPush.error) {
        toast(listsPush.error, 'error');
      } else if (listsPush.message) {
        toast(listsPush.message, 'success');
      }
      const timer = setTimeout(() => resetListsPush(), 4000);
      return () => clearTimeout(timer);
    }
  }, [listsPush.isRunning, listsPush.message, listsPush.error, toast, resetListsPush]);

  if (!listsPush.isRunning) return null;

  const percent = listsPush.total > 0
    ? Math.min(100, Math.round((listsPush.done / listsPush.total) * 100))
    : 0;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04] shadow-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-gray-900 dark:text-text-primary">
          {t('同步分类到 GitHub list', 'Pushing categories to lists')}
        </span>
        <span className="text-xs text-gray-500 dark:text-text-tertiary shrink-0">
          {listsPush.total > 0 ? `${listsPush.done}/${listsPush.total}` : '...'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.06] dark:bg-white/[0.04] overflow-hidden mb-2">
        <div
          className="h-full bg-brand-violet dark:bg-brand-violet transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      {listsPush.currentLabel && (
        <p className="text-xs text-gray-500 dark:text-text-tertiary truncate">
          {listsPush.currentLabel}
        </p>
      )}
    </div>
  );
};

export default ListsPushIndicator;
