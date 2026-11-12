#!/usr/bin/env node
/**
 * Decide whether a pull request touches the UI — and exactly WHICH pages — for
 * the detect job.
 *
 * Runs on a checkout of the default branch (never PR code) and only reads the
 * PR / commit diff through the API. Outputs (to $GITHUB_OUTPUT):
 *   ui     true|false
 *   sha    the PR head commit to record
 *   number the PR number
 *   scenes comma-separated scene specs to shoot, e.g. "settings-plugins,plugin:repo-info-card"
 *
 * Scene model (fine-grained — only pages the diff can render differently):
 *   repositories-light|repositories-dark   the repository list, per theme
 *   gists|releases|forks|discovery         the other top-level views
 *   settings-<tab>                         one scene per Settings tab
 *                                          (general, appearance, star-sync, ai,
 *                                          webdav, backup, backend, category,
 *                                          menu, data, logs, network, plugins,
 *                                          vector-search, mcp)
 *   plugin:<slug>                          every page contributed by the example
 *                                          plugin in examples/plugins/<slug>;
 *                                          shoot.mjs expands it into one
 *                                          plugin-<slug>-<pageId> shot per page
 *                                          by reading the plugin manifest from
 *                                          the built bundle.
 *   <scene>-<variant>                      an interaction variant of one base
 *                                          scene (SCENE_VARIANTS below): a
 *                                          state the default render never
 *                                          shows, e.g. an open dialog or a
 *                                          switched tab. shoot.mjs applies the
 *                                          variant's clicks right after the
 *                                          base scene's screenshot.
 *
 * `global` (shared chrome: App shell, header, ui primitives, theme tokens,
 * styling configs, common locales) expands to ALL view + settings scenes.
 * Plugin pages are standalone HTML documents and do not re-render app chrome,
 * so they are only shot when the diff touches that plugin (or plugin infra
 * used by their host views).
 *
 * Environment: GH_TOKEN (read), GITHUB_REPOSITORY, PR (number), GITHUB_OUTPUT,
 *              EVENT_ACTION (optional), BEFORE_SHA (optional), HEAD_SHA (optional).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * The Settings tabs, in the order SettingsPanel.tsx renders them.
 * `tab` is the SettingsTab id used by `gsm:pending-settings-tab`; `scene` is
 * the preview scene name. electron-only tabs (network, plugins, mcp) are
 * flagged so shoot.mjs can stub the Electron bridge.
 * @type {Array<{scene: string, tab: string, electronOnly?: boolean}>}
 */
export const SETTINGS_TABS = [
  { scene: 'settings-general', tab: 'general' },
  { scene: 'settings-appearance', tab: 'appearance' },
  { scene: 'settings-star-sync', tab: 'starSync' },
  { scene: 'settings-ai', tab: 'ai' },
  { scene: 'settings-webdav', tab: 'webdav' },
  { scene: 'settings-backup', tab: 'backup' },
  { scene: 'settings-backend', tab: 'backend' },
  { scene: 'settings-category', tab: 'category' },
  { scene: 'settings-menu', tab: 'menu' },
  { scene: 'settings-data', tab: 'data' },
  { scene: 'settings-logs', tab: 'logs' },
  { scene: 'settings-network', tab: 'network', electronOnly: true },
  { scene: 'settings-plugins', tab: 'plugins', electronOnly: true },
  { scene: 'settings-vector-search', tab: 'vectorSearch' },
  { scene: 'settings-mcp', tab: 'mcp', electronOnly: true },
];

/**
 * View-level scenes in canonical recording order.
 * @type {string[]}
 */
export const VIEW_SCENES = [
  'repositories-light',
  'repositories-dark',
  'gists',
  'releases',
  'forks',
  'discovery',
];

/**
 * All static scenes in canonical order (views + settings tabs). Plugin page
 * scenes are dynamic and never part of this list.
 * @type {string[]}
 */
export const ALL_SCENES = [...VIEW_SCENES, ...SETTINGS_TABS.map((t) => t.scene)];

/**
 * Interaction variants: extra screenshots of one base scene in a state the
 * default render never shows — an open dialog/sheet or a switched tab. Each
 * spec (`<baseScene>-<name>`) is a valid shoot.mjs scene; the open recipe
 * lives in shoot.mjs's VARIANT_ACTIONS. detect emits a variant only for diffs
 * whose visible change lives inside that state (the component rendered there,
 * via COMPONENT_VARIANTS below), never through `global` expansion.
 * @type {Array<{spec: string, baseScene: string}>}
 */
export const SCENE_VARIANTS = [
  // Token permission guide dialog: GitHubTokenPermissions renders inside a
  // Dialog in the General settings tab, closed in the default screenshot.
  { spec: 'settings-general-token-guide', baseScene: 'settings-general' },
  // The same component's fine-grained tab: its warning box only renders after
  // switching tabs, which no default screenshot does.
  { spec: 'login-token-finegrained', baseScene: 'login' },

  // Settings dialogs (opened by deterministic buttons in their panels).
  { spec: 'settings-plugins-marketplace', baseScene: 'settings-plugins' },
  // The sources dialog is chained on top of the open marketplace dialog.
  { spec: 'settings-plugins-sources', baseScene: 'settings-plugins' },
  { spec: 'settings-plugins-icon-picker', baseScene: 'settings-plugins' },
  { spec: 'settings-star-sync-push-modal', baseScene: 'settings-star-sync' },
  { spec: 'settings-ai-config-form', baseScene: 'settings-ai' },
  { spec: 'settings-webdav-config-form', baseScene: 'settings-webdav' },
  // Deploy-guide collapsible + its manual-deployment tab (tabs are hidden
  // until the guide is expanded).
  { spec: 'settings-vector-search-deploy-guide', baseScene: 'settings-vector-search' },

  // Repositories-view dialogs and sheets (per-card buttons, toolbar buttons).
  { spec: 'repositories-edit-modal', baseScene: 'repositories-light' },
  { spec: 'repositories-release-sheet', baseScene: 'repositories-light' },
  // Release sheet's notes tab (assets tab is the default sheet render).
  { spec: 'repositories-release-sheet-notes', baseScene: 'repositories-light' },
  { spec: 'repositories-chat-sheet', baseScene: 'repositories-light' },
  { spec: 'repositories-chat-history-sheet', baseScene: 'repositories-light' },
  { spec: 'repositories-readme-modal', baseScene: 'repositories-light' },
  { spec: 'repositories-category-edit-modal', baseScene: 'repositories-light' },
  { spec: 'repositories-batch-star-import', baseScene: 'repositories-light' },

  // Other views.
  { spec: 'gists-gist-detail', baseScene: 'gists' },
  { spec: 'gists-new-gist', baseScene: 'gists' },
  { spec: 'releases-filter-modal', baseScene: 'releases' },
  { spec: 'releases-source-settings', baseScene: 'releases' },
];

