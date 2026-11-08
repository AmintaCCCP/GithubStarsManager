#!/usr/bin/env node
/**
 * Decide whether a pull request touches the UI, for the detect job.
 *
 * Runs on a checkout of the default branch (never PR code) and only reads the
 * PR / commit diff through the API. Outputs (to $GITHUB_OUTPUT):
 *   ui     true|false
 *   sha    the PR head commit to record
 *   number the PR number
 *   scenes comma-separated list of scene names to shoot (e.g. "gists,releases")
 *
 * Environment: GH_TOKEN (read), GITHUB_REPOSITORY, PR (number), GITHUB_OUTPUT,
 *              EVENT_ACTION (optional), BEFORE_SHA (optional), HEAD_SHA (optional).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * All recognized UI preview scenes in canonical recording order.
 * @type {string[]}
 */
const ALL_SCENES = [
  'repositories-light',
  'repositories-dark',
  'gists',
  'releases',
  'forks',
  'discovery',
  'settings',
  'plugin-repo-custom-fields',
  'plugin-repo-info-card',
  'plugin-repo-insights',
];

/**
 * Mapping from high-level view identifier to the preview scene names it renders.
 * @type {Record<string, string[]>}
 */
const VIEW_TO_SCENES = {
  repositories: ['repositories-light', 'repositories-dark'],
  gists: ['gists'],
  releases: ['releases'],
  forks: ['forks'],
  discovery: ['discovery'],
  settings: ['settings'],
  'plugin-repo-custom-fields': ['plugin-repo-custom-fields'],
  'plugin-repo-info-card': ['plugin-repo-info-card'],
  'plugin-repo-insights': ['plugin-repo-insights'],
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
 * Classify a changed path to its affected view identifier or list of view identifiers.
 * Returns null if the file is ignored or does not affect UI.
 * @param {string} filePath - Path of the file relative to repository root.
 * @returns {'repositories' | 'gists' | 'releases' | 'forks' | 'discovery' | 'settings' | 'global' | string[] | null}
 */
export function classifyPath(filePath) {
  const path = filePath.replace(/\\/g, '/');
  if (isIgnoredPath(path)) {
    return null;
  }

  // 1. Gists view
  if (
    path.startsWith('src/features/gists/') ||
    /^src\/components\/Gist/i.test(path) ||
    /^src\/locales\/[^/]+\/gists\.json$/.test(path) ||
    path === 'src/store/slices/gistSlice.ts' ||
    path === 'src/utils/gistUtils.ts'
  ) {
    return 'gists';
  }

  // 2. Releases view
  if (
    path.startsWith('src/features/releases/') ||
    /^src\/components\/Release/i.test(path) ||
    /^src\/components\/Asset(FilterManager|LeadingIcon)\./.test(path) ||
    /^src\/components\/InstallableAssetRecommendation\./.test(path) ||
    /^src\/components\/SiWindows\./.test(path) ||
    /^src\/hooks\/useReleaseArtifactActions\./.test(path) ||
    /^src\/locales\/[^/]+\/releases\.json$/.test(path) ||
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
    /^src\/components\/XTweetModal\./.test(path) ||
    /^src\/components\/WeeklyIssueModal\./.test(path) ||
    /^src\/locales\/[^/]+\/discovery\.json$/.test(path) ||
    path === 'src/store/slices/discoverySlice.ts' ||
    /^src\/utils\/(discoveryFeeds|discoveryRss|trendingSnapshots|telegramFollows|xTweetFollows)\.[jt]s$/.test(path)
  ) {
    return 'discovery';
  }

  // 5. Plugin UI changes touch individual example plugin views or settings
  if (/^examples\/plugins\/repo-custom-fields\/ui\//.test(path)) {
    return 'plugin-repo-custom-fields';
  }
  if (/^examples\/plugins\/repo-info-card\/ui\//.test(path)) {
    return 'plugin-repo-info-card';
  }
  if (/^examples\/plugins\/repo-insights\/ui\//.test(path)) {
    return 'plugin-repo-insights';
  }
  if (
    path.startsWith('src/features/plugins/') ||
    path.startsWith('src/plugins/') ||
    /^examples\/plugins\/[^/]+\/(ui\/|manifest\.json$)/.test(path) ||
    /^src\/components\/PluginPage/i.test(path) ||
    /^src\/components\/settings\/Plugin/i.test(path) ||
    /^src\/locales\/[^/]+\/plugins\.json$/.test(path)
  ) {
    return ['settings', 'plugin-repo-custom-fields', 'plugin-repo-info-card', 'plugin-repo-insights'];
  }

  // 6. Settings view
  if (
    path.startsWith('src/features/settings/') ||
    /^src\/components\/Settings/i.test(path) ||
    path.startsWith('src/components/settings/') ||
    /^src\/components\/(Telegram|XTweet)SettingsModal\./.test(path) ||
    /^src\/locales\/[^/]+\/settings\.json$/.test(path) ||
    path === 'src/store/slices/configurationSlice.ts'
  ) {
    return 'settings';
  }

  // 7. Repositories view (the primary stars/repos manager view)
  if (
    path.startsWith('src/features/repositories/') ||
    path.startsWith('src/features/repository-chat/') ||
    /^src\/components\/Repository/i.test(path) ||
    /^src\/components\/Category/i.test(path) ||
    /^src\/components\/Search/i.test(path) ||
    /^src\/components\/FilterModal\./.test(path) ||
    /^src\/components\/BatchStarImportDialog\./.test(path) ||
    /^src\/components\/Bulk/i.test(path) ||
    /^src\/components\/SimilarViewBanner\./.test(path) ||
    /^src\/components\/CodeSearchView\./.test(path) ||
    /^src\/components\/ReadmeModal\./.test(path) ||
    /^src\/components\/ContextSidebarBody\./.test(path) ||
    /^src\/components\/SyncModeChoiceModal\./.test(path) ||
    /^src\/components\/GlobalChatHistorySheet\./.test(path) ||
    /^src\/locales\/[^/]+\/(repositories|chat|search)\.json$/.test(path) ||
    path === 'src/store/slices/repositorySlice.ts' ||
    path === 'src/store/slices/categorySlice.ts' ||
    /^src\/utils\/(repoSearch|categoryUtils|repositoryCardFields|repositoryCardActions|repositoryHealth|repositoryIdentity|repositoryMerge)\.[jt]s$/.test(path)
  ) {
    return 'repositories';
  }

  // 8. Timeline slice touches both releases and forks
  if (path === 'src/store/slices/timelineSlice.ts') {
    return ['releases', 'forks'];
  }

  // 9. Global UI elements (affect all scenes)
  if (
    path === 'src/App.tsx' ||
    path === 'src/main.tsx' ||
    path === 'src/index.css' ||
    path.startsWith('src/styles/') ||
    /^src\/components\/Header\./.test(path) ||
    /^src\/components\/WorkspacePageHeader\./.test(path) ||
    path.startsWith('src/components/ui/') ||
    path.startsWith('src/lib/') ||
    /^src\/components\/Modal\./.test(path) ||
    /^src\/components\/ErrorBoundary\./.test(path) ||
    /^src\/components\/LoginScreen\./.test(path) ||
    /^src\/components\/Update/i.test(path) ||
    /^src\/components\/ListsPushIndicator\./.test(path) ||
    /^src\/components\/BackToTop\./.test(path) ||
    /^src\/components\/ScrollToBottom\./.test(path) ||
    /^src\/components\/MarkdownRenderer\./.test(path) ||
    /^src\/components\/BilingualMarkdownRenderer\./.test(path) ||
    /^src\/components\/MermaidBlock\./.test(path) ||
    /^src\/components\/FloatingTooltip\./.test(path) ||
    /^src\/components\/DebugModeIndicator\./.test(path) ||
    /^src\/components\/GitHubTokenPermissions\./.test(path) ||
    /^src\/components\/SortAlgorithmTooltip\./.test(path) ||
    /^src\/constants\/themePresets\./.test(path) ||
    /^src\/(types|utils)\/themeTokens\./.test(path) ||
    /^src\/utils\/(markdownUtils|markdownSplitter|citationPostprocess)\.[jt]s$/.test(path) ||
    /^src\/lib\/themePresets\./.test(path) ||
    /^src\/locales\/[^/]+\/(common|app|login)\.json$/.test(path) ||
    path === 'src/store/slices/preferenceSlice.ts' ||
    path === 'index.html' ||
    path === 'tailwind.config.js' ||
    path === 'postcss.config.js' ||
    path === 'vite.config.ts' ||
    path.startsWith('public/')
  ) {
    return 'global';
  }

  // Fallback for any unclassified component or feature UI
  if (path.startsWith('src/components/') || path.startsWith('src/features/')) {
    return 'global';
  }

  return null;
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
        // If git comparison diverged (e.g. force-push tree rebase), conservative fallback to all scenes
        if (data.status === 'diverged') {
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
 * Returns an array of scene names in canonical order. Empty array if no UI changes.
 * @param {string[]} paths - Changed file paths.
 * @returns {string[]} Selected scene names.
 */
export function mapPathsToScenes(paths) {
  const views = new Set();

  for (const path of paths) {
    if (path === '*' || path === '__ALL__') {
      views.add('global');
      continue;
    }
    const classification = classifyPath(path);
    if (!classification) continue;
    if (Array.isArray(classification)) {
      for (const view of classification) views.add(view);
    } else {
      views.add(classification);
    }
  }

  if (views.size === 0) {
    return [];
  }

  if (views.has('global')) {
    return [...ALL_SCENES];
  }

  const selectedScenes = new Set();
  for (const view of views) {
    const scenes = VIEW_TO_SCENES[view];
    if (scenes) {
      for (const scene of scenes) selectedScenes.add(scene);
    }
  }

  return ALL_SCENES.filter((scene) => selectedScenes.has(scene));
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
 * @param {string} name - Name of the environment variable.
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
      if (paths.size > 0) {
        return [...paths];
      }
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

  const forcedByLabel = (pull.labels ?? []).some((label) => label?.name === 'ui-preview');
  let scenes = mapPathsToScenes(filenames);

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

export { ALL_SCENES, VIEW_TO_SCENES };

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
