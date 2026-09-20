



import { useT } from '../i18n/useT';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, FileCode2, HelpCircle, Loader2, Plus, RefreshCw, Search, Star, User, X } from 'lucide-react';
import { GistCard } from './GistCard';
import { GistDetailModal } from './GistDetailModal';
import { GistEditorModal } from './GistEditorModal';
import { useGistActions, type GistCreateInput, type GistUpdateInput } from '../features/gists/hooks/useGistActions';
import { useAppStore } from '../store/useAppStore';
import type { Gist, GistCategoryId } from '../types';
import { filterAndSortGists, getGistCategoryItems } from '../utils/gistUtils';

const categoryIcons = {
  all: FileCode2,
  starred: Star,
  mine: User,
};

const sortOptions = ['updated', 'created', 'name', 'files'] as const;
const gistCategories: GistCategoryId[] = ['all', 'starred', 'mine'];

export const GistView: React.FC = () => {
  const {
    user,
    gists,
    starredGists,
    gistSearchFilters,
    gistSearchResults,
    selectedGistCategory,

    setGistSearchFilters,
    setGistSearchResults,
    setSelectedGistCategory,
    setStarredGists,
    isRefreshing,
    isSearching,
    isAnalyzingAll,
    refreshGists,
    aiSearch: runAiSearch,
    analyzeVisibleGists,
    fetchGistDetail,
    submitGist,
  } = useGistActions();
  const t = useT('gists');
  const [query, setQuery] = useState(gistSearchFilters.query);
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

  const basicSearch = () => {
    setGistSearchFilters({ query });
  };

  const aiSearch = () => {
    void runAiSearch(query, currentCategoryItems, () => {
      aiRerankedRef.current = true;
    });
  };

  const openDetail = async (gist: Gist) => {
    const requestSeq = ++detailRequestSeqRef.current;
    setDetailGist(gist);
    setIsDetailOpen(true);
    const detail = await fetchGistDetail(gist);
    if (requestSeq !== detailRequestSeqRef.current || !detail) return;
    setDetailGist(detail);
  };

  const handleSubmitGist = async (input: GistCreateInput | GistUpdateInput) => {
    await submitGist(input, editingGist);
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
                    {t('gistView.gist-access-requires-the-gist-scope')}
                  </p>
                  <p className="leading-relaxed">
                    {t('gistView.if-your-private-gists-are-missing-or-you-cannot')}
                  </p>
                  <div className="absolute bottom-full left-3 -mb-px h-2 w-2 rotate-45 border-l border-t border-border bg-card dark:border-border dark:bg-card"></div>
                </div>
              </div>
            </div>
          </div>
          <div className="space-y-1">
            {gistCategories.map(categoryId => {
              const Icon = categoryIcons[categoryId];
              const active = selectedGistCategory === categoryId;
              return (
                <Button
                  key={categoryId}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setSelectedGistCategory(categoryId)}
                  variant="ghost"
                  className={`linear-settings-nav-item group flex w-full items-center justify-between px-3 py-2 text-sm text-muted-foreground hover:text-accent-foreground ${
                    active ? 'is-active' : ''
                  }`}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {t(`gistView.category-${categoryId}`)}
                  </span>
                  <span className={`font-medium ${active ? 'text-accent-foreground' : 'text-muted-foreground group-hover:text-accent-foreground'}`}>
                    {categoryItems[categoryId].length}
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
                    if (event.key === 'Enter' && !event.nativeEvent.isComposing) basicSearch();
                  }}
                  aria-label={t('gistView.search-gists-filenames-or-summaries')}
                  className="ui-field w-full py-2 pl-9 pr-9 text-sm text-foreground dark:text-foreground"
                  placeholder={t('gistView.search-gists-filenames-summaries')}
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
                    aria-label={t('gistView.clear-search')}
                    title={t('gistView.clear-search')}
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
                {t('gistView.ai-search')}
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={gistSearchFilters.sortBy}
                onValueChange={(value) => {
                  if (sortOptions.some((option) => option === value)) {
                    setGistSearchFilters({ sortBy: value as typeof sortOptions[number] });
                  }
                }}
              >
                <SelectTrigger aria-label={t('gistView.gist-sort-order')} className="ui-field h-9 w-40 px-3 py-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sortOptions.map(option => (
                    <SelectItem key={option} value={option}>
                      {t(`gistView.sort-${option}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                onClick={() => setGistSearchFilters({ sortOrder: gistSearchFilters.sortOrder === 'desc' ? 'asc' : 'desc' })}
                className="ui-button px-3 py-2 text-sm"
              >
                {gistSearchFilters.sortOrder === 'desc' ? t('gistView.desc') : t('gistView.asc')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={analyzeVisibleGists}
                disabled={isAnalyzingAll || gistSearchResults.length === 0}
                className="ui-button inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
              >
                {isAnalyzingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {t('gistView.ai-analyze')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={refreshGists}
                disabled={isRefreshing}
                className="ui-button inline-flex items-center gap-2 px-3 py-2 text-sm disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                {t('gistView.sync')}
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
                {t('gistView.new')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between text-sm text-muted-foreground dark:text-muted-foreground">
          <span>{t('gistView.v1-gists', { v1: gistSearchResults.length })}</span>
          {gistSearchFilters.query && <span>{t('gistView.search-applied')}</span>}
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
                onUnstarred={(gistId) => {
                  const latestStarred = useAppStore.getState().starredGists;
                  setStarredGists(latestStarred.filter(item => item.id !== gistId));
                }}
              />
            ))}
          </div>
        ) : (
          <div className="ui-empty-state p-12 text-center">
            {t('gistView.no-gists-yet-sync-to-fetch-data-or-create-a-new')}
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