/**
 * Dialog/sheet/tab components that render ONLY inside an interaction variant.
 * Keys are exact file names; values are space-separated SCENE_VARIANTS specs
 * appended to the component's base-scene classification. A change to one of
 * these files is invisible in the default render, so its variants are
 * mandatory to show the change. Deliberately NOT listed: destructive
 * confirmation dialogs (uninstall, data deletion, unstar — their shells are
 * generic and their triggers interpolated/stateful), state-gated overlays
 * (update dialog, sync-mode choice, login conflict, import preview),
 * selection-gated bulk modals, and discovery channel-gated settings (their
 * triggers only render on non-default channels the demo never selects).
 * @type {Record<string, string>}
 */
const COMPONENT_VARIANTS = {
  // Token permission helper: the guide dialog in settings-general and the
  // fine-grained tab on the login page are closed/inactive by default.
  'GitHubTokenPermissions.tsx': 'settings-general-token-guide login-token-finegrained',
  'PluginMarketplaceDialog.tsx': 'settings-plugins-marketplace settings-plugins-sources',
  'PluginSourcesDialog.tsx': 'settings-plugins-sources',
  'PluginIconPickerDialog.tsx': 'settings-plugins-icon-picker',
  'PushCategoriesModal.tsx': 'settings-star-sync-push-modal',
  // The add/edit AI provider form is Modal-hosted inside the panel.
  'AIConfigPanel.tsx': 'settings-ai-config-form',
  'WebDAVPanel.tsx': 'settings-webdav-config-form',
  // The deploy-guide collapsible hosts the deployment Tabs.
  'VectorSearchSettings.tsx': 'settings-vector-search-deploy-guide',
  'RepositoryEditModal.tsx': 'repositories-edit-modal',
  // The release sheet's notes tab is its non-default content state.
  'RepositoryReleaseSheet.tsx': 'repositories-release-sheet repositories-release-sheet-notes',
  'RepositoryChatSheet.tsx': 'repositories-chat-sheet',
  'GlobalChatHistorySheet.tsx': 'repositories-chat-history-sheet',
  // The readme modal opens from the repository card body click.
  'ReadmeModal.tsx': 'repositories-readme-modal',
  'CategoryEditModal.tsx': 'repositories-category-edit-modal',
  'BatchStarImportDialog.tsx': 'repositories-batch-star-import',
  'GistDetailModal.tsx': 'gists-gist-detail',
  'GistEditorModal.tsx': 'gists-new-gist',
  // FilterModal renders only in the releases view's filter manager.
  'FilterModal.tsx': 'releases-filter-modal',
  'ReleaseSourceSettingsModal.tsx': 'releases-source-settings',
};

const SETTINGS_SCENE_NAMES = new Set(SETTINGS_TABS.map((t) => t.scene));

/** Standalone scene names outside ALL_SCENES: the login page renders instead
 *  of the app shell, so global chrome never reaches it and it is only shot
 *  when login-specific files change. Interaction variant specs join them —
 *  they are extras shot on top of their base scene. */
const EXTRA_SCENE_NAMES = new Set(['login', ...SCENE_VARIANTS.map((v) => v.spec)]);

/**
 * Mapping from high-level view identifier to the preview scene names it renders.
 * @type {Record<string, string[]>}
 */
export const VIEW_TO_SCENES = {
  repositories: ['repositories-light', 'repositories-dark'],
  gists: ['gists'],
  releases: ['releases'],
  forks: ['forks'],
  discovery: ['discovery'],
  settings: [...SETTINGS_TABS.map((t) => t.scene)],
};

/**
 * Patterns for files that do NOT constitute UI changes.
 * Changes touching only files matching these patterns will result in ui=false.
 * Note: build/styling configs like tailwind.config.js, postcss.config.js, and vite.config.ts
 * are intentionally NOT ignored; they trigger all scenes.
 * @type {RegExp[]}
 */
const IGNORED_PATTERNS = [
  // Test suites, unit tests, and fixtures
  /\.(test|spec)\.[jt]sx?$/,
  /(?:^|\/)__tests__\//,
  /^src\/test\//,

  // Documentation and repository metadata
  /\.md$/i,
  /^docs\//,
  /^(LICENSE|LICENCE|\.gitignore|\.gitattributes|version-info\.xml)$/i,

  // CI, IDE, linters, tooling configs (excluding UI styling configs)
  /^\.github\//,
  /^\.vscode\//,
  /^\.editorconfig$/,
  /^\.prettier/,
  /^\.eslint/,
  /^eslint\.config\./,
  /^tsconfig.*\.json$/,

  // Desktop backend (Electron main/preload process code)
  /^electron\//,

  // Plugin background worker scripts (non-UI headless workers)
  /^examples\/plugins\/[^/]+\/worker\.[jt]s$/,

  // Landing page website (separate static site, not in the app bundle / preview)
  /^LandingPage\//,

  // Non-UI application logic (services, persistence storage, normalizers, helpers)
  /^src\/services\//,
  /^src\/store\/persistence\//,
  /^src\/store\/normalizers\//,
  /^src\/store\/helpers\//,
  /^src\/types\/(?!themeTokens\b)/,
  /^src\/polyfills\.ts$/,
  /^src\/vite-env\.d\.ts$/,

  // Non-UI utility modules (network, crypto, encoding, platform, logging)
  /^src\/utils\/(lanAddress|cryptoRandom|abortUtils|domTextScanner|logSanitizer|backendErrors|apiUrlBuilder|backendUrl|deviceTarget|formatBytes|sanitizeSchema|textLanguage|clipboardUtils|licenseFilter|logEventTypes)\.[jt]s$/,

  // Package manifests
  /^package(-lock)?\.json$/,
];

/**
 * Check whether a file path is non-UI and should be ignored during UI change detection.
 * @param {string} filePath - Path of the file relative to repository root.
 * @returns {boolean} True if the path is non-UI and should be ignored.
 */
export function isIgnoredPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  return IGNORED_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Settings panel components mapped to the single Settings tab that renders
 * them. Keys are exact file names under src/components/settings/. Anything not
 * listed here falls back to the whole Settings view (all tabs).
 * @type {Record<string, string>}
 */
