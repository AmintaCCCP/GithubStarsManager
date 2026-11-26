import * as React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './alert-dialog';

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
  const isDanger = type === 'danger';
  const confirmingRef = React.useRef(false);

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (confirmingRef.current) {
      confirmingRef.current = false;
      return;
    }
    onCancel();
  };

  const handleConfirm = () => {
    confirmingRef.current = true;
    onConfirm();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-start gap-3.5">
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${isDanger ? 'bg-destructive-tint' : 'bg-accent-tint'}`}>
              <AlertTriangle className={`size-4 ${isDanger ? 'text-destructive' : 'text-primary'}`} />
            </div>
            <div className="space-y-1.5">
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-all">{message}</AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            className={isDanger ? 'bg-destructive text-destructive-foreground' : undefined}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
