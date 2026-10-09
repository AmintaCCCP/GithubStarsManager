import { i18n } from '../../i18n';
import type { Repository } from '../../types';
import { logger } from '../../services/logger';
import { matchesCategory } from '../../utils/categoryUtils';
import type { AppStoreSlice } from '../types';
import { initialSearchFilters } from '../schema';
import { getAllCategories } from '../helpers/categoryHelpers';
import { buildListsPushPlan, validateListsPushPlan, GITHUB_LISTS_MAX_COUNT, GITHUB_LISTS_NAME_MAX_LENGTH } from '../helpers/listsPushPlan';
import { hasActiveSearchFilters } from '../../utils/repoSearch';
import { areRepositoryRecordsEqual, replaceRepositoryInList } from '../helpers/repositoryRecords';
import { shouldPreserveExisting } from '../helpers/accountWorkspace';
import { findIdentityMatch, isValidGitHubRepositoryId } from '../../utils/repositoryIdentity';

/** 合成一个不与现有记录冲突的本地 id（timestamp + random，避免并发竞态）。 */
const generateFallbackRepositoryId = (existingRepositories: Repository[]): number => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  const maxExistingId = existingRepositories.length > 0
    ? Math.max(...existingRepositories.map((r) => r.id))
    : 0;
  return Math.max(timestamp, maxExistingId + 1) + random;
};

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
      setRepositories: (repositories, options) => set((state) => {
        if (shouldPreserveExisting(repositories, state.repositories, options?.allowEmpty)) {
          logger.warn('store.setRepositories', 'Refusing empty overwrite of local repositories');
          return state;
        }
        return {
          repositories,
          // Background sync must not wipe an active search result set: replacing
          // it with the full list shrinks the visible slice and unmounts the card
          // being edited (closing its edit modal). SearchBar recomputes results
          // from the new repositories on its own effect.
          searchResults: hasActiveSearchFilters(state.searchFilters) ? state.searchResults : repositories,
        };
      }),
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
        // 身份判定统一走 findIdentityMatch（id 优先，合成 id 的名称兜底其次）——
        // 与星标同步 mergeStarredRepositories 共用同一份规则，避免两处口径漂移。
        const existing = findIdentityMatch(repo, state.repositories);
        let updatedRepositories;

        if (existing) {
          // 同一 GitHub 身份：更新现有仓库（沿用其 ID，保留 AI 分析与自定义字段）。
          // 入参是完整 GitHub 数据，full_name 等源字段随之刷新（改名即在此生效）。
          const existingRepoIndex = state.repositories.indexOf(existing);
          updatedRepositories = [...state.repositories];
          updatedRepositories[existingRepoIndex] = {
            ...repo,
            id: existing.id,
            // 保留自定义编辑的内容
            custom_description: existing.custom_description,
            custom_tags: existing.custom_tags,
            custom_category: existing.custom_category,
            category_locked: existing.category_locked,
            last_edited: existing.last_edited,
            subscribed_to_releases: existing.subscribed_to_releases,
            // 保留已完成的 AI 分析：入参来自 GitHub 详情 / 发现页数据，
            // 不带这些字段，直接展开会把已有 AI 摘要与标签清空。
            // 用 `?? existing.x` 而非无条件回填：入参若显式带了新值则采用新值。
            ai_summary: repo.ai_summary ?? existing.ai_summary,
            ai_tags: repo.ai_tags ?? existing.ai_tags,
            ai_platforms: repo.ai_platforms ?? existing.ai_platforms,
            analyzed_at: repo.analyzed_at ?? existing.analyzed_at,
            analysis_failed: repo.analysis_failed ?? existing.analysis_failed,
            analysis_error: repo.analysis_error ?? existing.analysis_error,
          };
        } else {
          // 新增为独立记录：本地没有该仓库，或同名但属于**另一个** GitHub 仓库。
          // 此时绝不能沿用 existing.id —— 否则新仓库会被写到旧仓库的 ID 下：
          // 用户对新仓库做完 AI 分析后，下次同步按 GitHub ID 匹配不到本地记录
          // （id 不同，且名称兜底只认领合成 id 记录），分析结果会再次丢失；
          // 若旧仓库仍在星标里，新仓库的分析还会被错误归属到旧仓库。
          // 优先沿用入参的 GitHub 真实 id；仅当 id 不可用时，才退回合成 id
          // （timestamp + random，确保唯一性，避免并发竞态）。
          updatedRepositories = isValidGitHubRepositoryId(repo.id)
            ? [...state.repositories, { ...repo, id: repo.id }]
            : [...state.repositories, { ...repo, id: generateFallbackRepositoryId(state.repositories) }];
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
      pushCategoriesToLists: async (api, categoryIds) => {
        const state = get();
        const t = i18n.getFixedT(state.language, 'app');
        // 重入保护：已有回写进行中时直接返回，避免并发创建重复 list 并互相覆盖成员
        if (state.listsPush.isRunning) return;
        if (!state.githubToken) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('repositorySlice.not-connected-to-github-yet') } });
          return;
        }
        if (!state.user) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('repositorySlice.missing-user-info-reconnect') } });
          return;
        }
        if (state.repositories.length === 0) {
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('repositorySlice.no-repositories-to-push') } });
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
          ).filter(cat => cat.id !== 'all')
            .filter(cat => !categoryIds || categoryIds.includes(cat.id));

          // 仅推送选中分类时，选中集合为空（含未知/已隐藏 id）则直接报错，不发起请求
          if (categoryIds && allCategories.length === 0) {
            set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('repositorySlice.no-categories-selected') } });
            return;
          }

          // 1. 获取当前全部 list（含成员）
          const currentLists = await api.getUserLists(user!.login);

          // 2. 构建"托管 list"映射计划：每个本地分类 → list id。
          //    使用分类的稳定身份（规范名 + 持久化 id 映射），而不是翻译后的 cat.name：
          //    否则在中文/英文间来回推送会创建并行 list（如 "Web应用" 与 "Web Apps"）。
          //    - 优先复用已持久化的 categoryListIdMap[cat.id]（跨语言稳定）
          //    - 否则按规范名及其本地化变体在既有 list 中查找（迁移历史 list，避免重复创建）
          //    - 仍找不到才新建，并用规范名命名，随后记录到映射
          //    计划构建为纯本地计算，便于在写入前整体校验 GitHub Lists 硬限制。
          const plan = buildListsPushPlan(allCategories, currentLists, categoryListIdMap, defaultCategoryOverrides);

          // 3. 预校验硬限制（list 总数上限 32、list 名称上限 32 字符）：
          //    任一触发即整体中止、零写入，并在错误中列出明细，引导用户到
          //    分类管理中隐藏/删除/重命名后重试（隐藏的分类不参与回写）。
          const planIssue = validateListsPushPlan(plan, currentLists.length);
          if (planIssue) {
            const parts: string[] = [];
            if (planIssue.tooLongNames.length > 0) {
              const items = planIssue.tooLongNames
                .map(({ name, length }) => t('repositorySlice.lists-push-limit-name-item', { name, length, max: GITHUB_LISTS_NAME_MAX_LENGTH }))
                .join('\n');
              parts.push(t('repositorySlice.lists-push-limit-name-too-long', { max: GITHUB_LISTS_NAME_MAX_LENGTH, items }));
            }
            if (planIssue.countExceeded) {
              parts.push(t('repositorySlice.lists-push-limit-count-exceeded', {
                max: GITHUB_LISTS_MAX_COUNT,
                existing: planIssue.countExceeded.existing,
                needed: planIssue.countExceeded.needed,
              }));
            }
            set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: parts.join('\n\n') } });
            return;
          }

          // 4. 执行计划（改名 best-effort：失败保留映射，下轮推送自然重试）
          const listIdByCategoryId = new Map<string, string>();
          const managedListIds = new Set<string>();
          const nextCategoryListIdMap = { ...categoryListIdMap };
          const renameFailures: string[] = [];
          const categoryById = new Map(allCategories.map(cat => [cat.id, cat]));
          for (const entry of plan) {
            const cat = categoryById.get(entry.categoryId)!;
            if (entry.kind === 'create') {
              const id = await api.createUserList(entry.name, true);
              listIdByCategoryId.set(entry.categoryId, id);
              nextCategoryListIdMap[entry.categoryId] = id;
              managedListIds.add(id);
              continue;
            }
            // auto-migrate name on language switch
            if (entry.remoteName !== cat.name) {
              try {
                await api.updateUserList(entry.listId, cat.name);
              } catch (e) {
                console.warn('rename list failed', entry.listId, entry.remoteName, '->', cat.name, e);
                renameFailures.push(`${entry.remoteName} -> ${cat.name}`);
              }
            }
            listIdByCategoryId.set(entry.categoryId, entry.listId);
            managedListIds.add(entry.listId);
            if (entry.kind === 'matched') {
              nextCategoryListIdMap[entry.categoryId] = entry.listId;
            }
          }
          if (renameFailures.length > 0) {
            logger.warn('githubLists', 'Some lists failed to rename, will retry next push', { failures: renameFailures });
          }
          // 5. 每仓库当前的 list 成员（小写 full_name → list id 集合）
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

          // 6. 每仓库命中的托管 list（effective 标签匹配）
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

          // 7. 需要更新的仓库：命中托管 list 的，或当前已在托管 list 中的（用于清理过期成员）
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
            set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: t('repositorySlice.no-repos-matched-any-category'), error: null } });
            return;
          }

          // 8. 解析仓库 node id
          const ownerNamePairs = [...reposToUpdate.keys()].map(key => {
            const original = lowerToOriginal.get(key) || key;
            const idx = original.indexOf('/');
            return { owner: original.slice(0, idx), name: original.slice(idx + 1) };
          });
          const nodeIdMap = await api.resolveRepositoryNodeIds(ownerNamePairs);

          // 9. 覆盖写入（保留非托管 list 成员），逐仓库更新进度
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

          set({ listsPush: { isRunning: false, total, done, currentLabel: null, message: t('repositorySlice.pushed-v1-lists-updated-updatedcount-repos', { v1: listIdByCategoryId.size, updatedCount: updatedCount }), error: null }, categoryListIdMap: nextCategoryListIdMap });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('Push categories to lists failed:', error);
          set({ listsPush: { isRunning: false, total: 0, done: 0, currentLabel: null, message: null, error: t('repositorySlice.push-failed-detail', { message }) } });
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
