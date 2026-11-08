/* Tests for the UI change detection and scene mapping in detect.mjs.
 * Run: node test-detect.mjs */
import {
  isIgnoredPath,
  classifyPath,
  mapPathsToScenes,
  ALL_SCENES,
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

// 1. isIgnoredPath tests
check('test file in src is ignored', isIgnoredPath('src/App.contextSidebar.test.tsx'), true);
check('test file with spec is ignored', isIgnoredPath('src/components/foo.spec.ts'), true);
check('__tests__ file is ignored', isIgnoredPath('src/features/repositories/__tests__/repo.test.ts'), true);
check('src/test fixture is ignored', isIgnoredPath('src/test/setup.ts'), true);
check('markdown file is ignored', isIgnoredPath('README.md'), true);
check('nested markdown is ignored', isIgnoredPath('docs/plugins/v1-development.md'), true);
check('plugin readme is ignored', isIgnoredPath('examples/plugins/repo-custom-fields/README.md'), true);
check('plugin worker is ignored', isIgnoredPath('examples/plugins/markdown-exporter/worker.js'), true);
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
check('types are ignored', isIgnoredPath('src/types/index.ts'), true);
check('utils are ignored', isIgnoredPath('src/utils/lanAddress.ts'), true);
check('polyfills is ignored', isIgnoredPath('src/polyfills.ts'), true);
check('package.json is ignored', isIgnoredPath('package.json'), true);
check('package-lock.json is ignored', isIgnoredPath('package-lock.json'), true);

check('UI component is not ignored', isIgnoredPath('src/components/GistView.tsx'), false);
check('plugin UI index.js is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/index.js'), false);
check('plugin UI style.css is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/style.css'), false);
check('plugin UI index.html is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/ui/index.html'), false);
check('plugin manifest is not ignored', isIgnoredPath('examples/plugins/repo-custom-fields/manifest.json'), false);
check('index.css is not ignored', isIgnoredPath('src/index.css'), false);
check('themeTokens is not ignored', isIgnoredPath('src/types/themeTokens.ts'), false);
check('tailwind config is not ignored', isIgnoredPath('tailwind.config.js'), false);

// 2. classifyPath tests
check('gists component', classifyPath('src/components/GistView.tsx'), 'gists');
check('gists feature', classifyPath('src/features/gists/hooks/useGist.ts'), 'gists');
check('gists locale', classifyPath('src/locales/zh/gists.json'), 'gists');
check('gists slice', classifyPath('src/store/slices/gistSlice.ts'), 'gists');

check('releases component', classifyPath('src/components/ReleaseTimeline.tsx'), 'releases');
check('releases asset filter', classifyPath('src/components/AssetFilterManager.tsx'), 'releases');
check('releases feature', classifyPath('src/features/releases/hooks/useReleases.ts'), 'releases');
check('releases locale', classifyPath('src/locales/en/releases.json'), 'releases');

check('forks component', classifyPath('src/components/ForkTimeline.tsx'), 'forks');
check('forks feature', classifyPath('src/features/forks/hooks/useForks.ts'), 'forks');
check('forks locale', classifyPath('src/locales/ja/forks.json'), 'forks');

check('discovery component', classifyPath('src/components/DiscoveryView.tsx'), 'discovery');
check('discovery subscription card', classifyPath('src/components/SubscriptionRepoCard.tsx'), 'discovery');
check('discovery feature', classifyPath('src/features/discovery/hooks/useDiscovery.ts'), 'discovery');
check('discovery locale', classifyPath('src/locales/zh/discovery.json'), 'discovery');

check('settings component', classifyPath('src/components/SettingsPanel.tsx'), 'settings');
check('settings subcomponent', classifyPath('src/components/settings/DataManagementSettings.tsx'), 'settings');
check('settings feature', classifyPath('src/features/settings/hooks/useSettings.ts'), 'settings');
check('settings locale', classifyPath('src/locales/zh/settings.json'), 'settings');

