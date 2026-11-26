import React, { useState } from 'react';
import { Eye, EyeOff, Loader2, UserPlus } from 'lucide-react';
import { useT } from '../i18n/useT';
import { DUPLICATE_ACCOUNT_ERROR } from '../hooks/useAccountProfiles';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';

interface AddAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (token: string, copySettings: boolean) => Promise<void>;
}

export const AddAccountModal: React.FC<AddAccountModalProps> = ({
  open,
  onOpenChange,
  onSubmit,
}) => {
  const t = useT('app');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [copySettings, setCopySettings] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    if (!nextOpen) {
      setToken('');
      setShowToken(false);
      setCopySettings(true);
      setError(null);
    }
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError(t('accountSwitcher.token-required'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(token.trim(), copySettings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      const status = typeof (err as { status?: unknown })?.status === 'number'
        ? (err as { status: number }).status
        : undefined;
      const isAuthError =
        status === 401 ||
        /\b401\b|bad credentials|unauthorized/i.test(msg);
      if (msg === DUPLICATE_ACCOUNT_ERROR) {
        setError(t('accountSwitcher.duplicate-account-error'));
      } else if (isAuthError || !msg) {
        setError(t('accountSwitcher.token-validation-failed'));
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {t('accountSwitcher.add-account-title')}
          </DialogTitle>
          <DialogDescription>
            {t('accountSwitcher.add-account-description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="add-account-pat" className="text-sm font-medium text-foreground">
              {t('accountSwitcher.github-pat-label')}
            </label>
            <div className="relative">
              <Input
                id="add-account-pat"
                type={showToken ? 'text' : 'password'}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  if (error) setError(null);
                }}
                placeholder={t('accountSwitcher.github-pat-placeholder')}
                autoComplete="off"
                disabled={submitting}
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setShowToken((prev) => !prev)}
                aria-label={showToken ? t('accountSwitcher.hide-token') : t('accountSwitcher.show-token')}
                disabled={submitting}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 p-3">
            <Checkbox
              id="add-account-copy-settings"
              checked={copySettings}
              onCheckedChange={(checked) => setCopySettings(checked === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <label
              htmlFor="add-account-copy-settings"
              className="cursor-pointer text-sm leading-snug text-foreground"
            >
              {t('accountSwitcher.copy-general-settings')}
            </label>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              {t('accountSwitcher.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || !token.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('accountSwitcher.add-and-switch')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
