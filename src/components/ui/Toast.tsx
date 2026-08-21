import * as React from 'react';
import * as ToastPrimitive from '@radix-ui/react-toast';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastProps {
  message: string;
  type: ToastType;
  onClose: () => void;
  duration?: number;
}

const TOAST_META: Record<ToastType, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-status-green/30 bg-accent/50 text-status-green dark:bg-muted/40' },
  error: { icon: AlertTriangle, className: 'border-destructive/30 bg-accent/50 text-destructive dark:bg-muted/40' },
  warning: { icon: AlertTriangle, className: 'border-amber-400/40 bg-accent/50 text-amber-500 dark:bg-muted/40 dark:text-amber-400' },
  info: { icon: Info, className: 'border-gray-200 bg-accent/50 text-muted-foreground dark:border-border dark:bg-muted/40 dark:text-muted-foreground' },
};

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000 }) => {
  const { icon: Icon, className } = TOAST_META[type];

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      <ToastPrimitive.Root
        open
        duration={duration}
        onOpenChange={(open) => !open && onClose()}
        className={cn('pointer-events-auto fixed right-4 top-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] items-center gap-3 rounded-lg border px-4 py-3 shadow-lg outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in', className)}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <ToastPrimitive.Description className="flex-1 whitespace-pre-line text-sm text-foreground dark:text-foreground">
          {message}
        </ToastPrimitive.Description>
        <ToastPrimitive.Close asChild>
          <button
            type="button"
            aria-label={`${message} - close`}
            className="rounded p-1 opacity-70 transition-opacity hover:bg-black/5 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/30 dark:hover:bg-accent"
          >
            <X className="h-4 w-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
          </button>
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
      <ToastPrimitive.Viewport className="pointer-events-none fixed inset-0 z-[100]" />
    </ToastPrimitive.Provider>
  );
};
