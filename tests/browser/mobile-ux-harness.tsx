/* eslint-disable react-refresh/only-export-components -- standalone Vite harness entry. */
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import type {
  Category,
  DiscoveryRepo,
  ForkRepo,
  Gist,
  Release,
  Repository,
  WorkflowDefinition,
} from '../../src/types';

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(String(key)) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(String(key)); },
    setItem: (key, value) => { values.set(String(key), String(value)); },
  };
};

// Isolate application persistence before importing any module that creates the store.
Object.defineProperties(window, {
  indexedDB: { configurable: true, value: undefined },
  localStorage: { configurable: true, value: createMemoryStorage() },
  sessionStorage: { configurable: true, value: createMemoryStorage() },
});
globalThis.fetch = async () => new Response(
  JSON.stringify({ message: 'Network is disabled in the mobile UX harness.' }),
  { status: 503, headers: { 'Content-Type': 'application/json' } },
);
window.open = () => null;
document.addEventListener('click', (event) => {
  if ((event.target as Element).closest('a[href]')) event.preventDefault();
}, true);

const [
  { Header },
  { SearchBar },
  { RepositoryCard },
  { GistCard },
  { default: ReleaseCard },
  { default: ForkCard },
  { SubscriptionRepoCard },
  { SettingsPanel },
  { Modal },
  dialog,
  alertDialog,
  sheet,
  { Textarea },
  { Button },
  table,
  { TooltipProvider },
  { DialogProvider },
  { useAppStore },
] = await Promise.all([
  import('../../src/components/Header'),
  import('../../src/components/SearchBar'),
  import('../../src/components/RepositoryCard'),
  import('../../src/components/GistCard'),
  import('../../src/components/ReleaseCard'),
  import('../../src/components/ForkCard'),
  import('../../src/components/SubscriptionRepoCard'),
  import('../../src/components/SettingsPanel'),
  import('../../src/components/Modal'),
  import('../../src/components/ui/dialog'),
  import('../../src/components/ui/alert-dialog'),
  import('../../src/components/ui/sheet'),
  import('../../src/components/ui/textarea'),
  import('../../src/components/ui/button'),
  import('../../src/components/ui/table'),
  import('../../src/components/ui/tooltip'),
  import('../../src/hooks/useDialog'),
  import('../../src/store/useAppStore'),
]);

const avatar = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="20" fill="#2563eb"/><path d="M11 22h18M20 11v18" stroke="white" stroke-width="3"/></svg>')}`;
const noop = () => undefined;

const category: Category = {
  id: 'mobile-fixtures',
  name: '移动端与 internationalization fixtures',
  icon: '◈',
  keywords: ['mobile', 'responsive', '本地化'],
  isCustom: true,
};

const repository: Repository = {
  id: 9001,
  name: 'extremely-long-responsive-repository-name-without-shortcuts',
  full_name: 'browser-harness-laboratory/extremely-long-responsive-repository-name-without-shortcuts',
  description: 'A deterministic repository fixture with a deliberately long description, 中文排版、emoji 🚀, and an uninterrupted URL: https://example.test/documentation/mobile/layout/overflow/regression/case.',
  html_url: 'https://example.test/browser-harness-laboratory/extremely-long-responsive-repository-name-without-shortcuts',
  stargazers_count: 987654,
  forks_count: 43210,
  forks: 43210,
  language: 'TypeScript',
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2026-09-18T12:00:00.000Z',
  pushed_at: '2026-09-19T08:30:00.000Z',
  starred_at: '2026-09-01T10:00:00.000Z',
  owner: { login: 'browser-harness-laboratory', avatar_url: avatar },
  topics: ['mobile-layout', 'accessibility', 'internationalization', 'long-content', 'deterministic-fixture'],
  ai_summary: 'Synthetic AI summary: validates narrow cards, wrapped action groups, bilingual text, and long metadata without contacting any service.',
  ai_tags: ['响应式设计', 'browser-qa', 'very-long-tag-for-overflow-testing'],
  ai_platforms: ['Web', 'Desktop'],
  analyzed_at: '2026-09-19T09:00:00.000Z',
  custom_category: category.name,
  custom_tags: ['fixture-only', '触控目标'],
  category_locked: true,
  license: 'Apache-2.0',
};

