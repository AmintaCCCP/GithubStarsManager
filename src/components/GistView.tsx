import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, ChevronDown, FileCode2, HelpCircle, Loader2, Plus, RefreshCw, Search, Star, User, X } from 'lucide-react';
import { GistCard } from './GistCard';
import { GistDetailModal } from './GistDetailModal';
import { GistEditorModal } from './GistEditorModal';
import { GistCreateInput, GistUpdateInput } from '../services/githubApi';
import { createGitHubApiService } from '../services/githubApiFactory';
import { AIService } from '../services/aiService';
import { useAppStore } from '../store/useAppStore';
import type { Gist, GistCategoryId } from '../types';
import { filterAndSortGists, getGistCategoryItems } from '../utils/gistUtils';
import { useDialog } from '../hooks/useDialog';

const categoryIcons = {
  all: FileCode2,
  starred: Star,
  mine: User,
};

const sortOptions = [
  { value: 'updated', labelZh: '按更新时间', labelEn: 'Updated' },
  { value: 'created', labelZh: '按创建时间', labelEn: 'Created' },
  { value: 'name', labelZh: '按名称', labelEn: 'Name' },
  { value: 'files', labelZh: '按文件数', labelEn: 'Files' },
] as const;

export const GistView: React.FC = () => {
  const {
    user,
    githubToken,
    gists,
    starredGists,
    gistSearchFilters,
    gistSearchResults,
    selectedGistCategory,
    aiConfigs,
    activeAIConfig,
    language,
    setGists,
    setStarredGists,
    updateGist,
    deleteGist,
    setGistSearchFilters,
    setGistSearchResults,
    setSelectedGistCategory,
    setAnalyzingGist,
  } = useAppStore();
  const { toast, confirm } = useDialog();
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [query, setQuery] = useState(gistSearchFilters.query);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isAnalyzingAll, setIsAnalyzingAll] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [detailGist, setDetailGist] = useState<Gist | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingGist, setEditingGist] = useState<Gist | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const detailRequestSeqRef = useRef(0);

  const categoryItems = useMemo(() => ({
    all: getGistCategoryItems('all', gists, starredGists, user?.login),
    starred: getGistCategoryItems('starred', gists, starredGists, user?.login),
    mine: getGistCategoryItems('mine', gists, starredGists, user?.login),
  }), [gists, starredGists, user?.login]);

  const currentCategoryItems = categoryItems[selectedGistCategory];
  // 标记最近一次是 AI 重排序结果，避免随后的 query 同步触发 effect 把它覆盖掉。
  const aiRerankedRef = useRef(false);

  useEffect(() => {
    // AI 重排序结果由 aiSearch 直接写入；这里跳过紧接着的一次覆盖。
    if (aiRerankedRef.current) {
      aiRerankedRef.current = false;
      return;
    }
    setGistSearchResults(filterAndSortGists(currentCategoryItems, gistSearchFilters));
  }, [currentCategoryItems, gistSearchFilters, setGistSearchResults]);

  const categories: Array<{ id: GistCategoryId; name: string; nameEn: string }> = [
    { id: 'all', name: '全部gist', nameEn: 'All gists' },
    { id: 'starred', name: '星标gist', nameEn: 'Starred gists' },
    { id: 'mine', name: '我的gist', nameEn: 'My gists' },
  ];

  const refreshGists = async () => {
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }

    setIsRefreshing(true);
    try {
      const api = createGitHubApiService(githubToken);
      const [mine, starred] = await Promise.all([
        api.getAllGists(gists),
        api.getAllStarredGists([...gists, ...starredGists]),
      ]);
      const starredIds = new Set(starred.map(gist => gist.id));
      setGists(mine.map(gist => ({ ...gist, starred: starredIds.has(gist.id) || gist.starred })));
      setStarredGists(starred);
      toast(t('Gist 同步完成', 'Gists synced'), 'success');
    } catch (error) {
      toast(error instanceof Error ? error.message : t('Gist 同步失败', 'Failed to sync gists'), 'error');
    } finally {
      setIsRefreshing(false);
    }
  };

  const basicSearch = () => {
    setGistSearchFilters({ query });
  };

  const aiSearch = async () => {
    if (!query.trim()) return;
    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      basicSearch();
      return;
    }

    setIsSearching(true);
    try {
      const aiService = new AIService(activeConfig, language);
      const ranked = await aiService.searchGistsWithReranking(
        filterAndSortGists(currentCategoryItems, { ...gistSearchFilters, query: '' }),
        query
      );
      // AI 重排序结果已含完整顺序，先写入标记，避免 effect 因 query 变化把结果覆盖。
      aiRerankedRef.current = true;
      setGistSearchFilters({ query });
      setGistSearchResults(ranked);
    } catch {
      basicSearch();
    } finally {
      setIsSearching(false);
    }
  };

  const analyzeVisibleGists = async () => {
    if (!githubToken) {
      toast(t('GitHub token 未找到，请重新登录。', 'GitHub token not found. Please login again.'), 'error');
      return;
    }
    const activeConfig = aiConfigs.find(config => config.id === activeAIConfig);
    if (!activeConfig) {
      toast(t('请先在设置中配置AI服务。', 'Please configure AI service in settings first.'), 'error');
      return;
    }
    if (!activeConfig.baseUrl || !activeConfig.apiKey || !activeConfig.model || activeConfig.apiKeyStatus === 'decrypt_failed' || activeConfig.apiKeyStatus === 'empty') {
      toast(t('AI服务配置不完整，请检查设置。', 'AI service configuration is incomplete. Please check settings.'), 'error');
      return;
    }

    const targets = gistSearchResults.filter(gist => !gist.analyzed_at || gist.analysis_failed);
    if (targets.length === 0) {
      toast(t('当前列表没有需要分析的 gist', 'No gists need analysis in the current list'), 'info');
      return;
    }

    const confirmed = await confirm(
      t('批量 AI 分析', 'Batch AI Analysis'),
      t(`将分析 ${targets.length} 个 gist，是否继续？`, `Analyze ${targets.length} gists. Continue?`),
      { type: 'warning' }
    );
    if (!confirmed) return;

    setIsAnalyzingAll(true);
    const api = createGitHubApiService(githubToken);
    const aiService = new AIService(activeConfig, language);
    let success = 0;
    let failed = 0;

    const concurrency = activeConfig.concurrency && activeConfig.concurrency > 1 ? activeConfig.concurrency : 1;

    const analyzeOne = async (gist: Gist) => {
      setAnalyzingGist(gist.id, true);
      try {
        const detail = await api.getGist(gist.id, gist);
        const summary = await aiService.analyzeGist(detail, api.getGistContentPreview(detail));
        updateGist({
          ...detail,
          ai_summary: summary.trim(),
          analyzed_at: new Date().toISOString(),
          analysis_failed: false,
          analysis_error: undefined,
        });
        success++;
      } catch (error) {
        updateGist({
          ...gist,
          analyzed_at: new Date().toISOString(),
          analysis_failed: true,
          analysis_error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      } finally {
        setAnalyzingGist(gist.id, false);
      }
    };

    // 按 concurrency 分批并发执行
    for (let i = 0; i < targets.length; i += concurrency) {
      const batch = targets.slice(i, i + concurrency);
      await Promise.all(batch.map(gist => analyzeOne(gist)));
    }

    setIsAnalyzingAll(false);
    toast(t(`AI分析完成：成功 ${success}，失败 ${failed}`, `AI analysis done: ${success} succeeded, ${failed} failed`), failed > 0 ? 'error' : 'success');
  };

  const openDetail = async (gist: Gist) => {
    const requestSeq = ++detailRequestSeqRef.current;
    setDetailGist(gist);
    setIsDetailOpen(true);
    if (!githubToken) return;

    try {
      const detail = await createGitHubApiService(githubToken).getGist(gist.id, gist);
      // 防止旧请求覆盖新打开的 gist 详情
      if (requestSeq !== detailRequestSeqRef.current) return;
      updateGist(detail);
      setDetailGist(detail);
    } catch (error) {
      if (requestSeq !== detailRequestSeqRef.current) return;
      const msg = error instanceof Error ? error.message : '';
      // 502/503/504 通常是 GitHub gist API 对该 gist 稳定返回的服务端错误（如 karpathy/8627fe...），
      // 重试无意义。此时用已缓存的 gist 数据降级打开弹窗，文件内容由 HighlightedCode 按需从 raw_url 获取。
      const isServerFailure = /50[234]/.test(msg);
      if (isServerFailure && gist) {
        toast(
          t('GitHub Gist API 暂时不可用，已使用缓存数据打开。文件内容将按需加载。', 'GitHub Gist API is temporarily unavailable. Opening with cached data. File content will load on demand.'),
          'warning'
        );
        return;
      }
      toast(t(`获取 Gist 详情失败${msg ? `：${msg}` : ''}`, `Failed to load gist details${msg ? `: ${msg}` : ''}`), 'error');
    }
  };

  const handleSubmitGist = async (input: GistCreateInput | GistUpdateInput) => {
    if (!githubToken) return;
    const api = createGitHubApiService(githubToken);
    try {
      if (editingGist) {
        const updated = await api.updateGist(editingGist.id, input as GistUpdateInput, editingGist);
        updateGist({ ...updated, last_edited: new Date().toISOString() });
        toast(t('Gist 已更新', 'Gist updated'), 'success');
        return;
      }

      const created = await api.createGist(input as GistCreateInput);
      updateGist({ ...created, last_edited: new Date().toISOString() });
      toast(t('Gist 已创建', 'Gist created'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      const isPermission = /403|404|forbidden|scope|permission/i.test(msg);
      toast(
        t(
          `Gist ${editingGist ? '更新' : '创建'}失败：${msg || '未知错误'}${isPermission ? '（请确认 token 已勾选 gist 权限，并在设置中重新输入 token 登录）' : ''}`,
          `Failed to ${editingGist ? 'update' : 'create'} gist: ${msg || 'Unknown error'}${isPermission ? ' (Make sure your token has the gist scope and re-login with the updated token)' : ''}`
        ),
        'error'
      );
    }
  };

  const selectedSort = sortOptions.find(option => option.value === gistSearchFilters.sortBy) || sortOptions[0];

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <aside className="lg:w-64 lg:flex-shrink-0">
        <div className="sticky top-24 z-10 rounded-lg border border-black/[0.06] bg-white p-3 shadow-sm dark:border-white/[0.04] dark:bg-white/[0.03]">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-text-primary">Gist</h2>
              <div className="group relative">
                <HelpCircle className="h-3.5 w-3.5 cursor-help text-gray-400 dark:text-text-quaternary" />
                <div className="absolute left-0 top-full z-[9999] mt-2 w-72 max-w-xs whitespace-normal rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-600 shadow-lg opacity-0 invisible transition-all break-words group-hover:visible group-hover:opacity-100 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  <p className="mb-1 font-medium text-gray-900 dark:text-white">
                    {t('访问 Gist 需要 gist 权限', 'Gist access requires the gist scope')}
                  </p>
                  <p className="leading-relaxed">
                    {t(
                      '若私有 gist 未拉取到，或无法新建/编辑/删除 gist，请到 GitHub → Settings → Developer settings → Personal access tokens 中确认当前 token 已勾选 gist 权限。修改权限后请重新输入 token 登录。',
                      'If your private gists are missing, or you cannot create/edit/delete gists, go to GitHub → Settings → Developer settings → Personal access tokens and make sure the gist scope is checked for your current token. Re-login with the updated token after changing scopes.'
                    )}
                  </p>
                  <div className="absolute bottom-full left-3 -mb-px h-2 w-2 rotate-45 border-l border-t border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"></div>
                </div>
              </div>
            </div>
            <span className="text-xs text-gray-500 dark:text-text-tertiary">{categoryItems.all.length}</span>
          </div>
          <div className="space-y-1">
            {categories.map(category => {
              const Icon = categoryIcons[category.id];
              const active = selectedGistCategory === category.id;
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelectedGistCategory(category.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    active
                      ? 'bg-brand-indigo text-white shadow-sm'
                      : 'text-gray-700 hover:bg-light-surface dark:text-text-secondary dark:hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {t(category.name, category.nameEn)}
                  </span>
                  <span className={active ? 'text-white/80' : 'text-gray-400 dark:text-text-quaternary'}>
                    {categoryItems[category.id].length}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="min-w-0 flex-1 space-y-5">
        <div className="rounded-lg border border-black/[0.06] bg-white p-4 shadow-sm dark:border-white/[0.04] dark:bg-white/[0.03]">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') basicSearch();
                  }}
                  className="w-full rounded-lg border border-black/[0.06] bg-light-surface py-2 pl-9 pr-9 text-sm text-gray-900 outline-none focus:border-brand-indigo dark:border-white/[0.04] dark:bg-black/20 dark:text-text-primary"
                  placeholder={t('搜索 gist、文件名、摘要...', 'Search gists, filenames, summaries...')}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuery('');
                      setGistSearchFilters({ query: '' });
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-text-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={aiSearch}
                disabled={isSearching || !query.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-indigo/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {t('AI搜索', 'AI search')}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSortOpen(open => !open)}
                  className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary"
                >
                  {t(selectedSort.labelZh, selectedSort.labelEn)}
                  <ChevronDown className="h-4 w-4" />
                </button>
                {sortOpen && (
                  <div className="absolute right-0 z-30 mt-1 w-40 overflow-hidden rounded-lg border border-black/[0.06] bg-white shadow-lg dark:border-white/[0.04] dark:bg-panel-dark">
                    {sortOptions.map(option => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          setGistSearchFilters({ sortBy: option.value });
                          setSortOpen(false);
                        }}
                        className={`block w-full px-3 py-2 text-left text-sm ${
                          gistSearchFilters.sortBy === option.value
                            ? 'bg-brand-indigo/10 text-brand-indigo dark:text-white'
                            : 'text-gray-700 hover:bg-light-surface dark:text-text-secondary dark:hover:bg-white/[0.08]'
                        }`}
                      >
                        {t(option.labelZh, option.labelEn)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setGistSearchFilters({ sortOrder: gistSearchFilters.sortOrder === 'desc' ? 'asc' : 'desc' })}
                className="rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary"
              >
                {gistSearchFilters.sortOrder === 'desc' ? t('降序', 'Desc') : t('升序', 'Asc')}
              </button>
              <button
                type="button"
                onClick={analyzeVisibleGists}
                disabled={isAnalyzingAll || gistSearchResults.length === 0}
                className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface disabled:opacity-50 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
              >
                {isAnalyzingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {t('AI分析', 'AI analyze')}
              </button>
              <button
                type="button"
                onClick={refreshGists}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 rounded-lg border border-black/[0.06] bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-light-surface disabled:opacity-50 dark:border-white/[0.04] dark:bg-white/[0.04] dark:text-text-secondary dark:hover:bg-white/[0.08]"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {t('同步', 'Sync')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingGist(null);
                  setIsEditorOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-indigo px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-indigo/90"
              >
                <Plus className="h-4 w-4" />
                {t('新建', 'New')}
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-text-tertiary">
          <span>{t(`共 ${gistSearchResults.length} 个 gist`, `${gistSearchResults.length} gists`)}</span>
          {gistSearchFilters.query && <span>{t('已应用搜索', 'Search applied')}</span>}
        </div>

        {gistSearchResults.length > 0 ? (
          <div className="grid gap-4">
            {gistSearchResults.map(gist => (
              <GistCard
                key={gist.id}
                gist={gist}
                isMine={gist.owner?.login === user?.login}
                onOpen={openDetail}
                onEdit={(target) => {
                  setEditingGist(target);
                  setIsEditorOpen(true);
                }}
                onDeleted={(gistId) => {
                  deleteGist(gistId);
                }}
                onUnstarred={(gistId) => {
                  const latestStarred = useAppStore.getState().starredGists;
                  setStarredGists(latestStarred.filter(item => item.id !== gistId));
                }}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-black/[0.08] bg-white p-12 text-center text-gray-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-text-tertiary">
            {t('暂无 gist。点击同步获取数据，或新建一个 gist。', 'No gists yet. Sync to fetch data, or create a new gist.')}
          </div>
        )}
      </section>

      <GistDetailModal gist={detailGist} isOpen={isDetailOpen} onClose={() => setIsDetailOpen(false)} />
      <GistEditorModal
        gist={editingGist}
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        onSubmit={handleSubmitGist}
      />
    </div>
  );
};