const SETTINGS_COMPONENT_SCENES = {
  'GeneralPanel.tsx': 'settings-general',
  'AppearancePanel.tsx': 'settings-appearance',
  'ThemeSettingsCard.tsx': 'settings-appearance',
  'RepositoryCardActionsSettings.tsx': 'settings-appearance',
  'StarSyncPanel.tsx': 'settings-star-sync',
  'AIConfigPanel.tsx': 'settings-ai',
  'WebDAVPanel.tsx': 'settings-webdav',
  'BackupPanel.tsx': 'settings-backup',
  'BackendPanel.tsx': 'settings-backend',
  'CategoryPanel.tsx': 'settings-category',
  'MenuManagementPanel.tsx': 'settings-menu',
  'DataManagementPanel.tsx': 'settings-data',
  'DiagnosticLogsPanel.tsx': 'settings-logs',
  'NetworkPanel.tsx': 'settings-network',
  'McpSettingsPanel.tsx': 'settings-mcp',
  'VectorSearchSettings.tsx': 'settings-vector-search',
  'PluginSettingsPanel.tsx': 'settings-plugins',
  'PluginRegistrySection.tsx': 'settings-plugins',
  'PluginMarketplaceDialog.tsx': 'settings-plugins',
  'PluginSourcesDialog.tsx': 'settings-plugins',
  'PluginUninstallDialog.tsx': 'settings-plugins',
  'PluginIconPickerDialog.tsx': 'settings-plugins',
  // Rendered by StarSyncPanel, not CategoryPanel.
  'PushCategoriesModal.tsx': 'settings-star-sync',
  // Shared by BackupPanel and DataManagementPanel.
  'IncludeKeysToggle.tsx': 'settings-backup settings-data',
};

/**
 * Locale top-level keys mapped to the scenes that render them. Only locales
 * that get key-level diffing are listed; keys missing from a table fall back
 * to the namespace default in LOCALE_NS_FALLBACK (conservative: a key we
 * cannot place might render anywhere that namespace does).
 * @type {Record<string, Record<string, string>>}
 */
const LOCALE_KEY_SCENES = {
  // app.json carries every Settings panel's strings, view chrome and shared widgets.
  app: {
    settingsPanel: 'settings',
    // The language-settings card renders in 外观, not only 通用.
    generalPanel: 'settings-general settings-appearance',
    themeSettingsCard: 'settings-appearance',
    starSyncPanel: 'settings-star-sync',
    aIConfigPanel: 'settings-ai',
    webDAVPanel: 'settings-webdav',
    backupPanel: 'settings-backup',
    includeKeysToggle: 'settings-backup settings-data',
    backendPanel: 'settings-backend',
    categoryPanel: 'settings-category',
    pushCategoriesModal: 'settings-star-sync',
    // ThemeSettingsCard reuses the menu panel's reorder strings in 外观.
    menuManagementPanel: 'settings-menu settings-appearance',
    dataManagementPanel: 'settings-data',
    diagnosticLogsPanel: 'settings-logs',
    networkPanel: 'settings-network',
    mcpSettingsPanel: 'settings-mcp',
    vectorSearchSettings: 'settings-vector-search',
    pluginSettingsPanel: 'settings-plugins',
    // Viewer/modal strings surface over the repositories view too (repo-card plugin actions).
    pluginPageViewer: 'repositories settings-plugins',
    // Update dialog strings: the check button and dialog live in 通用, the
    // per-version banner strings only render when an update is available.
    updateChecker: 'settings-general',
    updateNotificationBanner: 'deferred',
    // Toast/confirm strings surface wherever the next action fails — not
    // tied to any default page.
    useDialog: 'deferred',
    clipboardUtils: 'deferred',
    repositorySlice: 'repositories',
    // CategoryPanel reuses the empty-name validation string in 分类管理.
    categoryUtils: 'repositories settings-category',
    categorySidebar: 'repositories',
    categoryEditModal: 'repositories',
    repositoryEditModal: 'repositories',
    searchBar: 'repositories',
    searchDemo: 'repositories',
    searchResultStats: 'repositories',
    searchShortcutsHelp: 'repositories',
    codeSearchView: 'repositories',
    similarViewBanner: 'repositories',
    syncModeChoiceModal: 'repositories',
    bulkActionToolbar: 'repositories',
    bulkCategorizeModal: 'repositories',
    bulkRestoreModal: 'repositories',
    sortAlgorithmTooltip: 'repositories',
    listsPushIndicator: 'repositories',
    backToTop: 'repositories',
    scrollToBottom: 'repositories',

    // FilterModal renders only in the releases view (release timeline sidebar).
    assetFilterManager: 'releases',
    useReleaseArtifactActions: 'releases',
    installableAssetRecommendation: 'releases',

    forkCard: 'forks',
    discoverySidebar: 'discovery',

    markdownRenderer: 'repositories releases discovery',
    bilingualMarkdownRenderer: 'repositories releases discovery',
    readmeModal: 'repositories',
    useReadmeFetch: 'repositories',
  },
  // settings.json carries the settings hooks' toasts/errors.
  settings: {
    useAIConfigActions: 'settings-ai',
    useBackendSettingsActions: 'settings-backend',
    useBackupActions: 'settings-backup',
    useWebDAVActions: 'settings-webdav',
    useNetworkActions: 'settings-network',
    useMcpActions: 'settings-mcp',
    // CategoryEditModal (repositories view) drives star-sync pushes through this hook.
    useStarSyncActions: 'settings-star-sync repositories',
    useDesktopActions: 'settings-general',
    useGitHubTokenActions: 'settings-general',
    generalPanel: 'settings-general',
  },
  // plugins.json mixes discovery feed modals with plugin action strings.
  plugins: {
    telegramMessageModal: 'discovery',
    telegramSettingsModal: 'discovery',
    xTweetModal: 'discovery',
    xTweetSettingsModal: 'discovery',
    applyPluginActionResult: 'repositories settings-plugins',
    usePluginAI: 'repositories settings-plugins',
    usePluginWebSearch: 'repositories settings-plugins',
  },
  chat: {
    globalChatHistorySheet: 'repositories',
    repositoryChatHistoryPanel: 'repositories',
    repositoryChatSheet: 'repositories',
    citationBadge: 'repositories',
    useRepositoryChat: 'repositories',
    useRepositoryChatSessions: 'repositories',
    repositoryChatService: 'repositories',
  },
  // releases.json strings are consumed across views: fork cards render in the
  // forks timeline, the subscription card in discovery, and the release sheet
  // inside repository cards.
  releases: {
    forkCard: 'forks',
    forkTimeline: 'forks',
    subscriptionRepoCard: 'discovery',
    repositoryReleaseSheet: 'releases repositories',
    releaseCard: 'releases',
    releasePluginRecommendations: 'releases',
    releaseSourceSettingsModal: 'releases',
    releaseTimeline: 'releases',
    useReleaseTimelineActions: 'releases',
    useWatchedSourcesSync: 'releases',
  },
  // repository card strings also feed the card-action settings in 外观.
  repositories: {
    repositoryCard: 'repositories settings-appearance',
    batchStar: 'repositories',
    repositoryEditModal: 'repositories',
    repositoryList: 'repositories',
    repositoryHealthPanel: 'repositories',
    useBulkRepositoryActions: 'repositories',
    useRepositoryAnalysisJob: 'repositories',
    useRepositoryCardActions: 'repositories',
    useRepositoryReleaseSheet: 'repositories',
    useSearchActions: 'repositories',
  },
  common: {
    useForkTimelineActions: 'forks',
  },
};

