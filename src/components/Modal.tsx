import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { cn } from '../lib/utils';

type DialogContentPointerDownOutsideHandler = NonNullable<
  React.ComponentProps<typeof DialogContent>['onPointerDownOutside']
>;

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
  footer?: React.ReactNode;
  scrollable?: boolean;
  onPointerDownOutside?: DialogContentPointerDownOutsideHandler;
  onOverlayPointerDown?: React.PointerEventHandler<HTMLDivElement>;
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  footer,
  scrollable = false,
  onPointerDownOutside,
  onOverlayPointerDown,
}) => {
  const [isScrolling, setIsScrolling] = React.useState(false);
  const scrollStopTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (isOpen) return;
    if (scrollStopTimerRef.current) {
      window.clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = null;
    }
    setIsScrolling(false);
  }, [isOpen]);

  const handleScroll = () => {
    setIsScrolling(true);
    if (scrollStopTimerRef.current) window.clearTimeout(scrollStopTimerRef.current);
    scrollStopTimerRef.current = window.setTimeout(() => {
      setIsScrolling(false);
      scrollStopTimerRef.current = null;
    }, 700);
  };

  const content = scrollable ? (
    <>
      <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-12">
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div
        data-testid="modal-scroll-area"
        className={cn('min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-on-scroll', isScrolling && 'scrolling')}
        onScroll={handleScroll}
      >
        {children}
      </div>
      {footer && (
        <div data-testid="modal-footer" className="shrink-0 border-t border-border px-6 py-4">
          {footer}
        </div>
      )}
    </>
  ) : (
    <>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="min-w-0">{children}</div>
    </>
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className={cn(maxWidth, scrollable && 'flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0')}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onPointerDownOutside={onPointerDownOutside}
        onOverlayPointerDown={onOverlayPointerDown}
      >
        {content}
      </DialogContent>
    </Dialog>
  );
};
