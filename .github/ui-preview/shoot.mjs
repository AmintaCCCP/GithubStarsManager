#!/usr/bin/env node
/**
 * Take UI preview screenshots of a running build.
 *
 * Each scene boots the app from a fresh browser context seeded with demo data
 * (see fixtures/demo-state.json), so screenshots show a populated UI with zero
 * network dependencies and zero credentials.
 *
 * Usage:
 *   node shoot.mjs --url http://127.0.0.1:4173 --out <dir> [--only <spec>[,<spec>...]]
 *
 * Specs are the scene names listed in SCENES below, plus dynamic plugin specs
 * `plugin:<slug>` (every page contributed by examples/plugins/<slug>, resolved
 * from the built bundle at run time), interaction variant specs from detect's
 * SCENE_VARIANTS (e.g. `settings-general-token-guide`: the base scene's page
 * driven into an open-dialog / switched-tab state before the shot), and `all`
 * for every static scene.
 *
 * Settings scenes navigate to one specific Settings tab through
 * `gsm:pending-settings-tab` (sessionStorage), so a change to a single panel
 * only needs that panel's scene. Electron-only tabs (network, plugins, mcp)
 * render behind a minimal window.electronAPI stub built from the plugin
 * manifests in the served bundle.
 */
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedPersistedState, PERSIST_VERSION } from './seed.mjs';
import { SETTINGS_TABS, SCENE_VARIANTS } from './detect.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** One context per scene: persisted state (IndexedDB) is context-scoped.
 *  Every app view gets a scene. `currentView` is the persisted store field the
 *  app switches on; `settingsTab` additionally navigates to one Settings tab.
 *  `settleMs` extends the post-load settle wait for views that fetch their
 *  data after mount (discovery auto-refreshes its channels). `state` overrides
 *  are merged over the base fixture. */
const VIEW_SCENES = [
  { name: 'repositories-light', currentView: 'repositories', themeMode: 'light' },
  { name: 'repositories-dark', currentView: 'repositories', themeMode: 'dark' },
  { name: 'gists', currentView: 'gists', themeMode: 'light' },
  { name: 'releases', currentView: 'releases', themeMode: 'light' },
  { name: 'forks', currentView: 'forks', themeMode: 'light' },
  { name: 'discovery', currentView: 'subscription', themeMode: 'light', selectedDiscoveryChannel: 'trending', settleMs: 4000 },
  // Login page: rendered instead of the app shell when logged out. Not part
  // of ALL_SCENES — global chrome never reaches it.
  { name: 'login', loginScreen: true, themeMode: 'light' },
];

const SETTINGS_SCENES = SETTINGS_TABS.map((tab) => ({
  name: tab.scene,
  currentView: 'settings',
  settingsTab: tab.tab,
  themeMode: 'light',
  ...(tab.electronOnly ? { electronStub: true } : {}),
}));

const SCENES = [...VIEW_SCENES, ...SETTINGS_SCENES];

/** Behavior for each interaction variant from detect.mjs's SCENE_VARIANTS,
 *  applied in the base scene's browser context right after its screenshot:
 *  one click, a readiness wait, then the shot. `clickLocaleKey` resolves the
 *  click target's accessible name from the built bundle's zh locale (the
 *  preview renders zh), so renamed UI strings keep working without tool-side
 *  changes. A variant that cannot reach its state is skipped with a warning —
 *  the base screenshot still publishes. */
const VARIANT_ACTIONS = {
  // General settings' token-guide dialog: GitHubTokenPermissions renders
  // inside a Dialog, opened by the card's guide button.
  'settings-general-token-guide': {
    clickLocaleKey: 'app:generalPanel.token-permission-guide',
    readySelector: '[role="dialog"]',
    fullPage: false,
  },
  // Login page token permissions: switch to the fine-grained tab, whose
  // warning box is invisible in the default (classic-tab) screenshot. The
  // selectors key on the component's aria ids (`${useId}-panel-fine-grained`),
  // not on tab order or locale text.
  'login-token-finegrained': {
    clickSelector: '[role="tab"][aria-controls$="-panel-fine-grained"]',
    readySelector: '[role="tabpanel"][id$="-panel-fine-grained"]',
    fullPage: true,
  },
};

/** Scene names from before plugin scenes became dynamic; kept so a stale
 *  workflow output still resolves. */
const LEGACY_PLUGIN_SCENES = {
  'plugin-repo-custom-fields': 'repo-custom-fields',
  'plugin-repo-info-card': 'repo-info-card',
  'plugin-repo-insights': 'repo-insights',
};

/** Tuned readiness selectors for known plugin pages; other pages fall back to
 *  a generic body-content wait. Keys are `<slug>/<pageId>`. */
const PLUGIN_READY_SELECTORS = {
  'repo-custom-fields/fields': '#head:not([hidden])',
  'repo-info-card/info-card': '.style-grid > [role="radio"]',
  'repo-insights/insights': '#head:not([hidden])',
};

