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
import { PluginIcon } from '../plugins/pluginIcons';
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
          className="size-control shrink-0 rounded-md bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground"
        >
          <Plug className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <DropdownMenuItem key={`${action.pluginId}:${action.id}`} onSelect={() => void runAction(action)}>
            <PluginIcon pluginId={action.pluginId} icon={action.icon} className="mr-2 size-4" />
            {action.title}
          </DropdownMenuItem>
        ))}
        {exporters.map((exporter) => (
          <DropdownMenuItem key={`${exporter.pluginId}:export:${exporter.id}`} onSelect={() => void runExporter(exporter)}>
            <FolderOpen className="mr-2 size-4" />
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
      className={`fixed bottom-0 left-0 right-0 z-50 border-t border-subtle bg-floating shadow-elev-3 ${
        isClosing ? 'animate-slide-down' : 'animate-slide-up'
      } ${isShaking ? 'animate-shake' : ''}`}
      onClick={handleToolbarClick}
    >
      <div className="mx-auto max-w-7xl px-4 py-2.5 sm:px-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Selection Info */}
          <div className="flex items-center justify-between gap-3 sm:justify-start">
            <span className="text-label font-semibold text-foreground tabular-nums">
              {t('bulkActionToolbar.selected-selectedcount', { selectedCount: selectedCount })}
            </span>

            {/* Quick Actions */}
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSelectAll}
                disabled={isProcessing}
                className="h-control-sm gap-1 rounded-sm px-2 text-label-sm text-secondary hover:text-foreground"
                title={t('bulkActionToolbar.select-all-on-page')}
              >
                <CheckSquare className="size-3.5" />
                <span>{t('bulkActionToolbar.select-all')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleDeselectAll}
                disabled={isProcessing}
                className="h-control-sm gap-1 rounded-sm px-2 text-label-sm text-secondary hover:text-foreground"
                title={t('bulkActionToolbar.deselect-all')}
              >
                <Square className="size-3.5" />
                <span>{t('bulkActionToolbar.deselect-all-2')}</span>
              </Button>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="-mx-1 flex items-center justify-between gap-1 overflow-x-auto px-1 pb-0.5 sm:mx-0 sm:justify-start sm:px-0 sm:pb-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unstar-selected-repositories')}
              onClick={(e) => handleAction('unstar', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'unstar'
                  ? 'bg-destructive-solid text-on-destructive hover:bg-destructive-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'unstar' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Star className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.categorize-selected-repositories')}
              onClick={(e) => handleAction('categorize', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'categorize'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'categorize' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FolderOpen className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.generate-ai-summaries')}
              onClick={(e) => handleAction('ai-summary', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'ai-summary'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'ai-summary' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bot className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.subscribe-to-releases')}
              onClick={(e) => handleAction('subscribe', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'subscribe'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'subscribe' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bell className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unsubscribe-from-releases')}
              onClick={(e) => handleAction('unsubscribe', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'unsubscribe'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'unsubscribe' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <BellOff className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.lock-categories')}
              onClick={(e) => handleAction('lock-category', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'lock-category'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'lock-category' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Lock className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.unlock-categories')}
              onClick={(e) => handleAction('unlock-category', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'unlock-category'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              {isProcessing && showConfirm === 'unlock-category' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unlock className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('bulkActionToolbar.bulk-restore')}
              onClick={(e) => handleAction('restore', e)}
              disabled={isProcessing}
              className={`size-control shrink-0 rounded-md p-0 ${
                showConfirm === 'restore'
                  ? 'bg-accent-solid text-on-accent hover:bg-accent-solid'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
              title={t('bulkActionToolbar.bulk-restore')}
            >
              {isProcessing && showConfirm === 'restore' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RotateCcw className="size-4" />
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

            <div className="mx-1.5 hidden h-5 w-px bg-separator sm:block" />

            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleClose}
              disabled={isProcessing}
              className="size-control shrink-0 rounded-md p-0 text-tertiary hover:text-foreground"
              title={t('bulkActionToolbar.close-toolbar')}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* 弱气泡提示 */}
      {tooltip && (
        <div
          role="status"
          aria-live="polite"
          className="popover-styled motion-popover pointer-events-none fixed z-[60] px-2.5 py-1 text-label-sm text-foreground"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translateX(-50%)',
          }}
        >
          {tooltip.message}
        </div>
      )}
    </div>
  );
};
