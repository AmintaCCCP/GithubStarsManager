



import { useT, TranslateFn } from '../i18n/useT';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, FileCode2, Loader2, RefreshCw, Search, Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../store/useAppStore';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Switch } from './ui/switch';
import { RadioGroup, RadioGroupItem } from './ui/radio-group';
import { Label } from './ui/label';
import {
  filterStarredHits,
  isGrepRateLimitError,
  sanitizeGrepSnippet,
  searchGrepApp,
  type GrepCodeHit,
  type GrepFacetBucket,
  type GrepMatchMode,
  type GrepSearchResult,
} from '../services/grepAppService';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 450;

function toggleInSet(prev: Set<string>, value: string): Set<string> {
  const next = new Set(prev);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** 分面筛选组：渲染带计数的多选 chips，超限可展开。 */
const FacetGroup: React.FC<{
  title: string;
  buckets: GrepFacetBucket[];
  selected: Set<string>;
  onToggle: (val: string) => void;
  t: TranslateFn;
  maxShown?: number;
}> = ({ title, buckets, selected, onToggle, t, maxShown = 8 }) => {
  const [expanded, setExpanded] = useState(false);
  if (buckets.length === 0) return null;
  const shown = expanded ? buckets : buckets.slice(0, maxShown);
  return (
    <div className="space-y-1.5">
      <p className="text-label-sm font-medium text-tertiary">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((bucket) => {
          const active = selected.has(bucket.val);
          return (
            <button
              key={bucket.val}
              type="button"
              onClick={() => onToggle(bucket.val)}
              aria-pressed={active}
              title={`${bucket.val} (${bucket.count})`}
              className={`inline-flex h-control-sm max-w-full items-center gap-1.5 rounded-full px-2.5 text-label-sm font-medium transition-[background-color,color] duration-micro ease-out-subtle hover:duration-instant ${
                active
                  ? 'bg-accent-tint text-accent-text shadow-[inset_0_0_0_1px_var(--accent-tint-strong)]'
                  : 'bg-fill-hover text-secondary hover:bg-fill-pressed hover:text-foreground'
              }`}
            >
              <span className="truncate">{bucket.val}</span>
              <span className="shrink-0 text-caption text-tertiary tabular-nums">{bucket.count}</span>
            </button>
          );
        })}
      </div>
      {buckets.length > maxShown && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-label-sm text-accent-text hover:underline"
        >
          {expanded ? t('codeSearchView.show-less') : t('codeSearchView.show-all-v1', { v1: buckets.length })}
        </button>
      )}
    </div>
  );
};

