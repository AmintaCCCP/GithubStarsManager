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
  const [switchError, setSwitchError] = useState<string | null>(null);

  const handleSwitch = async (profileId: string) => {
    setSwitchError(null);
    try {
      await switchAccount(profileId);
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : String(err));
    }
  };

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
          className="fixed inset-0 z-50 flex items-center justify-center bg-scrim backdrop-blur-[2px]"
          role="status"
        >
          <div className="flex items-center gap-3 rounded-xl bg-floating px-5 py-3.5 shadow-elev-3">
            <Loader2 className="size-4 animate-spin text-accent-text" />
            <span className="text-label font-medium text-foreground">
              {t('accountSwitcher.switching-account')}
            </span>
          </div>
        </div>
      )}

      {showLoggedOutSwitcher && (
        <div
          className="border-b border-subtle bg-navigator px-4 py-2 text-label text-foreground"
          role="region"
          aria-label={t('accountSwitcher.accounts-label')}
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-secondary">
              <ArrowLeftRight className="size-4 shrink-0 text-tertiary" />
              {t('accountSwitcher.logged-out-profile-notice', { profile: activeProfileLabel })}
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {!isDefaultProfile(activeProfileId) && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isSwitching}
                  onClick={() => void handleSwitch(DEFAULT_PROFILE_ID)}
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
                    onClick={() => void handleSwitch(profile.id)}
                  >
                    {t('accountSwitcher.switch-to-profile', { profile: label })}
                  </Button>
                );
              })}
            </div>
          </div>
          {switchError && (
            <p className="mx-auto mt-1 max-w-7xl text-label-sm text-destructive" role="alert">
              {switchError}
            </p>
          )}
        </div>
      )}

      {otherTabSwitched && (
        <div
          className="border-b border-subtle bg-warning-tint px-4 py-2 text-label text-foreground"
          role="status"
          aria-live="polite"
        >
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <RefreshCw className="size-4 shrink-0 text-warning" />
              <span>
                {t('accountSwitcher.other-tab-switched-notice')}
                {reloadError && (
                  <span className="ml-2 text-label-sm text-destructive" role="alert">
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
          className="border-b border-subtle bg-warning-tint px-4 py-2 text-label text-foreground"
          role="alert"
        >
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <AlertTriangle className="size-4 shrink-0 text-warning" />
            <span>{t('accountSwitcher.backend-profiles-unsupported-warning')}</span>
          </div>
        </div>
      )}

      {conflictWarning && (
        <div
          className="border-b border-subtle bg-warning-tint px-4 py-2 text-label text-foreground"
          role="alert"
        >
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0 text-warning" />
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
              size="icon-sm"
              variant="ghost"
              className="shrink-0 text-secondary hover:text-foreground"
              aria-label={t('accountSwitcher.dismiss')}
              onClick={() => setConflictWarning(null)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
};