/**
 * Conservative fallback when a locale file cannot be key-diffed, or when a
 * changed top-level key is not in the key table. Each fallback is the union
 * of every scene that namespace's keys can render in (verified against the
 * app source), so a failed content read never under-captures cross-page
 * consumers. Keys are namespace names ('common' covers common.json etc.).
 * @type {Record<string, string | string[]>}
 */
const LOCALE_NS_FALLBACK = {
  app: 'global',
  // settings.json hook toasts surface in the settings tabs and, through
  // useStarSyncActions in CategoryEditModal, the repositories view.
  settings: ['repositories', 'settings'],
  plugins: ['repositories', 'settings-plugins', 'discovery'],
  chat: 'repositories',
  // repositoryCard strings also feed the card-action settings in 外观.
  repositories: ['repositories', 'settings-appearance'],
  // releases.json keys render in forks (fork cards/timeline), discovery
  // (subscription card) and repositories (release sheet inside repo cards).
  releases: ['releases', 'repositories', 'forks', 'discovery'],
  gists: 'gists',
  forks: 'forks',
  discovery: 'discovery',
  // shared namespaces can render on any page
  common: 'global',
  errors: 'global',
  // login.json strings render on the login page AND inside the settings
  // token-guide dialog (GitHubTokenPermissions reads the login namespace in
  // both hosts). The dialog and the component's fine-grained tab only show
  // through their variant scenes.
  login: ['login', 'settings-general', 'login-token-finegrained', 'settings-general-token-guide'],
  ai: 'global',
  services: 'global',
  search: 'repositories',
};

/** Matches src/locales/<lang>/<ns>.json */
const LOCALE_FILE_PATTERN = /^src\/locales\/[^/]+\/([a-zA-Z]+)\.json$/;

/**
 * Split a space-separated scene list from the tables above.
 * @param {string} spec - Space separated scene/view tokens.
 * @returns {string[]} Tokens.
 */
const splitSpec = (spec) => spec.split(/\s+/).filter(Boolean);

/**
 * Classify changed top-level keys of one locale namespace into scene/view
 * tokens. Unknown keys escalate to the namespace fallback so nothing that can
 * render is missed.
 * @param {string} ns - Locale namespace (file base name).
 * @param {string[]} changedKeys - Top-level keys whose value changed.
 * @returns {string[]} Scene/view tokens (may include 'global').
 */
export function classifyLocaleKeys(ns, changedKeys) {
  const table = LOCALE_KEY_SCENES[ns];
  const fallback = LOCALE_NS_FALLBACK[ns] ?? 'global';
  if (!table) {
    return splitSpec(typeof fallback === 'string' ? fallback : fallback.join(' '));
  }
  const out = new Set();
  let unknown = false;
  for (const key of changedKeys) {
    const spec = table[key];
    if (spec) {
      for (const token of splitSpec(spec)) out.add(token);
    } else {
      unknown = true;
    }
  }
  if (unknown) {
    for (const token of splitSpec(typeof fallback === 'string' ? fallback : fallback.join(' '))) {
      out.add(token);
    }
  }
  return [...out];
}

/** Plugin slugs travel into the `scenes` workflow output and from there onto
 *  a shell command line (shoot.mjs --only) and into file paths, so only
 *  unambiguous safe directory names may become specs. Mirrors
 *  SAFE_MANIFEST_SEGMENT in shoot.mjs: shell metacharacters, whitespace and
 *  traversal segments are rejected outright. */
const SAFE_PLUGIN_SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Classify a changed path to its affected view identifier, scene name, scene
 * spec, or list of them. Returns the base scenes for the path plus any
 * interaction-variant scenes (COMPONENT_VARIANTS) the path renders only in.
 * Returns null if the file is ignored or does not affect UI.
 *
 * Returned tokens are one of:
 *   - view ids resolved via VIEW_TO_SCENES ('repositories', 'settings', 'gists', …)
 *   - concrete scene names ('settings-data')
 *   - dynamic plugin specs ('plugin:<slug>')
 *   - interaction variant specs ('settings-plugins-marketplace', …)
 *   - 'global' (all static scenes)
 *   - 'deferred' (state containers whose visible effect ships through the
 *     components changed in the same PR; expanded to global only when no
 *     concrete scene was found)
 * @param {string} filePath - Path of the file relative to repository root.
 * @returns {string | string[] | null}
 */
export function classifyPath(filePath) {
  const path = filePath.replace(/\\/g, '/');
  if (isIgnoredPath(path)) {
    return null;
  }
  const base = classifyBasePath(path);
  const variantSpecs = splitSpec(COMPONENT_VARIANTS[path.split('/').pop()] ?? '');
  if (variantSpecs.length === 0) return base;
  if (!base) return variantSpecs;
  return [...(Array.isArray(base) ? base : [base]), ...variantSpecs];
}

/**
 * Base-scene classification shared by every non-ignored path (the rules that
 * existed before interaction variants). Returns null when the path affects no
 * base scene; classifyPath unions the result with COMPONENT_VARIANTS.
 * @param {string} path - Normalized (forward-slash) repository-relative path.
 * @returns {string | string[] | null}
 */
