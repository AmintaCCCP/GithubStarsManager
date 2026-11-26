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
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, index) => {
        const conflicting = isConflicting?.(item) ?? false;
        return (
          <div
            key={`${item}-${index}`}
            title={conflicting ? conflictTitle : undefined}
            className={cn(
              'inline-flex h-6 items-center gap-1 rounded-xs bg-fill-hover px-2',
              conflicting
                ? 'shadow-[inset_0_0_0_1px_hsl(var(--warning))]'
                : 'shadow-[inset_0_0_0_1px_var(--border-subtle)]'
            )}
          >
            <Badge
              variant="secondary"
              className="h-auto rounded-xs border-0 bg-transparent px-0 text-label-sm font-medium text-foreground"
            >
              {item}
            </Badge>
            {conflicting && conflictTitle && (
              <>
                <AlertTriangle className="size-3 text-warning" aria-hidden="true" />
                <span className="sr-only">{conflictTitle}</span>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onRemove(index)}
              aria-label={removeLabel(item)}
              className="size-5 rounded-xs p-0 text-tertiary hover:text-foreground"
            >
              <X className="size-3" />
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
        className="flex size-4 shrink-0 cursor-help items-center justify-center rounded-full text-tertiary hover:text-foreground transition-colors"
      >
        <HelpCircle className="size-3.5" aria-hidden="true" />
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
      'mt-3 rounded-lg p-3',
      accent === 'primary'
        ? 'bg-accent-tint shadow-[inset_0_0_0_1px_var(--accent-tint-strong)]'
        : 'bg-destructive-tint shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--destructive-solid)_28%,transparent)]',
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <p
        className={cn(
          'text-label font-medium',
          accent === 'primary' ? 'text-accent-text' : 'text-destructive',
        )}
      >
        {title}
      </p>
      {selected.length > 0 && (
        <span className="inline-flex h-5 items-center rounded-xs bg-accent-solid px-1.5 text-caption text-on-accent tabular-nums whitespace-nowrap">
          {selectedCountText}
        </span>
      )}
    </div>

    <div className="relative mt-2.5">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-tertiary" aria-hidden="true" />
      <Input
        type="text"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        aria-label={searchPlaceholder}
        autoFocus
        className="h-control-lg w-full pl-8 pr-3 text-label"
      />
    </div>

    <div className="mt-2 max-h-60 divide-y divide-separator overflow-y-auto rounded-md bg-paper shadow-elev-0" role="listbox" aria-multiselectable="true">
      {!hasReleaseRepos ? (
        <p className="px-3 py-6 text-center text-label text-secondary">
          {noReleaseReposText}
        </p>
      ) : options.length === 0 ? (
        <p className="px-3 py-6 text-center text-label text-secondary">
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
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-fill-hover"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-4 shrink-0 items-center justify-center rounded-xs border transition-colors',
                  checked
                    ? 'border-primary bg-accent-solid text-on-accent'
                    : 'border-control bg-transparent'
                )}
              >
                {checked && <Check className="size-3" strokeWidth={2.5} />}
              </span>
              <span className="min-w-0 flex-1 truncate text-label text-foreground" title={fullName}>
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
      id: filter?.id || `custom-${Date.now()}`,
      name: name.trim(),
      keywords: keywords.filter(k => k.trim()),
      excludeKeywords: excludeKeywords.filter(k => k.trim()),
      includeRepos: includeRepos.filter(r => r.trim()),
      alwaysExcludeRepos: alwaysExcludeRepos.filter(r => r.trim())
    };

    onSave(savedFilter);
    onClose();
  };

  const keywordInputClass = 'h-control-lg flex-1 text-label';

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
          'rounded-lg bg-raised p-3.5 transition-shadow',
          pickerOpen
            ? isInclude
              ? 'shadow-[0_0_0_1px_var(--focus-ring)]'
              : 'shadow-[0_0_0_1px_var(--destructive-text)]'
            : 'shadow-elev-0',
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {isInclude
              ? <PlusCircle className="size-4 shrink-0 text-accent-text" aria-hidden="true" />
              : <MinusCircle className="size-4 shrink-0 text-destructive" aria-hidden="true" />}
            <span className="block text-label font-medium text-foreground">
              {isInclude ? tModal('include-repos-label') : tModal('exclude-repos-label')}
            </span>
            <FieldHint text={isInclude ? tModal('include-repos-note') : tModal('exclude-repos-note')} />
          </div>
          <Button
            type="button"
            variant={pickerOpen ? 'outline' : 'ghost'}
            size="sm"
            onClick={() => setRepoPickerTarget(pickerOpen ? null : target)}
            disabled={releaseRepos.length === 0}
            title={releaseRepos.length === 0 ? tModal('repo-picker-no-release-repos') : undefined}
            aria-pressed={pickerOpen}
            className={cn(
              'h-control-sm rounded-sm px-2.5 text-label-sm',
              pickerOpen
                ? 'text-secondary hover:text-foreground'
                : isInclude
                  ? 'bg-accent-tint text-accent-text hover:bg-accent-tint-strong'
                  : 'bg-destructive-tint text-destructive hover:bg-destructive-tint',
            )}
          >
            <span>{pickerOpen ? tModal('repo-picker-done') : (isInclude ? tModal('add-include-repos') : tModal('add-exclude-repos'))}</span>
          </Button>
        </div>

        {items.length > 0 ? (
          <div className="mt-2.5">
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
          <p className="mt-2 text-label-sm text-tertiary">
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
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="md"
            onClick={onClose}
          >
            {tModal('cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={handleSave}
            disabled={!canSave}
          >
            {filter ? tModal('save') : tModal('create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Filter Name */}
        <div>
          <label htmlFor="filter-name" className="mb-1.5 block text-label font-medium text-foreground">
            {tModal('name-label')}
          </label>
          <Input
            id="filter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={tModal('name-placeholder')}
            className="h-control-lg w-full text-label"
          />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FilterTab)}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="assets" className="gap-1.5 tabular-nums">
              <Package className="size-3.5" aria-hidden="true" />
              <span>{tModal('tab-assets')} · {assetRuleCount}</span>
            </TabsTrigger>
            <TabsTrigger value="repos" className="gap-1.5 tabular-nums">
              <FolderGit2 className="size-3.5" aria-hidden="true" />
              <span>{tModal('tab-repos')} · {repoRuleCount}</span>
            </TabsTrigger>
          </TabsList>

          {!canSave && (
            <p className="mt-2 flex items-center gap-1.5 text-label-sm text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              {tModal('save-no-rules-hint')}
            </p>
          )}

          {/* 资产过滤 */}
          <TabsContent value="assets" className="space-y-4">
            {/* Include keywords（白名单） */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <label htmlFor="filter-keywords" className="block text-label font-medium text-foreground">
                  {tModal('include-keywords-label')}
                </label>
                <FieldHint text={tModal('tip-body')} />
              </div>

              <div className="mb-2.5 flex items-center gap-2">
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
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={addKeyword}
                  disabled={!newKeyword.trim()}
                >
                  <Plus className="size-3.5" />
                  <span>{tModal('add')}</span>
                </Button>
              </div>

              <KeywordChips
                items={keywords}
                removeLabel={(item) => tModal('remove-keyword-aria', { keyword: item })}
                onRemove={(index) => setKeywords(keywords.filter((_, i) => i !== index))}
              />

              {keywords.length === 0 && (
                <p className="text-label-sm text-tertiary">
                  {tModal('include-keywords-hint')}
                </p>
              )}
            </div>

            {/* Exclude keywords（黑名单） */}
            <div>
              <div className="mb-1.5 flex items-center gap-1.5">
                <label htmlFor="filter-exclude-keywords" className="block text-label font-medium text-foreground">
                  {tModal('exclude-keywords-label')}
                </label>
                <FieldHint text={tModal('exclude-keywords-hint')} />
              </div>

              <div className="mb-2.5 flex items-center gap-2">
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
                  type="button"
                  variant="primary"
                  size="lg"
                  onClick={addExcludeKeyword}
                  disabled={!newExcludeKeyword.trim()}
                >
                  <Plus className="size-3.5" />
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
          <TabsContent value="repos" className="space-y-3">
            {renderRepoSection('include')}
            {renderRepoSection('exclude')}
          </TabsContent>
        </Tabs>
      </div>
    </Modal>
  );
};
