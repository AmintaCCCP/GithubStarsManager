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
  closeLabel?: string;
}

const TOAST_META: Record<ToastType, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  success: { icon: CheckCircle2, className: 'border-status-green/30 bg-background text-status-green dark:bg-card' },
  error: { icon: AlertTriangle, className: 'border-destructive/30 bg-background text-destructive dark:bg-card' },
  warning: { icon: AlertTriangle, className: 'border-status-amber/40 bg-background text-status-amber dark:bg-card' },
  info: { icon: Info, className: 'border-border bg-background text-muted-foreground dark:bg-card' },
};

const TOAST_EXIT_DURATION_MS = 150;

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000, closeLabel = 'Close' }) => {
  const { icon: Icon, className } = TOAST_META[type];
  const [open, setOpen] = React.useState(true);
  const closeTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      closeTimeoutRef.current = setTimeout(onClose, TOAST_EXIT_DURATION_MS);
    }
  };

  return (
    <ToastPrimitive.Root
        open={open}
        duration={duration}
        onOpenChange={handleOpenChange}
        className={cn('pointer-events-auto flex w-[min(420px,calc(100vw_-_2rem))] items-center gap-3 rounded-lg border px-4 py-3 shadow-lg outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in', className)}
      >
        <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
        <ToastPrimitive.Description className="flex-1 whitespace-pre-line text-sm text-foreground dark:text-foreground">
          {message}
        </ToastPrimitive.Description>
        <ToastPrimitive.Close asChild>
          <button
            type="button"
            aria-label={closeLabel}
            className="rounded p-1 opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring/30 dark:hover:bg-accent"
          >
            <X className="h-4 w-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
          </button>
        </ToastPrimitive.Close>
      </ToastPrimitive.Root>
  );
};
