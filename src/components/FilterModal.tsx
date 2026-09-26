import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, Check, Search, HelpCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
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

/** 关键词 chip 列表：白名单/黑名单共用同一中性样式 */
const KeywordChips: React.FC<{
  items: string[];
  removeLabel: (item: string) => string;
  onRemove: (index: number) => void;
}> = ({ items, removeLabel, onRemove }) => {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <div
          key={`${item}-${index}`}
          className="flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-1"
        >
          <Badge
            variant="secondary"
            className="h-auto rounded-sm border-0 bg-transparent px-0 text-sm font-medium text-secondary-foreground"
          >
            {item}
          </Badge>
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
      ))}
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
  const [newKeyword, setNewKeyword] = useState('');
  const [newExcludeKeyword, setNewExcludeKeyword] = useState('');
  const [isRepoPickerOpen, setIsRepoPickerOpen] = useState(false);
  const [repoSearch, setRepoSearch] = useState('');

  useEffect(() => {
    if (filter) {
      setName(filter.name);
      setKeywords([...filter.keywords]);
      setExcludeKeywords([...(filter.excludeKeywords ?? [])]);
      setIncludeRepos([...(filter.includeRepos ?? [])]);
    } else {
      setName('');
      setKeywords([]);
      setExcludeKeywords([]);
      setIncludeRepos([]);
    }
    setNewKeyword('');
    setNewExcludeKeyword('');
    setIsRepoPickerOpen(false);
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

  const addKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setNewKeyword('');
    }
  };

  const addExcludeKeyword = () => {
    const trimmed = newExcludeKeyword.trim();
    if (trimmed && !excludeKeywords.includes(trimmed)) {
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

  const handleSave = () => {
    if (!name.trim() || keywords.length === 0) {
      return;
    }

    // 新增字段始终写回（允许空数组）：updateAssetFilter 是 spread 合并，
    // 省略键会导致清空后的黑名单/始终包含仓库残留旧值。
    const savedFilter: AssetFilter = {
      id: filter?.id || Date.now().toString(),
      name: name.trim(),
      keywords: keywords.filter(k => k.trim()),
      excludeKeywords: excludeKeywords.filter(k => k.trim()),
      includeRepos: includeRepos
    };

    onSave(savedFilter);
    onClose();
  };

  const keywordInputClass = 'flex-1 px-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card dark:bg-muted/40 text-foreground dark:text-foreground';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={filter ? tModal('title-edit') : tModal('title-new')}
      maxWidth={isRepoPickerOpen ? 'max-w-4xl' : 'max-w-2xl'}
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
            disabled={!name.trim() || keywords.length === 0}
            className={`px-4 py-2 rounded-lg transition-colors ${(!name.trim() || keywords.length === 0) ? 'bg-muted text-muted-foreground dark:bg-card/5 dark:text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary'}`}
          >
            {filter ? tModal('save') : tModal('create')}
          </Button>
        </div>
      }
    >
      <div className={cn('gap-5', isRepoPickerOpen && 'flex flex-col md:flex-row')}>
        {/* 左列：过滤器表单 */}
        <div className="min-w-0 flex-1 space-y-4">
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

          {/* Always-included repositories（强制包含） */}
          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="block text-sm font-medium text-foreground dark:text-foreground">
                  {tModal('include-repos-label')}
                </span>
                <FieldHint text={tModal('include-repos-note')} />
              </div>
              <Button
                onClick={() => setIsRepoPickerOpen(!isRepoPickerOpen)}
                disabled={releaseRepos.length === 0}
                title={releaseRepos.length === 0 ? tModal('repo-picker-no-release-repos') : undefined}
                className="flex items-center space-x-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {!isRepoPickerOpen && <Plus className="w-4 h-4" />}
                <span>{isRepoPickerOpen ? tModal('repo-picker-done') : tModal('add-include-repos')}</span>
              </Button>
            </div>

            {includeRepos.length > 0 ? (
              <KeywordChips
                items={includeRepos}
                removeLabel={(repo) => tModal('remove-include-repo-aria', { repo })}
                onRemove={(index) => setIncludeRepos(includeRepos.filter((_, i) => i !== index))}
              />
            ) : (
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {tModal('include-repos-empty')}
              </p>
            )}
          </div>
        </div>

        {/* 右列：始终包含仓库选择器 */}
        {isRepoPickerOpen && (
          <aside className="min-w-0 md:w-80 md:shrink-0 md:border-l md:border-border md:pl-5" aria-label={tModal('repo-picker-title')}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-foreground dark:text-foreground">
                {tModal('repo-picker-title')}
              </p>
              {includeRepos.length > 0 && (
                <span className="px-2 py-0.5 bg-primary text-primary-foreground text-xs rounded-full whitespace-nowrap">
                  {tModal('repo-picker-selected-count', { count: includeRepos.length })}
                </span>
              )}
            </div>

            <div className="relative mt-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground dark:text-muted-foreground" aria-hidden="true" />
              <Input
                type="text"
                value={repoSearch}
                onChange={(e) => setRepoSearch(e.target.value)}
                placeholder={tModal('repo-picker-search-placeholder')}
                aria-label={tModal('repo-picker-search-placeholder')}
                autoFocus
                className="w-full pl-8 pr-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card dark:bg-muted/40 text-foreground dark:text-foreground"
              />
            </div>

            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-border dark:border-border" role="listbox" aria-multiselectable="true">
              {releaseRepos.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground dark:text-muted-foreground">
                  {tModal('repo-picker-no-release-repos')}
                </p>
              ) : filteredRepoOptions.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground dark:text-muted-foreground">
                  {tModal('repo-picker-empty')}
                </p>
              ) : (
                filteredRepoOptions.map((fullName) => {
                  const checked = isRepoIncluded(fullName);
                  return (
                    <button
                      type="button"
                      key={fullName}
                      role="option"
                      aria-selected={checked}
                      onClick={() => toggleRepoIncluded(fullName)}
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
          </aside>
        )}
      </div>
    </Modal>
  );
};
