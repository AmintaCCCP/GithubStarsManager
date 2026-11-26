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

const TOAST_META: Record<ToastType, { icon: React.ComponentType<{ className?: string }>; iconClassName: string }> = {
  success: { icon: CheckCircle2, iconClassName: 'text-status-green' },
  error: { icon: AlertTriangle, iconClassName: 'text-destructive' },
  warning: { icon: AlertTriangle, iconClassName: 'text-status-amber' },
  info: { icon: Info, iconClassName: 'text-secondary' },
};

const TOAST_EXIT_DURATION_MS = 150;

export const Toast: React.FC<ToastProps> = ({ message, type, onClose, duration = 3000, closeLabel = 'Close' }) => {
  const { icon: Icon, iconClassName } = TOAST_META[type];
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
      className="pointer-events-auto flex min-h-[44px] w-[min(420px,calc(100vw_-_2rem))] items-center gap-2.5 rounded-lg bg-floating px-3 py-2.5 text-foreground shadow-elev-2 outline-none data-[state=closed]:animate-fade-out data-[state=open]:animate-fade-in"
    >
      <Icon className={cn('size-4 shrink-0', iconClassName)} aria-hidden="true" />
      <ToastPrimitive.Description className="flex-1 whitespace-pre-line text-label text-foreground">
        {message}
      </ToastPrimitive.Description>
      <ToastPrimitive.Close asChild>
        <button
          type="button"
          aria-label={closeLabel}
          className="motion-press inline-grid size-control-sm shrink-0 place-items-center rounded-sm text-tertiary hover:bg-fill-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </ToastPrimitive.Close>
    </ToastPrimitive.Root>
  );
};