function classifyBasePath(path) {
  // 0. Locale files classify at namespace level here; mapPathsToScenes
  // overrides this with the key-level diff when one is available.
  if (LOCALE_FILE_PATTERN.test(path)) {
    return classifyLocaleFile(path, null);
  }

  // 1. Gists view
  if (
    path.startsWith('src/features/gists/') ||
    /^src\/components\/Gist/i.test(path) ||
    path === 'src/store/slices/gistSlice.ts' ||
    path === 'src/utils/gistUtils.ts'
  ) {
    return 'gists';
  }

  // 2. Releases view. FilterModal belongs here: it is instantiated by the
  // AssetFilterManager in the releases view's context sidebar only.
  if (
    path.startsWith('src/features/releases/') ||
    /^src\/components\/Release/i.test(path) ||
    /^src\/components\/(AssetFilterManager|AssetLeadingIcon|FilterModal)\./.test(path) ||
    /^src\/components\/InstallableAssetRecommendation\./.test(path) ||
    /^src\/components\/SiWindows\./.test(path) ||
    /^src\/hooks\/useReleaseArtifactActions\./.test(path) ||
    /^src\/utils\/(releaseAssets|assetFilters|assetCompatibility|installableAssets|releaseDownloadLinks|releaseSources)\.[jt]s$/.test(path)
  ) {
    return 'releases';
  }

  // 3. Forks view
  if (
    path.startsWith('src/features/forks/') ||
    /^src\/components\/Fork/i.test(path) ||
    /^src\/locales\/[^/]+\/forks\.json$/.test(path)
  ) {
    return 'forks';
  }

  // 4. Discovery view (view key: subscription)
  if (
    path.startsWith('src/features/discovery/') ||
    /^src\/components\/Discovery/i.test(path) ||
    /^src\/components\/SubscriptionRepoCard\./.test(path) ||
    /^src\/components\/ExternalDiscoveryFeedsModal\./.test(path) ||
    /^src\/components\/TelegramMessageModal\./.test(path) ||
    /^src\/components\/TelegramSettingsModal\./.test(path) ||
    /^src\/components\/XTweetModal\./.test(path) ||
    /^src\/components\/XTweetSettingsModal\./.test(path) ||
    /^src\/components\/WeeklyIssueModal\./.test(path) ||
    path === 'src/store/slices/discoverySlice.ts' ||
    /^src\/utils\/(discoveryFeeds|discoveryRss|trendingSnapshots|telegramFollows|xTweetFollows)\.[jt]s$/.test(path)
  ) {
    return 'discovery';
  }

  // 5. Example plugin UI: shoot exactly that plugin's pages. Unsafe slugs
  // (shell metacharacters, traversal) never become specs.
  const pluginMatch = path.match(/^examples\/plugins\/([^/]+)\/(.*)$/);
  if (pluginMatch) {
    const slug = pluginMatch[1];
    const rest = pluginMatch[2];
    if (!SAFE_PLUGIN_SLUG.test(slug) || slug.includes('..')) {
      return null;
    }
    if (/^(ui\/|manifest\.json$)/.test(rest)) {
      // manifest.json also feeds the plugin list in Settings › Plugins.
      return rest === 'manifest.json'
        ? ['settings-plugins', `plugin:${slug}`]
        : `plugin:${slug}`;
    }
    return null; // worker.js, README.md, other non-UI plugin files
  }

  // 6. Plugin host UI: the Settings › Plugins tab renders the registry and
  // embedded pages; repository cards render plugin actions. Standalone plugin
  // pages are unaffected (they never import src/plugins).
  if (
    path.startsWith('src/features/plugins/') ||
    path.startsWith('src/plugins/') ||
    /^src\/components\/PluginPage(Viewer|Modal)\./.test(path)
  ) {
    return ['repositories', 'settings-plugins'];
  }

  // 7. Settings: map each panel to its own tab scene (some panels render in
  // several tabs, hence the space-separated split).
  if (/^src\/components\/settings\/[^/]+\.tsx?$/.test(path)) {
    const base = path.split('/').pop();
    return splitSpec(SETTINGS_COMPONENT_SCENES[base] ?? 'settings');
  }
  if (
    path === 'src/components/SettingsPanel.tsx' ||
    (path.startsWith('src/features/settings/') && !path.startsWith('src/features/settings/hooks/')) ||
    /^src\/components\/settings\//.test(path)
  ) {
    return 'settings';
  }
  if (path === 'src/store/slices/configurationSlice.ts') {
    return 'settings';
  }

  // 8. Repositories view (the primary stars/repos manager view)
  if (
    path.startsWith('src/features/repositories/') ||
    path.startsWith('src/features/repository-chat/') ||
    /^src\/components\/Repository/i.test(path) ||
    /^src\/components\/Category/i.test(path) ||
    /^src\/components\/Search/i.test(path) ||
    /^src\/components\/BatchStarImportDialog\./.test(path) ||
    /^src\/components\/Bulk/i.test(path) ||
    /^src\/components\/SimilarViewBanner\./.test(path) ||
    /^src\/components\/CodeSearchView\./.test(path) ||
    /^src\/components\/ReadmeModal\./.test(path) ||
    /^src\/components\/ContextSidebarBody\./.test(path) ||
    /^src\/components\/SyncModeChoiceModal\./.test(path) ||
    /^src\/components\/GlobalChatHistorySheet\./.test(path) ||
    path === 'src/store/slices/repositorySlice.ts' ||
    path === 'src/store/slices/categorySlice.ts' ||
    /^src\/utils\/(repoSearch|categoryUtils|repositoryCardFields|repositoryCardActions|repositoryHealth|repositoryIdentity|repositoryMerge)\.[jt]s$/.test(path)
  ) {
    return 'repositories';
  }

  // 9. Timeline slice touches both releases and forks
  if (path === 'src/store/slices/timelineSlice.ts') {
    return ['releases', 'forks'];
  }

  // 10. State containers: their visible effect ships through the components
  // changed in the same PR. If a PR changes ONLY these, fall back to global.
  if (
    path.startsWith('src/store/slices/') ||
    path === 'src/store/initialState.ts' ||
    path === 'src/store/schema.ts'
  ) {
    return 'deferred';
  }

  // 11. Conditional overlays: they render only on runtime state the demo
  // preview never provides (update dialogs/banners, open dialogs, error
  // states, hover tooltips, scroll affordances, collapsed release notes), so
  // a screenshot of any default page would show no difference. They follow
  // the components changed in the same PR; a diff touching only these falls
  // back to global.
  if (
    /^src\/components\/(Update|Modal\.|ErrorBoundary\.|DebugModeIndicator\.|ListsPushIndicator\.|BackToTop\.|ScrollToBottom\.|FloatingTooltip\.|SortAlgorithmTooltip\.|MarkdownRenderer\.|BilingualMarkdownRenderer\.|MermaidBlock\.|PluginPageHost\.|lazyKatexCss|modalDismiss\.|platformMeta\.)/.test(path) ||
    /^src\/utils\/(markdownUtils|markdownSplitter|citationPostprocess)\.[jt]s$/.test(path) ||
    path.startsWith('src/features/settings/hooks/') ||
    path.startsWith('src/features/lifecycle/')
  ) {
    return 'deferred';
  }

  // 12. Login page: rendered instead of the app shell when logged out, so
  // global chrome changes do not reach it.
  if (/^src\/components\/LoginScreen\./.test(path) || /^src\/locales\/[^/]+\/login\.json$/.test(path)) {
    return 'login';
  }

  // 13. Token permission helper renders inline on the login page and inside
  // the General settings tab's token-guide dialog; its interaction variants
  // are declared in COMPONENT_VARIANTS.
  if (/^src\/components\/GitHubTokenPermissions\./.test(path)) {
    return ['settings-general', 'login'];
  }

  // 14. Global style/theme/primitive layers render on every app page AND on
  // the login page (which uses ui primitives, translations, theme presets and
  // the public logo), so they trigger the login scene as well.
  if (
    path === 'src/index.css' ||
    path.startsWith('src/styles/') ||
    path.startsWith('src/i18n/') ||
    path.startsWith('src/components/ui/') ||
    path === 'tailwind.config.js' ||
    path === 'postcss.config.js' ||
    path.startsWith('public/') ||
    path === 'index.html' ||
    /^src\/(types|utils)\/themeTokens\./.test(path) ||
    /^src\/constants\/themePresets\./.test(path) ||
    /^src\/lib\/themePresets\./.test(path)
  ) {
    return ['global', 'login'];
  }

  // 15. App shell chrome: every app scene, but not the standalone login page.
  if (
    path === 'src/App.tsx' ||
    path === 'src/main.tsx' ||
    /^src\/components\/Header\./.test(path) ||
    /^src\/components\/WorkspacePageHeader\./.test(path) ||
    path.startsWith('src/lib/') ||
    /^src\/locales\/[^/]+\/common\.json$/.test(path) ||
    path === 'vite.config.ts'
  ) {
    return 'global';
  }

  // Fallback for any unclassified component or feature UI
  if (path.startsWith('src/components/') || path.startsWith('src/features/')) {
    return 'global';
  }

  // UI-adjacent infrastructure (hooks, remaining utils/store files)
  // can render on any page: defer like state containers, so a diff touching
  // only these still falls back to global instead of silently capturing
  // nothing. i18n modules are NOT deferred: every page renders translated
  // strings, so they classify as global above.
  if (
    path.startsWith('src/hooks/') ||
    path.startsWith('src/utils/') ||
    path.startsWith('src/store/')
  ) {
    return 'deferred';
  }

  return null;
}

