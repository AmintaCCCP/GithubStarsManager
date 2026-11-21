import { makeT, useT } from "../../../i18n/useT";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Gist } from '../../../types';
import type { GistCreateInput, GistUpdateInput } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccount,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { withAccountSwitchGuardSync } from '../../../services/autoSync';
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

/**
 * 审计修复（C35）：详情请求因会话切换被丢弃时抛出的专用错误——调用方据此
 * 区分「会话切换」与「普通失败」：捕获本错误时清除旧账号 detailGist 并关闭
 * 详情面板（GistView 属主会话收尾，见 HANDOFF-B-TO-C.md C 实现记录）；
 * 普通失败仍返回 null 走调用方现有的降级显示。
 */
export class GistDetailSessionSwitchedError extends Error {
  constructor() {
    super('gist-detail-session-switched');
    this.name = 'GistDetailSessionSwitchedError';
  }
}

/**
 * 按 ID 原位修改星标字段（R12 审计修复）：迟到的取消星标响应不得用发起时的
 * 旧对象覆盖期间发生的编辑（描述/文件等），只允许改 `starred`。返回原数组
 * 引用表示没有变化。
 */
const patchGistStarred = (gists: Gist[], gistId: string, starred: boolean): Gist[] => {
  const index = gists.findIndex((gist) => gist.id === gistId);
  if (index === -1 || gists[index].starred === starred) return gists;
  const next = [...gists];
  next[index] = { ...next[index], starred };
  return next;
};

/**
 * R13 审计修复（CodeRabbit）：迟到的编辑响应不得用发起时的旧对象覆盖期间
 * 完成的较新编辑（如响应等待期间同账号又完成了第二次编辑）。以 GitHub 服务
 * 端版本戳 updated_at 比较当前条目与迟到响应的版本顺序（PATCH 响应与既有
 * 条目都携带服务端 updated_at）；不使用响应到达时本地设置的 last_edited——
 * 那是到达时刻，不代表编辑顺序。任一时间戳无法解析（版本顺序不可判定）或
 * 当前条目更新时返回 true（跳过补写，等待下次刷新），绝不回退较新内容。
 */
const lateEditWriteSuperseded = (current: Gist, incoming: Gist): boolean => {
  const currentVersion = Date.parse(current.updated_at);
  const incomingVersion = Date.parse(incoming.updated_at);
  if (Number.isNaN(currentVersion) || Number.isNaN(incomingVersion)) return true;
  return currentVersion > incomingVersion;
};

/**
 * 合并迟到的 Gist PATCH 编辑响应：只覆写 PATCH 拥有的远端字段与 last_edited，
 * 保留归档/实时条目上独立产生的本地字段（如 ai_summary、analyzed_at、starred）。
 */
const mergeLateGistEdit = (current: Gist, incoming: Gist): Gist => ({
  ...current,
  description: incoming.description,
  public: incoming.public,
  html_url: incoming.html_url,
  created_at: incoming.created_at,
  updated_at: incoming.updated_at,
  comments: incoming.comments,
  owner: incoming.owner,
  files: incoming.files,
  last_edited: incoming.last_edited,
});

/**
 * 审计修复：切号期间远端操作已成功的 Gist 变更（删除/取消星标/编辑）必须
 * 反映到发起账号的工作区，否则切回该账号时归档快照会把旧状态换入实时列表，
 * 与 GitHub 不一致。沿用账号工作区生命周期的安全更新路径（与
 * useRepositoryCardActions.unstar 的 C29 模式一致）：
 * - 发起账号已重新激活（A→B→A）→ 写入其当前实时工作区（簿记守卫内）；
 * - 仍停放 → 只更新其归档快照；快照不存在时绝不创建/覆盖（不触碰当前账号）。
 * 远端操作不可撤销，本地补写只是让列表与远端一致；提示与回调仍按原会话
 * 检查丢弃（不属于本函数职责）。
 */
