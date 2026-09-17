import type {
  AccountWorkspace,
  Category,
  ForkRepo,
  Gist,
  GistCategoryId,
  GitHubUser,
  Release,
  ReleaseSourceSettings,
  Repository,
  SyncMode,
} from '../../types';
import { defaultReleaseSourceSettings } from '../../types';
import { normalizeReleaseSourceSettings } from '../../utils/releaseSources';

export type { AccountWorkspace };

export interface AccountWorkspaceRuntime {
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  gistSearchResults: Gist[];
  selectedGistCategory: GistCategoryId;
  searchResults: Repository[];
  similarView: null;
  analyzingGistIds: Set<string>;
  analyzingRepositoryIds: Set<number>;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

export interface AccountWorkspaceSource {
  repositories: Repository[];
  lastSync: string | null;
  gists: Gist[];
  starredGists: Gist[];
  selectedGistCategory: GistCategoryId;
  releases: Release[];
  releaseSubscriptions: Set<number>;
  releaseSourceSettings: ReleaseSourceSettings;
  readReleases: Set<number>;
  forks: ForkRepo[];
  readForks: Set<number>;
  customCategories: Category[];
  hiddenDefaultCategoryIds: string[];
  categoryOrder: string[];
  defaultCategoryOverrides: Record<string, Partial<Category>>;
  categoryListIdMap: Record<string, string>;
  syncMode: SyncMode;
  syncModeConfigured: boolean;
}

const numberSetToArray = (value: Set<number> | unknown): number[] => (
  value instanceof Set
    ? Array.from(value)
    : Array.isArray(value)
      ? value.filter((item): item is number => typeof item === 'number')
      : []
);

export const shouldPreserveExisting = <T>(
  incoming: T[] | undefined,
  existing: T[],
  allowEmpty = false,
): boolean => incoming !== undefined && incoming.length === 0 && existing.length > 0 && !allowEmpty;

export const accountIdKey = (user: Pick<GitHubUser, 'id'> | number | null | undefined): string | null => {
  const id = typeof user === 'number' ? user : user?.id;
  return typeof id === 'number' && Number.isFinite(id) ? String(id) : null;
};

export const normalizeAccountWorkspaces = (value: unknown): Record<string, AccountWorkspace> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const empty = emptyAccountWorkspace();
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, workspace]) => {
      if (!key || !workspace || typeof workspace !== 'object' || Array.isArray(workspace)) return [];
      const record = workspace as Record<string, unknown>;
      return [[key, {
        ...empty,
        repositories: Array.isArray(record.repositories) ? record.repositories : [],
        lastSync: typeof record.lastSync === 'string' ? record.lastSync : null,
        gists: Array.isArray(record.gists) ? record.gists : [],
        starredGists: Array.isArray(record.starredGists) ? record.starredGists : [],
        selectedGistCategory: record.selectedGistCategory === 'starred' || record.selectedGistCategory === 'mine'
          ? record.selectedGistCategory
          : 'all',
        releases: Array.isArray(record.releases) ? record.releases : [],
        releaseSubscriptions: Array.isArray(record.releaseSubscriptions)
          ? record.releaseSubscriptions.filter((item): item is number => typeof item === 'number')
          : [],
        releaseSourceSettings: normalizeReleaseSourceSettings(record.releaseSourceSettings),
        readReleases: Array.isArray(record.readReleases)
          ? record.readReleases.filter((item): item is number => typeof item === 'number')
          : [],
        forks: Array.isArray(record.forks) ? record.forks : [],
        readForks: Array.isArray(record.readForks)
          ? record.readForks.filter((item): item is number => typeof item === 'number')
          : [],
        customCategories: Array.isArray(record.customCategories) ? record.customCategories : [],
        hiddenDefaultCategoryIds: Array.isArray(record.hiddenDefaultCategoryIds)
          ? record.hiddenDefaultCategoryIds.filter((item): item is string => typeof item === 'string')
          : [],
        categoryOrder: Array.isArray(record.categoryOrder)
          ? record.categoryOrder.filter((item): item is string => typeof item === 'string')
          : [],
        defaultCategoryOverrides: record.defaultCategoryOverrides && typeof record.defaultCategoryOverrides === 'object'
          && !Array.isArray(record.defaultCategoryOverrides)
          ? record.defaultCategoryOverrides as AccountWorkspace['defaultCategoryOverrides']
          : {},
        categoryListIdMap: record.categoryListIdMap && typeof record.categoryListIdMap === 'object'
          && !Array.isArray(record.categoryListIdMap)
          ? Object.fromEntries(
              Object.entries(record.categoryListIdMap).filter(
                ([mapKey, mapValue]) => typeof mapKey === 'string' && typeof mapValue === 'string',
              ),
            )
          : {},
        syncMode: record.syncMode === 'stars-and-lists' ? 'stars-and-lists' : 'stars',
        syncModeConfigured: record.syncModeConfigured === true,
      }]];
    }),
  );
};