/**
 * Classify a locale file. Uses the key-level diff when available (precise),
 * otherwise the conservative per-namespace fallback.
 * @param {string} filePath - Path of the changed locale file.
 * @param {string[] | null} [changedKeys] - Top-level keys changed in this file,
 *   or null when the key diff is unavailable.
 * @returns {string[]} Scene/view tokens.
 */
export function classifyLocaleFile(filePath, changedKeys = null) {
  const match = filePath.replace(/\\/g, '/').match(LOCALE_FILE_PATTERN);
  if (!match) return [];
  const ns = match[1];
  if (changedKeys && changedKeys.length > 0) {
    return classifyLocaleKeys(ns, changedKeys);
  }
  if (changedKeys) return []; // diffed, but nothing visible changed (formatting only)
  const fallback = LOCALE_NS_FALLBACK[ns] ?? 'global';
  return splitSpec(typeof fallback === 'string' ? fallback : fallback.join(' '));
}

/** Multiset line diff: lines whose occurrence count differs between the two
 *  versions. Reordering identical lines is not reported — sufficient for the
 *  wiring-diff question ("WHICH code changed", not where). */
const diffChangedLines = (baseRaw, headRaw) => {
  const counts = (raw) => {
    const map = new Map();
    for (const line of (raw ?? '').split('\n')) map.set(line, (map.get(line) ?? 0) + 1);
    return map;
  };
  const base = counts(baseRaw);
  const head = counts(headRaw);
  const changed = [];
  for (const [line, n] of head) {
    for (let i = 0; i < n - (base.get(line) ?? 0); i += 1) changed.push(line);
  }
  for (const [line, n] of base) {
    for (let i = 0; i < n - (head.get(line) ?? 0); i += 1) changed.push(line);
  }
  return changed;
};

const BRACE_ONLY_LINE = /^\s*[{}()]*\s*$/;

/**
 * Whether a file's diff can only affect the Electron desktop surface: every
 * changed line references the desktop bridge (or its electronProxy module) or
 * is bare syntax. The web bundle's desktopBridge no-ops every method outside
 * Electron (see src/services/electronProxy.ts), so such a diff renders no web
 * difference and the file is ignored instead of triggering every scene.
 * @param {string} baseRaw - Base version content (null when unreadable).
 * @param {string} headRaw - Head version content (null when unreadable).
 * @returns {boolean} True when every changed line is desktop-bridge-only.
 */
export function isDesktopBridgeOnlyDiff(baseRaw, headRaw) {
  if (baseRaw === null || headRaw === null) return false;
  const changed = diffChangedLines(baseRaw, headRaw);
  if (changed.length === 0) return true;
  return changed.every((line) => BRACE_ONLY_LINE.test(line) || /desktopBridge|electronProxy/.test(line));
}

/** i18n module wiring (non-locale, non-test): the i18next runtime and its
 *  side effects. Such a diff usually renders nothing by itself, but CAN (boot
 *  language resolution), so it classifies as global — unless the content diff
 *  proves it desktop-bridge-only (see isDesktopBridgeOnlyDiff).
 * @param {string} filePath - Path relative to the repository root.
 * @returns {boolean} True for changed src/i18n module files worth diffing.
 */
export function isI18nWiringPath(filePath) {
  const path = filePath.replace(/\\/g, '/');
  return /^src\/i18n\/[^/]+\.ts$/.test(path) && !/\.(test|spec)\.[jt]sx?$/.test(path);
}

/**
 * Parse output from GitHub API files queries (handles raw JSON or newline-separated filenames).
 * If the compare output indicates branch divergence (force push) or truncation (>= 300 files),
 * returns ['*'] to conservatively trigger all preview scenes.
 * @param {string} raw - Output string from executor.
 * @returns {string[]} List of changed file paths or wildcard ['*'].
 */
