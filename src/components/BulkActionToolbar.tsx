import React, { useState, useRef } from 'react';
import { X, Star, FolderOpen, Bot, Bell, BellOff, CheckSquare, Square, Loader2 } from 'lucide-react';
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
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shakeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 清理 shake timeout on unmount
  React.useEffect(() => {
    return () => {
      if (shakeTimeoutRef.current) {
        clearTimeout(shakeTimeoutRef.current);
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

  const handleAction = async (action: string) => {
    if (showConfirm === action) {
      setIsProcessing(true);
      if (confirmTimeoutRef.current) {
        clearTimeout(confirmTimeoutRef.current);
        confirmTimeoutRef.current = null;
      }
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
      setShowConfirm(action);
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
      className={`fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 shadow-lg z-50 ${
        isClosing ? 'animate-slide-down' : 'animate-slide-up'
      } ${isShaking ? 'animate-shake' : ''}`}
      onClick={handleToolbarClick}
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
          {/* Selection Info */}
          <div className="flex items-center justify-between sm:justify-start space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-base sm:text-lg font-semibold text-gray-900 dark:text-white">
                {t(`已选择 ${selectedCount} 个`, `Selected ${selectedCount}`)}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center space-x-1 sm:space-x-2">
              <button
                onClick={onSelectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('全选当前页面', 'Select all on page')}
              >
                <CheckSquare className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('全选', 'Select All')}</span>
              </button>
              <button
                onClick={handleDeselectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
              onClick={() => handleAction('unstar')}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm ${
                showConfirm === 'unstar'
                  ? 'bg-red-700 text-white hover:bg-red-800'
                  : 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('取消 Star', 'Unstar')}
            >
              {isProcessing && showConfirm === 'unstar' ? (
                <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <Star className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">
                {isProcessing && showConfirm === 'unstar'
                  ? t('处理中...', 'Processing...')
                  : showConfirm === 'unstar'
                    ? t('再次确认', 'Confirm Again')
                    : t('取消 Star', 'Unstar')}
              </span>
            </button>

            <button
              onClick={() => handleAction('categorize')}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm ${
                showConfirm === 'categorize'
                  ? 'bg-blue-700 text-white hover:bg-blue-800'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('批量分类', 'Categorize')}
            >
              {isProcessing && showConfirm === 'categorize' ? (
                <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <FolderOpen className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">
                {isProcessing && showConfirm === 'categorize'
                  ? t('处理中...', 'Processing...')
                  : showConfirm === 'categorize'
                    ? t('再次确认', 'Confirm Again')
                    : t('分类', 'Categorize')}
              </span>
            </button>

            <button
              onClick={() => handleAction('ai-summary')}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm ${
                showConfirm === 'ai-summary'
                  ? 'bg-purple-700 text-white hover:bg-purple-800'
                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('AI 总结', 'AI Summary')}
            >
              {isProcessing && showConfirm === 'ai-summary' ? (
                <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">
                {isProcessing && showConfirm === 'ai-summary'
                  ? t('处理中...', 'Processing...')
                  : showConfirm === 'ai-summary'
                    ? t('再次确认', 'Confirm Again')
                    : t('AI 总结', 'AI Summary')}
              </span>
            </button>

            <button
              onClick={() => handleAction('subscribe')}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm ${
                showConfirm === 'subscribe'
                  ? 'bg-green-700 text-white hover:bg-green-800'
                  : 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('订阅发布', 'Subscribe Releases')}
            >
              {isProcessing && showConfirm === 'subscribe' ? (
                <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <Bell className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">
                {isProcessing && showConfirm === 'subscribe'
                  ? t('处理中...', 'Processing...')
                  : showConfirm === 'subscribe'
                    ? t('再次确认', 'Confirm Again')
                    : t('订阅版本发布', 'Subscribe')}
              </span>
            </button>

            <button
              onClick={() => handleAction('unsubscribe')}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center space-x-1 sm:space-x-2 px-2 sm:px-4 py-2 rounded-lg transition-colors text-xs sm:text-sm ${
                showConfirm === 'unsubscribe'
                  ? 'bg-orange-700 text-white hover:bg-orange-800'
                  : 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 hover:bg-orange-200 dark:hover:bg-orange-800'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('取消订阅发布', 'Unsubscribe Releases')}
            >
              {isProcessing && showConfirm === 'unsubscribe' ? (
                <Loader2 className="w-3 h-3 sm:w-4 sm:h-4 animate-spin" />
              ) : (
                <BellOff className="w-3 h-3 sm:w-4 sm:h-4" />
              )}
              <span className="hidden sm:inline">
                {isProcessing && showConfirm === 'unsubscribe'
                  ? t('处理中...', 'Processing...')
                  : showConfirm === 'unsubscribe'
                    ? t('再次确认', 'Confirm Again')
                    : t('取消订阅', 'Unsubscribe')}
              </span>
            </button>

            <div className="hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 mx-2"></div>

            <button
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-shrink-0 p-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors disabled:opacity-50"
              title={t('关闭工具栏', 'Close toolbar')}
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
