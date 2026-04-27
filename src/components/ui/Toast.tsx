import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const iconMap = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const bgMap = {
  success: 'bg-gray-50 dark:bg-white/[0.04] border-status-green/30',
  error: 'bg-gray-50 dark:bg-white/[0.04] border-status-red/30',
  info: 'bg-gray-50 dark:bg-white/[0.04] border-gray-200 dark:border-white/[0.08]',
};

const iconColorMap = {
  success: 'text-status-green dark:text-status-green',
  error: 'text-status-red dark:text-status-red',
  info: 'text-gray-500 dark:text-text-secondary',
};

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000 }) => {
  const previousActiveElement = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement;

    timeoutRef.current = setTimeout(() => {
      onClose();
    }, duration);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      previousActiveElement.current?.focus();
    };
  }, [duration, onClose]);

  const Icon = iconMap[type];

  const toastContent = (
    <div className="fixed top-4 right-4 z-[100] animate-in slide-in-from-top-2 fade-in duration-200">
      <div className={`flex items-center space-x-3 px-4 py-3 rounded-lg border shadow-lg ${bgMap[type]}`}>
        <Icon className={`w-5 h-5 flex-shrink-0 ${iconColorMap[type]}`} />
        <p className="text-sm text-gray-900 dark:text-text-primary">{message}</p>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
        >
          <X className="w-4 h-4 text-gray-400 dark:text-text-tertiary" />
        </button>
      </div>
    </div>
  );

  return createPortal(toastContent, document.body);
};
