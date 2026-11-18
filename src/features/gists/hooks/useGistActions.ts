import { makeT, useT } from "../../../i18n/useT";
import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Gist } from '../../../types';
import type { GistCreateInput, GistUpdateInput } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { selectGistViewState } from '../../../store/selectors';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { AIService } from '../../../services/aiService';
import { useDialog } from '../../../hooks/useDialog';
import { applyGistAnalysisFilter, filterAndSortGists } from '../../../utils/gistUtils';

export type { GistCreateInput, GistUpdateInput };

// GistCard 单卡分析 patch 字面量提纯（成功/失败两态）。
export const applyGistAnalysisSuccess = (detail: Gist, summary: string, now: string): Gist => ({
  ...detail,
  ai_summary: summary.trim(),
  analyzed_at: now,
  analysis_failed: false,
  analysis_error: undefined,
});

export const applyGistAnalysisFailure = (gist: Gist, error: string, now: string): Gist => ({
  ...gist,
  analyzed_at: now,
  analysis_failed: true,
  analysis_error: error,
});

export const useGistActions = () => {
  const state = useAppStore(useShallow(selectGistViewState));
  const { toast, confirm } = useDialog();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  // isAnalyzingGist(id) 的渲染值恒等于 store 集合值：原 GistCard 的本地 isAnalyzingLocal
  // 与 setAnalyzingGist 同置同清，渲染上与集合值等价，故本 hook 只操作 store 集合、
  // 不再设本地 flag（勿"修复"回双 flag 写法）。
  const analyzingGistIds = useAppStore((s) => s.analyzingGistIds);
  const isAnalyzingGist = useCallback(
    (gistId: string) => analyzingGistIds.has(gistId),
    [analyzingGistIds],
  );
  const t = useT('gists');

  const refreshGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    setIsRefreshing(true);
    // 账号代次校验（Issue #611）：Gist 全量刷新耗时期间切号后丢弃结果
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    try {
      const api = createGitHubApiService(state.githubToken);
      const [mine, starred] = await Promise.all([
        api.getAllGists(state.gists),
        api.getAllStarredGists([...state.gists, ...state.starredGists]),
      ]);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
      const starredIds = new Set(starred.map(gist => gist.id));
      state.setGists(mine.map(gist => ({ ...gist, starred: starredIds.has(gist.id) || gist.starred })));
      state.setStarredGists(starred);
      toast(t('useGistActions.gists-synced'), 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('useGistActions.failed-to-sync-gists'), 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [state, t, toast]);

  const aiSearch = useCallback(async (
    query: string,
    categoryItems: Gist[],
    onReranked: (ranked: Gist[]) => void,
  ) => {
    if (!query.trim()) return;
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      state.setGistSearchFilters({ query });
      return;
    }
    setIsSearching(true);
    // 账号代次校验（Issue #611）：AI 搜索等待期间切号后，旧账号的查询与结果
    // 绝不能写入新账号的搜索视图（含失败回退路径），沿用 refreshGists 的模式
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    try {
      const aiService = new AIService(activeConfig, state.language);
      // 候选集不做分析状态预过滤：分析状态是视图层筛选，排序结果需覆盖两种状态，
      // 否则搜索发起后切换状态会因候选集缺失而漏掉符合条件的 gist
      const ranked = await aiService.searchGistsWithReranking(
        filterAndSortGists(categoryItems, { ...state.gistSearchFilters, query: '', isAnalyzed: undefined }),
        query,
      );
      // 账号已切换：跳过 onReranked 与全部搜索写入，丢弃旧账号结果
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      const currentState = useAppStore.getState();
      const filteredRanked = applyGistAnalysisFilter(
        ranked,
        currentState.gistSearchFilters.isAnalyzed,
      );
      onReranked(ranked);
      currentState.setGistSearchFilters({ query });
      currentState.setGistSearchResults(filteredRanked);
    } catch {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      state.setGistSearchFilters({ query });
    } finally {
      setIsSearching(false);
    }
  }, [state]);

  const analyzeVisibleGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      toast(t('useGistActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model || activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('useGistActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }
    const targets = state.gistSearchResults.filter(gist => !gist.analyzed_at || gist.analysis_failed);
    if (targets.length === 0) {
      toast(t('useGistActions.no-gists-need-analysis-in-the-current-list'), 'info');
      return;
    }
    // 账号代次校验（Issue #611 审计修复）：targets/api/aiService 都取自发起账号的
    // 闭包，jobAccountId 必须在 await confirm 之前记录——确认后再读取会拿到
    // 切号后的账号，后续 isCurrentAccount 校验恒通过，旧账号的分析结果会写进
    // 新账号工作区。确认通过后用保存值复核一次，切号即整体退出。
    const jobAccountId = peekCurrentAccountId();
    const jobGeneration = getAccountSessionGeneration();
    const confirmed = await confirm(t('useGistActions.batch-ai-analysis'), t('useGistActions.analyze-v1-gists-continue', { v1: targets.length }), { type: 'warning' });
    if (!confirmed) return;
    if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;

    setIsAnalyzingAll(true);
    const api = createGitHubApiService(state.githubToken);
    const aiService = new AIService(activeConfig, state.language);
    let success = 0;
    let failed = 0;
    const concurrency = activeConfig.concurrency && activeConfig.concurrency > 1 ? activeConfig.concurrency : 1;
    const analyzeOne = async (gist: Gist) => {
      if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
      state.setAnalyzingGist(gist.id, true);
      try {
        const detail = await api.getGistForAnalysis(gist.id, gist);
        // 发送内容给 AI 前复核：切号后绝不把旧账号的私有 Gist 正文发给 AI
        if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
        const summary = await aiService.analyzeGist(detail, api.getGistContentPreview(detail));
        if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
        state.updateGist({ ...detail, ai_summary: summary.trim(), analyzed_at: new Date().toISOString(), analysis_failed: false, analysis_error: undefined });
        success++;
      } catch (error) {
        if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
        state.updateGist({ ...gist, analyzed_at: new Date().toISOString(), analysis_failed: true, analysis_error: error instanceof Error ? error.message : String(error) });
        failed++;
      } finally {
        // 分析标记清理只作用于发起账号仍是当前账号的场景：切号后 setAnalyzingGist
        // 作用于新账号工作区，会误清新账号同 ID Gist 的分析标记（分析中标记不
        // 入工作区快照，无需对归档工作区做额外清理）。
        if (isCurrentAccountSession(jobAccountId, jobGeneration)) {
          state.setAnalyzingGist(gist.id, false);
        }
      }
    };
    try {
      for (let index = 0; index < targets.length; index += concurrency) {
        await Promise.all(targets.slice(index, index + concurrency).map(analyzeOne));
      }
      if (isCurrentAccountSession(jobAccountId, jobGeneration)) {
        toast(t('useGistActions.ai-analysis-done-success-succeeded-failed-failed', { success: success, failed: failed }), failed > 0 ? 'error' : 'success');
      }
    } finally {
      setIsAnalyzingAll(false);
    }
  }, [state, t, toast, confirm]);

  const fetchGistDetail = useCallback(async (gist: Gist): Promise<Gist | null> => {
    if (!state.githubToken) return null;
    // 账号代次校验（Issue #611 审计修复）：账号 ID 必须在任何 await 之前保存，
    // 提交结果前用保存值复核——请求完成后再读取会拿到切号后的账号，检查恒通过
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    try {
      const detail = await createGitHubApiService(state.githubToken).getGist(gist.id, gist);
      // 详情拉取切号后丢弃：不写入当前工作区，也不向调用方返回旧账号详情
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return null;
      state.updateGist(detail);
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/5\d{2}/.test(message)) {
        toast(t('useGistActions.github-gist-api-is-temporarily-unavailable-openi'), 'warning');
        return null;
      }
      toast(t(message ? 'useGistActions.failed-to-load-gist-details' : 'useGistActions.failed-to-load-gist-details-empty', { message }), 'error');
      return null;
    }
  }, [state, t, toast]);

  const submitGist = useCallback(async (input: GistCreateInput | GistUpdateInput, editingGist: Gist | null) => {
    if (!state.githubToken) return;
    // 账号代次校验（Issue #611）：等待 GitHub API 期间切号后，本地写入与
    // 提示一律丢弃（远端操作已按发起账号的 Token 完成，不可撤销）
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    const api = createGitHubApiService(state.githubToken);
    try {
      if (editingGist) {
        const updated = await api.updateGist(editingGist.id, input as GistUpdateInput, editingGist);
        if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
        state.updateGist({ ...updated, last_edited: new Date().toISOString() });
        toast(t('useGistActions.gist-updated'), 'success');
        return;
      }
      const created = await api.createGist(input as GistCreateInput);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      state.updateGist({ ...created, last_edited: new Date().toISOString() });
      toast(t('useGistActions.gist-created'), 'success');
    } catch (error) {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      const message = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(message);
      toast(
        t(editingGist ? 'useGistActions.gist-update-failed' : 'useGistActions.gist-create-failed', {
          message: message || t('useGistActions.unknown-error'),
          permissionNote: isPermission ? t('useGistActions.gist-permission-note') : '',
        }),
        'error',
      );
    }
  }, [state, t, toast]);

  // 单卡 AI 分析（原 GistCard.handleAnalyze）：无 Abort、无 forceSync；
  // 重新分析覆盖确认在本 hook 内（View 只保留 stopPropagation 前置）。
  const analyzeOne = useCallback(async (gist: Gist) => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      toast(t('useGistActions.please-configure-ai-service-in-settings-first'), 'error');
      return;
    }
    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model || activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('useGistActions.ai-service-configuration-is-incomplete-please-ch'), 'error');
      return;
    }

    // 账号代次校验（Issue #611 审计修复）：确认弹窗与两次 AI 等待期间都可能
    // 切号——账号 ID 在任何 await 之前保存，成功/失败/标记清理三条路径全部用
    // 保存值复核，绝不写入切号后的当前工作区。
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    // 失败的 gist 已写入 analyzed_at，但重试应与批量分析一致：直接执行，不弹覆盖确认
    if (gist.analyzed_at && !gist.analysis_failed) {
      const shouldContinue = await confirm(
        t('useGistActions.re-analyze-confirmation'),
        t('useGistActions.this-gist-has-already-been-analyzed-overwrite-th'),
        { type: 'warning' }
      );
      if (!shouldContinue) return;
    }
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;

    state.setAnalyzingGist(gist.id, true);
    try {
      const githubApi = createGitHubApiService(state.githubToken);
      const detail = await githubApi.getGistForAnalysis(gist.id, gist);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      const aiService = new AIService(activeConfig, state.language);
      const summary = await aiService.analyzeGist(detail, githubApi.getGistContentPreview(detail));
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      state.updateGist(applyGistAnalysisSuccess(detail, summary, new Date().toISOString()));
      toast(t('useGistActions.gist-ai-analysis-completed'), 'success');
    } catch (error) {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      state.updateGist(applyGistAnalysisFailure(gist, error instanceof Error ? error.message : String(error), new Date().toISOString()));
      toast(t('useGistActions.gist-ai-analysis-failed'), 'error');
    } finally {
      // 与批量分析一致：分析标记清理只作用于发起账号仍是当前账号的工作区
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        state.setAnalyzingGist(gist.id, false);
      }
    }
  }, [state, t, toast, confirm]);

  const unstarGist = useCallback(async (gist: Gist, onUnstarred?: (gistId: string) => void) => {
    if (!state.githubToken) return;
    // 账号代次校验（Issue #611）：确认弹窗与远端等待期间切号后，本地写入与
    // 结果回调一律丢弃（远端操作已按发起账号的 Token 完成，不可撤销）
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    const confirmed = await confirm(
      t('useGistActions.unstar-gist'),
      t('useGistActions.are-you-sure-you-want-to-unstar-this-gist'),
      { type: 'warning', confirmText: t('useGistActions.unstar') }
    );
    if (!confirmed) return;
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;

    // 客户端必须在复核之后同步创建：工厂从实时 Store 读取账号头，
    // 任何 await 之后创建都可能把请求发到切号后的账号。
    const api = createGitHubApiService(state.githubToken);
    setIsMutating(true);
    try {
      await api.unstarGist(gist.id);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      onUnstarred?.(gist.id);
      state.updateGist({ ...gist, starred: false });
      toast(t('useGistActions.unstarred'), 'success');
    } catch {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      toast(t('useGistActions.failed-to-unstar'), 'error');
    } finally {
      setIsMutating(false);
    }
  }, [state, t, toast, confirm]);

  // 注意：本方法有意遮蔽经由 ...state 展开的同名 store action（签名不同：
  // 接收 Gist 对象并内置确认/报错）。需要原始 store action 的调用方应自行
  // 从 useAppStore 订阅（GistView 的 onDeleted 即如此）。
  const deleteGist = useCallback(async (gist: Gist, onDeleted?: (gistId: string) => void) => {
    if (!state.githubToken || gist.owner?.login !== state.user?.login) return;
    // 账号代次校验（Issue #611）：确认弹窗与远端等待期间切号后，本地删除与
    // 结果回调一律丢弃（远端删除已按发起账号的 Token 完成，不可撤销）
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    const confirmed = await confirm(
      t('useGistActions.delete-gist'),
      t('useGistActions.are-you-sure-you-want-to-delete-this-gist-this-c'),
      { type: 'danger', confirmText: t('useGistActions.delete') }
    );
    if (!confirmed) return;
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;

    const api = createGitHubApiService(state.githubToken);
    setIsMutating(true);
    try {
      await api.deleteGist(gist.id);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      state.deleteGist(gist.id);
      onDeleted?.(gist.id);
      toast(t('useGistActions.gist-deleted'), 'success');
    } catch (error) {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      const msg = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(msg);
      toast(
        t(msg ? 'useGistActions.failed-to-delete-gist' : 'useGistActions.failed-to-delete-gist-empty', {
          message: msg,
          permissionNote: isPermission ? t('useGistActions.gist-permission-note') : '',
        }),
        'error'
      );
    } finally {
      setIsMutating(false);
    }
  }, [state, t, toast, confirm]);

  // 大文件按需拉取（原 GistDetailModal.HighlightedCode effect 的服务调用部分）。
  // 无 token 时抛出的错误文案与原 setRawError 直写逐字一致，由 View catch 落 rawError。
  // Abort/retry/局部缓存归 View：signal 由调用方传入。
  // 依赖只含 token：语言切换不得换引用（否则 View 的拉取 effect 会随 language 变化
  // 重新发起网络请求），无 token 文案在抛错时经 getState() 读取当前语言。
  const fetchGistFileRaw = useCallback(async (rawUrl: string, signal?: AbortSignal): Promise<string> => {
    if (!state.githubToken) {
      const currentLanguage = useAppStore.getState().language;
      throw new Error(makeT(currentLanguage, 'gists')('useGistActions.github-token-not-configured'));
    }
    return createGitHubApiService(state.githubToken).getGistFileRaw(rawUrl, signal);
  }, [state.githubToken]);

  return {
    ...state,
    isRefreshing,
    isSearching,
    isAnalyzingAll,
    isMutating,
    refreshGists,
    aiSearch,
    analyzeVisibleGists,
    fetchGistDetail,
    submitGist,
    analyzeOne,
    unstarGist,
    deleteGist,
    fetchGistFileRaw,
    isAnalyzingGist,
  };
};
