import { useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Gist } from '../../../types';
import type { GistCreateInput, GistUpdateInput } from '../../../services/githubApi';
import { useAppStore } from '../../../store/useAppStore';
import { selectGistViewState } from '../../../store/selectors';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import { AIService } from '../../../services/aiService';
import { useDialog } from '../../../hooks/useDialog';
import { filterAndSortGists } from '../../../utils/gistUtils';

export type { GistCreateInput, GistUpdateInput };

export const useGistActions = () => {
  const state = useAppStore(useShallow(selectGistViewState));
  const { toast, confirm } = useDialog();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const t = useCallback((zh: string, en: string) => state.language === 'zh' ? zh : en, [state.language]);

  const refreshGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    setIsRefreshing(true);
    try {
      const api = createGitHubApiService(state.githubToken);
      const [mine, starred] = await Promise.all([
        api.getAllGists(state.gists),
        api.getAllStarredGists([...state.gists, ...state.starredGists]),
      ]);
      const starredIds = new Set(starred.map(gist => gist.id));
      state.setGists(mine.map(gist => ({ ...gist, starred: starredIds.has(gist.id) || gist.starred })));
      state.setStarredGists(starred);
      toast(t('Gist 同步完成', 'Gists synced'), 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('Gist 同步失败', 'Failed to sync gists'), 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [state, t, toast]);

  const aiSearch = useCallback(async (
    query: string,
    categoryItems: Gist[],
    onReranked: () => void,
  ) => {
    if (!query.trim()) return;
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      state.setGistSearchFilters({ query });
      return;
    }
    setIsSearching(true);
    try {
      const aiService = new AIService(activeConfig, state.language);
      const ranked = await aiService.searchGistsWithReranking(
        filterAndSortGists(categoryItems, { ...state.gistSearchFilters, query: '' }),
        query,
      );
      onReranked();
      state.setGistSearchFilters({ query });
      state.setGistSearchResults(ranked);
    } catch {
      state.setGistSearchFilters({ query });
    } finally {
      setIsSearching(false);
    }
  }, [state]);

  const analyzeVisibleGists = useCallback(async () => {
    if (!state.githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const activeConfig = state.aiConfigs.find(config => config.id === state.activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }
    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model || activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('AI服务配置不完整，请检查设置。', 'AI service configuration is incomplete. Please check settings.'), 'error');
      return;
    }
    const targets = state.gistSearchResults.filter(gist => !gist.analyzed_at || gist.analysis_failed);
    if (targets.length === 0) {
      toast(t('当前列表没有需要分析的 gist', 'No gists need analysis in the current list'), 'info');
      return;
    }
    const confirmed = await confirm(t('批量 AI 分析', 'Batch AI Analysis'), t(`将分析 ${targets.length} 个 gist，是否继续？`, `Analyze ${targets.length} gists. Continue?`), { type: 'warning' });
    if (!confirmed) return;

    setIsAnalyzingAll(true);
    const api = createGitHubApiService(state.githubToken);
    const aiService = new AIService(activeConfig, state.language);
    let success = 0;
    let failed = 0;
    const concurrency = activeConfig.concurrency && activeConfig.concurrency > 1 ? activeConfig.concurrency : 1;
    const analyzeOne = async (gist: Gist) => {
      state.setAnalyzingGist(gist.id, true);
      try {
        const detail = await api.getGistForAnalysis(gist.id, gist);
        const summary = await aiService.analyzeGist(detail, api.getGistContentPreview(detail));
        state.updateGist({ ...detail, ai_summary: summary.trim(), analyzed_at: new Date().toISOString(), analysis_failed: false, analysis_error: undefined });
        success++;
      } catch (error) {
        state.updateGist({ ...gist, analyzed_at: new Date().toISOString(), analysis_failed: true, analysis_error: error instanceof Error ? error.message : String(error) });
        failed++;
      } finally {
        state.setAnalyzingGist(gist.id, false);
      }
    };
    try {
      for (let index = 0; index < targets.length; index += concurrency) {
        await Promise.all(targets.slice(index, index + concurrency).map(analyzeOne));
      }
      toast(t(`AI分析完成：成功 ${success}，失败 ${failed}`, `AI analysis done: ${success} succeeded, ${failed} failed`), failed > 0 ? 'error' : 'success');
    } finally {
      setIsAnalyzingAll(false);
    }
  }, [state, t, toast, confirm]);

  const fetchGistDetail = useCallback(async (gist: Gist): Promise<Gist | null> => {
    if (!state.githubToken) return null;
    try {
      const detail = await createGitHubApiService(state.githubToken).getGist(gist.id, gist);
      state.updateGist(detail);
      return detail;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/5\d{2}/.test(message)) {
        toast(t('GitHub Gist API 暂时不可用，已使用缓存数据打开。文件内容将按需加载。', 'GitHub Gist API is temporarily unavailable. Opening with cached data. File content will load on demand.'), 'warning');
        return null;
      }
      toast(t(`获取 Gist 详情失败${message ? `：${message}` : ''}`, `Failed to load gist details${message ? `: ${message}` : ''}`), 'error');
      return null;
    }
  }, [state, t, toast]);

  const submitGist = useCallback(async (input: GistCreateInput | GistUpdateInput, editingGist: Gist | null) => {
    if (!state.githubToken) return;
    const api = createGitHubApiService(state.githubToken);
    try {
      if (editingGist) {
        const updated = await api.updateGist(editingGist.id, input as GistUpdateInput, editingGist);
        state.updateGist({ ...updated, last_edited: new Date().toISOString() });
        toast(t('Gist 已更新', 'Gist updated'), 'success');
        return;
      }
      const created = await api.createGist(input as GistCreateInput);
      state.updateGist({ ...created, last_edited: new Date().toISOString() });
      toast(t('Gist 已创建', 'Gist created'), 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(message);
      toast(
        t(
          `Gist ${editingGist ? '更新' : '创建'}失败：${message || '未知错误'}${isPermission ? '（请确认 token 已勾选 gist 权限，并在设置中重新输入 token 登录）' : ''}`,
          `Failed to ${editingGist ? 'update' : 'create'} gist: ${message || 'Unknown error'}${isPermission ? ' (Make sure your token has the gist scope and re-login with the updated token)' : ''}`,
        ),
        'error',
      );
    }
  }, [state, t, toast]);

  return {
    ...state,
    isRefreshing,
    isSearching,
    isAnalyzingAll,
    refreshGists,
    aiSearch,
    analyzeVisibleGists,
    fetchGistDetail,
    submitGist,
  };
};
