import React, { useState, useCallback, createContext, useContext, ReactNode, useMemo, useRef } from 'react';
import { Toast, ToastType } from '../components/ui/Toast';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';

interface ToastState {
  message: string;
  type: ToastType;
  key: number;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  type?: 'danger' | 'warning' | 'info';
}

interface DialogContextValue {
  toast: (message: string, type?: ToastType) => void;
  confirm: (title: string, message: string, options?: {
    confirmText?: string;
    cancelText?: string;
    type?: 'danger' | 'warning' | 'info';
  }) => Promise<boolean>;
}

const DialogContext = createContext<DialogContextValue | null>(null);

export const useDialog = (): DialogContextValue => {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('useDialog must be used within a DialogProvider');
  }
  return context;
};

interface DialogProviderProps {
  children: ReactNode;
}

export const DialogProvider: React.FC<DialogProviderProps> = ({ children }) => {
  const [toastState, setToastState] = useState<ToastState | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>({
    isOpen: false,
    title: '',
    message: '',
    confirmText: undefined,
    cancelText: undefined,
    type: 'warning',
  });

  const pendingResolveRef = useRef<((value: boolean) => void) | null>(null);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    setToastState({ message, type, key: Date.now() });
  }, []);

  const closeToast = useCallback(() => {
    setToastState(null);
  }, []);

  const confirm = useCallback((
    title: string,
    message: string,
    options?: {
      confirmText?: string;
      cancelText?: string;
      type?: 'danger' | 'warning' | 'info';
    }
  ): Promise<boolean> => {
    // Cancel any pending confirm so its awaiter does not hang.
    pendingResolveRef.current?.(false);
    pendingResolveRef.current = null;

    return new Promise((resolve) => {
      pendingResolveRef.current = resolve;
      setConfirmState({
        isOpen: true,
        title,
        message,
        confirmText: options?.confirmText,
        cancelText: options?.cancelText,
        type: options?.type || 'warning',
      });
    });
  }, []);

  const handleConfirm = useCallback(() => {
    pendingResolveRef.current?.(true);
    pendingResolveRef.current = null;
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const handleCancel = useCallback(() => {
    pendingResolveRef.current?.(false);
    pendingResolveRef.current = null;
    setConfirmState((prev) => ({ ...prev, isOpen: false }));
  }, []);

  const value = useMemo<DialogContextValue>(() => ({
    toast,
    confirm,
  }), [toast, confirm]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      {toastState && (
        <Toast
          key={toastState.key}
          message={toastState.message}
          type={toastState.type}
          onClose={closeToast}
        />
      )}
      <ConfirmDialog
        isOpen={confirmState.isOpen}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        cancelText={confirmState.cancelText}
        type={confirmState.type}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </DialogContext.Provider>
  );
};