export function parseFileList(raw) {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const data = JSON.parse(trimmed);
      if (Array.isArray(data)) {
        return data.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
      }
      if (data && typeof data === 'object') {
        // If git comparison diverged or rewound (e.g. force-push tree rebase/reset), conservative fallback to all scenes
        if (data.status === 'diverged' || data.status === 'behind') {
          return ['*'];
        }
        const files = Array.isArray(data.files) ? data.files : [];
        // GitHub Compare API caps at 300 files without pagination; if at cap, results may be truncated
        if (files.length >= 300) {
          return ['*'];
        }
        return files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
      }
    } catch {
      // Fall through to plain text splitting if JSON parse fails
    }
  }
  return trimmed.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Given an array of changed file paths, determine which scenes to capture.
 * Returns an array of scene names / plugin specs in canonical order. Empty
 * array if no UI changes.
 * @param {string[]} paths - Changed file paths.
 * @param {Record<string, string[]>} [localeKeysByPath] - Optional map from
 *   locale file path to its diffed top-level keys. Entries with an empty key
 *   array mean "diffed, nothing visible changed"; missing entries fall back to
 *   the file-level namespace mapping.
 * @param {Set<string>} [inertPaths] - Paths whose content diff proves they
 *   render no web difference (desktop-bridge-only i18n wiring changes); they
 *   are skipped like ignored paths.
 * @returns {string[]} Selected scene names / specs.
 */
export function mapPathsToScenes(paths, localeKeysByPath = {}, inertPaths = new Set()) {
  const tokens = new Set();
  let hasGlobal = false;
  let hasDeferred = false;
  // Provenance per static scene: a scene confirms coverage for an
  // accompanying deferred change only when some app component (not a plugin
  // manifest) provided it.
  const appScenes = new Set();
  const manifestScenes = new Set();

  for (const path of paths) {
    if (path === '*' || path === '__ALL__') {
      hasGlobal = true;
      continue;
    }
    if (inertPaths.has(path)) {
      continue;
    }
    let classification;
    if (LOCALE_FILE_PATTERN.test(path.replace(/\\/g, '/')) && Object.prototype.hasOwnProperty.call(localeKeysByPath, path)) {
      classification = classifyLocaleFile(path, localeKeysByPath[path]);
    } else {
      classification = classifyPath(path);
    }
    if (!classification) continue;
    const list = Array.isArray(classification) ? classification : [classification];
    const fromManifest = Array.isArray(classification)
      && classification.length === 2
      && classification[0] === 'settings-plugins'
      && classification[1]?.startsWith('plugin:');
    for (const token of list) {
      if (token === 'global') hasGlobal = true;
      else if (token === 'deferred') hasDeferred = true;
      else {
        tokens.add(token);
        if (fromManifest) manifestScenes.add(token);
        else if (!token.startsWith('plugin:')) appScenes.add(token);
      }
    }
  }

  const selectedScenes = new Set();
  const pluginSpecs = new Set();

  const expandToken = (token) => {
    if (token.startsWith('plugin:')) {
      pluginSpecs.add(token);
      return;
    }
    if (EXTRA_SCENE_NAMES.has(token) || SETTINGS_SCENE_NAMES.has(token) || VIEW_SCENES.includes(token)) {
      selectedScenes.add(token);
      return;
    }
    const scenes = VIEW_TO_SCENES[token];
    if (scenes) {
      for (const scene of scenes) selectedScenes.add(scene);
    }
  };

  for (const token of tokens) expandToken(token);

  // State/infra changes have unconfirmed blast radius: escalate to global
  // unless concrete app-component scenes were found in the same diff. Scenes
  // that exist only through a plugin manifest (and plugin specs alone) do not
  // cover the rest of the app a translation or state change could touch.
  if (hasDeferred && appScenes.size === 0) {
    hasGlobal = true;
  }

  if (hasGlobal) {
    // Global chrome re-renders on every view and settings tab. Plugin pages
    // are standalone documents and only depend on their own files, which are
    // classified separately — so only plugin specs from this same diff join in.
    for (const scene of ALL_SCENES) selectedScenes.add(scene);
  }

  const ordered = ALL_SCENES.filter((scene) => selectedScenes.has(scene));
  const extras = [...EXTRA_SCENE_NAMES].filter((scene) => selectedScenes.has(scene)).sort();
  return [...ordered, ...extras, ...[...pluginSpecs].sort()];
}

const FILES_PER_PAGE = 100;
const MAX_PAGES = 100;

/**
 * Execute the GitHub CLI with the specified arguments.
 * @param {string[]} args - CLI arguments to pass to `gh`.
 * @returns {string} Output string from the CLI command.
 */
function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

/**
 * Ensure an environment variable is present and return its trimmed value.
 * @param {string} name - Name of the environment variable value to return.
 * @returns {string} The non-empty environment variable value.
 */
function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`detect: missing env ${name}`);
    process.exit(1);
  }
  return value;
}

/**
 * Collect changed paths from GitHub API.
 * - When action is 'synchronize', inspects the commit/push range (BEFORE_SHA...HEAD_SHA).
 *   If the range diverged or is truncated, conservatively returns ['*'] for all scenes.
 *   If the compare query fails, falls back directly to PR changed files.
 * - Otherwise (opened, reopened, labeled, dispatch), inspects all changed files of the pull request.
 * @param {object} params
 * @param {string} params.repo - Repository in "owner/repo" format.
 * @param {number} params.pr - Pull request number.
 * @param {string} [params.action] - GitHub event action (e.g. 'synchronize', 'opened').
 * @param {string} [params.beforeSha] - Previous head SHA for synchronize events.
 * @param {string} [params.headSha] - Current head commit SHA.
 * @param {Function} [params.executor] - Command execution function (defaults to gh).
 * @returns {string[]} Array of unique changed file paths.
 */
export function collectChangedPaths({ repo, pr, action, beforeSha, headSha, executor = gh }) {
  const isSha = (s) => typeof s === 'string' && /^[0-9a-f]{40}$/i.test(s.trim()) && !/^0+$/.test(s.trim());

  if (action === 'synchronize' && isSha(beforeSha) && isSha(headSha)) {
    try {
      console.log(`detect: comparing push range ${beforeSha.slice(0, 7)}...${headSha.slice(0, 7)}`);
      const url = `repos/${repo}/compare/${beforeSha.trim()}...${headSha.trim()}`;
      const output = executor(['api', url]);
      const filePaths = parseFileList(output);
      const paths = new Set(filePaths);
      return [...paths];
    } catch (err) {
      console.warn(`detect: compare failed (${err.message}); falling back to PR files`);
    }
  }

  console.log(`detect: reading PR #${pr} changed files`);
  const paths = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `repos/${repo}/pulls/${pr}/files?per_page=${FILES_PER_PAGE}&page=${page}`;
    const output = executor(['api', url]);
    const filePaths = parseFileList(output);
    if (filePaths.length === 0) break;
    for (const name of filePaths) paths.add(name);
    if (filePaths.length < FILES_PER_PAGE) break;
  }
  return [...paths];
}

