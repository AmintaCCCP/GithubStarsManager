



import { useT } from '../i18n/useT';
import React, { useEffect, useRef } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useDialog } from '../hooks/useDialog';

/**
 * 全局 GitHub Lists 回写进度指示器。
 * 进程运行于 store 级 action，切换页面不中断；此处提供跨页面可见的
 * 进度浮层，并在完成/失败时给出 toast 反馈。
 */
export const ListsPushIndicator: React.FC = () => {
  const { listsPush, resetListsPush } = useAppStore(useShallow((state) => ({
    language: state.language,
    listsPush: state.listsPush,
    resetListsPush: state.resetListsPush,
  })));
  const { toast } = useDialog();
  const t = useT('app');

  const prevRunningRef = useRef(listsPush.isRunning);
  // 按对象引用比较：每次 store 写入都会生成新的 listsPush 对象，即使错误文案相同也能再次提示
  const prevListsPushRef = useRef(listsPush);
  // 结束后延迟重置的定时器放在 ref 中，避免后续 store 写入触发 effect 重跑时被提前清除
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(resetTimerRef.current), []);

  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    const prevListsPush = prevListsPushRef.current;
    prevRunningRef.current = listsPush.isRunning;
    prevListsPushRef.current = listsPush;
    // 任何新的推送状态都会取代上一轮待执行的 reset，避免其清空新一轮运行状态或新错误
    if (listsPush !== prevListsPush) clearTimeout(resetTimerRef.current);

    if (wasRunning && !listsPush.isRunning) {
      if (listsPush.error) {
        toast(listsPush.error, 'error');
      } else if (listsPush.message) {
        toast(listsPush.message, 'success');
      }
      resetTimerRef.current = setTimeout(() => resetListsPush(), 4000);
      return;
    }

    // 未运行时新出现的错误（如启动前的 token/仓库/选择校验失败）没有运行→结束的转换，需单独 toast。
    // 不调用 reset：错误由 StarSyncPanel 内联展示，保留在 store 中。
    if (!wasRunning && !listsPush.isRunning && listsPush.error && listsPush !== prevListsPush) {
      toast(listsPush.error, 'error');
    }
  }, [listsPush, toast, resetListsPush]);

  if (!listsPush.isRunning) return null;

  const percent = listsPush.total > 0
    ? Math.min(100, Math.round((listsPush.done / listsPush.total) * 100))
    : 0;

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-80 max-w-[calc(100vw_-_2rem)] bg-card dark:bg-card rounded-xl border border-border dark:border-border shadow-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-foreground dark:text-foreground">
          {t('listsPushIndicator.pushing-categories-to-lists')}
        </span>
        <span className="text-xs text-muted-foreground dark:text-muted-foreground shrink-0">
          {listsPush.total > 0 ? `${listsPush.done}/${listsPush.total}` : '…'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden mb-2">
        <div
          className="h-full bg-primary dark:bg-primary transition-all duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
      {listsPush.currentLabel && (
        <p className="text-xs text-muted-foreground dark:text-muted-foreground truncate">
          {listsPush.currentLabel}
        </p>
      )}
    </div>
  );
};

export default ListsPushIndicator;
