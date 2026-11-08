#!/usr/bin/env node
/**
 * Take UI preview screenshots of a running build.
 *
 * Each scene boots the app from a fresh browser context seeded with demo data
 * (see fixtures/demo-state.json), so screenshots show a populated UI with zero
 * network dependencies and zero credentials.
 *
 * Usage:
 *   node shoot.mjs --url http://127.0.0.1:4173 --out <dir> [--only <scene>[,<scene>...]]
 *
 * Scenes live in SCENES below; each entry is merged over the base fixture, so
 * adding a screenshot usually means adding one line here.
 */
import { chromium } from 'playwright';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedPersistedState, PERSIST_VERSION } from './seed.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

/** One context per scene: persisted state (IndexedDB) is context-scoped.
 *  Every app view gets a scene; `currentView` is the persisted store field the
 *  app switches on. `settleMs` extends the post-load settle wait for views
 *  that fetch their data after mount (discovery auto-refreshes its channels).
 *  `state` overrides are merged over the base fixture. */
const SCENES = [
  { name: 'repositories-light', currentView: 'repositories', themeMode: 'light' },
  { name: 'repositories-dark', currentView: 'repositories', themeMode: 'dark' },
  { name: 'gists', currentView: 'gists', themeMode: 'light' },
  { name: 'releases', currentView: 'releases', themeMode: 'light' },
  { name: 'forks', currentView: 'forks', themeMode: 'light' },
  { name: 'discovery', currentView: 'subscription', themeMode: 'light', selectedDiscoveryChannel: 'trending', settleMs: 4000 },
  { name: 'settings', currentView: 'settings', themeMode: 'light' },
  {
    name: 'plugin-repo-custom-fields',
    pluginUrl: '/plugins/repo-custom-fields/ui/index.html',
    pluginId: 'com.githubstarsmanager.repo-custom-fields',
    pageId: 'fields',
  },
  {
    name: 'plugin-repo-info-card',
    pluginUrl: '/plugins/repo-info-card/ui/index.html',
    pluginId: 'com.githubstarsmanager.repo-info-card',
    pageId: 'card',
  },
  {
    name: 'plugin-repo-insights',
    pluginUrl: '/plugins/repo-insights/ui/index.html',
    pluginId: 'com.githubstarsmanager.repo-insights',
    pageId: 'insights',
  },
];

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
 * Take a screenshot for a single scene inside a hermetic browser context.
 * @param {import('playwright').Browser} browser - Active Playwright browser instance.
 * @param {object} baseState - Base demo state fixture.
 * @param {object} scene - Scene configuration describing views and store overrides.
 * @param {string} url - Base preview server URL.
 * @param {string} outDir - Directory where the screenshot PNG will be saved.
 * @returns {Promise<{ scene: string, path: string }>} Resulting screenshot record.
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
      await page.goto(targetUrl, { waitUntil: 'load', timeout: 30_000 });
      const demoRepo = baseState.repositories?.[0] ?? {
        id: 1,
        name: 'GithubStarsManager',
        full_name: 'AmintaCCCP/GithubStarsManager',
        description: 'GitHub Stars Manager demo repository',
        stargazers_count: 1234,
        forks_count: 56,
        language: 'TypeScript',
      };
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
      await page.waitForTimeout(scene.settleMs ?? 1000);
      await page.screenshot({ path: shotPath, fullPage: true });
      console.log(`  ✓ ${scene.name} -> ${shotPath}`);
      return { scene: scene.name, path: shotPath };
    }

    await gotoForSeeding(page, url);
    const seeded = await page.evaluate(
      seedPersistedState,
      { state: { ...baseState, ...scene, currentView: scene.currentView, themeMode: scene.themeMode }, version: PERSIST_VERSION },
    );
    if (!seeded.indexedDB) {
      console.warn(`  (${scene.name}) IndexedDB unavailable; seeded via localStorage fallback`);
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

    // The app shell renders only after hydration; wait for it, then for real
    // view content: no Suspense fallback ([role="status"] "Loading..." frame)
    // may remain. A timeout fails the run instead of shipping a loading shot.
    await page.waitForSelector('.ui-shell', { timeout: 60_000 });
    await page.waitForSelector('main.app-main', { timeout: 30_000 });
    await page.waitForFunction(() => {
      const main = document.querySelector('main.app-main');
      return !!main && (main.innerText ?? '').trim().length > 0 && !main.querySelector('[role="status"]');
    }, null, { timeout: 45_000, polling: 250 });
    await page.waitForFunction(() => document.fonts.status === 'loaded', null, { timeout: 15_000 });
    await page.waitForTimeout(scene.settleMs ?? 800);

    await page.screenshot({ path: shotPath, fullPage: true });
    console.log(`  ✓ ${scene.name} -> ${shotPath}`);
    return { scene: scene.name, path: shotPath };
  } finally {
    await context.close();
  }
}

/**
 * Main entry point for the screenshot recording runner.
 */
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args) return;

  let scenes = SCENES;
  if (args.only && args.only.length > 0 && !args.only.includes('all')) {
    const known = new Set(SCENES.map((s) => s.name));
    const unknown = args.only.filter((name) => !known.has(name));
    if (unknown.length > 0) {
      console.error(`Unknown scene(s): ${unknown.join(', ')}. Known: ${[...known].join(', ')}`);
      process.exitCode = 2;
      return;
    }
    scenes = SCENES.filter((s) => args.only.includes(s.name));
  }

  const baseState = JSON.parse(await readFile(path.join(SCRIPT_DIR, 'fixtures', 'demo-state.json'), 'utf8'));
  // Start from an empty output directory: the output path lives under
  // $RUNNER_TEMP where PR code (npm postinstall) has already run, so a stale
  // or planted file must never survive into the uploaded artifact.
  await rm(args.out, { recursive: true, force: true });
  await mkdir(args.out, { recursive: true });

  const browser = await chromium.launch();
  const results = [];
  try {
    for (const scene of scenes) {
      results.push(await shootScene(browser, baseState, scene, args.url, args.out));
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
