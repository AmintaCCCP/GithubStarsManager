import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FileCode2, HelpCircle, Loader2, Plus, RefreshCw, Search, Star, User, X } from 'lucide-react';
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
        const detail = await api.getGistForAnalysis(gist.id, gist);
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
      const isServerFailure = /5\d{2}/.test(msg);
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

  return (
    <div className="flex w-full flex-col items-start gap-4 lg:flex-row lg:gap-6">
      <aside className="w-full lg:w-64 lg:flex-shrink-0 lg:self-start">
        <div className="linear-sidebar sticky top-24 z-10 p-3">
          <div className="mb-3 flex items-center justify-between px-2">
            <div className="flex items-center gap-1">
              <h2 className="text-lg font-semibold text-foreground dark:text-foreground">Gist</h2>
              <div className="group relative">
                <HelpCircle className="h-3.5 w-3.5 cursor-help text-muted-foreground dark:text-muted-foreground/70" />
                <div className="absolute left-0 top-full z-[9999] mt-2 w-72 max-w-xs whitespace-normal rounded-lg border border-border bg-card p-3 text-xs text-muted-foreground shadow-lg opacity-0 invisible transition-all break-words group-hover:visible group-hover:opacity-100 dark:border-border dark:bg-card dark:text-muted-foreground">
                  <p className="mb-1 font-medium text-foreground dark:text-foreground">
                    {t('访问 Gist 需要 gist 权限', 'Gist access requires the gist scope')}
                  </p>
                  <p className="leading-relaxed">
                    {t(
                      '若私有 gist 未拉取到，或无法新建/编辑/删除 gist，请到 GitHub → Settings → Developer settings → Personal access tokens 中确认当前 token 已勾选 gist 权限。修改权限后请重新输入 token 登录。',
                      'If your private gists are missing, or you cannot create/edit/delete gists, go to GitHub → Settings → Developer settings → Personal access tokens and make sure the gist scope is checked for your current token. Re-login with the updated token after changing scopes.'
                    )}
                  </p>
                  <div className="absolute bottom-full left-3 -mb-px h-2 w-2 rotate-45 border-l border-t border-border bg-card dark:border-border dark:bg-card"></div>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            {categories.map(category => {
              const Icon = categoryIcons[category.id];
              const active = selectedGistCategory === category.id;
              return (
                <Button
                  key={category.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedGistCategory(category.id)}
                  variant="ghost"
                  className={`linear-settings-nav-item group flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-accent-foreground ${
                    active ? 'is-active' : ''
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {t(category.name, category.nameEn)}
                  </span>
                  <span className={`font-medium ${active ? 'text-accent-foreground' : 'text-muted-foreground group-hover:text-accent-foreground'}`}>
                    {categoryItems[category.id].length}
                  </span>
                </Button>
              );
            })}
          </div>
        </div>
      </aside>

      <section className="w-full min-w-0 flex-1 space-y-5 lg:self-start">
        <div className="ui-toolbar p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') basicSearch();
                  }}
                  aria-label={t('搜索 gist、文件名或摘要', 'Search gists, filenames, or summaries')}
                  className="ui-field w-full py-2 pl-9 pr-9 text-sm text-foreground dark:text-foreground"
                  placeholder={t('搜索 gist、文件名、摘要...', 'Search gists, filenames, summaries...')}
                />
                {query && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setQuery('');
                      setGistSearchFilters({ query: '' });
                    }}
                    aria-label={t('清除搜索', 'Clear search')}
                    title={t('清除搜索', 'Clear search')}
                    className="absolute right-2 top-1/2 h-7 w-7 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-muted-foreground dark:hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Button
                type="button"
                onClick={aiSearch}
                disabled={isSearching || !query.trim()}
                className="ui-button-primary inline-flex items-center gap-2 px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {t('AI搜索', 'AI search')}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={gistSearchFilters.sortBy}
                onValueChange={(value) => {
                  if (sortOptions.some((option) => option.value === value)) {
                    setGistSearchFilters({ sortBy: value as typeof sortOptions[number]['value'] });
                  }
                }}
              >
                <SelectTrigger aria-label={t('Gist 排序方式', 'Gist sort order')} className="ui-field h-9 w-40 px-3 py-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map(option => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.labelZh, option.labelEn)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                onClick={() => setGistSearchFilters({ sortOrder: gistSearchFilters.sortOrder === 'desc' ? 'asc' : 'desc' })}
                className="ui-button px-3 py-2 text-sm"
              >
                {gistSearchFilters.sortOrder === 'desc' ? t('降序', 'Desc') : t('升序', 'Asc')}
              </Button>
              <Button
                type="button"
                onClick={analyzeVisibleGists}
                disabled={isAnalyzingAll || gistSearchResults.length === 0}
                className="ui-button inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
              >
                {isAnalyzingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {t('AI分析', 'AI analyze')}
              </Button>
              <Button
                type="button"
                onClick={refreshGists}
                disabled={isRefreshing}
                className="ui-button inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {t('同步', 'Sync')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setEditingGist(null);
                  setIsEditorOpen(true);
                }}
                className="ui-button-primary inline-flex items-center gap-2 px-3 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                {t('新建', 'New')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground dark:text-muted-foreground">
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
          <div className="ui-empty-state p-12 text-center">
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