/**
 * Fetch a file's raw content at a given ref through the GitHub contents API.
 * The ref goes into the URL query string: `gh api -f` does not populate query
 * parameters for GET requests (the contents endpoint then 404s), so passing
 * it as a field would make every locale content read silently fail.
 * @param {object} params
 * @param {string} params.repo - Repository in "owner/repo" format.
 * @param {string} params.path - File path relative to the repository root.
 * @param {string} params.ref - Commit sha or ref to read from.
 * @param {Function} [params.executor] - Command execution function (defaults to gh).
 * @returns {string | null} Raw file content, or null if it cannot be read.
 */
function fetchContentAt({ repo, path, ref, executor = gh }) {
  try {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return executor([
      'api',
      `repos/${repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`,
      '-H',
      'Accept: application/vnd.github.raw+json',
    ]);
  } catch (err) {
    console.warn(`detect: could not read ${path} at ${ref.slice(0, 7)} (${err.message.split('\n')[0]})`);
    return null;
  }
}

/**
 * Diff the top-level keys of a JSON object.
 * @param {string} baseRaw - Base version content.
 * @param {string} headRaw - Head version content.
 * @returns {string[]} Keys that were added, removed or whose value changed.
 */
export function diffTopLevelKeys(baseRaw, headRaw) {
  const parse = (raw) => {
    try {
      const data = JSON.parse(raw);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  };
  const base = parse(baseRaw);
  const head = parse(headRaw);
  const changed = [];
  for (const key of Object.keys(head)) {
    if (!(key in base) || JSON.stringify(base[key]) !== JSON.stringify(head[key])) {
      changed.push(key);
    }
  }
  for (const key of Object.keys(base)) {
    if (!(key in head)) changed.push(key);
  }
  return changed;
}

/**
 * For every changed locale file, diff its top-level keys between the two refs
 * so scene mapping can be done per key instead of per file. Unreadable files
 * are simply absent from the result (callers fall back to file-level mapping).
 * @param {object} params
 * @param {string} params.repo - Repository in "owner/repo" format.
 * @param {string[]} params.paths - All changed file paths.
 * @param {string} params.baseRef - Base commit sha (push base or PR base).
 * @param {string} params.headRef - Head commit sha.
 * @param {Function} [params.executor] - Command execution function (defaults to gh).
 * @returns {Promise<Record<string, string[]>>} Map from locale file path to changed keys.
 */
export async function diffLocaleKeys({ repo, paths, baseRef, headRef, executor = gh }) {
  const localeFiles = [...new Set(paths)].filter((p) => LOCALE_FILE_PATTERN.test(p.replace(/\\/g, '/')));
  const result = {};
  for (const file of localeFiles) {
    const [baseRaw, headRaw] = await Promise.all([
      fetchContentAt({ repo, path: file, ref: baseRef, executor }),
      fetchContentAt({ repo, path: file, ref: headRef, executor }),
    ]);
    if (baseRaw === null || headRaw === null) continue;
    result[file] = diffTopLevelKeys(baseRaw, headRaw);
  }
  return result;
}

/**
 * Append key-value pairs to the GitHub Actions output file.
 * @param {string} outputPath - File path pointed by GITHUB_OUTPUT.
 * @param {Record<string, string | number>} pairs - Key-value output parameters.
 */
export function writeOutput(outputPath, pairs) {
  const body = Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  appendFileSync(outputPath, `${body}\n`, 'utf8');
}

/**
 * Main entry point for detect script execution in CI.
 */
export async function main() {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const prRaw = (process.env.PR ?? '').trim();
  if (!/^\d{1,9}$/.test(prRaw)) {
    console.error(`detect: PR must be a positive integer, got ${JSON.stringify(process.env.PR)}`);
    process.exit(1);
  }
  const pr = Number(prRaw);
  const output = requireEnv('GITHUB_OUTPUT');
  const action = (process.env.EVENT_ACTION ?? '').trim();
  const beforeSha = (process.env.BEFORE_SHA ?? '').trim();
  const headSha = (process.env.HEAD_SHA ?? '').trim();

  const pull = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`]));
  if (pull.state !== 'open') {
    console.log(`detect: PR #${pr} is ${pull.state}; skipping`);
    writeOutput(output, { ui: 'false', sha: '', number: pr, scenes: '' });
    process.exit(0);
  }

  const effectiveHeadSha = headSha || pull.head?.sha;
  const filenames = collectChangedPaths({
    repo,
    pr,
    action,
    beforeSha,
    headSha: effectiveHeadSha,
  });

  // Content-level diffing against the base ref, for two purposes:
  // - locale files: key-level diffing so only the strings that actually
  //   changed map to scenes, instead of the whole namespace going global;
  // - i18n module wiring: a diff confined to desktop-bridge lines cannot
  //   render in the web preview and must not trigger every scene.
  let localeKeysByPath = {};
  const inertPaths = new Set();
  if (!filenames.includes('*')) {
    const baseRef = action === 'synchronize' && /^[0-9a-f]{40}$/i.test(beforeSha) && !/^0+$/.test(beforeSha)
      ? beforeSha.trim()
      : pull.base?.sha;
    if (baseRef) {
      localeKeysByPath = await diffLocaleKeys({ repo, paths: filenames, baseRef, headRef: effectiveHeadSha });
      for (const wiringPath of filenames.filter(isI18nWiringPath)) {
        const [baseRaw, headRaw] = await Promise.all([
          fetchContentAt({ repo, path: wiringPath, ref: baseRef }),
          fetchContentAt({ repo, path: wiringPath, ref: effectiveHeadSha }),
        ]);
        if (isDesktopBridgeOnlyDiff(baseRaw, headRaw)) {
          console.log(`detect: ${wiringPath} diff is desktop-bridge-only; renders no web change`);
          inertPaths.add(wiringPath);
        }
      }
    }
  }

  const forcedByLabel = (pull.labels ?? []).some((label) => label?.name === 'ui-preview');
  let scenes = mapPathsToScenes(filenames, localeKeysByPath, inertPaths);

  if (scenes.length === 0 && forcedByLabel) {
    console.log(`detect: forced by ui-preview label; capturing all scenes`);
    scenes = [...ALL_SCENES];
  }

  if (scenes.length === 0) {
    console.log(`detect: PR #${pr} (${filenames.length} changed path(s)) has no UI adjustments and no force label`);
    writeOutput(output, { ui: 'false', sha: effectiveHeadSha, number: pr, scenes: '' });
    process.exit(0);
  }

  console.log(`detect: PR #${pr} changes require ${scenes.length} scene(s): ${scenes.join(', ')}`);
  writeOutput(output, {
    ui: 'true',
    sha: effectiveHeadSha,
    number: pr,
    scenes: scenes.join(','),
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