const applyRemoteGistChangeToOwnerSession = (
  ownerAccountId: string | null,
  change:
    | { type: 'update'; gist: Gist }
    | { type: 'delete'; gistId: string }
    | { type: 'star'; gistId: string; starred: boolean }
    | { type: 'create'; gist: Gist },
): void => {
  if (!ownerAccountId || typeof useAppStore.setState !== 'function') return;
  if (isCurrentAccount(ownerAccountId)) {
    withAccountSwitchGuardSync(() => {
      if (change.type === 'delete') {
        useAppStore.getState().deleteGist(change.gistId);
        return;
      }
      if (change.type === 'star') {
        // 只改星标字段：读取实时最新条目，绝不写回发起时的旧快照
        useAppStore.setState((state) => ({
          gists: patchGistStarred(state.gists, change.gistId, change.starred),
          starredGists: patchGistStarred(state.starredGists, change.gistId, change.starred),
          gistSearchResults: patchGistStarred(state.gistSearchResults, change.gistId, change.starred),
        }));
        return;
      }
      if (change.type === 'create') {
        // 新建补写：按 ID 插入发起账号自己的 gist 列表（不覆盖已有条目）
        useAppStore.setState((state) => {
          if (state.gists.some((gist) => gist.id === change.gist.id)) return state;
          return { gists: [change.gist, ...state.gists] };
        });
        return;
      }
      // R13：实时列表已有较新版本（响应等待期间同账号完成了第二次编辑）时
      // 跳过补写——迟到的编辑响应绝不覆盖较新的 Gist。
      const liveCurrent = useAppStore.getState().gists.find((gist) => gist.id === change.gist.id);
      if (liveCurrent && lateEditWriteSuperseded(liveCurrent, change.gist)) return;
      useAppStore.getState().updateGist(liveCurrent ? mergeLateGistEdit(liveCurrent, change.gist) : change.gist);
    });
    return;
  }
  withAccountSwitchGuardSync(() => {
    useAppStore.setState((state) => {
      const parked = state.accountWorkspaces?.[ownerAccountId];
      if (!parked) return state;
      if (change.type === 'delete') {
        return {
          accountWorkspaces: {
            ...state.accountWorkspaces,
            [ownerAccountId]: {
              ...parked,
              gists: parked.gists.filter((gist) => gist.id !== change.gistId),
              starredGists: parked.starredGists.filter((gist) => gist.id !== change.gistId),
            },
          },
        };
      }
      if (change.type === 'star') {
        // 迟到的取消星标：只改最新条目的星标字段，保留期间发生的编辑内容
        const gists = patchGistStarred(parked.gists, change.gistId, change.starred);
        const starredGists = patchGistStarred(parked.starredGists, change.gistId, change.starred);
        if (gists === parked.gists && starredGists === parked.starredGists) return state;
        return {
          accountWorkspaces: {
            ...state.accountWorkspaces,
            [ownerAccountId]: { ...parked, gists, starredGists },
          },
        };
      }
      if (change.type === 'create') {
        // 切号期间创建成功：按 ID 插入发起账号归档（已在列表则保持原条目）
        if (parked.gists.some((gist) => gist.id === change.gist.id)) return state;
        return {
          accountWorkspaces: {
            ...state.accountWorkspaces,
            [ownerAccountId]: { ...parked, gists: [change.gist, ...parked.gists] },
          },
        };
      }
      // 编辑：按 ID 原位替换；条目不在快照中时跳过（绝不无中生有，
      // 也绝不把更新条目前置插入——那是「新增」语义，不属于本路径）。
      // R13：归档条目已是更新的远端版本时跳过补写——迟到的编辑响应
      // 绝不用旧对象覆盖较新的归档 Gist。
      const replaceById = (gists: Gist[]): Gist[] => {
        const index = gists.findIndex((gist) => gist.id === change.gist.id);
        if (index === -1) return gists;
        if (lateEditWriteSuperseded(gists[index], change.gist)) return gists;
        const next = [...gists];
        next[index] = mergeLateGistEdit(gists[index], change.gist);
        return next;
      };
      const gists = replaceById(parked.gists);
      const starredGists = replaceById(parked.starredGists);
      if (gists === parked.gists && starredGists === parked.starredGists) return state;
      return {
        accountWorkspaces: {
          ...state.accountWorkspaces,
          [ownerAccountId]: { ...parked, gists, starredGists },
        },
      };
    });
  });
};

