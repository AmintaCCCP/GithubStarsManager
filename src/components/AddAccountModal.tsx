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
            <UserPlus className="size-4 text-secondary" />
            {t('accountSwitcher.add-account-title')}
          </DialogTitle>
          <DialogDescription>
            {t('accountSwitcher.add-account-description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="add-account-pat" className="text-label font-medium text-foreground">
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
                className="pr-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground"
                onClick={() => setShowToken((prev) => !prev)}
                aria-label={showToken ? t('accountSwitcher.hide-token') : t('accountSwitcher.show-token')}
                disabled={submitting}
              >
                {showToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-2.5 rounded-md bg-sunken px-3 py-2.5 shadow-elev-0">
            <Checkbox
              id="add-account-copy-settings"
              checked={copySettings}
              onCheckedChange={(checked) => setCopySettings(checked === true)}
              disabled={submitting}
              className="mt-0.5"
            />
            <label
              htmlFor="add-account-copy-settings"
              className="cursor-pointer text-label leading-snug text-foreground"
            >
              {t('accountSwitcher.copy-general-settings')}
            </label>
          </div>

          {error && (
            <p className="rounded-md bg-destructive-tint px-3 py-2 text-label-sm text-destructive" role="alert">
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
            <Button type="submit" variant="primary" disabled={submitting || !token.trim()}>
              {submitting && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {t('accountSwitcher.add-and-switch')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
