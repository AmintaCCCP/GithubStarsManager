import { useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
import React, { useState, useRef } from 'react';
import { X, Star, FolderOpen, Bot, Bell, BellOff, CheckSquare, Square, Loader2, Lock, Unlock, RotateCcw, Plug } from 'lucide-react';
import { Repository } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { Button } from './ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './ui/dropdown-menu';
import { usePluginActions } from '../plugins/hooks/usePluginActions';
import { applyPluginActionResult } from '../plugins/applyPluginActionResult';
import { useDialog } from '../hooks/useDialog';
import { usePluginExporters } from '../plugins/hooks/usePluginExporters';
import { pluginClient } from '../plugins/pluginClient';
import type { RegisteredPluginAction } from '../plugins/types';

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

interface RegisteredExporter {
  id: string;
  title: string;
  fileExtension: string;
  mimeType: string;
  pluginId: string;
  pluginName: string;
}

const PluginBulkMenu: React.FC<{
  actions: RegisteredPluginAction[];
  exporters: RegisteredExporter[];
  repositories: Repository[];
  language: AppLanguage;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}> = ({ actions, exporters, repositories, language, disabled, onBusyChange }) => {
  const { toast } = useDialog();
  const t = useT('app');

  const runAction = async (action: RegisteredPluginAction) => {
    onBusyChange(true);
    try {
      const operation = await pluginClient.runAction({
        pluginId: action.pluginId,
        actionId: action.id,
        repositories,
      });
      if (!operation.success) return toast(operation.error.message, 'error');
      await applyPluginActionResult(operation.result, toast, language);
    } catch {
      toast(t('bulkActionToolbar.plugin-action-failed'), 'error');
    } finally {
      onBusyChange(false);
    }
  };

  const runExporter = async (exporter: RegisteredExporter) => {
    onBusyChange(true);
    try {
      const operation = await pluginClient.runExporter({
        pluginId: exporter.pluginId,
        exporterId: exporter.id,
        repositories,
      });
      if (!operation.success) return toast(operation.error.message, 'error');
      const url = URL.createObjectURL(new Blob([operation.result.content], { type: operation.result.mimeType }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = operation.result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      toast(t('bulkActionToolbar.export-complete'), 'success');
    } catch {
      toast(t('bulkActionToolbar.plugin-export-failed'), 'error');
    } finally {
      onBusyChange(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          aria-label={t('bulkActionToolbar.plugin-actions')}
          className="h-9 w-9 shrink-0 rounded-lg bg-muted text-muted-foreground hover:bg-accent hover:text-foreground sm:h-10 sm:w-10"
        >
          <Plug className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem key={`${action.pluginId}:${action.id}`} onSelect={() => void runAction(action)}>
            <Plug className="mr-2 h-4 w-4" />
            {action.title}
          </DropdownMenuItem>
        ))}
        {exporters.map((exporter) => (
          <DropdownMenuItem key={`${exporter.pluginId}:export:${exporter.id}`} onSelect={() => void runExporter(exporter)}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {exporter.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const BulkActionToolbar: React.FC<BulkActionToolbarProps> = ({
  selectedCount,
  repositories,
  onSelectAll,
  onDeselectAll,
  onBulkAction,
  onClose,
  isVisible = true
}) => {
  const { language } = useAppStore(useShallow((state) => ({
    language: state.language,
  })));
  const pluginActions = usePluginActions('bulk-toolbar');
  const pluginExporters = usePluginExporters();
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
        const label_text = language === 'zh' ? label?.zh : label?.en;
        const message = t('bulkActionToolbar.click-again-to-confirm-v1', { v1: label_text || '' });
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

  const t = useT('app');

  if (!shouldRender) return null;

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 bg-card dark:bg-card border-t border-border dark:border-border shadow-lg z-50 ${
        isClosing ? 'animate-slide-down' : 'animate-slide-up'
      } ${isShaking ? 'animate-shake' : ''}`}
      onClick={handleToolbarClick}
    >
      <div className="max-w-7xl mx-auto px-2 sm:px-4 lg:px-8 py-3 sm:py-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0">
          {/* Selection Info */}
          <div className="flex items-center justify-between sm:justify-start space-x-2 sm:space-x-4">
            <div className="flex items-center space-x-2">
              <span className="text-base sm:text-lg font-semibold text-foreground dark:text-foreground">
                {t('bulkActionToolbar.selected-selectedcount', { selectedCount: selectedCount })}
              </span>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center space-x-1 sm:space-x-2">
              <Button
                variant="ghost"
                onClick={onSelectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('bulkActionToolbar.select-all-on-page')}
              >
                <CheckSquare className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('bulkActionToolbar.select-all')}</span>
              </Button>
              <Button
                variant="ghost"
                onClick={handleDeselectAll}
                disabled={isProcessing}
                className="flex items-center space-x-1 px-2 sm:px-3 py-1.5 text-xs sm:text-sm text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t('bulkActionToolbar.deselect-all')}
              >
                <Square className="w-3 h-3 sm:w-4 sm:h-4" />
                <span>{t('bulkActionToolbar.deselect-all-2')}</span>
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between sm:justify-start space-x-1 sm:space-x-2 overflow-x-auto pb-1 sm:pb-0 -mx-2 px-2 sm:mx-0 sm:px-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unstar-selected-repositories')}
              onClick={(e) => handleAction('unstar', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'unstar'
                  ? 'bg-destructive text-destructive-foreground hover:opacity-90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unstar' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Star className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.categorize-selected-repositories')}
              onClick={(e) => handleAction('categorize', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'categorize'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'categorize' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <FolderOpen className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.generate-ai-summaries')}
              onClick={(e) => handleAction('ai-summary', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'ai-summary'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'ai-summary' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Bot className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.subscribe-to-releases')}
              onClick={(e) => handleAction('subscribe', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'subscribe'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'subscribe' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Bell className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unsubscribe-from-releases')}
              onClick={(e) => handleAction('unsubscribe', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'unsubscribe'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unsubscribe' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <BellOff className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.lock-categories')}
              onClick={(e) => handleAction('lock-category', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'lock-category'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'lock-category' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Lock className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unlock-categories')}
              onClick={(e) => handleAction('unlock-category', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'unlock-category'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {isProcessing && showConfirm === 'unlock-category' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <Unlock className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.bulk-restore')}
              onClick={(e) => handleAction('restore', e)}
              disabled={isProcessing}
              className={`flex-shrink-0 flex items-center justify-center w-9 h-9 sm:w-10 sm:h-10 p-0 rounded-lg transition-colors ${
                showConfirm === 'restore'
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent hover:text-foreground dark:hover:bg-accent dark:hover:text-foreground'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title={t('bulkActionToolbar.bulk-restore')}
            >
              {isProcessing && showConfirm === 'restore' ? (
                <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
              ) : (
                <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
              )}
            </Button>

            {(pluginActions.actions.length > 0 || pluginExporters.exporters.length > 0) && (
              <PluginBulkMenu
                actions={pluginActions.actions}
                exporters={pluginExporters.exporters}
                repositories={repositories}
                language={language}
                disabled={isProcessing}
                onBusyChange={setIsProcessing}
              />
            )}

            <div className="hidden sm:block w-px h-6 bg-muted dark:bg-accent mx-2"></div>

            <Button
              variant="ghost"
              onClick={handleClose}
              disabled={isProcessing}
              className="flex-shrink-0 p-2 text-muted-foreground dark:text-muted-foreground hover:bg-muted dark:hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
              title={t('bulkActionToolbar.close-toolbar')}
            >
              <X className="w-4 h-4 sm:w-5 sm:h-5" />
            </Button>
          </div>
        </div>
      </div>

      {/* 弱气泡提示 */}
      {tooltip && (
        <div
          role="status"
          aria-live="polite"
          className="fixed z-[60] rounded-lg bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-lg pointer-events-none animate-fade-in"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltip.message}
          <div className="absolute left-1/2 -bottom-1 h-2 w-2 -translate-x-1/2 rotate-45 transform bg-popover"></div>
        </div>
      )}
    </div>
  );
};