/**
 * Fetch a JSON document from the preview server.
 * @param {string} url - Absolute URL to fetch.
 * @returns {Promise<object | Array | null>} Parsed JSON, or null when the
 *   document is missing or invalid.
 */
async function fetchJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Resolve a click target's accessible name from the built bundle's zh locale
 * (the preview renders zh). Key format: "<ns>:<dotted.key.path>". The build
 * job copies src/locales next to the bundle (import.meta.glob ships locale
 * JSONs only as JS chunks), so the raw files are statically served at
 * /locales/<lang>/<ns>.json; a missing key or file skips the variant.
 * @param {string} url - Base preview server URL.
 * @param {string} nsKey - Namespace-qualified locale key.
 * @returns {Promise<string | null>} The translated text, or null when missing.
 */
async function resolveLocaleText(url, nsKey) {
  const sep = nsKey.indexOf(':');
  if (sep < 0) return null;
  const ns = nsKey.slice(0, sep);
  const keyPath = nsKey.slice(sep + 1).split('.');
  const data = await fetchJson(new URL(`/locales/zh/${encodeURIComponent(ns)}.json`, url).href);
  let node = data;
  for (const key of keyPath) node = node?.[key];
  return typeof node === 'string' && node.trim() ? node : null;
}

/**
 * Read the list of bundled plugin directory names from the build output. The
 * build job writes dist/plugins/index.json; without it the Plugins settings
 * scene still renders, just with an empty registry list.
 * @param {string} url - Base preview server URL.
 * @returns {Promise<string[]>} Plugin slugs.
 */
async function listBundledPlugins(url) {
  const index = await fetchJson(new URL('/plugins/index.json', url).href);
  return Array.isArray(index) ? index.filter((slug) => typeof slug === 'string') : [];
}

/** Scene names must survive publish.mjs's allow-list (`^[a-z0-9][a-z0-9-]*\.png$`)
 *  and must not escape the output directory, so slugs and page ids from PR
 *  manifests are validated and re-encoded into a publish-compatible form. */
const SAFE_MANIFEST_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Re-encode a slug or page id into a filename-safe, publish-compatible
 * segment (lowercase, only [a-z0-9-], non-empty).
 * @param {string} value - Raw manifest segment.
 * @param {string} fallback - Name to use when nothing survives the encoding.
 * @returns {string} Sanitized segment.
 */
const nameSegment = (value, fallback) => {
  const clean = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean || fallback;
};

/**
 * Expand `plugin:<slug>` specs into concrete page scenes by reading each
 * plugin's manifest from the built bundle. Manifest-supplied slugs and page
 * ids are validated (no traversal, sane charset) and encoded so the produced
 * file names are always accepted by publish.mjs; distinct ids that encode to
 * the same segment get a numeric suffix instead of colliding.
 * @param {string} url - Base preview server URL.
 * @param {string[]} slugs - Plugin directory names requested for capture.
 * @returns {Promise<Array<object>>} Scene definitions for every contributed page.
 */
