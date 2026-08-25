
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createInitialState } from './initialState';
import { appPersistenceOptions } from './persistence/options';
import { createAuthSlice } from './slices/authSlice';
import { createCategorySlice } from './slices/categorySlice';
import { createConfigurationSlice } from './slices/configurationSlice';
import { createDiscoverySlice } from './slices/discoverySlice';
import { createGistSlice } from './slices/gistSlice';
import { createPreferenceSlice } from './slices/preferenceSlice';
import { createRepositorySlice } from './slices/repositorySlice';
import { createTimelineSlice } from './slices/timelineSlice';
import type { AppStoreState } from './types';

export { getAllCategories, sortCategoriesByOrder } from './helpers/categoryHelpers';
export { normalizePersistedState } from './normalizers/persistedState';
export {
  defaultCategories,
  defaultMcpConfig,
  isKnownEmbeddingFormatVersion,
  LEGACY_EMBEDDING_FORMAT_VERSION,
} from './schema';

/**
 * The application has exactly one Zustand Store and one persistence shell.
 * Domain slices only contribute state actions; hydration and persistence remain
 * centralized here through appPersistenceOptions.
 */
export const useAppStore = create<AppStoreState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),
      ...createAuthSlice(set, get),
      ...createRepositorySlice(set, get),
      ...createGistSlice(set, get),
      ...createConfigurationSlice(set, get),
      ...createTimelineSlice(set, get),
      ...createCategorySlice(set, get),
      ...createPreferenceSlice(set, get),
      ...createDiscoverySlice(set, get),
    }),
    appPersistenceOptions,
  ),
);