/** 单条代码命中卡片：消毒后的 snippet 经 innerHTML 渲染，链接均指向 GitHub。 */
const HitCard: React.FC<{ hit: GrepCodeHit; isStarred: boolean; t: TranslateFn }> = ({
  hit,
  isStarred,
  t,
}) => {
  const repo = hit.repo.trim();
  const branch = hit.branch.trim() || 'main';
  // 路径按段编码，避免空格 / # / ? 等字符破坏链接
  const encodedPath = hit.path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const fileUrl =
    repo && hit.path ? `https://github.com/${repo}/blob/${branch}/${encodedPath}` : `https://github.com/${repo}`;
  const snippet = useMemo(() => sanitizeGrepSnippet(hit.snippetHtml), [hit.snippetHtml]);
  if (!repo) return null;
  return (
    <article className="rounded-lg bg-paper p-3.5 shadow-elev-0 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover/40 hover:duration-instant">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <FileCode2 className="size-4 shrink-0 text-tertiary" />
        <a
          href={`https://github.com/${hit.repo}`}
          target="_blank"
          rel="noreferrer"
          className="truncate text-label-lg font-semibold text-accent-text hover:underline"
        >
          {hit.repo}
        </a>
        {isStarred && (
          <Badge variant="secondary" className="gap-1 border-0 bg-accent-tint text-accent-text">
            <Star className="size-3" />
            {t('codeSearchView.starred')}
          </Badge>
        )}
        <span className="text-label-sm text-tertiary font-mono">{hit.branch}</span>
        {hit.language && <Badge variant="secondary" className="border-0">{hit.language}</Badge>}
        {hit.totalMatches && (
          <span className="text-label-sm text-tertiary tabular-nums">
            {hit.totalMatches} {t('codeSearchView.matches')}
          </span>
        )}
      </div>
      <a
        href={fileUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-2 block truncate text-label-sm text-tertiary font-mono hover:text-accent-text hover:underline"
        title={hit.path}
      >
        {hit.path}
      </a>
      {snippet ? (
        <div
          className="grep-snippet overflow-x-auto rounded-md border border-subtle bg-sunken p-3 font-mono text-mono-ui leading-relaxed [&_mark]:rounded-xs [&_mark]:bg-[var(--ui-search-highlight)] [&_mark]:text-[var(--ui-search-highlight-foreground)] [&_mark]:px-0.5"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      ) : (
        <p className="text-label-sm text-tertiary">{t('codeSearchView.no-snippet-preview')}</p>
      )}
      <div className="mt-2 flex justify-end">
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-label-sm font-medium text-accent-text hover:underline"
        >
          {t('codeSearchView.view-file-on-github')}
          <ExternalLink className="size-3" />
        </a>
      </div>
    </article>
  );
};

/** 代码高级搜索视图：实时防抖查询 + 匹配模式 + 分面筛选 + 收藏过滤 + 分页。 */
export const CodeSearchView: React.FC = () => {
  const { repositories } = useAppStore(
    useShallow((state) => ({ repositories: state.repositories }))
  );
  const t = useT('app');
  // 错误文案经 ref 读取，避免纯语言切换触发网络重搜
  const tRef = useRef(t);
  tRef.current = t;

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<GrepMatchMode>('fuzzy');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [selectedLangs, setSelectedLangs] = useState<Set<string>>(new Set());
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set());
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [result, setResult] = useState<GrepSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const starredSet = useMemo(() => {
    const set = new Set<string>();
    for (const repo of repositories) {
      if (repo?.full_name) set.add(repo.full_name.toLowerCase());
    }
    return set;
  }, [repositories]);

  const runSearch = useCallback(
    async (nextPage: number, append: boolean) => {
      const q = query.trim();
      if (q.length < MIN_QUERY_LENGTH) {
        abortRef.current?.abort();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setResult(null);
        setError(null);
        setLoading(false);
        setPage(1);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = (requestIdRef.current += 1);
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await searchGrepApp(
          {
            q,
            mode,
            caseSensitive,
            langs: [...selectedLangs],
            repos: [...selectedRepos],
            paths: [...selectedPaths],
            page: nextPage,
          },
          { signal: controller.signal }
        );
        if (requestIdRef.current !== requestId) return;
        setResult((prev) =>
          append && prev
            ? { ...data, hits: [...prev.hits, ...data.hits] }
            : data
        );
        setPage(nextPage);
      } catch (err) {
        if (controller.signal.aborted || requestIdRef.current !== requestId) return;
              setError(
          isGrepRateLimitError(err)
            ? tRef.current('codeSearchView.rate-limited')
            : err instanceof Error
              ? err.message
              : tRef.current('codeSearchView.search-failed')
        );
      } finally {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [query, mode, caseSensitive, selectedLangs, selectedRepos, selectedPaths]
  );

  // 实时搜索：输入防抖后自动请求第 1 页
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < MIN_QUERY_LENGTH) {
      abortRef.current?.abort();
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      void runSearch(1, false);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, caseSensitive, selectedLangs, selectedRepos, selectedPaths, runSearch]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const visibleHits = useMemo(() => {
    if (!result) return [];
    if (!starredOnly) return result.hits;
    return filterStarredHits(result.hits, starredSet);
  }, [result, starredOnly, starredSet]);

  const hasMore = result ? result.hits.length < result.total : false;
  const hasActiveFilters =
    selectedLangs.size > 0 || selectedRepos.size > 0 || selectedPaths.size > 0 || starredOnly;
  const clearFilters = useCallback(() => {
    setSelectedLangs(new Set());
    setSelectedRepos(new Set());
    setSelectedPaths(new Set());
    setStarredOnly(false);
  }, []);

  return (
    <div className="space-y-4">
      {/* 搜索框 */}
      <div className="ui-toolbar space-y-3">
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-tertiary" />
            <Input
              type="text"
              aria-label={t('codeSearchView.code-search-keywords')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  void runSearch(1, false);
                }
                if (e.key === 'Escape') setQuery('');
              }}
              placeholder={t('codeSearchView.type-to-search-code-live-min-2-chars')}
              className="w-full pl-8 pr-8"
            />
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setQuery('')}
                aria-label={t('codeSearchView.clear')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-tertiary hover:text-foreground"
              >
                <X className="size-3.5" />
              </Button>
            )}
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(1, false);
            }}
            disabled={query.trim().length < MIN_QUERY_LENGTH || loading}
            className="shrink-0 gap-1.5"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            {t('codeSearchView.search')}
          </Button>
        </div>

        {/* 匹配模式 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-label">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as GrepMatchMode)}
            className="flex flex-wrap items-center gap-4"
            aria-label={t('codeSearchView.match-mode')}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="fuzzy" id="grep-mode-fuzzy" />
              <Label htmlFor="grep-mode-fuzzy" className="cursor-pointer text-label font-normal text-secondary">
                {t('codeSearchView.fuzzy')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="words" id="grep-mode-words" />
              <Label htmlFor="grep-mode-words" className="cursor-pointer text-label font-normal text-secondary">
                {t('codeSearchView.whole-word')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="regexp" id="grep-mode-regexp" />
              <Label htmlFor="grep-mode-regexp" className="cursor-pointer text-label font-normal text-secondary">
                {t('codeSearchView.regexp-re2')}
              </Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="grep-case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
            <Label htmlFor="grep-case" className="cursor-pointer text-label font-normal text-secondary">
              {t('codeSearchView.match-case')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="grep-starred" checked={starredOnly} onCheckedChange={setStarredOnly} />
            <Label htmlFor="grep-starred" className="flex cursor-pointer items-center gap-1 text-label font-normal text-secondary">
              <Star className="size-3.5" />
              {t('codeSearchView.starred-only')}
            </Label>
          </div>
        </div>

        {/* 动态过滤器 */}
        {result && (result.repoFacets.length > 0 || result.langFacets.length > 0 || result.pathFacets.length > 0) && (
          <div className="space-y-2.5 border-t border-subtle pt-3">
            <div className="flex items-center justify-between">
              <p className="text-label font-medium text-foreground">
                {t('codeSearchView.filters')}
                {hasActiveFilters && (
                  <span className="ml-2 text-label-sm font-normal text-tertiary">
                    {t('codeSearchView.selections-re-search-automatically')}
                  </span>
                )}
              </p>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="text-label-sm text-accent-text hover:underline">
                  {t('codeSearchView.clear-filters')}
                </button>
              )}
            </div>
            <FacetGroup
              title={t('codeSearchView.repository')}
              buckets={result.repoFacets}
              selected={selectedRepos}
              onToggle={(v) => setSelectedRepos((prev) => toggleInSet(prev, v))}
              t={t}
            />
            <FacetGroup
              title={t('codeSearchView.language')}
              buckets={result.langFacets}
              selected={selectedLangs}
              onToggle={(v) => setSelectedLangs((prev) => toggleInSet(prev, v))}
              t={t}
            />
            <FacetGroup
              title={t('codeSearchView.path')}
              buckets={result.pathFacets}
              selected={selectedPaths}
              onToggle={(v) => setSelectedPaths((prev) => toggleInSet(prev, v))}
              t={t}
            />
          </div>
        )}
      </div>

      {/* 状态区 */}
      {loading && !result && (
        <div className="flex flex-col items-center justify-center gap-3 py-14">
          <Loader2 className="size-6 animate-spin text-accent-text" />
          <p className="text-label text-secondary">{t('codeSearchView.searching-code')}</p>
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-3 rounded-lg bg-destructive-tint px-4 py-6 text-center">
          <p className="max-w-md text-label text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void runSearch(1, false)} className="gap-1.5">
            <RefreshCw className="size-3.5" />
            {t('codeSearchView.retry')}
          </Button>
        </div>
      )}
      {!loading && !error && !result && (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <Search className="size-10 stroke-[1.5] text-tertiary" />
          <p className="text-label-lg font-medium text-foreground">{t('codeSearchView.code-search')}</p>
          <p className="max-w-sm text-label text-secondary">
            {t('codeSearchView.full-text-code-search-across-public-repos-with-f')}
          </p>
        </div>
      )}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-label-sm text-tertiary tabular-nums">
            <span>
              {t('codeSearchView.total')} <strong className="font-medium text-foreground">{starredOnly ? visibleHits.length : result.total}</strong>{' '}
              {t('codeSearchView.results')}
              {starredOnly && (
                <span className="ml-1">
                  {t('codeSearchView.starred-filter-v1-total', { v1: result.total })}
                </span>
              )}
              {loading && <span className="ml-2">{t('codeSearchView.searching')}</span>}
            </span>
          </div>
          {visibleHits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg bg-paper py-12 text-center shadow-elev-0">
              <Star className="size-10 stroke-[1.5] text-tertiary" />
              <p className="text-label text-secondary">
                {starredOnly
                  ? t('codeSearchView.no-hits-in-starred-repos-try-turning-off-starred')
                  : t('codeSearchView.no-matches-try-another-keyword-or-looser-filters')}
              </p>
              {starredOnly && (
                <Button variant="secondary" size="sm" onClick={() => setStarredOnly(false)}>
                  {t('codeSearchView.turn-off-starred-only')}
                </Button>
              )}
            </div>
          ) : (
            visibleHits.map((hit, index) => (
              <HitCard
                key={`${hit.repo}@${hit.path}#${index}`}
                hit={hit}
                isStarred={starredSet.has(hit.repo.toLowerCase())}
                t={t}
              />
            ))
          )}
          {loadingMore && (
            <div className="flex items-center justify-center gap-2 py-4 text-label-sm text-tertiary">
              <Loader2 className="size-4 animate-spin" />
              {t('codeSearchView.loading-more')}
            </div>
          )}
          {!loadingMore && hasMore && (visibleHits.length > 0 || starredOnly) && (
            <div className="flex justify-center pt-1">
              <Button
                variant="secondary"
                onClick={() => void runSearch(page + 1, true)}
                disabled={loading}
                className="gap-1.5 tabular-nums"
              >
                {t('codeSearchView.load-more-v1-v2', { v1: result.hits.length, v2: result.total })}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

CodeSearchView.displayName = 'CodeSearchView';
