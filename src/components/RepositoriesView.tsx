import React, { useEffect } from 'react';
import { CategorySidebar } from './CategorySidebar';
import { RepositoryList } from './RepositoryList';
import { SearchBar } from './SearchBar';
import { useAppStore } from '../store/useAppStore';
import type { AppState } from '../types';
import { hasActiveSearchFilters } from '../utils/repoSearch';

export const RepositoriesView = React.memo(({
  repositories,
  searchResults,
  searchFilters,
  selectedCategory,
  onCategorySelect
}: {
  repositories: AppState['repositories'];
  searchResults: AppState['searchResults'];
  searchFilters: AppState['searchFilters'];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}) => {
  const isActive = hasActiveSearchFilters(searchFilters);
  const similarView = useAppStore((state) => state.similarView);
  const exitSimilarView = useAppStore((state) => state.exitSimilarView);

  // 相似视图下用户发起搜索时，自动退出相似视图（搜索优先于相似浏览，避免界面歧义）
  useEffect(() => {
    if (similarView?.active && isActive) {
      exitSimilarView();
    }
  }, [similarView?.active, isActive, exitSimilarView]);

  // 相似仓库视图激活时，列表数据源切换为相似结果，且忽略分类过滤
  const listRepositories = similarView?.active
    ? similarView.similarResults
    : (isActive ? searchResults : repositories);

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
      <CategorySidebar
        repositories={repositories}
        selectedCategory={selectedCategory}
        onCategorySelect={onCategorySelect}
      />
      <div className="flex-1 space-y-6">
        <SearchBar />
        <RepositoryList
          repositories={listRepositories}
          selectedCategory={similarView?.active ? 'all' : selectedCategory}
        />
      </div>
    </div>
  );
});
RepositoriesView.displayName = 'RepositoriesView';
