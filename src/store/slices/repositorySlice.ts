
import type { Repository } from '../../types';
import { matchesCategory } from '../../utils/categoryUtils';
import type { AppStoreSlice } from '../types';
import { defaultCategories, initialSearchFilters } from '../schema';
import { getAllCategories, getCategoryNameVariants } from '../helpers/categoryHelpers';
import { hasActiveSearchFilters } from '../../utils/repoSearch';
import { areRepositoryRecordsEqual, replaceRepositoryInList } from '../helpers/repositoryRecords';

export const createRepositorySlice: AppStoreSlice<Pick<import('../types').AppActions,
  | 'setRepositories'
  | 'updateRepository'
  | 'updateRepositoriesMetadata'
  | 'addRepository'
  | 'setLoading'
  | 'setSyncingStars'
  | 'setLastSync'
  | 'setSyncMode'
  | 'setSyncModeConfigured'
  | 'pushCategoriesToLists'
  | 'resetListsPush'
  | 'setListsPushError'
  | 'setCategoryListIdMap'
  | 'deleteRepository'
  | 'setAnalyzingRepository'
  | 'enterSimilarView'
  | 'resetSimilarView'
  | 'exitSimilarView'
  | 'setSearchFilters'
  | 'setSearchResults'
>> = (set, get) => ({
      // Repository actions
      setRepositories: (repositories) => set((state) => ({
        repositories,
        // Background sync must not wipe an active search result set: replacing
        // it with the full list shrinks the visible slice and unmounts the card
        // being edited (closing its edit modal). SearchBar recomputes results
        // from the new repositories on its own effect.
        searchResults: hasActiveSearchFilters(state.searchFilters) ? state.searchResults : repositories,
      })),
      updateRepository: (repo) => set((state) => {
        const repositoriesResult = replaceRepositoryInList(state.repositories, repo);
        const searchResultsResult = state.searchResults === state.repositories
          ? repositoriesResult
          : replaceRepositoryInList(state.searchResults, repo);
        const similarResultsResult = state.similarView
          ? replaceRepositoryInList(state.similarView.similarResults, repo)
          : null;

        if (!repositoriesResult.changed && !searchResultsResult.changed && !similarResultsResult?.changed) {
          return state;
        }

        return {
          repositories: repositoriesResult.repositories,
          searchResults: searchResultsResult.repositories,
          similarView: similarResultsResult
            ? { ...state.similarView!, similarResults: similarResultsResult.repositories }
            : state.similarView,
        };
      }),
      updateRepositoriesMetadata: (updates) => set((state) => {
        if (!updates.length) return state;
        const patchMap = new Map(updates.map((u) => [u.id, u.patch]));

        const applyPatches = (list: Repository[]): { repositories: Repository[]; changed: boolean } => {
          let changed = false;
          // 用 Map 索引避免多次 findIndex
          const indexById = new Map(list.map((r, i) => [r.id, i]));
          const next = list.slice();
          for (const [id, patch] of patchMap) {
            const idx = indexById.get(id);
            if (idx === undefined) continue;
            const merged = { ...next[idx], ...patch };
            if (!areRepositoryRecordsEqual(next[idx], merged)) {
              next[idx] = merged;
              changed = true;
            }
          }
          return { repositories: next, changed };
        };

        const repositoriesResult = applyPatches(state.repositories);
        const searchResultsResult = state.searchResults === state.repositories
          ? repositoriesResult
          : applyPatches(state.searchResults);
        const similarResultsResult = state.similarView
          ? applyPatches(state.similarView.similarResults)
          : { repositories: [], changed: false };

        if (!repositoriesResult.changed && !searchResultsResult.changed && !similarResultsResult.changed) {
          return state;
        }

        return {
          repositories: repositoriesResult.repositories,
          searchResults: searchResultsResult.repositories,
          similarView: state.similarView
            ? { ...state.similarView, similarResults: similarResultsResult.repositories }
            : state.similarView,
        };
      }),
      addRepository: (repo) => set((state) => {
        // 检查是否已存在相同 full_name 的仓库
        const existingRepoIndex = state.repositories.findIndex(r => r.full_name === repo.full_name);
        let updatedRepositories;

        if (existingRepoIndex >= 0) {
          // 如果存在，更新现有仓库（保留ID）
          updatedRepositories = [...state.repositories];
          updatedRepositories[existingRepoIndex] = {
            ...repo,
            id: updatedRepositories[existingRepoIndex].id,
            // 保留自定义编辑的内容
            custom_description: updatedRepositories[existingRepoIndex].custom_description,
            custom_tags: updatedRepositories[existingRepoIndex].custom_tags,
            custom_category: updatedRepositories[existingRepoIndex].custom_category,
            category_locked: updatedRepositories[existingRepoIndex].category_locked,
            last_edited: updatedRepositories[existingRepoIndex].last_edited,
            subscribed_to_releases: updatedRepositories[existingRepoIndex].subscribed_to_releases,
          };
        } else {
          // 如果不存在，添加新仓库（生成新ID）
          // 使用 timestamp + random 确保唯一性，避免并发时的竞态条件
          const timestamp = Date.now();
          const random = Math.floor(Math.random() * 10000);
          const maxExistingId = state.repositories.length > 0
            ? Math.max(...state.repositories.map(r => r.id))
            : 0;
          const newId = Math.max(timestamp, maxExistingId + 1) + random;
          updatedRepositories = [...state.repositories, { ...repo, id: newId }];
        }

        return {
          repositories: updatedRepositories,
          // Same guard as setRepositories: while search filters are active the
          // visible list is searchResults, and swapping in the full list would
          // unmount filtered cards (closing their edit modal). SearchBar
          // recomputes results from the updated repositories on its own effect.
          searchResults: hasActiveSearchFilters(state.searchFilters)
            ? state.searchResults
            : updatedRepositories
        };
      }),
      setLoading: (isLoading) => set({ isLoading }),
      setSyncingStars: (isSyncingStars) => set({ isSyncingStars }),
      setLastSync: (lastSync) => set({ lastSync }),
      setSyncMode: (syncMode) => set({ syncMode }),
      setSyncModeConfigured: (syncModeConfigured) => set({ syncModeConfigured }),
      resetListsPush: () => set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: null } }),
      setListsPushError: (error) => set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error } }),
      setCategoryListIdMap: (categoryId, listId) => set((state) => ({ categoryListIdMap: { ...state.categoryListIdMap, [categoryId]: listId } })),
      pushCategoriesToLists: async (api) => {
        const state = get();
        const t = (zh: string, en: string) => (state.language === 'zh' ? zh : en);
        // 重入保护：已有回写进行中时直接返回，避免并发创建重复 list 并互相覆盖成员
        if (state.listsPush.isRunning) return;
        if (!state.githubToken) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('未登录 GitHub，请先连接', 'Not connected to GitHub yet') } });
          return;
        }
        if (!state.user) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('缺少用户信息，请重新连接', 'Missing user info, reconnect') } });
          return;
        }
        if (state.repositories.length === 0) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('暂无仓库可回写', 'No repositories to push') } });
          return;
        }

        set({ listsPush: { isRunning: true, total: 0, done: 0, currentLabel: null, message: null, error: null } });

        try {
          const { user, repositories, customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides, categoryListIdMap } = get();

          const allCategories = getAllCategories(
            customCategories,
            language,
            hiddenDefaultCategoryIds,
            defaultCategoryOverrides
          ).filter(cat => cat.id !== 'all');

          // 1. 获取当前全部 list（含成员）
          const currentLists = await api.getUserLists(user!.login);

          // 2. 构建"托管 list"映射：每个本地分类 → list id。
          //    使用分类的稳定身份（规范名 + 持久化 id 映射），而不是翻译后的 cat.name：
          //    否则在中文/英文间来回推送会创建并行 list（如 "Web应用" 与 "Web Apps"）。
          //    - 优先复用已持久化的 categoryListIdMap[cat.id]（跨语言稳定）
          //    - 否则按规范名及其本地化变体在既有 list 中查找（迁移历史 list，避免重复创建）
          //    - 仍找不到才新建，并用规范名命名，随后记录到映射
          const listIdByCategoryId = new Map<string, string>();
          const managedListIds = new Set<string>();
          const nextCategoryListIdMap = { ...categoryListIdMap };
          for (const cat of allCategories) {
            const persistedId = categoryListIdMap[cat.id];
            if (persistedId && currentLists.some(l => l.id === persistedId)) {
              const existing = currentLists.find(l => l.id === persistedId)!;
              // auto-migrate name on language switch
              if (existing.name !== cat.name) {
                try { await api.updateUserList(persistedId, cat.name); } catch (e) { console.warn('rename list failed', persistedId, e); }
              }
              listIdByCategoryId.set(cat.id, persistedId);
              managedListIds.add(persistedId);
              continue;
            }
            // 规范名：默认分类用其稳定中文名（除非被用户覆盖），自定义分类用其自身名称
            const defaultCat = defaultCategories.find(d => d.id === cat.id);
            const canonicalName = defaultCat ? defaultCat.name : cat.name;
            const overrideName = defaultCategoryOverrides[cat.id]?.name;
            const nameVariants = getCategoryNameVariants(canonicalName, overrideName);
            const matchedList = currentLists.find(l =>
              nameVariants.some(v => v.toLowerCase() === l.name.toLowerCase())
            );
            if (matchedList) {
              // rename if language changed (e.g. 开发工具 -> Development Tools)
              if (matchedList.name !== cat.name) {
                try { await api.updateUserList(matchedList.id, cat.name); } catch (e) { console.warn('rename list failed', matchedList.id, e); }
              }
              listIdByCategoryId.set(cat.id, matchedList.id);
              nextCategoryListIdMap[cat.id] = matchedList.id;
              managedListIds.add(matchedList.id);
              continue;
            }
            const id = await api.createUserList(cat.name, true);
            listIdByCategoryId.set(cat.id, id);
            nextCategoryListIdMap[cat.id] = id;
            managedListIds.add(id);
          }

          // 3. 每仓库当前的 list 成员（小写 full_name → list id 集合）
          const repoCurrentListIds = new Map<string, Set<string>>();
          const lowerToOriginal = new Map<string, string>();
          for (const list of currentLists) {
            for (const fullName of list.items) {
              const key = fullName.toLowerCase();
              lowerToOriginal.set(key, fullName);
              if (!repoCurrentListIds.has(key)) repoCurrentListIds.set(key, new Set());
              repoCurrentListIds.get(key)!.add(list.id);
            }
          }

          // 4. 每仓库命中的托管 list（effective 标签匹配）
          const repoTargetListIds = new Map<string, Set<string>>();
          for (const repo of repositories) {
            const ownerLogin = repo.owner?.login;
            const original = repo.full_name || (ownerLogin && repo.name ? `${ownerLogin}/${repo.name}` : '');
            // 跳过缺少有效 owner/name（含空 full_name）的仓库，避免生成无法解析的 key
            if (!original.includes('/')) continue;
            const key = original.toLowerCase();
            lowerToOriginal.set(key, original);
            const matched: string[] = [];
            for (const cat of allCategories) {
              if (matchesCategory(repo, cat, 'effective')) {
                const id = listIdByCategoryId.get(cat.id);
                if (id) matched.push(id);
              }
            }
            if (matched.length > 0) {
              repoTargetListIds.set(key, new Set(matched));
            }
          }

          // 5. 需要更新的仓库：命中托管 list 的，或当前已在托管 list 中的（用于清理过期成员）
          const reposToUpdate = new Map<string, Set<string>>();
          for (const [key, targetIds] of repoTargetListIds) {
            reposToUpdate.set(key, targetIds);
          }
          for (const [key, currentIds] of repoCurrentListIds) {
            const hasManagedCurrent = [...currentIds].some(id => managedListIds.has(id));
            if (hasManagedCurrent && !reposToUpdate.has(key)) {
              reposToUpdate.set(key, new Set());
            }
          }

          if (reposToUpdate.size === 0) {
            set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: t('没有仓库命中任何分类', 'No repos matched any category'), error: null } });
            return;
          }

          // 6. 解析仓库 node id
          const ownerNamePairs = [...reposToUpdate.keys()].map(key => {
            const original = lowerToOriginal.get(key) || key;
            const idx = original.indexOf('/');
            return { owner: original.slice(0, idx), name: original.slice(idx + 1) };
          });
          const nodeIdMap = await api.resolveRepositoryNodeIds(ownerNamePairs);

          // 7. 覆盖写入（保留非托管 list 成员），逐仓库更新进度
          let updatedCount = 0;
          let done = 0;
          const total = reposToUpdate.size;
          for (const [key, targetIds] of reposToUpdate) {
            done++;
            set({ listsPush: { isRunning: true, total, done, currentLabel: key, message: null, error: null } });
            const itemId = nodeIdMap.get(key);
            if (!itemId) continue;
            const currentIds = repoCurrentListIds.get(key) || new Set<string>();
            const preservedIds = [...currentIds].filter(id => !managedListIds.has(id));
            const finalListIds = [...new Set([...preservedIds, ...targetIds])];
            if (finalListIds.length === currentIds.size && finalListIds.every(id => currentIds.has(id))) {
              continue;
            }
            await api.updateUserListsForItem(itemId, finalListIds);
            updatedCount++;
          }

          set({ listsPush: { isRunning: false, total, done, currentLabel: null, message: t(
            `已同步 ${listIdByCategoryId.size} 个 list、更新 ${updatedCount} 个仓库`,
            `Pushed ${listIdByCategoryId.size} lists, updated ${updatedCount} repos`
          ), error: null }, categoryListIdMap: nextCategoryListIdMap });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Push categories to lists failed:', error);
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('同步失败', 'Push failed') + `: ${message}` } });
        }
      },
      deleteRepository: (repoId) => set((state) => {
        const nextReleaseSubscriptions = new Set(state.releaseSubscriptions);
        nextReleaseSubscriptions.delete(repoId);

        const filteredReleases = state.releases.filter(release => release.repository.id !== repoId);
        const remainingReleaseIds = new Set(filteredReleases.map(release => release.id));
        const nextReadReleases = new Set(
          Array.from(state.readReleases).filter(releaseId => remainingReleaseIds.has(releaseId))
        );

        return {
          repositories: state.repositories.filter(r => r.id !== repoId),
          searchResults: state.searchResults.filter(r => r.id !== repoId),
          similarView: state.similarView
            ? { ...state.similarView, similarResults: state.similarView.similarResults.filter(r => r.id !== repoId) }
            : state.similarView,
          releases: filteredReleases,
          releaseSubscriptions: nextReleaseSubscriptions,
          readReleases: nextReadReleases,
        };
      }),
      setAnalyzingRepository: (repoId, isAnalyzing) => set((state) => {
        const alreadyAnalyzing = state.analyzingRepositoryIds.has(repoId);
        if (alreadyAnalyzing === isAnalyzing) {
          return state;
        }

        const nextAnalyzingIds = new Set(state.analyzingRepositoryIds);
        if (isAnalyzing) {
          nextAnalyzingIds.add(repoId);
        } else {
          nextAnalyzingIds.delete(repoId);
        }
        return { analyzingRepositoryIds: nextAnalyzingIds };
      }),

      // Similar repositories view actions
      /**
       * 进入"查找相似仓库"视图：保存当前相似结果、锚点仓库，并快照进入前的
       * searchResults/searchFilters 用于重置恢复（链式查找时保留首次快照）。
       */
      enterSimilarView: (repos, anchor) => set((state) => ({
        similarView: {
          active: true,
          anchorRepoFullName: anchor.full_name,
          anchorRepoName: anchor.name,
          similarResults: repos,
          // 链式查找时保留首次进入的快照，避免覆盖重置目标
          originalSearchResults: state.similarView?.originalSearchResults ?? state.searchResults,
          originalSearchFilters: state.similarView?.originalSearchFilters ?? state.searchFilters,
        },
        // 进入相似视图时清空搜索条件，避免与搜索结果混淆（相似视图是列表的"替代"视图）
        searchFilters: { ...initialSearchFilters },
      })),
      /**
       * 重置相似视图：恢复进入前的搜索结果与条件（回到"查找相似之前"的状态）。
       */
      resetSimilarView: () => set((state) => ({
        // 重置恢复进入前的搜索结果与条件（回到"查找相似之前"的状态）
        searchResults: state.similarView?.originalSearchResults ?? state.repositories,
        searchFilters: state.similarView?.originalSearchFilters ?? { ...initialSearchFilters },
        similarView: null,
      })),
      /**
       * 退出相似视图（不恢复进入前的搜索状态）：用于用户发起新搜索或切换分类时，
       * 避免把旧快照覆盖到新的搜索/分类结果上。
       */
      exitSimilarView: () => set({ similarView: null }),

      // Search actions
      setSearchFilters: (filters) => set((state) => {
        const newFilters = { ...state.searchFilters, ...filters };

        // 处理互斥筛选器：isAnalyzed 和 analysisFailed 不能同时设置
        if (filters.isAnalyzed !== undefined && filters.isAnalyzed !== null) {
          // 如果设置了 isAnalyzed，清除 analysisFailed
          newFilters.analysisFailed = undefined;
        }
        if (filters.analysisFailed !== undefined && filters.analysisFailed !== null) {
          // 如果设置了 analysisFailed，清除 isAnalyzed
          newFilters.isAnalyzed = undefined;
        }

        return { searchFilters: newFilters };
      }),
      setSearchResults: (searchResults) => set({ searchResults }),

});