check('repositories list', classifyPath('src/components/RepositoryList.tsx'), 'repositories');
check('repositories card', classifyPath('src/components/RepositoryCard.tsx'), 'repositories');
check('repositories chat feature', classifyPath('src/features/repository-chat/components/ChatSheet.tsx'), 'repositories');
check('repositories locale', classifyPath('src/locales/zh/repositories.json'), 'repositories');

check('plugin modal touches repositories and settings', classifyPath('src/components/PluginPageModal.tsx'), ['repositories', 'settings']);
check('plugin settings panel touches repositories and settings', classifyPath('src/components/settings/PluginSettingsPanel.tsx'), ['repositories', 'settings']);
check('plugin example UI touches repositories and settings', classifyPath('examples/plugins/repo-custom-fields/ui/index.js'), ['repositories', 'settings']);
check('plugin example manifest touches repositories and settings', classifyPath('examples/plugins/repo-custom-fields/manifest.json'), ['repositories', 'settings']);
check('plugin feature touches repositories and settings', classifyPath('src/features/plugins/hooks/usePluginAI.ts'), ['repositories', 'settings']);
check('plugin locale touches repositories and settings', classifyPath('src/locales/zh/plugins.json'), ['repositories', 'settings']);

check('timelineSlice touches releases and forks', classifyPath('src/store/slices/timelineSlice.ts'), ['releases', 'forks']);

check('App.tsx is global', classifyPath('src/App.tsx'), 'global');
check('main.tsx is global', classifyPath('src/main.tsx'), 'global');
check('index.css is global', classifyPath('src/index.css'), 'global');
check('Header.tsx is global', classifyPath('src/components/Header.tsx'), 'global');
check('Modal.tsx is global', classifyPath('src/components/Modal.tsx'), 'global');
check('ui button is global', classifyPath('src/components/ui/button.tsx'), 'global');
check('tailwind.config.js is global', classifyPath('tailwind.config.js'), 'global');
check('themeTokens.ts is global', classifyPath('src/types/themeTokens.ts'), 'global');

// 3. mapPathsToScenes tests
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

check('settings change maps only to settings', mapPathsToScenes([
  'src/components/SettingsPanel.tsx',
]), ['settings']);

check('repositories change maps to repositories-light and repositories-dark', mapPathsToScenes([
  'src/components/RepositoryList.tsx',
]), ['repositories-light', 'repositories-dark']);

check('plugin UI change maps to repositories-light, repositories-dark, and settings', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/ui/index.js',
]), ['repositories-light', 'repositories-dark', 'settings']);

check('plugin UI change with worker and readme still maps to repositories and settings', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/ui/style.css',
  'examples/plugins/markdown-exporter/worker.js',
  'examples/plugins/repo-custom-fields/README.md',
]), ['repositories-light', 'repositories-dark', 'settings']);

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

check('PR 575 commit 8f2fbc18 (with Modal.tsx) maps to ALL_SCENES', mapPathsToScenes([
  'examples/plugins/repo-custom-fields/README.md',
  'examples/plugins/repo-custom-fields/manifest.json',
  'examples/plugins/repo-custom-fields/ui/index.js',
  'examples/plugins/repo-custom-fields/ui/style.css',
  'src/components/Modal.tsx',
  'src/components/PluginPageModal.test.tsx',
  'src/components/PluginPageModal.tsx',
]), ALL_SCENES);

check('PR 575 commit cfd97a2d (docs only) maps to empty scenes', mapPathsToScenes([
  'docs/plugins/v1-development.md',
  'examples/plugins/repo-custom-fields/README.md',
]), []);

check('timelineSlice maps to releases and forks', mapPathsToScenes([
  'src/store/slices/timelineSlice.ts',
]), ['releases', 'forks']);

console.log(`\nTest result: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
process.exit(failures ? 1 : 0);