async function resolvePluginScenes(url, slugs) {
  const scenes = [];
  const usedNames = new Set();
  for (const slug of slugs) {
    if (!SAFE_MANIFEST_SEGMENT.test(slug) || slug.includes('..')) {
      console.warn(`  ⚠ plugin:${slug} skipped: unsafe plugin directory name`);
      continue;
    }
    const manifest = await fetchJson(new URL(`/plugins/${encodeURIComponent(slug)}/manifest.json`, url).href);
    if (!manifest || typeof manifest !== 'object') {
      console.warn(`  ⚠ plugin:${slug} skipped: manifest not available at /plugins/${slug}/manifest.json`);
      continue;
    }
    const pages = Array.isArray(manifest.contributes?.pages) ? manifest.contributes.pages : [];
    if (pages.length === 0) {
      console.warn(`  ⚠ plugin:${slug} skipped: manifest contributes no pages`);
      continue;
    }
    for (const page of pages) {
      if (!page?.id || !page?.entry) continue;
      const pageId = String(page.id);
      if (!SAFE_MANIFEST_SEGMENT.test(pageId) || pageId.includes('..')) {
        console.warn(`  ⚠ plugin:${slug} page ${JSON.stringify(pageId)} skipped: unsafe page id`);
        continue;
      }
      const entry = String(page.entry).replace(/^\//, '');
      let name = `plugin-${nameSegment(slug, 'plugin')}-${nameSegment(pageId, 'page')}`;
      for (let n = 2; usedNames.has(name); n += 1) name = `${name}-${n}`;
      usedNames.add(name);
      scenes.push({
        name,
        pluginUrl: `/plugins/${encodeURIComponent(slug)}/${entry.split('/').map(encodeURIComponent).join('/')}`,
        pluginId: manifest.id ?? `com.githubstarsmanager.${slug}`,
        pluginSlug: slug,
        pageId,
        readySelector: PLUGIN_READY_SELECTORS[`${slug}/${pageId}`] ?? null,
      });
    }
  }
  return scenes;
}

/**
 * In-app-phase GitHub API mock, built from the demo fixture. The seeded demo
 * token is inert (nothing in the app authenticates on its own), but views like
 * discovery still call api.github.com on mount; answering from the fixture
 * keeps those scenes populated and the whole run hermetic.
 */
function buildGitHubApiMock(baseState) {
  const reposByFullName = new Map(baseState.repositories.map((repo) => [repo.full_name, repo]));
  const releasesByRepoId = new Map();
  for (const release of baseState.releases ?? []) {
    const list = releasesByRepoId.get(release.repository.id) ?? [];
    list.push(release);
    releasesByRepoId.set(release.repository.id, list);
  }
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  // The trending channel does not use the GitHub API: it fetches this RSS feed
  // and reads title/link plus the "⭐ n | 🍴 n" markers in the description,
  // then enriches each entry through /repos/{owner}/{repo} (handled below).
  const trendingRss = () => {
    const items = baseState.repositories
      .filter((repo) => !repo.fork)
      .map((repo) => [
        '<item>',
        `<title>${repo.full_name}</title>`,
        `<link>${repo.html_url}</link>`,
        `<description><![CDATA[ ⭐ ${repo.stargazers_count.toLocaleString('en-US')} | 🍴 ${repo.forks_count.toLocaleString('en-US')} ]]></description>`,
        '</item>',
      ].join('\n'))
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>GitHub Trending demo</title>${items}</channel></rss>`;
  };

  return function handleGitHubApi(route) {
    const requestUrl = route.request().url();
    if (requestUrl.startsWith('https://mshibanami.github.io/GitHubTrendingRSS/')) {
      return route.fulfill({ status: 200, contentType: 'application/rss+xml', body: trendingRss() });
    }
    const { pathname } = new URL(requestUrl);
    if (pathname === '/search/repositories') {
      return json(route, {
        total_count: baseState.repositories.length,
        incomplete_results: false,
        items: baseState.repositories,
      });
    }
    const releasesMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/releases$/);
    if (releasesMatch) {
      const repo = reposByFullName.get(`${releasesMatch[1]}/${releasesMatch[2]}`);
      return json(route, repo ? (releasesByRepoId.get(repo.id) ?? []) : []);
    }
    const repoMatch = pathname.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    if (repoMatch) {
      const repo = reposByFullName.get(`${repoMatch[1]}/${repoMatch[2]}`);
      return repo ? json(route, repo) : json(route, { message: 'Not Found' }, 404);
    }
    if (pathname === '/user') return json(route, baseState.user);
    if (pathname === '/user/orgs') return json(route, []);
    if (pathname === '/gists' || pathname === '/gists/starred') return json(route, baseState.gists ?? []);
    return json(route, { message: 'Not Found' }, 404);
  };
}

/**
 * Parse and validate CLI arguments for the screenshot runner.
 * @param {string[]} argv - Command line argument array (without node or script path).
 * @returns {{ url: string, out: string, only: string[] | null } | null}
 */
function parseArgs(argv) {
  const args = { url: 'http://127.0.0.1:4173', out: path.join(SCRIPT_DIR, '.shots'), only: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--url') args.url = argv[++i];
    else if (flag === '--out') args.out = argv[++i];
    else if (flag === '--only') {
      args.only = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (args.only.length === 0) {
        console.error('--only requires at least one scene');
        process.exitCode = 2;
        return null;
      }
    }
    else {
      console.error(`Unknown argument: ${flag}`);
      process.exitCode = 2;
      return null;
    }
  }
  if (!args.url || !args.out) {
    console.error('Usage: node shoot.mjs --url <base-url> --out <dir> [--only <scene>...]');
    process.exitCode = 2;
    return null;
  }
  return args;
}

/**
 * Split a --only list into static scene names, plugin specs and interaction
 * variant specs. Legacy plugin scene names are translated to their
 * `plugin:<slug>` spec.
 * @param {string[]} only - Raw spec list.
 * @returns {{ staticNames: string[], pluginSlugs: string[], variantSpecs: string[], wantsAll: boolean }}
 */
function splitOnlySpecs(only) {
  const known = new Set(SCENES.map((s) => s.name));
  const variantSpecs = new Set(SCENE_VARIANTS.map((v) => v.spec));
  const staticNames = [];
  const pluginSlugs = [];
  const variants = [];
  for (const spec of only) {
    if (spec === 'all') continue;
    if (spec.startsWith('plugin:')) {
      pluginSlugs.push(spec.slice('plugin:'.length));
      continue;
    }
    if (LEGACY_PLUGIN_SCENES[spec]) {
      pluginSlugs.push(LEGACY_PLUGIN_SCENES[spec]);
      continue;
    }
    if (variantSpecs.has(spec)) {
      variants.push(spec);
      continue;
    }
    if (!known.has(spec)) {
      console.error(`Unknown scene: ${spec}. Known: ${[...known].join(', ')}; plugin specs: plugin:<slug>; variant specs: ${[...variantSpecs].join(', ')}; "all" for every static scene`);
      process.exitCode = 2;
      return null;
    }
    staticNames.push(spec);
  }
  return { staticNames, pluginSlugs, variantSpecs: variants, wantsAll: only.includes('all') };
}

/**
 * Phase 1 of scene setup: load the app's document with every other request
 * aborted. The routes stay armed until the caller finishes seeding, so a
 * late-discovered app script can never boot and write default state shards
 * before the demo snapshot exists.
 */
async function gotoForSeeding(page, url) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') return route.continue();
    return route.abort();
  });
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => document.readyState !== 'uninitialized');
}

/**
 * Browser-side stub of the Electron bridge, injected before app scripts run.
 * Provides realistic data for the Plugins tab and answers every other IPC
 * call with an empty success so electron-only panels render their UI instead
 * of staying hidden. `desktop` stays undefined: the tray/auto-launch bridge
 * must keep reporting "unsupported" in the web preview.
 *
 * The plugin client talks to `window.electronAPI.plugins` (see
 * src/plugins/pluginClient.ts), so the plugin surface is nested accordingly.
 * @param {Array<object>} plugins - InstalledPlugin-shaped records for the registry.
 */
function installElectronStub(plugins) {
  const emptyMarketplace = { sources: [], entries: [] };
  const mutationError = { code: 'unsupported', message: 'preview stub' };
  const base = {
    plugins: {
      list: async () => ({ plugins, invalidPlugins: [] }),
      installFromDirectory: async () => ({ success: false, error: mutationError }),
      enable: async () => ({ success: false, error: mutationError }),
      disable: async () => ({ success: false, error: mutationError }),
      uninstall: async () => ({ success: false, error: mutationError }),
      getPage: async () => ({ success: false, error: mutationError }),
      getSearchEndpoint: async () => ({ endpoint: null }),
      configureWebSearch: async () => ({ success: false, error: mutationError }),
      marketplace: {
        getState: async () => emptyMarketplace,
        addSource: async () => ({ success: false, error: mutationError }),
        updateSource: async () => ({ success: false, error: mutationError }),
        removeSource: async () => ({ success: false, error: mutationError }),
        refresh: async () => ({ success: false, error: mutationError }),
      },
    },
  };
  // Any other IPC surface (MCP bridge, desktop prefs, update checks, …) gets a
  // callable that resolves empty and can be nested arbitrarily, so panels
  // render their UI instead of crashing on a missing method.
  const anyCall = new Proxy(function stubCall() {}, {
    get(target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'desktop') return undefined;
      return anyCall;
    },
    apply() {
      return Promise.resolve({});
    },
  });
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: new Proxy(base, {
      get(target, prop) {
        if (prop === 'then' || prop === 'desktop') return undefined;
        if (prop in target) return target[prop];
        return anyCall;
      },
    }),
  });
}

/**
 * In-page stand-in for the plugin host bridge — the other half of what
 * PluginPageViewer does in the real app. Plugin pages postMessage
 * `plugin-page:request` and stall until a `plugin-page:response` arrives, so
 * without a host, storage reads and metric fetches hang forever and the
 * screenshot would capture endless spinners.
 *
 * Runs inside the page (page.evaluate). Answers storage/clipboard from an
 * in-memory map, GitHub endpoints from the demo fixture, and everything else
 * with a clean failure so panels settle into their empty/error states instead
 * of spinning. Value shapes mirror the host: network.request resolves
 * `{status, body, acct}` (4xx → success:false, 202 → body:null), and
 * repositories.search resolves a plain repository array.
 * @param {object} params - Fixture data and seeded storage entries.
 */
function installPluginHostResponder({ repositories, releasesByRepositoryId, storageSeed }) {
  const storage = new Map(Object.entries(storageSeed ?? {}));
  const reposByFullName = new Map(repositories.map((repo) => [repo.full_name, repo]));
  const acct = 'preview';
  const userAvatar = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="32" fill="#4c5fd5"/><text x="32" y="40" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${(repositories[0]?.full_name ?? 'g/s')[0].toUpperCase()}</text></svg>`,
  )}`;

  // Deterministic stand-ins for GitHub's stats endpoints (which answer 202
  // "computing" until warmed up): pages would retry 202s forever, so hand out
  // plausible fixed data instead.
  const baseWeek = Math.floor(Date.UTC(2026, 0, 5) / 1000);
  const commitActivity = Array.from({ length: 52 }, (_, i) => {
    const days = Array.from({ length: 7 }, (_, d) => ((i * 13 + d * 7) % 9));
    return { days, total: days.reduce((sum, n) => sum + n, 0), week: baseWeek + i * 604800 };
  });
  // Tuple format the page charts: [week epoch, additions, deletions].
  const codeFrequency = Array.from({ length: 52 }, (_, i) => [
    baseWeek + i * 604800,
    ((i * 11) % 17) * 6,
    -(((i * 7) % 11) * 3),
  ]);
  const ownerLogin = (repositories[0]?.full_name ?? 'o/r').split('/')[0];
  const contributors = [
    { login: ownerLogin, id: 1, contributions: 412, avatar_url: userAvatar, html_url: `https://github.com/${ownerLogin}`, type: 'User' },
    { login: 'demo-contributor', id: 2, contributions: 87, avatar_url: userAvatar, html_url: 'https://github.com/demo-contributor', type: 'User' },
  ];
  const languages = { TypeScript: 64200, JavaScript: 21400, CSS: 8100, Shell: 1250 };
  const communityProfile = {
    files: { readme: {}, license: {}, contributing: {}, code_of_conduct: {} },
    health_percentage: 92,
  };

  const respondNetwork = (args) => {
    const path = String(args?.path ?? '/');
    const httpError = (status) => ({
      success: false,
      error: { code: 'PLUGIN_NETWORK_HTTP_ERROR', message: `GitHub API returned ${status} for ${path}` },
    });
    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (repoMatch) {
      const fullName = `${repoMatch[1]}/${repoMatch[2]}`;
      const rest = repoMatch[3] ?? '';
      if (!rest) {
        // The real host normalizes 4xx/5xx to a success:false bridge error;
        // plugins branch on `success`, so a 404 must not look like data.
        const repo = reposByFullName.get(fullName);
        return repo ? { success: true, value: { status: 200, body: repo, acct } } : httpError(404);
      }
      if (rest === '/releases') {
        const repo = reposByFullName.get(fullName);
        return { success: true, value: { status: 200, body: repo ? (releasesByRepositoryId[repo.id] ?? []) : [], acct } };
      }
      if (rest === '/pulls' || rest.startsWith('/pulls?')) {
        return { success: true, value: { status: 200, body: [], acct } };
      }
      if (rest === '/stats/commit_activity') return { success: true, value: { status: 200, body: commitActivity, acct } };
      if (rest === '/stats/code_frequency') return { success: true, value: { status: 200, body: codeFrequency, acct } };
      if (rest === '/contributors') return { success: true, value: { status: 200, body: contributors, acct } };
      if (rest === '/languages') return { success: true, value: { status: 200, body: languages, acct } };
      if (rest === '/community/profile') return { success: true, value: { status: 200, body: communityProfile, acct } };
      if (rest === '/security-advisories') return { success: true, value: { status: 200, body: [], acct } };
      // Anything else: GitHub answers 202 while computing; the pages render
      // that as a computing state instead of hanging or erroring.
      return { success: true, value: { status: 202, body: null, acct } };
    }
    const userMatch = path.match(/^\/users\/([^/]+)$/);
    if (userMatch) {
      return {
        success: true,
        value: {
          status: 200,
          body: { login: userMatch[1], html_url: `https://github.com/${userMatch[1]}`, avatar_url: userAvatar },
          acct,
        },
      };
    }
    return { success: true, value: { status: 202, body: null, acct } };
  };

  // Readiness signal: track when the LAST NEW request signature appeared.
  // A page still fetching fresh metrics/keys during initial load keeps
  // producing new signatures; a page that repeats identical background
  // requests forever (polling) stops producing them, so it still settles.
  const seenSignatures = new Set();
  window.__pluginHostLastNewRequestAt = Date.now();

  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object' || data.type !== 'plugin-page:request') return;
    if (event.source !== window.parent) return;
    const a = data.args ?? {};
    const sig = `${data.method}:${a.key ?? a.path ?? a.query ?? ''}`;
    if (!seenSignatures.has(sig)) {
      seenSignatures.add(sig);
      window.__pluginHostLastNewRequestAt = Date.now();
    }
    const reply = (payload) => {
      window.parent.postMessage({
        type: 'plugin-page:response',
        pluginId: data.pluginId,
        pageId: data.pageId,
        requestId: data.requestId,
        token: data.token,
        ...payload,
      }, '*');
    };
    const { method, args } = data;
    try {
      if (method === 'storage.get') return reply({ success: true, value: storage.get(String(args?.key)) ?? null });
      if (method === 'storage.set') {
        storage.set(String(args?.key), args?.value);
        return reply({ success: true, value: { ok: true } });
      }
      if (method === 'storage.delete') {
        storage.delete(String(args?.key));
        return reply({ success: true, value: { ok: true } });
      }
      if (method === 'clipboard.write' || method === 'clipboard.writeImage') {
        return reply({ success: true, value: { ok: true } });
      }
      if (method === 'network.request') return reply(respondNetwork(args));
      if (method === 'repositories.search') {
        const query = String(args?.query ?? '').toLowerCase();
        const limit = Number(args?.limit ?? 20);
        const found = repositories
          .filter((repo) => !query || repo.full_name.toLowerCase().includes(query))
          .slice(0, Number.isFinite(limit) ? limit : 20);
        return reply({ success: true, value: found });
      }
      if (method === 'ai.generate' || method === 'web.search') {
        return reply({ success: false, error: { code: 'AI_UNAVAILABLE', message: 'preview stub has no AI provider' } });
      }
      return reply({ success: false, error: { code: 'UNSUPPORTED_METHOD', message: `preview stub does not implement ${method}` } });
    } catch (error) {
      return reply({ success: false, error: { code: 'STUB_ERROR', message: String(error?.message ?? error) } });
    }
  });
}

