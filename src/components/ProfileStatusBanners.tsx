import React, { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Loader2, RefreshCw, X } from 'lucide-react';
import { useT } from '../i18n/useT';
import { useAccountProfiles } from '../hooks/useAccountProfiles';
import {
  DEFAULT_PROFILE_ID,
  PROFILE_CONFLICT_EVENT,
  isDefaultProfile,
  type ProfileConflictEventDetail,
} from '../services/profileStorage';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/button';

export const ProfileStatusBanners: React.FC = () => {
  const t = useT('app');
  const isAuthenticated = useAppStore((state) => state.isAuthenticated);
  const {
    profiles,
    activeProfileId,
    isSwitching,
    otherTabSwitched,
    backendProfilesUnsupported,
    switchAccount,
    reloadPage,
  } = useAccountProfiles();
  const [conflictWarning, setConflictWarning] = useState<ProfileConflictEventDetail | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);

  useEffect(() => {
    const handleConflict = (event: Event) => {
      const detail = (event as CustomEvent<ProfileConflictEventDetail>).detail;
      if (detail && (detail.kind === 'webdav' || detail.kind === 'vector')) {
        setConflictWarning(detail);
      }
    };
    window.addEventListener(PROFILE_CONFLICT_EVENT, handleConflict);
    return () => {
      window.removeEventListener(PROFILE_CONFLICT_EVENT, handleConflict);
    };
  }, []);

  const showLoggedOutSwitcher =
    !isAuthenticated && (!isDefaultProfile(activeProfileId) || profiles.length >= 2);
  const activeProfile = profiles.find((p) => p.id === activeProfileId);
  const activeProfileLabel = activeProfile?.login || activeProfile?.name || activeProfileId;
  const otherProfiles = profiles.filter((p) => p.id !== activeProfileId && p.id !== DEFAULT_PROFILE_ID);

  return (
    <>
      {isSwitching && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
          role="status"
          aria-live="assertive"
        >
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-5 py-4 shadow-lg">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm font-medium text-foreground">
              {t('accountSwitcher.switching-account')}
            </span>
          </div>
        </div>
      )}

      {showLoggedOutSwitcher && (
        <div
          className="border-b border-border bg-muted/60 px-4 py-2 text-sm text-foreground"
          role="region"
          aria-label={t('accountSwitcher.accounts-label')}
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-muted-foreground">
              <ArrowLeftRight className="h-4 w-4 shrink-0" />
              {t('accountSwitcher.logged-out-profile-notice', { profile: activeProfileLabel })}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {!isDefaultProfile(activeProfileId) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isSwitching}
                  onClick={() => void switchAccount(DEFAULT_PROFILE_ID)}
                >
                  {t('accountSwitcher.return-to-default')}
                </Button>
              )}
              {otherProfiles.map((profile) => {
                const label = profile.login || profile.name || profile.id;
                return (
                  <Button
                    key={profile.id}
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isSwitching}
                    onClick={() => void switchAccount(profile.id)}
                  >
                    {t('accountSwitcher.switch-to-profile', { profile: label })}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {otherTabSwitched && (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {t('accountSwitcher.other-tab-switched-notice')}
                {reloadError && (
                  <span className="ml-2 text-destructive" role="alert">
                    {reloadError}
                  </span>
                )}
              </span>
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={isSwitching}
              onClick={async () => {
                setReloadError(null);
                try {
                  await reloadPage();
                } catch (err) {
                  setReloadError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              {t('accountSwitcher.reload-now')}
            </Button>
          </div>
        </div>
      )}

      {backendProfilesUnsupported && (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
          role="alert"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>{t('accountSwitcher.backend-profiles-unsupported-warning')}</span>
          </div>
        </div>
      )}

      {conflictWarning && (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-foreground"
          role="alert"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                {conflictWarning.kind === 'webdav'
                  ? t('accountSwitcher.profile-conflict-webdav-warning', {
                      account: conflictWarning.conflictingProfile,
                    })
                  : t('accountSwitcher.profile-conflict-vector-warning', {
                      account: conflictWarning.conflictingProfile,
                    })}
              </span>
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0"
              aria-label={t('accountSwitcher.dismiss')}
              onClick={() => setConflictWarning(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
