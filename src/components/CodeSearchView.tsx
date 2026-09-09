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

const FacetGroup: React.FC<{
  title: string;
  buckets: GrepFacetBucket[];
  selected: Set<string>;
  onToggle: (val: string) => void;
  t: (zh: string, en: string) => string;
  maxShown?: number;
}> = ({ title, buckets, selected, onToggle, t, maxShown = 8 }) => {
  const [expanded, setExpanded] = useState(false);
  if (buckets.length === 0) return null;
  const shown = expanded ? buckets : buckets.slice(0, maxShown);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-muted-foreground">{title}</p>
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
              className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-muted/50 text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <span className="truncate">{bucket.val}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px]">{bucket.count}</span>
            </button>
          );
        })}
      </div>
      {buckets.length > maxShown && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-primary hover:underline"
        >
          {expanded ? t('收起', 'Show less') : t(`展开全部 ${buckets.length} 项`, `Show all ${buckets.length}`)}
        </button>
      )}
    </div>
  );
};

const HitCard: React.FC<{ hit: GrepCodeHit; isStarred: boolean; t: (zh: string, en: string) => string }> = ({
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
    <article className="rounded-xl border border-border/60 bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <FileCode2 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <a
          href={`https://github.com/${hit.repo}`}
          target="_blank"
          rel="noreferrer"
          className="truncate text-sm font-semibold text-primary hover:underline"
        >
          {hit.repo}
        </a>
        {isStarred && (
          <Badge variant="secondary" className="gap-1">
            <Star className="h-3 w-3" />
            {t('已收藏', 'Starred')}
          </Badge>
        )}
        <span className="text-xs text-muted-foreground">{hit.branch}</span>
        {hit.language && <Badge variant="outline">{hit.language}</Badge>}
        {hit.totalMatches && (
          <span className="text-xs text-muted-foreground">
            {hit.totalMatches} {t('处匹配', 'matches')}
          </span>
        )}
      </div>
      <a
        href={fileUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-2 block truncate text-xs text-muted-foreground hover:text-primary hover:underline"
        title={hit.path}
      >
        {hit.path}
      </a>
      {snippet ? (
        <div
          className="grep-snippet overflow-x-auto rounded-lg border border-border/50 bg-muted/40 p-2 text-xs leading-relaxed [&_mark]:rounded [&_mark]:bg-yellow-200 [&_mark]:px-0.5 dark:[&_mark]:bg-yellow-500/40"
          dangerouslySetInnerHTML={{ __html: snippet }}
        />
      ) : (
        <p className="text-xs text-muted-foreground">{t('无片段预览', 'No snippet preview')}</p>
      )}
      <div className="mt-2 flex justify-end">
        <a
          href={fileUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          {t('在 GitHub 查看文件', 'View file on GitHub')}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </article>
  );
};

export const CodeSearchView: React.FC = () => {
  const { repositories, language } = useAppStore(
    useShallow((state) => ({ repositories: state.repositories, language: state.language }))
  );
  const t = useCallback((zh: string, en: string) => (language === 'zh' ? zh : en), [language]);
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
        const translate = tRef.current;
        setError(
          isGrepRateLimitError(err)
            ? translate('触发 grep.app 限流（429），请稍后重试', 'grep.app rate limited (429), please retry later')
            : err instanceof Error
              ? err.message
              : translate('搜索失败，请重试', 'Search failed, please retry')
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
      <div className="ui-toolbar space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              aria-label={t('代码搜索关键词', 'Code search keywords')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  if (debounceRef.current) clearTimeout(debounceRef.current);
                  void runSearch(1, false);
                }
                if (e.key === 'Escape') setQuery('');
              }}
              placeholder={t('输入关键字实时搜索代码…（至少 2 个字符）', 'Type to search code live… (min 2 chars)')}
              className="ui-field h-auto w-full py-2.5 pl-10 pr-9"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label={t('清空', 'Clear')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            onClick={() => {
              if (debounceRef.current) clearTimeout(debounceRef.current);
              void runSearch(1, false);
            }}
            disabled={query.trim().length < MIN_QUERY_LENGTH || loading}
            className="shrink-0 gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {t('搜索', 'Search')}
          </Button>
        </div>

        {/* 匹配模式 */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <RadioGroup
            value={mode}
            onValueChange={(v) => setMode(v as GrepMatchMode)}
            className="flex flex-wrap items-center gap-4"
            aria-label={t('匹配模式', 'Match mode')}
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="fuzzy" id="grep-mode-fuzzy" />
              <Label htmlFor="grep-mode-fuzzy" className="cursor-pointer text-sm font-normal">
                {t('模糊', 'Fuzzy')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="words" id="grep-mode-words" />
              <Label htmlFor="grep-mode-words" className="cursor-pointer text-sm font-normal">
                {t('全词精确', 'Whole word')}
              </Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="regexp" id="grep-mode-regexp" />
              <Label htmlFor="grep-mode-regexp" className="cursor-pointer text-sm font-normal">
                {t('正则 (RE2)', 'Regexp (RE2)')}
              </Label>
            </div>
          </RadioGroup>
          <div className="flex items-center gap-2">
            <Switch id="grep-case" checked={caseSensitive} onCheckedChange={setCaseSensitive} />
            <Label htmlFor="grep-case" className="cursor-pointer text-sm font-normal">
              {t('区分大小写', 'Match case')}
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="grep-starred" checked={starredOnly} onCheckedChange={setStarredOnly} />
            <Label htmlFor="grep-starred" className="flex cursor-pointer items-center gap-1 text-sm font-normal">
              <Star className="h-3.5 w-3.5" />
              {t('只显示我收藏的仓库', 'Starred only')}
            </Label>
          </div>
        </div>

        {/* 动态过滤器 */}
        {result && (result.repoFacets.length > 0 || result.langFacets.length > 0 || result.pathFacets.length > 0) && (
          <div className="space-y-3 border-t border-border/60 pt-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {t('筛选', 'Filters')}
                {hasActiveFilters && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {t('勾选后自动重新搜索', 'Selections re-search automatically')}
                  </span>
                )}
              </p>
              {hasActiveFilters && (
                <button type="button" onClick={clearFilters} className="text-xs text-primary hover:underline">
                  {t('清空筛选', 'Clear filters')}
                </button>
              )}
            </div>
            <FacetGroup
              title={t('仓库', 'Repository')}
              buckets={result.repoFacets}
              selected={selectedRepos}
              onToggle={(v) => setSelectedRepos((prev) => toggleInSet(prev, v))}
              t={t}
            />
            <FacetGroup
              title={t('语言', 'Language')}
              buckets={result.langFacets}
              selected={selectedLangs}
              onToggle={(v) => setSelectedLangs((prev) => toggleInSet(prev, v))}
              t={t}
            />
            <FacetGroup
              title={t('路径', 'Path')}
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
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t('正在搜索 grep.app…', 'Searching grep.app…')}</p>
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 py-8 text-center">
          <p className="max-w-md text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={() => void runSearch(1, false)} className="gap-2">
            <RefreshCw className="h-3.5 w-3.5" />
            {t('重试', 'Retry')}
          </Button>
        </div>
      )}
      {!loading && !error && !result && (
        <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
          <Search className="h-8 w-8 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">{t('高级搜索', 'Code Search')}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t(
              '基于 grep.app 的公开仓库代码检索，支持模糊 / 全词 / 正则与仓库·路径·语言过滤。',
              'Public code search via grep.app with fuzzy / whole-word / regexp and repo·path·language facets.'
            )}
          </p>
        </div>
      )}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span>
              {t('共', 'Total')} <strong className="text-foreground">{starredOnly ? visibleHits.length : result.total}</strong>{' '}
              {t('条结果', 'results')}
              {starredOnly && (
                <span className="ml-1">
                  {t(`（已按收藏过滤，全网 ${result.total} 条）`, `(starred filter, ${result.total} total)`)}
                </span>
              )}
              {loading && <span className="ml-2">{t('搜索中…', 'Searching…')}</span>}
            </span>
          </div>
          {visibleHits.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 py-12 text-center">
              <Star className="h-6 w-6 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                {starredOnly
                  ? t('收藏的仓库中没有命中，试试关闭“只显示我收藏的仓库”', 'No hits in starred repos, try turning off starred-only')
                  : t('没有匹配结果，换个关键词或放宽过滤器试试', 'No matches, try another keyword or looser filters')}
              </p>
              {starredOnly && (
                <Button variant="outline" size="sm" onClick={() => setStarredOnly(false)}>
                  {t('关闭收藏过滤', 'Turn off starred-only')}
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
            <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('正在加载更多…', 'Loading more…')}
            </div>
          )}
          {!loadingMore && hasMore && visibleHits.length > 0 && (
            <div className="flex justify-center pt-1">
              <Button
                variant="outline"
                onClick={() => void runSearch(page + 1, true)}
                disabled={loading}
                className="gap-2"
              >
                {t(`加载更多（已加载 ${result.hits.length}/${result.total}）`, `Load more (${result.hits.length}/${result.total})`)}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

CodeSearchView.displayName = 'CodeSearchView';