const gist: Gist = {
  id: 'mobile-harness-gist-0000000000000001',
  description: '多语言 Gist fixture with a very long title and code-oriented filenames for narrow viewport truncation.',
  public: true,
  html_url: 'https://example.test/gists/mobile-harness-gist-0000000000000001',
  created_at: '2025-03-01T08:00:00.000Z',
  updated_at: '2026-09-19T07:45:00.000Z',
  comments: 17,
  owner: { login: 'synthetic-fixture-owner-with-a-long-name', avatar_url: avatar },
  files: {
    'packages/mobile/src/very-long-responsive-component-name.tsx': {
      filename: 'packages/mobile/src/very-long-responsive-component-name.tsx',
      type: 'text/typescript',
      language: 'TypeScript',
      size: 4096,
      content: 'export const greeting = "你好, narrow browser";\n',
    },
    'README.localized.md': {
      filename: 'README.localized.md',
      type: 'text/markdown',
      language: 'Markdown',
      size: 2048,
      content: '# Mobile fixture\n\n| Locale | Status |\n| --- | --- |\n| 中文 | ready |',
    },
  },
  starred: true,
  ai_summary: '真实 GistCard leaf with synthetic code metadata, localized text, and a long summary that must wrap without pushing actions off-screen.',
  analyzed_at: '2026-09-19T08:00:00.000Z',
};

const releaseBody = `## Mobile release notes / 移动端发布说明

This deterministic release contains a long URL: https://example.test/releases/download/v2026.09.19/mobile-browser-harness-linux-aarch64.tar.gz

| Platform | Artifact | 状态 |
| --- | --- | --- |
| iOS | universal-preview-build-with-a-long-name.ipa | ready |
| Android | universal-preview-build-with-a-long-name.apk | 已验证 |

\`\`\`tsx
const localizedMessage = '窄屏代码块应当横向滚动，而不是撑破页面';
export default localizedMessage;
\`\`\`
`;

const release: Release = {
  id: 9101,
  tag_name: 'v2026.09.19-mobile-browser-quality-assurance-preview',
  name: 'Mobile Browser QA — 多语言候选版本 with an intentionally long release name',
  body: releaseBody,
  published_at: '2026-09-19T10:00:00.000Z',
  html_url: 'https://example.test/releases/v2026.09.19-mobile-browser-quality-assurance-preview',
  assets: [{
    id: 9201,
    name: 'github-stars-manager-mobile-browser-harness-linux-aarch64-with-symbols.tar.gz',
    size: 128_450_560,
    download_count: 123456,
    browser_download_url: 'https://example.test/assets/github-stars-manager-mobile-browser-harness-linux-aarch64-with-symbols.tar.gz',
    content_type: 'application/gzip',
    created_at: '2026-09-19T10:00:00.000Z',
    updated_at: '2026-09-19T11:00:00.000Z',
  }],
  repository: { id: repository.id, full_name: repository.full_name, name: repository.name },
  updated_asset_ids: [9201],
  is_read: false,
};

const fork: ForkRepo = {
  id: 9301,
  name: 'responsive-fork-with-an-intentionally-long-branch-context',
  fork: true,
  full_name: 'mobile-contributor/responsive-fork-with-an-intentionally-long-branch-context',
  description: 'Synthetic fork used to exercise action wrapping and expanded workflow rows.',
  html_url: 'https://example.test/mobile-contributor/responsive-fork-with-an-intentionally-long-branch-context',
  stargazers_count: 42,
  forks_count: 8,
  forks: 8,
  language: 'Rust',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-09-18T00:00:00.000Z',
  pushed_at: '2026-09-18T00:00:00.000Z',
  default_branch: 'feature/mobile-layout-and-localized-workflow-controls',
  owner: { login: 'mobile-contributor', avatar_url: avatar },
  source: {
    id: repository.id,
    full_name: repository.full_name,
    name: repository.name,
    description: repository.description,
    html_url: repository.html_url,
    stargazers_count: repository.stargazers_count,
    forks_count: repository.forks_count,
    updated_at: repository.updated_at,
    owner: repository.owner,
  },
  has_unread: true,
};

const workflows: WorkflowDefinition[] = [{
  id: 9401,
  name: 'Build, localize, accessibility-test, and package every mobile target',
  path: '.github/workflows/build-localize-accessibility-test-and-package-mobile-targets.yml',
  state: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-09-19T00:00:00.000Z',
  url: 'https://example.test/api/workflows/9401',
  html_url: 'https://example.test/workflows/9401',
  badge_url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg"/%3E',
}];