/**
 * Run one interaction variant in the base scene's settled page and take its
 * screenshot. The click/readiness selectors describe states the default
 * render never shows (an open dialog, a switched tab); a variant that cannot
 * reach its state is skipped with a warning instead of failing the run — the
 * base screenshot already stands.
 * @param {import('playwright').Page} page - The base scene's settled page.
 * @param {string} variantSpec - The variant's full scene spec.
 * @param {string} url - Base preview server URL (for locale text resolution).
 * @param {string} outDir - Directory where the screenshot PNG will be saved.
 * @returns {Promise<{ scene: string, path: string } | null>} Shot record, or null when skipped.
 */
async function shootVariant(page, variantSpec, url, outDir) {
  const action = VARIANT_ACTIONS[variantSpec];
  const shotPath = path.join(outDir, `${variantSpec}.png`);
  if (!action) {
    console.warn(`  ⚠ ${variantSpec} skipped: no VARIANT_ACTIONS entry`);
    return null;
  }
  try {
    if (action.clickLocaleKey) {
      const text = await resolveLocaleText(url, action.clickLocaleKey);
      if (!text) throw new Error(`locale text for ${action.clickLocaleKey} not found in the built bundle`);
      await page.getByRole('button', { name: text }).click({ timeout: 10_000 });
    } else if (action.clickSelector) {
      await page.locator(action.clickSelector).first().click({ timeout: 10_000 });
    }
    if (action.readySelector) {
      await page.waitForSelector(action.readySelector, { state: 'visible', timeout: 15_000 });
    }
    await page.waitForTimeout(action.settleMs ?? 500);
    await page.screenshot({ path: shotPath, fullPage: action.fullPage ?? true });
    console.log(`  ✓ ${variantSpec} -> ${shotPath}`);
    return { scene: variantSpec, path: shotPath };
  } catch (error) {
    console.warn(`  ⚠ ${variantSpec} skipped: ${error.message.split('\n')[0]}`);
    return null;
  }
}

