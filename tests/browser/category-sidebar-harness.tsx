/* eslint-disable react-refresh/only-export-components -- standalone harness keeps its entry components in one file. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { CategorySidebar } from '../../src/components/CategorySidebar';
import { DialogProvider } from '../../src/hooks/useDialog';
import { TooltipProvider } from '../../src/components/ui/tooltip';
import { useAppStore } from '../../src/store/useAppStore';
import type { Category, Repository } from '../../src/types';

const customCategories: Category[] = Array.from({ length: 20 }, (_, index) => ({
  id: `harness-category-${index + 1}`,
  name: index % 5 === 0
    ? `Long category name for responsive truncation ${index + 1}`
    : `Fixture category ${index + 1}`,
  icon: ['◈', '◆', '●', '▲'][index % 4],
  keywords: [`fixture-${index + 1}`],
  isCustom: true,
}));

const repositories: Repository[] = [
  'responsive-layout-fixture',
  'category-sidebar-fixture',
  'scrollable-repository-fixture',
  'long-name-fixture',
  'grid-card-fixture',
  'deterministic-browser-fixture',
].map((name, index) => ({
  id: index + 1,
  name,
  full_name: `browser-harness/${name}`,
  description: `Deterministic repository fixture ${index + 1} for responsive verification.`,
  html_url: `https://example.test/${name}`,
  stargazers_count: 100 - index * 7,
  forks_count: 10 + index,
  forks: 10 + index,
  language: index % 2 === 0 ? 'TypeScript' : 'CSS',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-09-19T00:00:00Z',
  pushed_at: '2026-09-18T00:00:00Z',
  owner: { login: 'browser-harness', avatar_url: '' },
  topics: ['fixture', 'responsive'],
  custom_category: customCategories[index]?.name,
  category_locked: true,
}));

const initializeFixtureState = () => {
  useAppStore.setState({
    language: 'en',
    isSidebarCollapsed: false,
    hiddenDefaultCategoryIds: [],
    customCategories,
    categoryOrder: [],
    categoryMatchMode: 'effective',
    hasHydrated: true,
    selectedCategory: 'all',
    repositories,
    searchResults: repositories,
    isAuthenticated: false,
    githubToken: null,
    backendApiSecret: null,
  });
};

const MockRepositoryCard: React.FC<{ repository: Repository }> = ({ repository }) => (
  <article data-harness-card className="rounded-lg border bg-card p-4 shadow-sm">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="truncate font-semibold text-card-foreground">{repository.full_name}</h3>
      <span className="shrink-0 text-xs text-muted-foreground">★ {repository.stargazers_count}</span>
    </div>
    <p className="line-clamp-3 text-sm text-muted-foreground">{repository.description}</p>
    <div className="mt-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
      <span className="rounded bg-muted px-2 py-1">{repository.language}</span>
      <span className="rounded bg-muted px-2 py-1">fixture</span>
    </div>
  </article>
);

const Harness: React.FC = () => {
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [isFixtureReady, setIsFixtureReady] = useState(false);

  useEffect(() => {
    let initialized = false;
    let unsubscribe = () => {};
    const initialize = () => {
      if (initialized) return;
      initialized = true;
      initializeFixtureState();
      unsubscribe();
      setIsFixtureReady(true);
    };

    if (useAppStore.persist.hasHydrated()) {
      initialize();
    } else {
      unsubscribe = useAppStore.persist.onFinishHydration(initialize);
    }

    return () => {
      initialized = true;
      unsubscribe();
    };
  }, []);

  if (!isFixtureReady) return null;

  return (
    <div data-harness-root className="min-h-screen bg-background p-4 text-foreground sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-4 inline-flex rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          Local CategorySidebar browser harness · credential-free
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
          <CategorySidebar
            repositories={repositories}
            selectedCategory={selectedCategory}
            onCategorySelect={setSelectedCategory}
          />
          <main data-harness-main-panel className="min-w-0 flex-1 space-y-6">
            <header className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Repository browser</p>
                <h1 className="text-xl font-semibold">Responsive fixture collection</h1>
              </div>
              <label className="w-full sm:max-w-xs">
                <span className="sr-only">Search repositories</span>
                <input
                  type="search"
                  placeholder="Search repositories"
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
            </header>
            <div className="rounded-lg border bg-muted/30 p-4" data-harness-selection>
              <span className="text-sm text-muted-foreground">Currently selected category</span>
              <strong className="ml-2 break-words">{selectedCategory}</strong>
            </div>
            <div data-harness-card-grid className="grid min-w-0 gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {repositories.map((repository) => (
                <MockRepositoryCard key={repository.id} repository={repository} />
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    <TooltipProvider delayDuration={300}>
      <Harness />
    </TooltipProvider>
  </DialogProvider>,
);
