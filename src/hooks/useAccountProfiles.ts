import { useCallback, useEffect, useState } from 'react';
import { backend } from '../services/backendAdapter';
import { flushAutoSyncBeforeSwitch } from '../services/autoSync';
import { createGitHubApiService } from '../services/githubApiFactory';
import { clearEncryptedXAuthViaDesktop, isElectron } from '../services/electronProxy';
import { deleteProfileIndexedDbs, flushPendingIdbWrites } from '../services/indexedDbStorage';
import {
  ACTIVE_PROFILE_ID,
  ACTIVE_PROFILE_KEY,
  DEFAULT_PROFILE_ID,
  PROFILES_REGISTRY_KEY,
  PROFILES_UPDATED_EVENT,
  clearProfileLocalStorage,
  makeProfileId,
  pickCopyableSettings,
  readProfiles,
  removeProfileFromRegistry,
  setActiveProfileId,
  syncActiveProfileMetadata,
  upsertProfile,
  writePendingSeed,
  type ProfileEntry,
} from '../services/profileStorage';
import { useT } from '../i18n/useT';
import { writeSessionBackendSecret } from '../store/persistence/authStorage';
import { flushPendingPersistSnapshot } from '../store/persistence/storage';
import { useAppStore } from '../store/useAppStore';

export const DUPLICATE_ACCOUNT_ERROR = 'DUPLICATE_ACCOUNT';

export interface AccountProfilesController {
  profiles: ProfileEntry[];
  activeProfileId: string;
  isSwitching: boolean;
  otherTabSwitched: boolean;
  backendProfilesUnsupported: boolean;
  switchAccount: (targetProfileId: string) => Promise<void>;
  addAccount: (token: string, copySettings: boolean) => Promise<void>;
  removeProfile: (targetProfileId: string) => Promise<void>;
  reloadPage: () => Promise<void>;
}

const flushCurrentProfileBeforeReload = async (): Promise<void> => {
  await flushPendingPersistSnapshot();
  await flushPendingIdbWrites();
  await flushAutoSyncBeforeSwitch(3000);
};

let globalIsSwitching = false;
const switchingListeners = new Set<(switching: boolean) => void>();

const setGlobalIsSwitching = (next: boolean): void => {
  if (globalIsSwitching === next) return;
  globalIsSwitching = next;
  for (const listener of switchingListeners) {
    listener(next);
  }
};

