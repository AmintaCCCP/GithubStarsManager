
import type { AppStoreSlice } from '../types';
import { replaceGistInList } from '../helpers/repositoryRecords';

export const createGistSlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setGists'
  | 'setStarredGists'
  | 'updateGist'
  | 'deleteGist'
  | 'setGistSearchFilters'
  | 'setGistSearchResults'
  | 'setSelectedGistCategory'
  | 'setAnalyzingGist'
>> = (set) => ({
      // Gist actions
      setGists: (gists) => set((state) => ({
        gists,
        gistSearchResults: state.gistSearchFilters.query ? state.gistSearchResults : gists,
      })),
      setStarredGists: (starredGists) => set({ starredGists }),
      updateGist: (gist) => set((state) => {
        const gistsResult = replaceGistInList(state.gists, gist);
        const starredResult = replaceGistInList(state.starredGists, gist);
        const searchResult = replaceGistInList(state.gistSearchResults, gist);
        const isMine = !!state.user?.login && gist.owner?.login === state.user.login;

        return {
          gists: gistsResult.found
            ? gistsResult.gists
            : isMine
              ? [gist, ...state.gists]
              : state.gists,
          starredGists: starredResult.found ? starredResult.gists : state.starredGists,
          gistSearchResults: searchResult.found ? searchResult.gists : state.gistSearchResults,
        };
      }),
      deleteGist: (gistId) => set((state) => {
        const nextAnalyzingIds = new Set(state.analyzingGistIds);
        nextAnalyzingIds.delete(gistId);
        return {
          gists: state.gists.filter(gist => gist.id !== gistId),
          starredGists: state.starredGists.filter(gist => gist.id !== gistId),
          gistSearchResults: state.gistSearchResults.filter(gist => gist.id !== gistId),
          analyzingGistIds: nextAnalyzingIds,
        };
      }),
      setGistSearchFilters: (filters) => set((state) => ({
        gistSearchFilters: { ...state.gistSearchFilters, ...filters },
      })),
      setGistSearchResults: (gistSearchResults) => set({ gistSearchResults }),
      setSelectedGistCategory: (selectedGistCategory) => set({ selectedGistCategory }),
      setAnalyzingGist: (gistId, isAnalyzing) => set((state) => {
        const alreadyAnalyzing = state.analyzingGistIds.has(gistId);
        if (alreadyAnalyzing === isAnalyzing) {
          return state;
        }

        const nextAnalyzingIds = new Set(state.analyzingGistIds);
        if (isAnalyzing) {
          nextAnalyzingIds.add(gistId);
        } else {
          nextAnalyzingIds.delete(gistId);
        }
        return { analyzingGistIds: nextAnalyzingIds };
      }),

});