const discoveryRepo: DiscoveryRepo = {
  ...repository,
  id: 9501,
  name: 'discovered-project-with-extraordinarily-long-mobile-friendly-metadata',
  full_name: '全球开源社区/discovered-project-with-extraordinarily-long-mobile-friendly-metadata',
  description: '发现页真实卡片：English, 中文, 日本語 and a long description designed to wrap beside a dense touch-safe action group.',
  rank: 1,
  channel: 'weekly',
  platform: 'All',
  weeklyIssue: {
    number: 321,
    title: '【开源自荐】Mobile layout fixture with long localized content',
    html_url: 'https://example.test/weekly/issues/321',
    labels: ['weekly', 'issue-321'],
    createdAt: '2026-09-15T00:00:00.000Z',
  },
};

await useAppStore.persist.rehydrate();
useAppStore.setState({
  user: { id: 1, login: 'synthetic-mobile-reviewer', name: 'Mobile QA Reviewer', avatar_url: avatar, email: null },
  githubToken: null,
  backendApiSecret: null,
  isAuthenticated: false,
  hasHydrated: true,
  language: 'en',
  theme: 'light',
  currentView: 'repositories',
  repositories: [repository],
  searchResults: [repository],
  gists: [gist],
  starredGists: [gist],
  gistSearchResults: [gist],
  releases: [release],
  releaseSubscriptions: new Set([repository.id]),
  forks: [fork],
  readForks: new Set<number>(),
  customCategories: [category],
  selectedCategory: 'all',
  subscriptionRepos: { 'most-stars': [], 'most-forks': [], 'most-dev': [], trending: [] },
  discoveryRepos: {
    trending: [discoveryRepo], 'hot-release': [], 'most-popular': [], topic: [],
    'x-tweet': [], telegram: [], weekly: [discoveryRepo], search: [], 'code-search': [],
  },
  selectedDiscoveryChannel: 'weekly',
  rpcDownloadConfig: { enabled: false, host: '', port: 6800 },
});

type HarnessView = 'repositories' | 'gists' | 'releases' | 'forks' | 'discovery' | 'settings' | 'overlays';
type OverlayKind = 'modal' | 'dialog' | 'alert-dialog' | 'sheet';

const viewLabels: Record<HarnessView, string> = {
  repositories: 'Repositories',
  gists: 'Gists',
  releases: 'Releases',
  forks: 'Forks',
  discovery: 'Discovery',
  settings: 'Settings',
  overlays: 'Overlays & forms',
};
const views = Object.keys(viewLabels) as HarnessView[];
const parseView = (): HarnessView => {
  const value = new URLSearchParams(location.search).get('view');
  return views.includes(value as HarnessView) ? value as HarnessView : 'repositories';
};
const appView: Partial<Record<HarnessView, 'repositories' | 'gists' | 'releases' | 'forks' | 'subscription' | 'settings'>> = {
  repositories: 'repositories', gists: 'gists', releases: 'releases', forks: 'forks',
  discovery: 'subscription', settings: 'settings',
};

const ViewFrame: React.FC<{ title: string; detail: string; children: React.ReactNode }> = ({ title, detail, children }) => (
  <section className="space-y-4" aria-labelledby="harness-view-heading">
    <div className="rounded-lg border bg-card p-4">
      <h2 id="harness-view-heading" className="text-xl font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
    {children}
  </section>
);

const RepositoryView = () => (
  <ViewFrame title="Repository, search, and card surface" detail="Full Header and SearchBar with the real RepositoryCard leaf.">
    <Header />
    <SearchBar />
    <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2">
      <RepositoryCard repository={repository} allCategories={[category]} searchQuery="responsive" />
      <RepositoryCard repository={{ ...repository, id: 9002, name: '第二个超长仓库名称-mobile-table-and-code-layout', full_name: '本地测试/第二个超长仓库名称-mobile-table-and-code-layout' }} allCategories={[category]} viewMode="list" />
    </div>
  </ViewFrame>
);

const GistView = () => (
  <ViewFrame title="Gist card representative" detail="Real GistCard leaf; actions are inert because the deterministic store has no token.">
    <GistCard gist={gist} isMine onOpen={noop} onEdit={noop} onDeleted={noop} onUnstarred={noop} />
  </ViewFrame>
);