/**
 * Take a screenshot for a single scene inside a hermetic browser context.
 * @param {import('playwright').Browser} browser - Active Playwright browser instance.
 * @param {object} baseState - Base demo state fixture.
 * @param {object} scene - Scene configuration describing views and store overrides.
 * @param {string} url - Base preview server URL.
 * @param {string} outDir - Directory where the screenshot PNG will be saved.
 * @returns {Promise<Array<{ scene: string, path: string }>>} Screenshot records: the base scene, then any interaction variants (skipped ones omitted).
 */
async function shootScene(browser, baseState, scene, url, outDir) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    colorScheme: scene.themeMode ?? 'light',
  });
  const page = await context.newPage();
  const shotPath = path.join(outDir, `${scene.name}.png`);
  try {
    if (scene.pluginUrl) {
      const origin = new URL(url).origin;
      const targetUrl = new URL(scene.pluginUrl, url).href;
      await page.route('**/*', (route) => {
        const reqUrl = route.request().url();
        if (reqUrl.startsWith(origin)) return route.continue();
        return route.abort();
      });
      const response = await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
      if (!response || !response.ok()) {
        console.warn(`  ⚠ ${scene.name} skipped: plugin asset not available at ${scene.pluginUrl} (${response?.status() ?? 'no response'})`);
        return null;
      }
      const demoRepo = baseState.repositories?.[0] ?? {
        id: 1,
        name: 'GithubStarsManager',
        full_name: 'AmintaCCCP/GithubStarsManager',
        description: 'GitHub Stars Manager demo repository',
        stargazers_count: 1234,
        forks_count: 56,
        language: 'TypeScript',
      };
      // Emulate the host bridge before init so the page's first storage read
      // and metric fetch settle: seed the custom-fields document for the demo
      // repository and hand the demo fixture to the network responder.
      const releasesByRepositoryId = {};
      for (const release of baseState.releases ?? []) {
        (releasesByRepositoryId[release.repository?.id] ??= []).push(release);
      }
      await page.evaluate(installPluginHostResponder, {
        repositories: baseState.repositories ?? [],
        releasesByRepositoryId,
        storageSeed: {
          [`fields:${demoRepo.id}`]: {
            schema: 1,
            fields: [
              { id: 'f-upstream', type: 'text', name: '上游跟踪', value: '每周一同步上游 release' },
              { id: 'f-eval', type: 'note', name: '评估备注', value: '演示数据：推理速度优秀， license 已确认。', format: 'markdown' },
              { id: 'f-doc', type: 'link', name: '文档', value: 'https://github.com/ollama/ollama#readme' },
            ],
          },
        },
      });
      await page.evaluate(({ pluginId, pageId, repo }) => {
        window.postMessage({
          type: 'plugin-page:init',
          pluginId,
          pageId,
          token: 'preview-token',
          context: {
            repository: repo,
            language: 'zh',
            theme: 'light',
          },
        }, '*');
      }, { pluginId: scene.pluginId, pageId: scene.pageId, repo: demoRepo });
      if (scene.readySelector) {
        await page.waitForSelector(scene.readySelector, { timeout: 15_000 });
      } else {
        await page.waitForFunction(() => !!document.body && document.body.innerText.trim().length > 0, null, { timeout: 15_000 });
      }
      // Explicit readiness beyond the shell: a static title would pass the
      // checks above while bridge data is still loading. Wait until no NEW
      // request signature has appeared for a moment — fresh fetches keep the
      // signature set growing (initial load ongoing), while a page that
      // repeats identical background requests settles. A page that keeps
      // producing new signatures fails the scene instead of publishing an
      // unfinished screenshot.
      await page.waitForFunction(() => {
        const last = window.__pluginHostLastNewRequestAt || 0;
        return last > 0 && Date.now() - last >= 1500;
      }, null, { timeout: 45_000, polling: 250 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(scene.settleMs ?? 600);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`  ✓ ${scene.name} -> ${shotPath}`);
      // Plugin pages are standalone documents; no interaction variants exist
      // for them.
      return [{
        scene: scene.name,
        path: shotPath,
        ...(scene.pluginSlug ? { pluginSlug: scene.pluginSlug, pageId: scene.pageId } : {}),
      }];
    }

    if (scene.electronStub) {
      await page.addInitScript(installElectronStub, scene.plugins ?? []);
    }
    await gotoForSeeding(page, url);
    const seedState = { ...baseState, ...scene, currentView: scene.currentView, themeMode: scene.themeMode };
    if (scene.loginScreen) {
      // Log out: the app then renders the LoginScreen instead of the shell.
      seedState.isAuthenticated = false;
      seedState.githubToken = '';
      seedState.user = null;
    }
    const seeded = await page.evaluate(
      seedPersistedState,
      { state: seedState, version: PERSIST_VERSION },
    );
    if (!seeded.indexedDB) {
      console.warn(`  (${scene.name}) IndexedDB unavailable; seeded via localStorage fallback`);
    }
    // Navigate to the scene's Settings tab before the app boots: the panel
    // reads this one-shot key on mount. No-op for non-settings scenes.
    if (scene.settingsTab) {
      await page.evaluate((tab) => sessionStorage.setItem('gsm:pending-settings-tab', tab), scene.settingsTab);
    }
    // Seed is durable now; release the phase-1 blocking routes.
    await page.unroute('**/*');
    // App phase: serve same-origin (preview server) requests, answer GitHub
    // API calls from the demo fixture, and abort everything else so no real
    // network call can influence the screenshots.
    const origin = new URL(url).origin;
    const handleGitHubApi = buildGitHubApiMock(baseState);
    await page.route('**/*', (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.startsWith(origin)) return route.continue();
      if (requestUrl.startsWith('https://api.github.com/')
        || requestUrl.startsWith('https://mshibanami.github.io/')) {
        return handleGitHubApi(route);
      }
      return route.abort();
    });
    await page.reload({ waitUntil: 'load', timeout: 60_000 });

    if (scene.loginScreen) {
      // The login page replaces the whole shell — wait for its own content
      // instead of .ui-shell / main.app-main. The token input only exists
      // once the real form has hydrated; a Suspense "Loading..." frame would
      // satisfy a text-based check.
      await page.waitForSelector('#root input', { timeout: 60_000 });
      await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(scene.settleMs ?? 800);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`  ✓ ${scene.name} -> ${shotPath}`);
      return await finishScene(page, scene, [{ scene: scene.name, path: shotPath }], url, outDir);
    }

    // The app shell renders only after hydration; wait for it, then for real
    // view content: no Suspense fallback ([role="status"] "Loading..." frame)
    // may remain. A timeout fails the run instead of shipping a loading shot.
    await page.waitForSelector('.ui-shell', { timeout: 60_000 });
    await page.waitForSelector('main.app-main', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const main = document.querySelector('main.app-main');
      return !!main && (main.innerText ?? '').trim().length > 0 && !main.querySelector('[role="status"]');
    }, null, { timeout: 45_000, polling: 250 });
    // The requested settings tab must actually be active (sessionStorage
    // navigation worked); the panel applies it right after mount, so poll
    // briefly — and fail loudly rather than shoot the General tab.
    if (scene.settingsTab) {
      const expected = `settings-tabpanel-${scene.settingsTab}`;
      const matched = await page.waitForFunction((want) => {
        const panel = document.querySelector('[data-settings-sections]');
        return (panel?.getAttribute('id') ?? '') === want;
      }, expected, { timeout: 15_000, polling: 100 }).then(() => true).catch(() => false);
      if (!matched) {
        const activeTab = await page.evaluate(() => document.querySelector('[data-settings-sections]')?.getAttribute('id') ?? 'none');
        throw new Error(`${scene.name}: expected active settings tab "${expected}", saw "${activeTab}"`);
      }
    }
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15_000 });
    await page.waitForTimeout(scene.settleMs ?? 800);

    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`  ✓ ${scene.name} -> ${shotPath}`);
    return await finishScene(page, scene, [{ scene: scene.name, path: shotPath }], url, outDir);
  } finally {
    await context.close();
  }
}

