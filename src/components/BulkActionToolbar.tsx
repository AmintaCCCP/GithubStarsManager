import React, { useState, useRef } from 'react';
import { X, Star, FolderOpen, Bot, Bell, BellOff, CheckSquare, Square, Loader2, Lock, Unlock, RotateCcw } from 'lucide-react';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';

interface BulkActionToolbarProps {
  selectedCount: number;
  repositories: Repository[];
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onBulkAction: (action: string, repos: Repository[]) => Promise<void>;
  onClose: () => void;
  isVisible?: boolean;
}

interface TooltipState {
  action: string;
  message: string;
  x: number;
  y: number;
}

export const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  repositories,
  onSelectAll,
  onDeselectAll,
  onBulkAction,
  onClose,
  isVisible = true
}) => {
  const { language } = useAppStore();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showConfirm, setShowConfirm] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [shouldRender, setShouldRender] = useState(isVisible);
  const [isShaking, setIsShaking] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 处理可见性变化，播放动画后再卸载
  React.useEffect(() => {
    if (isVisible) {
      setShouldRender(true);
      setIsClosing(false);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => {
        setShouldRender(false);
      }, 300); // 动画持续时间
      return () => clearTimeout(timer);
    }
  }, [isVisible]);

  // 清理 shake timeout 和 confirm timeout on unmount
  React.useEffect(() => {
    return () => {
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current);
      }
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
    };
  }, []);

  // 触发抖动动画
  const triggerShake = () => {
    setIsShaking(true);
    if (shakeTimeoutRef.current) {
      clearTimeout(shakeTimeoutRef.current);
    }
    shakeTimeoutRef.current = setTimeout(() => {
      setIsShaking(false);
    }, 500);
  };

  const handleAction = async (action: string, e?: React.MouseEvent) => {
    if (showConfirm === action) {
      setIsProcessing(true);
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
        tooltipTimeoutRef.current = null;
      }
      setTooltip(null);
      try {
        await onBulkAction(action, repositories);
      } finally {
        setIsProcessing(false);
        setShowConfirm(null);
      }
    } else {
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
      }
      if (tooltipTimeoutRef.current) {
        clearTimeout(tooltipTimeoutRef.current);
      }
      setShowConfirm(action);

      // 显示弱气泡提示
      if (e) {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const actionLabels: Record<string, { zh: string; en: string }> = {
          unstar: { zh: '取消 Star', en: 'Unstar' },
          categorize: { zh: '批量分类', en: 'Categorize' },
          'ai-summary': { zh: 'AI 总结', en: 'AI Summary' },
          subscribe: { zh: '订阅版本发布', en: 'Subscribe Releases' },
          unsubscribe: { zh: '取消订阅发布', en: 'Unsubscribe Releases' },
          'lock-category': { zh: '批量锁定分类', en: 'Lock Categories' },
          'unlock-category': { zh: '批量解锁分类', en: 'Unlock Categories' },
          'restore': { zh: '批量还原', en: 'Bulk Restore' },
        };
        const label = actionLabels[action];
        const message = language === 'zh'
          ? `再次点击确认${label?.zh || ''}`
          : `Click again to confirm ${label?.en || ''}`;
        setTooltip({
          action,
          message,
          x: rect.left + rect.width / 2,
          y: rect.top - 40,
        });
        tooltipTimeoutRef.current = setTimeout(() => setTooltip(null), 3000);
      }

      confirmTimeoutRef.current = setTimeout(() => setShowConfirm(null), 3000);
    }
  };

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
    }, 300);
  };

  const handleDeselectAll = () => {
    setIsClosing(true);
    setTimeout(() => {
      onDeselectAll();
      setIsClosing(false);
    }, 300);
  };

  // 处理点击工具栏背景（非按钮区域）
  const handleToolbarClick = (e: React.MouseEvent) => {
    // 如果点击的是工具栏背景本身（不是按钮），触发抖动提示
    if (e.target === e.currentTarget) {
      triggerShake();
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-panel-dark border-t border-black/[0.06] dark:border-white/[0.04] shadow-lg z-50 ${
        isClosing ? 'animate-slide-down' : 'animate-slide-up'
      } ${isShaking ? 'animate-shake' : ''}`}
      onClick={handleToolbarClick}
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
          {/* Selection Info */}
          <div className="flex items-center justify-between sm:justify-start space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-base sm:text-lg font-semibold text-gray-900 dark:text-text-primary">
                {t(`已选择 ${selectedCount} 个`, `Selected ${selectedCount}`)}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center space-x-1 sm:space-x-2">
              <button
                onClick={onSelectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-700 dark:text-text-tertiary hover:bg-light-surface dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('全选当前页面', 'Select all on page')}
              >
                <CheckSquare className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('全选', 'Select All')}</span>
              </button>
              <button
                onClick={handleDeselectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-700 dark:text-text-tertiary hover:bg-light-surface dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('取消选择所有', 'Deselect all')}
              >
                <Square className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('不全选', 'Deselect All')}</span>
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between sm:justify-start space-x-1 sm:space-x-2 overflow-x-auto pb-1 sm:pb-0 -mx-2 px-2 sm:mx-0 sm:px-0">
            <button
              onClick={(e) => handleAction('unstar', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'unstar'
                  ? 'bg-status-red text-white hover:opacity-90'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unstar' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Star className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('categorize', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'categorize'
                  ? 'bg-brand-indigo text-white hover:bg-brand-hover'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'categorize' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('ai-summary', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'ai-summary'
                  ? 'bg-status-red text-white hover:opacity-90'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'ai-summary' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Bot className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('subscribe', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'subscribe'
                  ? 'bg-brand-indigo text-white hover:bg-brand-hover'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'subscribe' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('unsubscribe', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'unsubscribe'
                  ? 'bg-brand-indigo text-white hover:bg-brand-hover'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unsubscribe' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <BellOff className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('lock-category', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'lock-category'
                  ? 'bg-brand-indigo text-white hover:bg-brand-hover'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'lock-category' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('unlock-category', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'unlock-category'
                  ? 'bg-gray-700 text-white hover:bg-gray-800'
                  : 'bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary hover:bg-gray-200 hover:text-gray-900 dark:hover:bg-white/[0.08] dark:hover:text-text-primary'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unlock-category' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Unlock className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <button
              onClick={(e) => handleAction('restore', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 rounded-lg transition-colors ${
                showConfirm === 'restore'
                  ? 'bg-teal-700 text-white hover:bg-teal-800'
                  : 'bg-teal-100 text-teal-700 dark:bg-teal-900 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('批量还原', 'Bulk Restore')}
            >
              {isProcessing && showConfirm === 'restore' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </button>

            <div className="hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2"></div>

            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-shrink-0 p-2 text-gray-500 dark:text-text-tertiary hover:bg-light-surface dark:hover:bg-white/10 rounded-lg transition-colors disabled:opacity-50"
              title={t('关闭工具栏', 'Close toolbar')}
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </div>

      {/* 弱气泡提示 */}
      {tooltip && (
        <div
          className="fixed z-[60] px-3 py-1.5 text-xs text-white bg-gray-800 dark:bg-white/[0.04] rounded-lg shadow-lg pointer-events-none animate-fade-in"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltip.message}
          <div className="absolute left-1/2 -bottom-1 w-2 h-2 bg-gray-800 dark:bg-white/[0.04] transform -translate-x-1/2 rotate-45"></div>
        </div>
      )}
    </div>
  );
};