const ReleaseView = () => {
  const [assetsOpen, setAssetsOpen] = useState(true);
  const [notesOpen, setNotesOpen] = useState(true);
  return (
    <ViewFrame title="Release card and timeline representative" detail="Real ReleaseCard leaf with expanded assets, Markdown table, long URL, and code block.">
      <ReleaseCard
        release={release}
        downloadLinks={release.assets.map((asset) => ({
          name: asset.name, url: asset.browser_download_url, size: asset.size,
          downloadCount: asset.download_count, assetId: asset.id, updatedAt: asset.updated_at,
          contentType: asset.content_type,
        }))}
        isUnread
        isAssetsExpanded={assetsOpen}
        isReleaseNotesExpanded={notesOpen}
        isFullContent
        truncatedBody={releaseBody.slice(0, 180)}
        matchesActiveFilters={() => true}
        selectedFilters={['mobile', 'archive-with-a-long-filter-name']}
        onToggleAssets={() => setAssetsOpen((open) => !open)}
        onToggleReleaseNotes={() => setNotesOpen((open) => !open)}
        onToggleFullContent={noop}
        onUnsubscribe={noop}
        onMarkAsRead={noop}
        onMarkAssetAsRead={noop}
        language="en"
        formatFileSize={(bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`}
      />
    </ViewFrame>
  );
};

const ForkView = () => {
  const [open, setOpen] = useState(true);
  return (
    <ViewFrame title="Fork card and timeline representative" detail="Real ForkCard leaf with an expanded long workflow row.">
      <ForkCard
        fork={fork}
        isUnread
        isWorkflowsExpanded={open}
        onToggleWorkflows={() => setOpen((value) => !value)}
        onSyncUpstream={noop}
        onMarkAsRead={noop}
        onRunWorkflow={noop}
        workflows={workflows}
        isLoadingWorkflows={false}
        isSyncing={false}
        isRunningWorkflow={false}
        needsSync
        language="en"
      />
    </ViewFrame>
  );
};

const DiscoveryView = () => (
  <ViewFrame title="Discovery and subscription representative" detail="Real SubscriptionRepoCard leaf using an offline weekly fixture.">
    <SubscriptionRepoCard repo={discoveryRepo} desktopSafeMode />
  </ViewFrame>
);

const SettingsView = () => {
  const { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } = table;
  return (
    <ViewFrame title="Settings representative" detail="Full SettingsPanel with its real responsive tab navigation and panels; storage and fetch are isolated.">
      <SettingsPanel />
      <div className="rounded-lg border bg-card p-4">
        <h3 className="mb-3 font-semibold">Synthetic configuration table / 配置表</h3>
        <Table>
          <TableHeader><TableRow><TableHead>Setting</TableHead><TableHead>Long deterministic value</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>
            <TableRow><TableCell>Endpoint</TableCell><TableCell className="break-all font-mono">https://example.test/offline-only/configuration/with/a/very/long/path</TableCell><TableCell>Disabled</TableCell></TableRow>
            <TableRow><TableCell>语言</TableCell><TableCell>English / 简体中文 / 日本語</TableCell><TableCell>Ready</TableCell></TableRow>
          </TableBody>
        </Table>
      </div>
    </ViewFrame>
  );
};

const OverlayView = () => {
  const initial = new URLSearchParams(location.search).get('overlay') as OverlayKind | null;
  const [open, setOpen] = useState<OverlayKind | null>(
    ['modal', 'dialog', 'alert-dialog', 'sheet'].includes(initial ?? '') ? initial : 'modal',
  );
  const { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } = dialog;
  const {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
    AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  } = alertDialog;
  const { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } = sheet;
  const show = (kind: OverlayKind) => {
    setOpen(kind);
    const query = new URLSearchParams(location.search);
    query.set('view', 'overlays');
    query.set('overlay', kind);
    history.replaceState(null, '', `${location.pathname}?${query}`);
  };
  const form = (
    <div className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="harness-notes">Review notes / 审阅备注</label>
      <Textarea id="harness-notes" defaultValue={'const narrowLayout = "must wrap safely";\n// 本地 fixture：禁止网络请求'} rows={5} />
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={() => setOpen(null)}>Cancel</Button>
        <Button type="button" onClick={() => setOpen(null)}>Save deterministic fixture</Button>
      </div>
    </div>
  );
  return (
    <ViewFrame title="Shared overlays and form controls" detail="Real Modal, Dialog, AlertDialog, Sheet, Textarea, and responsive action groups. Choose one open overlay at a time.">
      <div className="grid grid-cols-2 gap-2 rounded-lg border bg-card p-4 sm:grid-cols-4">
        {(['modal', 'dialog', 'alert-dialog', 'sheet'] as OverlayKind[]).map((kind) => (
          <Button key={kind} type="button" variant={open === kind ? 'default' : 'outline'} className="min-h-11" onClick={() => show(kind)}>
            Open {kind}
          </Button>
        ))}
      </div>
      <Modal isOpen={open === 'modal'} onClose={() => setOpen(null)} title="Scrollable Modal / 移动端表单" scrollable footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => setOpen(null)}>Close</Button><Button type="button" onClick={() => setOpen(null)}>Apply</Button></div>}>
        <p className="mb-4 break-words text-sm text-muted-foreground">Long modal content: https://example.test/forms/review/mobile/very/long/unbroken/context/path</p>
        {form}
      </Modal>
      <Dialog open={open === 'dialog'} onOpenChange={(value) => !value && setOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Dialog fixture / 对话框</DialogTitle><DialogDescription>Real responsive dialog content with deterministic local form data.</DialogDescription></DialogHeader>
          {form}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(null)}>Dismiss</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={open === 'alert-dialog'} onOpenChange={(value) => !value && setOpen(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Delete synthetic fixture?</AlertDialogTitle><AlertDialogDescription>This only exercises the responsive destructive action group; no data or service is touched.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep fixture</AlertDialogCancel><AlertDialogAction onClick={() => setOpen(null)}>Delete fixture</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Sheet open={open === 'sheet'} onOpenChange={(value) => !value && setOpen(null)}>
        <SheetContent side="right">
          <SheetHeader><SheetTitle>Review Sheet / 审阅面板</SheetTitle><SheetDescription>A full-width mobile sheet using the real shared primitive.</SheetDescription></SheetHeader>
          {form}
          <SheetFooter><Button type="button" variant="outline" onClick={() => setOpen(null)}>Close sheet</Button></SheetFooter>
        </SheetContent>
      </Sheet>
    </ViewFrame>
  );
};

const Harness = () => {
  const [view, setView] = useState<HarnessView>(parseView);
  const selectView = (next: HarnessView) => {
    setView(next);
    const query = new URLSearchParams(location.search);
    query.set('view', next);
    if (next !== 'overlays') query.delete('overlay');
    history.replaceState(null, '', `${location.pathname}?${query}`);
    const nextAppView = appView[next];
    if (nextAppView) useAppStore.getState().setCurrentView(nextAppView);
  };

  useEffect(() => useAppStore.subscribe((state, previous) => {
    if (state.currentView === previous.currentView) return;
    selectView(state.currentView === 'subscription' ? 'discovery' : state.currentView);
  }), []);

  return (
    <div data-harness-root className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card px-3 py-4 sm:px-6">
        <div className="mx-auto max-w-[1440px]">
          <p className="text-xs font-medium uppercase tracking-wide text-primary">Credential-free local browser fixture</p>
          <h1 className="mt-1 text-2xl font-bold">Mobile UX browser harness</h1>
          <nav aria-label="Harness views" className="mt-4 flex max-w-full gap-2 overflow-x-auto pb-1">
            {views.map((item) => (
              <Button
                key={item}
                type="button"
                variant={view === item ? 'default' : 'outline'}
                className="min-h-11 shrink-0 touch-manipulation"
                aria-pressed={view === item}
                data-harness-view-button={item}
                onClick={() => selectView(item)}
              >
                {viewLabels[item]}
              </Button>
            ))}
          </nav>
        </div>
      </header>
      <main data-harness-view={view} className="mx-auto max-w-[1440px] p-3 sm:p-6">
        {view === 'repositories' && <RepositoryView />}
        {view === 'gists' && <GistView />}
        {view === 'releases' && <ReleaseView />}
        {view === 'forks' && <ForkView />}
        {view === 'discovery' && <DiscoveryView />}
        {view === 'settings' && <SettingsView />}
        {view === 'overlays' && <OverlayView />}
      </main>
    </div>
  );
};

const initialAppView = appView[parseView()];
if (initialAppView) useAppStore.setState({ currentView: initialAppView });

document.documentElement.classList.add('light');
createRoot(document.getElementById('root')!).render(
  <DialogProvider>
    <TooltipProvider delayDuration={250}>
      <Harness />
    </TooltipProvider>
  </DialogProvider>,
);