/**
 * Append a scene's interaction variant shots (if any) to its base record.
 * Runs in the same settled browser context, so the variant captures the page
 * exactly as the base screenshot left it, with only the click applied.
 * @param {import('playwright').Page} page - The base scene's settled page.
 * @param {object} scene - Scene configuration, possibly carrying `variants`.
 * @param {Array<{ scene: string, path: string }>} results - Base shot records.
 * @param {string} url - Base preview server URL.
 * @param {string} outDir - Directory where variant PNGs will be saved.
 * @returns {Promise<Array<{ scene: string, path: string }>>} All shot records.
 */
async function finishScene(page, scene, results, url, outDir) {
  for (const variant of scene.variants ?? []) {
    const variantResult = await shootVariant(page, variant.spec, url, outDir);
    if (variantResult) results.push(variantResult);
  }
  return results;
}

/**
 * Main entry point for the screenshot recording runner.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;

  let staticScenes = SCENES;
  let pluginSlugs = [];
  if (args.only && args.only.length > 0) {
    const split = splitOnlySpecs(args.only);
    if (!split) return;
    pluginSlugs = split.pluginSlugs;
    // With `all` every static scene runs; otherwise only the requested ones —
    // a spec list of just plugin:<slug> specs must not fall back to shooting
    // everything. A requested variant implies its base scene (the variant is
    // shot in the base's browser context after the base screenshot).
    if (!split.wantsAll) {
      const selected = new Set(split.staticNames);
      for (const spec of split.variantSpecs) {
        const variant = SCENE_VARIANTS.find((v) => v.spec === spec);
        if (variant) selected.add(variant.baseScene);
      }
      staticScenes = SCENES.filter((s) => selected.has(s.name));
    }
    // Variants only run when explicitly requested: `all` and global-chrome
    // expansion shoot the default renders; detect attaches variants per
    // changed file, not per page.
    const wantedVariants = split.wantsAll
      ? []
      : SCENE_VARIANTS.filter((v) => split.variantSpecs.includes(v.spec));
    for (const scene of staticScenes) {
      const sceneVariants = wantedVariants.filter((v) => v.baseScene === scene.name);
      if (sceneVariants.length > 0) scene.variants = sceneVariants;
    }
  }

  const baseState = JSON.parse(await readFile(path.join(SCRIPT_DIR, 'fixtures', 'demo-state.json'), 'utf8'));

  // Resolve plugin specs against the built bundle before any browser work.
  const pluginScenes = pluginSlugs.length > 0 ? await resolvePluginScenes(args.url, pluginSlugs) : [];
  // Electron-only settings tabs need a populated registry: build the stub's
  // plugin list from every manifest the bundle ships.
  if (staticScenes.some((s) => s.electronStub)) {
    const bundled = await listBundledPlugins(args.url);
    const manifests = await Promise.all(bundled.map(async (slug) => ({
      slug,
      manifest: await fetchJson(new URL(`/plugins/${encodeURIComponent(slug)}/manifest.json`, args.url).href),
    })));
    const stubPlugins = manifests
      .filter((entry) => entry.manifest && typeof entry.manifest === 'object')
      .map((entry) => ({
        directoryName: entry.slug,
        manifest: entry.manifest,
        enabled: true,
        status: 'active',
        grantedPermissions: Array.isArray(entry.manifest.permissions) ? entry.manifest.permissions : [],
      }));
    for (const scene of staticScenes) {
      if (scene.electronStub) scene.plugins = stubPlugins;
    }
    if (stubPlugins.length === 0) {
      console.warn('  ⚠ no plugin manifests served under /plugins; electron-only settings scenes will show an empty registry');
    }
  }

  // Start from an empty output directory: the output path lives under
  // $RUNNER_TEMP where PR code (npm postinstall) has already run, so a stale
  // or planted file must never survive into the uploaded artifact.
  await rm(args.out, { recursive: true, force: true });
  await mkdir(args.out, { recursive: true });

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const scene of [...staticScenes, ...pluginScenes]) {
      for (const result of await shootScene(browser, baseState, scene, args.url, args.out)) {
        if (result) results.push(result);
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(args.out, 'scenes.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`Done: ${results.length} screenshot(s) in ${args.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
