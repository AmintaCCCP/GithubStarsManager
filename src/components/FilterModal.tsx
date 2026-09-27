import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Check, Search, HelpCircle, AlertTriangle, PlusCircle, MinusCircle, FolderGit2, Package } from 'lucide-react';
import { Modal } from './Modal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { AssetFilter } from '../types';
import { useAppStore } from '../store/useAppStore';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../i18n/useT';
import { normalizeRepoKey, resolveReleaseSources } from '../utils/releaseSources';
import { cn } from '../lib/utils';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  filter?: AssetFilter;
  onSave: (filter: AssetFilter) => void;
}

type FilterTab = 'assets' | 'repos';
type RepoPickerTarget = 'include' | 'exclude';

/** 关键词 chip 列表：白名单/黑名单共用同一中性样式；仓库 chip 可携带冲突态 */
const KeywordChips: React.FC<{
  items: string[];
  removeLabel: (item: string) => string;
  onRemove: (index: number) => void;
  isConflicting?: (item: string) => boolean;
  conflictTitle?: string;
}> = ({ items, removeLabel, onRemove, isConflicting, conflictTitle }) => {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => {
        const conflicting = isConflicting?.(item) ?? false;
        return (
          <div
            key={`${item}-${index}`}
            title={conflicting ? conflictTitle : undefined}
            className={cn(
              'flex items-center gap-1 rounded-md border bg-muted px-2 py-1',
              conflicting
                ? 'border-amber-500/70 dark:border-amber-500/70'
                : 'border-border'
            )}
          >
            <Badge
              variant="secondary"
              className="h-auto rounded-sm border-0 bg-transparent px-0 text-sm font-medium text-secondary-foreground"
            >
              {item}
            </Badge>
            {conflicting && conflictTitle && (
              <>
                <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-500" aria-hidden="true" />
                <span className="sr-only">{conflictTitle}</span>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(index)}
              aria-label={removeLabel(item)}
              className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
            </Button>
          </div>
        );
      })}
    </div>
  );
};

/** 字段说明：问号图标 + 悬停提示（全局 TooltipProvider 见 main.tsx） */
const FieldHint: React.FC<{ text: string }> = ({ text }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        aria-label={text}
        className="flex h-4 w-4 shrink-0 cursor-help items-center justify-center rounded-full text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground transition-colors"
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </TooltipTrigger>
    <TooltipContent side="top" className="max-w-72 whitespace-normal break-words text-left">
      {text}
    </TooltipContent>
  </Tooltip>
);

/** 仓库选择器：在所属区块内原地展开，搜索 + 多选列表 + 已选计数 */
const RepoPickerPanel: React.FC<{
  title: string;
  accent: 'primary' | 'destructive';
  search: string;
  onSearchChange: (value: string) => void;
  options: string[];
  hasReleaseRepos: boolean;
  noReleaseReposText: string;
  emptyText: string;
  searchPlaceholder: string;
  selectedCountText: string;
  selected: string[];
  isSelected: (fullName: string) => boolean;
  onToggle: (fullName: string) => void;
}> = ({
  title,
  accent,
  search,
  onSearchChange,
  options,
  hasReleaseRepos,
  noReleaseReposText,
  emptyText,
  searchPlaceholder,
  selectedCountText,
  selected,
  isSelected,
  onToggle,
}) => (
  <div
    role="group"
    aria-label={title}
    className={cn(
      'mt-3 rounded-lg border p-3',
      accent === 'primary'
        ? 'border-primary/40 bg-primary/5 dark:border-primary/40 dark:bg-primary/5'
        : 'border-destructive/40 bg-destructive/5 dark:border-destructive/40 dark:bg-destructive/5',
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <p
        className={cn(
          'text-sm font-medium',
          accent === 'primary' ? 'text-primary dark:text-primary' : 'text-destructive dark:text-destructive',
        )}
      >
        {title}
      </p>
      {selected.length > 0 && (
        <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full whitespace-nowrap">
          {selectedCountText}
        </span>
      )}
    </div>

    <div className="relative mt-3">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
      <Input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        autoFocus
        className="w-full pl-8 pr-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card dark:bg-muted/40 text-foreground dark:text-foreground"
      />
    </div>

    <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border dark:border-border" role="listbox" aria-multiselectable="true">
      {!hasReleaseRepos ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground dark:text-muted-foreground">
          {noReleaseReposText}
        </p>
      ) : options.length === 0 ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground dark:text-muted-foreground">
          {emptyText}
        </p>
      ) : (
        options.map((fullName) => {
          const checked = isSelected(fullName);
          return (
            <button
              type="button"
              key={fullName}
              role="option"
              aria-selected={checked}
              onClick={() => onToggle(fullName)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-accent dark:hover:bg-accent transition-colors"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border shadow-sm transition-colors',
                  checked
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border dark:border-border bg-card'
                )}
              >
                {checked && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground dark:text-foreground" title={fullName}>
                {fullName}
              </span>
            </button>
          );
        })
      )}
    </div>
  </div>
);