export const emptyAccountWorkspace = (): AccountWorkspace => ({
  repositories: [],
  lastSync: null,
  gists: [],
  starredGists: [],
  selectedGistCategory: 'all',
  releases: [],
  releaseSubscriptions: [],
  releaseSourceSettings: defaultReleaseSourceSettings,
  readReleases: [],
  forks: [],
  readForks: [],
  customCategories: [],
  hiddenDefaultCategoryIds: [],
  categoryOrder: [],
  defaultCategoryOverrides: {},
  categoryListIdMap: {},
  syncMode: 'stars',
  syncModeConfigured: false,
});

export const captureAccountWorkspace = (state: AccountWorkspaceSource): AccountWorkspace => ({
  repositories: state.repositories,
  lastSync: state.lastSync,
  gists: state.gists,
  starredGists: state.starredGists,
  selectedGistCategory: state.selectedGistCategory,
  releases: state.releases,
  releaseSubscriptions: numberSetToArray(state.releaseSubscriptions),
  releaseSourceSettings: state.releaseSourceSettings,
  readReleases: numberSetToArray(state.readReleases),
  forks: state.forks,
  readForks: numberSetToArray(state.readForks),
  customCategories: state.customCategories,
  hiddenDefaultCategoryIds: state.hiddenDefaultCategoryIds,
  categoryOrder: state.categoryOrder,
  defaultCategoryOverrides: state.defaultCategoryOverrides,
  categoryListIdMap: state.categoryListIdMap,
  syncMode: state.syncMode,
  syncModeConfigured: state.syncModeConfigured,
});

export const applyAccountWorkspace = (workspace: AccountWorkspace | undefined): AccountWorkspaceRuntime => {
  const snapshot = workspace ?? emptyAccountWorkspace();
  return {
    repositories: snapshot.repositories,
    lastSync: snapshot.lastSync,
    gists: snapshot.gists,
    starredGists: snapshot.starredGists,
    gistSearchResults: snapshot.gists,
    selectedGistCategory: snapshot.selectedGistCategory,
    searchResults: snapshot.repositories,
    similarView: null,
    analyzingGistIds: new Set<string>(),
    analyzingRepositoryIds: new Set<number>(),
    releases: snapshot.releases,
    releaseSubscriptions: new Set(snapshot.releaseSubscriptions),
    releaseSourceSettings: snapshot.releaseSourceSettings,
    readReleases: new Set(snapshot.readReleases),
    forks: snapshot.forks,
    readForks: new Set(snapshot.readForks),
    customCategories: snapshot.customCategories,
    hiddenDefaultCategoryIds: snapshot.hiddenDefaultCategoryIds,
    categoryOrder: snapshot.categoryOrder,
    defaultCategoryOverrides: snapshot.defaultCategoryOverrides,
    categoryListIdMap: snapshot.categoryListIdMap,
    syncMode: snapshot.syncMode,
    syncModeConfigured: snapshot.syncModeConfigured,
  };
};

export type WorkspaceDataCandidate = Partial<AccountWorkspaceSource | AccountWorkspace>;

/**
 * Predicate checking whether a workspace (live or parked snapshot) holds any
 * persisted user content or user-defined category configuration.
 * Excludes syncMode alone, adhering to the account-switching contract.
 */
export const workspaceHasData = (workspace: WorkspaceDataCandidate | null | undefined): boolean => {
  if (!workspace) return false;
  return (
    (workspace.repositories?.length ?? 0) > 0
    || (workspace.gists?.length ?? 0) > 0
    || (workspace.starredGists?.length ?? 0) > 0
    || (workspace.releases?.length ?? 0) > 0
    || (workspace.forks?.length ?? 0) > 0
    || (workspace.customCategories?.length ?? 0) > 0
    || (workspace.categoryOrder?.length ?? 0) > 0
    || (workspace.hiddenDefaultCategoryIds?.length ?? 0) > 0
    || Object.keys(workspace.defaultCategoryOverrides ?? {}).length > 0
    || Object.keys(workspace.categoryListIdMap ?? {}).length > 0
  );
};

export const switchAccountWorkspace = (
  current: AccountWorkspaceSource & { accountWorkspaces: Record<string, AccountWorkspace> },
  previousAccountId: string | null,
  nextAccountId: string,
): { accountWorkspaces: Record<string, AccountWorkspace>; workspace: AccountWorkspaceRuntime | null } => {
  const accountWorkspaces = { ...current.accountWorkspaces };
  if (previousAccountId && previousAccountId !== nextAccountId) {
    accountWorkspaces[previousAccountId] = captureAccountWorkspace(current);
  }
  if (previousAccountId === nextAccountId) {
    return { accountWorkspaces, workspace: null };
  }
  // Logged-out login: keep live lists if they already hold data (backend
  // restore wrote first). Otherwise restore a parked snapshot for this id.
  if (!previousAccountId && workspaceHasData(current)) {
    return { accountWorkspaces, workspace: null };
  }
  return {
    accountWorkspaces,
    workspace: applyAccountWorkspace(accountWorkspaces[nextAccountId]),
  };
};