export const useGistActions = () => {
  const state = useAppStore(useShallow(selectGistViewState));
  const { toast, confirm } = useDialog();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [isMutating, setIsMutating] = useState(false);
  // 刷新状态按请求归属（审计修复）：同账号会话代次递增（换凭据）后 currentUserId
  // 不变、下方 effect 不执行，而 finally 的会话检查又会跳过清理——没有请求身份
  // 记录时同步按钮会永久禁用。每次刷新登记唯一身份，仅最新请求可复位状态。
  const refreshRunRef = useRef(0);
  // AI 搜索忙碌状态按请求归属（R13 审计修复）：与 refreshGists 同一模式——
  // 仅最新一次搜索可在 finally 中清除 isSearching，旧请求不得覆盖新请求的状态。
  const searchRunRef = useRef(0);
  // 分析标记归属（R12 审计修复）：同账号换凭据会推进会话代次但账号不变，
  // 旧任务的 finally 若只看代次会跳过清理，Gist 永久显示「分析中」。为每个
  // Gist 记录设置标记的任务身份：只有仍持有该标记的任务才能清除它——新会话
  // 刚为同一 Gist 设置的标记不会被旧任务误清。
  const analysisRunRef = useRef(0);
  const analysisMarkerOwnersRef = useRef(new Map<string, number>());
  const analyzeAllRunRef = useRef(0);
  const mutationRunRef = useRef(0);
  const activeMutationsRef = useRef(new Map<number, string | null>());
  const currentUserId = useAppStore((s) => s.user?.id ?? null);
  const syncMutatingStateForAccount = useCallback((accountId: string | null) => {
    for (const owner of activeMutationsRef.current.values()) {
      if (owner === accountId) {
        setIsMutating(true);
        return;
      }
    }
    setIsMutating(false);
  }, []);
  // 切换账号时立即清除旧会话残留的刷新/搜索/批量分析/变更忙碌状态，避免新账号按钮被禁用
  useEffect(() => {
    setIsRefreshing(false);
    // R13 审计修复（CodeRabbit）：AI 搜索忙碌状态同样随切号复位——GistView
    // 不因切号重新挂载，旧账号未结束的搜索会让新账号的搜索按钮保持禁用。
    setIsSearching(false);
    setIsAnalyzingAll(false);
    syncMutatingStateForAccount(currentUserId !== null ? String(currentUserId) : null);
  }, [currentUserId, syncMutatingStateForAccount]);
  // isAnalyzingGist(id) 的渲染值恒等于 store 集合值：原 GistCard 的本地 isAnalyzingLocal
  // 与 setAnalyzingGist 同置同清，渲染上与集合值等价，故本 hook 只操作 store 集合、
  // 不再设本地 flag（勿"修复"回双 flag 写法）。
  const analyzingGistIds = useAppStore((s) => s.analyzingGistIds);
  const isAnalyzingGist = useCallback(
    (gistId: string) => analyzingGistIds.has(gistId),
    [analyzingGistIds],
  );
  const t = useT('gists');

  /**
   * 分析标记的取得/释放（R12）：标记按任务身份归属。释放只允许标记的当前
   * 持有者执行——同账号换凭据推进代次后，旧任务仍能清掉自己留下的标记；
   * 新会话为同一 Gist 重新设置的标记不会被旧任务误清。
   */
  const beginAnalysisMarker = useCallback((gistId: string) => {
    const token = ++analysisRunRef.current;
    analysisMarkerOwnersRef.current.set(gistId, token);
    state.setAnalyzingGist(gistId, true);
    return token;
  }, [state]);

  const endAnalysisMarker = useCallback((gistId: string, token: number) => {
    if (analysisMarkerOwnersRef.current.get(gistId) !== token) return;
    analysisMarkerOwnersRef.current.delete(gistId);
    state.setAnalyzingGist(gistId, false);
  }, [state]);

  const refreshGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('useGistActions.github-token-not-found-please-login-again'), 'error');
      return;
    }
    setIsRefreshing(true);
    const refreshRunId = ++refreshRunRef.current;
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
      // 审计修复（C34）：刷新请求失败提示先校验发起会话——已切换则不显示
      // 旧请求错误；finally 的加载状态清理保持不变。
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      toast(error instanceof Error ? error.message : t('useGistActions.failed-to-sync-gists'), 'error');
    } finally {
      // 审计修复：复位按请求身份而非会话校验——旧请求结束时若仍是最新一次
      // 刷新（含同账号换凭据后无新请求的场景），必须复位禁用的同步按钮；
      // 新会话已发起自己的刷新（身份已让位）时绝不覆盖其状态。
      if (refreshRunRef.current === refreshRunId) {
        setIsRefreshing(false);
      }
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
    const searchRunId = ++searchRunRef.current;
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
      // 忙碌状态按请求身份清除（R13）：只有仍是最新一次搜索时才复位，
      // 旧请求不得覆盖新请求设置的忙碌状态。
      if (searchRunRef.current === searchRunId) {
        setIsSearching(false);
      }
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

    const analyzeAllRunId = ++analyzeAllRunRef.current;
    setIsAnalyzingAll(true);
    const api = createGitHubApiService(state.githubToken);
    const aiService = new AIService(activeConfig, state.language);
    let success = 0;
    let failed = 0;
    const concurrency = activeConfig.concurrency && activeConfig.concurrency > 1 ? activeConfig.concurrency : 1;
    const analyzeOne = async (gist: Gist) => {
      if (!isCurrentAccountSession(jobAccountId, jobGeneration)) return;
      const markerToken = beginAnalysisMarker(gist.id);
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
        // 标记按任务身份归属（R12）：同一账号换凭据（代次推进、账号不变）也
        // 必须清理旧任务自己留下的标记，否则 Gist 永久显示「分析中」；新会话
        // 为同一 Gist 重新设置的标记（新 token）不会被旧任务误清。切到其他
        // 账号时不清理（新账号工作区的同 ID 标记与旧任务无关）。
        if (isCurrentAccount(jobAccountId)) {
          endAnalysisMarker(gist.id, markerToken);
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
      if (analyzeAllRunRef.current === analyzeAllRunId && isCurrentAccount(jobAccountId)) {
        setIsAnalyzingAll(false);
      }
    }
  }, [beginAnalysisMarker, endAnalysisMarker, state, t, toast, confirm]);

  const fetchGistDetail = useCallback(async (gist: Gist): Promise<Gist | null> => {
    if (!state.githubToken) return null;
    // 账号代次校验（Issue #611 审计修复）：账号 ID 必须在任何 await 之前保存，
    // 提交结果前用保存值复核——请求完成后再读取会拿到切号后的账号，检查恒通过
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    try {
      const detail = await createGitHubApiService(state.githubToken).getGist(gist.id, gist);
      // 审计修复（C35）：详情拉取切号后抛出专用错误——调用方能区分「会话切换」
      // 与「普通失败」（捕获 GistDetailSessionSwitchedError 时清除旧账号
      // detailGist 并关闭详情面板）；绝不写入当前工作区，也绝不返回旧账号详情。
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        throw new GistDetailSessionSwitchedError();
      }
      state.updateGist(detail);
      return detail;
    } catch (error) {
      // 会话切换信号必须穿透到调用方，不得被普通失败路径吞掉
      if (error instanceof GistDetailSessionSwitchedError) throw error;
      // 审计修复（C34/R2-C17）：详情请求失败提示先校验发起会话——已切换则
      // 与成功路径一致抛出专用标记错误（调用方据此清理旧账号 detailGist 并
      // 关闭详情面板），绝不把旧账号请求的失败当作当前会话的普通失败；
      // 同会话失败保留现有降级显示（返回 null）。
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        throw new GistDetailSessionSwitchedError();
      }
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
        if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
          // 审计修复：远端编辑已按发起账号完成（不可撤销）——发起账号的
          // 工作区（实时或归档）必须同步该结果。
          applyRemoteGistChangeToOwnerSession(
            startedAccountId,
            { type: 'update', gist: { ...updated, last_edited: new Date().toISOString() } },
          );
          return;
        }
        state.updateGist({ ...updated, last_edited: new Date().toISOString() });
        toast(t('useGistActions.gist-updated'), 'success');
        return;
      }
      const created = await api.createGist(input as GistCreateInput);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        // 审计修复（R12）：远端创建已按发起账号完成（不可撤销）——按 ID 补写
        // 发起账号的工作区（实时或归档），否则切回后归档列表缺少新 Gist；
        // 不显示旧会话的成功提示，也不触碰当前账号的列表。
        applyRemoteGistChangeToOwnerSession(
          startedAccountId,
          { type: 'create', gist: { ...created, last_edited: new Date().toISOString() } },
        );
        return;
      }
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

    const markerToken = beginAnalysisMarker(gist.id);
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
      // 与批量分析一致（R12）：同账号换凭据后旧任务仍清理自己留下的标记；
      // 切到其他账号时不清理（新账号同 ID 标记与旧任务无关）。
      if (isCurrentAccount(startedAccountId)) {
        endAnalysisMarker(gist.id, markerToken);
      }
    }
  }, [beginAnalysisMarker, endAnalysisMarker, state, t, toast, confirm]);

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
    const mutationToken = ++mutationRunRef.current;
    activeMutationsRef.current.set(mutationToken, startedAccountId);
    setIsMutating(true);
    try {
      await api.unstarGist(gist.id);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        // 审计修复：远端取消星标已按发起账号完成（不可撤销）——发起账号的
        // 工作区（实时或归档）必须同步该结果，切回后列表才与 GitHub 一致。
        // R12：只改星标字段，绝不写回发起时的旧对象（期间可能已被编辑）。
        applyRemoteGistChangeToOwnerSession(startedAccountId, { type: 'star', gistId: gist.id, starred: false });
        return;
      }
      onUnstarred?.(gist.id);
      applyRemoteGistChangeToOwnerSession(startedAccountId, { type: 'star', gistId: gist.id, starred: false });
      toast(t('useGistActions.unstarred'), 'success');
    } catch {
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
      toast(t('useGistActions.failed-to-unstar'), 'error');
    } finally {
      activeMutationsRef.current.delete(mutationToken);
      if (isCurrentAccount(startedAccountId)) {
        syncMutatingStateForAccount(startedAccountId);
      }
    }
  }, [state, t, toast, confirm, syncMutatingStateForAccount]);

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
    const mutationToken = ++mutationRunRef.current;
    activeMutationsRef.current.set(mutationToken, startedAccountId);
    setIsMutating(true);
    try {
      await api.deleteGist(gist.id);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        // 审计修复：远端删除已按发起账号完成（不可撤销）——发起账号的
        // 工作区（实时或归档）必须同步该结果，切回后已删除的 Gist 不得复活。
        applyRemoteGistChangeToOwnerSession(startedAccountId, { type: 'delete', gistId: gist.id });
        return;
      }
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
      activeMutationsRef.current.delete(mutationToken);
      if (isCurrentAccount(startedAccountId)) {
        syncMutatingStateForAccount(startedAccountId);
      }
    }
  }, [state, t, toast, confirm, syncMutatingStateForAccount]);

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