export const FilterModal: React.FC<FilterModalProps> = ({
  isOpen,
  onClose,
  filter,
  onSave
}) => {
  const t = useT('app');
  const tModal = (key: string, params?: Record<string, unknown>) =>
    t(`assetFilterManager.filterModal.${key}`, params);

  const { repositories, releaseSubscriptions, releaseSourceSettings } = useAppStore(useShallow((state) => ({
    repositories: state.repositories,
    releaseSubscriptions: state.releaseSubscriptions,
    releaseSourceSettings: state.releaseSourceSettings,
  })));

  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [excludeKeywords, setExcludeKeywords] = useState<string[]>([]);
  const [includeRepos, setIncludeRepos] = useState<string[]>([]);
  const [alwaysExcludeRepos, setAlwaysExcludeRepos] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [newExcludeKeyword, setNewExcludeKeyword] = useState('');
  const [activeTab, setActiveTab] = useState<FilterTab>('assets');
  const [repoPickerTarget, setRepoPickerTarget] = useState<RepoPickerTarget | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

  useEffect(() => {
    if (filter) {
      setName(filter.name);
      setKeywords([...filter.keywords]);
      setExcludeKeywords([...(filter.excludeKeywords ?? [])]);
      setIncludeRepos([...(filter.includeRepos ?? [])]);
      setAlwaysExcludeRepos([...(filter.alwaysExcludeRepos ?? [])]);
    } else {
      setName('');
      setKeywords([]);
      setExcludeKeywords([]);
      setIncludeRepos([]);
      setAlwaysExcludeRepos([]);
    }
    setNewKeyword('');
    setNewExcludeKeyword('');
    // 重置清单包含当前标签与选择器状态：重开弹窗总是回到「资产过滤」
    setActiveTab('assets');
    setRepoPickerTarget(null);
    setRepoSearch('');
  }, [filter, isOpen]);

  // 所有已关注 Release 的仓库（星标订阅 + 追更 + 自定义来源），按 full_name 去重排序
  const releaseRepos = useMemo(() =>
    resolveReleaseSources({ repositories, releaseSubscriptions, releaseSourceSettings })
      .repositories
      .map(repo => repo.full_name)
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())),
  [repositories, releaseSubscriptions, releaseSourceSettings]);

  const filteredRepoOptions = useMemo(() => {
    const query = repoSearch.trim().toLowerCase();
    if (!query) return releaseRepos;
    return releaseRepos.filter(fullName => fullName.toLowerCase().includes(query));
  }, [releaseRepos, repoSearch]);

  const isRepoIncluded = (fullName: string) =>
    includeRepos.some(name => normalizeRepoKey(name) === normalizeRepoKey(fullName));

  const toggleRepoIncluded = (fullName: string) => {
    setIncludeRepos(prev => (
      isRepoIncluded(fullName)
        ? prev.filter(name => normalizeRepoKey(name) !== normalizeRepoKey(fullName))
        : [...prev, fullName]
    ));
  };

  const isRepoExcluded = (fullName: string) =>
    alwaysExcludeRepos.some(name => normalizeRepoKey(name) === normalizeRepoKey(fullName));

  const toggleRepoExcluded = (fullName: string) => {
    setAlwaysExcludeRepos(prev => (
      isRepoExcluded(fullName)
        ? prev.filter(name => normalizeRepoKey(name) !== normalizeRepoKey(fullName))
        : [...prev, fullName]
    ));
  };

  // 同一仓库同时出现在两组是合法草稿态：展示冲突提示（排除优先），不静默清理
  const isRepoConflicting = (fullName: string) =>
    isRepoIncluded(fullName) && isRepoExcluded(fullName);

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    // 关键词匹配大小写不敏感，添加去重同样不区分大小写
    if (trimmed && !keywords.some(k => k.toLowerCase() === trimmed.toLowerCase())) {
      setKeywords([...keywords, trimmed]);
      setNewKeyword('');
    }
  };

  const addExcludeKeyword = () => {
    const trimmed = newExcludeKeyword.trim();
    if (trimmed && !excludeKeywords.some(k => k.toLowerCase() === trimmed.toLowerCase())) {
      setExcludeKeywords([...excludeKeywords, trimmed]);
      setNewExcludeKeyword('');
    }
  };

  const handleKeyPress = (
    e: React.KeyboardEvent,
    addFn: () => void
  ) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      addFn();
    }
  };

  // 名称必填且至少配置一项规则（资产关键词、排除关键词、包含仓库或排除仓库），
  // 避免一个空过滤器被启用后意外匹配所有内容；保存守卫与按钮状态共用该派生值
  const canSave = name.trim().length > 0 &&
    (keywords.length > 0 || excludeKeywords.length > 0 ||
      includeRepos.length > 0 || alwaysExcludeRepos.length > 0);

  const handleSave = () => {
    if (!canSave) {
      return;
    }

    // 四个数组始终写回（允许空数组）：updateAssetFilter 是 spread 合并，
    // 省略键会导致清空后的黑名单/始终包含/始终排除仓库残留旧值。
    const savedFilter: AssetFilter = {
      id: filter?.id || Date.now().toString(),
      name: name.trim(),
      keywords: keywords.filter(k => k.trim()),
      excludeKeywords: excludeKeywords.filter(k => k.trim()),
      includeRepos: includeRepos.filter(r => r.trim()),
      alwaysExcludeRepos: alwaysExcludeRepos.filter(r => r.trim())
    };

    onSave(savedFilter);
    onClose();
  };

  const keywordInputClass = 'flex-1 px-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card dark:bg-muted/40 text-foreground dark:text-foreground';

  const assetRuleCount = keywords.length + excludeKeywords.length;
  const repoRuleCount = includeRepos.length + alwaysExcludeRepos.length;

  // 仓库过滤标签：两个独立区块（包含=主色、排除=红色），选择器在所属区块内
  // 原地展开，归属一目了然；同一时间最多展开一个
  const renderRepoSection = (target: RepoPickerTarget) => {
    const isInclude = target === 'include';
    const items = isInclude ? includeRepos : alwaysExcludeRepos;
    const pickerOpen = repoPickerTarget === target;
    return (
      <section
        aria-label={isInclude ? tModal('include-repos-label') : tModal('exclude-repos-label')}
        className={cn(
          'rounded-lg border p-3 transition-colors',
          pickerOpen
            ? isInclude
              ? 'border-primary/50 dark:border-primary/50'
              : 'border-destructive/50 dark:border-destructive/50'
            : 'border-border dark:border-border',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isInclude
              ? <PlusCircle className="h-4 w-4 shrink-0 text-primary dark:text-primary" aria-hidden="true" />
              : <MinusCircle className="h-4 w-4 shrink-0 text-destructive dark:text-destructive" aria-hidden="true" />}
            <span className="block text-sm font-medium text-foreground dark:text-foreground">
              {isInclude ? tModal('include-repos-label') : tModal('exclude-repos-label')}
            </span>
            <FieldHint text={isInclude ? tModal('include-repos-note') : tModal('exclude-repos-note')} />
          </div>
          <Button
            onClick={() => setRepoPickerTarget(pickerOpen ? null : target)}
            disabled={releaseRepos.length === 0}
            title={releaseRepos.length === 0 ? tModal('repo-picker-no-release-repos') : undefined}
            aria-pressed={pickerOpen}
            className={cn(
              'flex items-center space-x-1 px-3 py-1.5 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
              pickerOpen
                ? 'bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground hover:bg-accent dark:hover:bg-accent'
                : isInclude
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 dark:bg-primary/15 dark:text-primary dark:hover:bg-primary/25'
                  : 'bg-destructive/10 text-destructive hover:bg-destructive/20 dark:bg-destructive/15 dark:text-destructive dark:hover:bg-destructive/25',
            )}
          >
            <span>{pickerOpen ? tModal('repo-picker-done') : (isInclude ? tModal('add-include-repos') : tModal('add-exclude-repos'))}</span>
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="mt-2">
            <KeywordChips
              items={items}
              removeLabel={(repo) => isInclude
                ? tModal('remove-include-repo-aria', { repo })
                : tModal('remove-exclude-repo-aria', { repo })}
              onRemove={(index) => (isInclude ? setIncludeRepos : setAlwaysExcludeRepos)(items.filter((_, i) => i !== index))}
              isConflicting={isRepoConflicting}
              conflictTitle={tModal('repo-conflict-hint')}
            />
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground dark:text-muted-foreground">
            {isInclude ? tModal('include-repos-empty') : tModal('exclude-repos-empty')}
          </p>
        )}

        {pickerOpen && (
          <RepoPickerPanel
            title={isInclude ? tModal('repo-picker-title') : tModal('repo-picker-title-exclude')}
            accent={isInclude ? 'primary' : 'destructive'}
            search={repoSearch}
            onSearchChange={setRepoSearch}
            options={filteredRepoOptions}
            hasReleaseRepos={releaseRepos.length > 0}
            noReleaseReposText={tModal('repo-picker-no-release-repos')}
            emptyText={tModal('repo-picker-empty')}
            searchPlaceholder={tModal('repo-picker-search-placeholder')}
            selectedCountText={tModal('repo-picker-selected-count', { count: items.length })}
            selected={items}
            isSelected={isInclude ? isRepoIncluded : isRepoExcluded}
            onToggle={isInclude ? toggleRepoIncluded : toggleRepoExcluded}
          />
        )}
      </section>
    );
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={filter ? tModal('title-edit') : tModal('title-new')}
      maxWidth="max-w-2xl"
      scrollable
      footer={
        <div className="flex justify-end space-x-3">
          <Button
            onClick={onClose}
            className="px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 dark:border dark:border-border rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors"
          >
            {tModal('cancel')}
          </Button>
          <Button
            onClick={handleSave}
            disabled={!canSave}
            className={`px-4 py-2 rounded-lg transition-colors ${canSave ? 'bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary' : 'bg-muted text-muted-foreground dark:bg-card/5 dark:text-muted-foreground cursor-not-allowed'}`}
          >
            {filter ? tModal('save') : tModal('create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Filter Name */}
        <div>
          <label htmlFor="filter-name" className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            {tModal('name-label')}
          </label>
          <Input
            id="filter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tModal('name-placeholder')}
            className="w-full px-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card dark:bg-muted/40 text-foreground dark:text-foreground"
          />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FilterTab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="assets" className="gap-1.5">
              <Package className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{tModal('tab-assets')} · {assetRuleCount}</span>
            </TabsTrigger>
            <TabsTrigger value="repos" className="gap-1.5">
              <FolderGit2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{tModal('tab-repos')} · {repoRuleCount}</span>
            </TabsTrigger>
          </TabsList>

          {!canSave && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {tModal('save-no-rules-hint')}
            </p>
          )}

          {/* 资产过滤 */}
          <TabsContent value="assets" className="space-y-4">
            {/* Include keywords（白名单） */}
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <label htmlFor="filter-keywords" className="block text-sm font-medium text-foreground dark:text-foreground">
                  {tModal('include-keywords-label')}
                </label>
                <FieldHint text={tModal('tip-body')} />
              </div>

              <div className="flex space-x-2 mb-3">
                <Input
                  id="filter-keywords"
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, addKeyword)}
                  placeholder={tModal('keyword-input-placeholder')}
                  className={keywordInputClass}
                />
                <Button
                  onClick={addKeyword}
                  disabled={!newKeyword.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{tModal('add')}</span>
                </Button>
              </div>

              <KeywordChips
                items={keywords}
                removeLabel={(item) => tModal('remove-keyword-aria', { keyword: item })}
                onRemove={(index) => setKeywords(keywords.filter((_, i) => i !== index))}
              />

              {keywords.length === 0 && (
                <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                  {tModal('include-keywords-hint')}
                </p>
              )}
            </div>

            {/* Exclude keywords（黑名单） */}
            <div>
              <div className="mb-2 flex items-center gap-1.5">
                <label htmlFor="filter-exclude-keywords" className="block text-sm font-medium text-foreground dark:text-foreground">
                  {tModal('exclude-keywords-label')}
                </label>
                <FieldHint text={tModal('exclude-keywords-hint')} />
              </div>

              <div className="flex space-x-2 mb-3">
                <Input
                  id="filter-exclude-keywords"
                  type="text"
                  value={newExcludeKeyword}
                  onChange={(e) => setNewExcludeKeyword(e.target.value)}
                  onKeyDown={(e) => handleKeyPress(e, addExcludeKeyword)}
                  placeholder={tModal('keyword-input-placeholder')}
                  className={keywordInputClass}
                />
                <Button
                  onClick={addExcludeKeyword}
                  disabled={!newExcludeKeyword.trim()}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>{tModal('add')}</span>
                </Button>
              </div>

              <KeywordChips
                items={excludeKeywords}
                removeLabel={(item) => tModal('remove-keyword-aria', { keyword: item })}
                onRemove={(index) => setExcludeKeywords(excludeKeywords.filter((_, i) => i !== index))}
              />
            </div>
          </TabsContent>

          {/* 仓库过滤 */}
          <TabsContent value="repos" className="space-y-4">
            {renderRepoSection('include')}
            {renderRepoSection('exclude')}
          </TabsContent>
        </Tabs>
      </div>
    </Modal>
  );
};
