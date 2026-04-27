import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  type?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  type = 'warning',
}) => {
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement as HTMLElement;
      document.body.style.overflow = 'hidden';

      // Focus cancel button by default for safety
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 0);
    } else {
      document.body.style.overflow = '';
      previousActiveElement.current?.focus();
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onCancel();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm();
  };

  const handleCancel = () => {
    onCancel();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onCancel();
    }
  };

  const buttonClass = type === 'danger'
    ? 'bg-status-red hover:bg-status-red/90 dark:bg-status-red/80 dark:hover:bg-status-red'
    : 'bg-brand-indigo hover:bg-brand-hover dark:bg-brand-indigo dark:hover:bg-brand-hover';

  const dialogContent = (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50" />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-md mx-4 bg-white dark:bg-panel-dark dark:border dark:border-white/[0.04] rounded-xl shadow-xl"
      >
        <div className="p-6">
          <div className="flex items-start space-x-4">
            <div className={`flex-shrink-0 p-2 rounded-full ${
              type === 'danger' ? 'bg-status-red/10' : 'bg-brand-indigo/10'
            }`}>
              <AlertTriangle className={`w-6 h-6 ${
                type === 'danger' ? 'text-status-red' : 'text-brand-indigo dark:text-brand-indigo'
              }`} />
            </div>
            <div className="flex-1">
              <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900 dark:text-text-primary">
                {title}
              </h3>
              <p className="mt-2 text-sm text-gray-600 dark:text-text-secondary">
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end space-x-3 px-6 py-4 bg-light-bg dark:bg-white/[0.02] border-t border-black/[0.06] dark:border-white/[0.04] rounded-b-xl">
          <button
            ref={cancelButtonRef}
            onClick={handleCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-text-primary bg-white dark:bg-panel-dark border border-black/[0.06] dark:border-white/[0.08] rounded-lg hover:bg-gray-50 dark:hover:bg-white/[0.08] transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${buttonClass}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialogContent, document.body);
};