export const useAccountProfiles = (): AccountProfilesController => {
  const t = useT('app');
  const [profiles, setProfiles] = useState<ProfileEntry[]>(() => readProfiles());
  const [isSwitching, setIsSwitching] = useState(() => globalIsSwitching);
  const [otherTabSwitched, setOtherTabSwitched] = useState(false);
  const [backendProfilesUnsupported, setBackendProfilesUnsupported] = useState(
    () => backend.profilesUnsupportedWarning,
  );

  useEffect(() => {
    const refreshProfiles = () => setProfiles(readProfiles());

    const handleStorage = (event: StorageEvent) => {
      if (event.key === PROFILES_REGISTRY_KEY) {
        refreshProfiles();
      } else if (
        event.key === ACTIVE_PROFILE_KEY &&
        event.newValue &&
        event.newValue !== ACTIVE_PROFILE_ID
      ) {
        setOtherTabSwitched(true);
      }
    };

    switchingListeners.add(setIsSwitching);
    window.addEventListener(PROFILES_UPDATED_EVENT, refreshProfiles);
    window.addEventListener('storage', handleStorage);
    const unsubscribeBackend =
      typeof backend.subscribeAvailability === 'function'
        ? backend.subscribeAvailability(() => {
            setBackendProfilesUnsupported(Boolean(backend.profilesUnsupportedWarning));
          })
        : () => {};

    return () => {
      switchingListeners.delete(setIsSwitching);
      window.removeEventListener(PROFILES_UPDATED_EVENT, refreshProfiles);
      window.removeEventListener('storage', handleStorage);
      unsubscribeBackend();
    };
  }, []);

  const snapshotCurrentProfile = useCallback(() => {
    const state = useAppStore.getState();
    syncActiveProfileMetadata(
      {
        user: state.user,
        webdavConfigs: state.webdavConfigs,
        vectorSearchConfig: state.vectorSearchConfig,
      },
      { force: true },
    );
  }, []);

  const switchAccount = useCallback(async (targetProfileId: string) => {
    if (targetProfileId === ACTIVE_PROFILE_ID || globalIsSwitching) return;
    setGlobalIsSwitching(true);
    try {
      snapshotCurrentProfile();
      const currentBackendSecret = useAppStore.getState().backendApiSecret;
      if (currentBackendSecret) {
        writeSessionBackendSecret(currentBackendSecret);
      }
      await flushCurrentProfileBeforeReload();
      setActiveProfileId(targetProfileId);
      window.location.reload();
    } catch (error) {
      setGlobalIsSwitching(false);
      throw error;
    }
  }, [snapshotCurrentProfile]);

  const addAccount = useCallback(async (token: string, copySettings: boolean) => {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new Error('EMPTY_TOKEN');
    }

    const validatedUser = await createGitHubApiService(trimmed, { direct: true }).getCurrentUser();
    const newProfileId = makeProfileId(validatedUser.id);
    const currentState = useAppStore.getState();
    const existingProfiles = readProfiles();

    const isDuplicate =
      currentState.user?.id === validatedUser.id ||
      existingProfiles.some(
        (p) =>
          p.id === newProfileId ||
          (p.login && validatedUser.login && p.login.toLowerCase() === validatedUser.login.toLowerCase()),
      );

    if (isDuplicate) {
      throw new Error(DUPLICATE_ACCOUNT_ERROR);
    }

    // Record the existing logged-in account (e.g. 'default') before adding the 2nd account
    // so switching back always returns to the original untouched default profile.
    snapshotCurrentProfile();

    setGlobalIsSwitching(true);
    try {
      await flushCurrentProfileBeforeReload();

      const copiedSettings = copySettings
        ? pickCopyableSettings(currentState as unknown as Record<string, unknown>)
        : undefined;

      if (currentState.backendApiSecret) {
        writeSessionBackendSecret(currentState.backendApiSecret);
        writeSessionBackendSecret(currentState.backendApiSecret, newProfileId);
      }

      writePendingSeed({
        profileId: newProfileId,
        user: validatedUser,
        githubToken: trimmed,
        copiedSettings,
      });

      upsertProfile({
        id: newProfileId,
        login: validatedUser.login,
        name: validatedUser.name ?? undefined,
        avatarUrl: validatedUser.avatar_url,
      });

      setActiveProfileId(newProfileId);
      window.location.reload();
    } catch (error) {
      setGlobalIsSwitching(false);
      throw error;
    }
  }, [snapshotCurrentProfile]);

  const removeProfile = useCallback(async (targetProfileId: string) => {
    if (targetProfileId === ACTIVE_PROFILE_ID) return;
    // Delete the server-side profile first. If the backend refuses (409 in use,
    // 500, network error) keep local data and the registry entry untouched so the
    // user can retry — otherwise the surviving server DB reappears on the next
    // multi-device discovery and the account looks undeletable.
    if (backend.isAvailable && backend.profilesSupported && targetProfileId !== DEFAULT_PROFILE_ID) {
      let deleted = false;
      try {
        deleted = await backend.deleteServerProfile(targetProfileId);
      } catch {
        deleted = false;
      }
      if (!deleted) {
        throw new Error(t('accountSwitcher.remove-account-server-failed'));
      }
    }
    // Delete IndexedDB next; if deletion fails or is blocked by another open tab,
    // abort before modifying localStorage or removing the profile from the registry
    // so the user can see the error and retry without leaving orphaned data.
    await deleteProfileIndexedDbs(targetProfileId);
    clearProfileLocalStorage(targetProfileId);
    if (isElectron()) {
      try {
        await clearEncryptedXAuthViaDesktop(targetProfileId);
      } catch {
        // Best-effort desktop X auth cleanup.
      }
    }
    const next = removeProfileFromRegistry(targetProfileId);
    setProfiles(next);
  }, [t]);

  const reloadPage = useCallback(async () => {
    if (globalIsSwitching) return;
    setGlobalIsSwitching(true);
    try {
      await flushCurrentProfileBeforeReload();
      window.location.reload();
    } catch (error) {
      setGlobalIsSwitching(false);
      throw error;
    }
  }, []);

  return {
    profiles,
    activeProfileId: ACTIVE_PROFILE_ID,
    isSwitching,
    otherTabSwitched,
    backendProfilesUnsupported,
    switchAccount,
    addAccount,
    removeProfile,
    reloadPage,
  };
};
