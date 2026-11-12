#!/usr/bin/env node
/**
 * Systematic one-change-at-a-time experiment for the ui-preview scene mapping.
 *
 * For EVERY UI-relevant file (and every top-level locale key) this applies a
 * minimal synthetic change in the worktree, runs the real detect pipeline
 * (classifyPath + key-level locale diff against the committed base), and
 * compares the produced scene set against a ground truth derived from
 * consumer analysis (grep of actual usages) plus demo-visibility curation.
 *
 * Run from the worktree root: node ui-exp/experiment.mjs [--only <filter>]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Run from the repo root: node .github/ui-preview/experiment.mjs [--only <filter>] */
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const UIP = SCRIPT_DIR;

const detect = await import(`file://${UIP}/detect.mjs`);

const git = (...args) => execFileSync('git', ['-C', ROOT, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** Ground truth: shared components whose rendering is conditional on runtime
 *  state the demo fixture never provides (verified by reading each component).
 *  They map to 'deferred': they follow real panels changed in the same PR and
 *  escalate to global only when changed alone. */
const CONDITIONAL_OVERLAYS = new Set([
  'UpdateChecker.tsx',            // update dialog; opens only when an update is found
  'UpdateNotificationBanner.tsx', // banner; only when an update is available
  'Modal.tsx',                    // dialog shell; visible only while a dialog is open
  'ErrorBoundary.tsx',            // renders only after a render error
  'DebugModeIndicator.tsx',       // `if (!debug) return null`
  'ListsPushIndicator.tsx',       // `if (!listsPush.isRunning) return null`
  'BackToTop.tsx',                // opacity-0 until the page is scrolled
  'ScrollToBottom.tsx',           // chat scroll affordance
  'FloatingTooltip.tsx',          // hover-only tooltip
  'SortAlgorithmTooltip.tsx',     // hover-only tooltip
  'MarkdownRenderer.tsx',         // only inside collapsed release notes / closed modals
  'BilingualMarkdownRenderer.tsx',
  'MermaidBlock.tsx',             // only when markdown content contains mermaid
  'PluginPageHost.tsx',           // lazy host mounted when a plugin page is opened
]);

/** Files whose change is expected to map to the whole app. */
const GLOBAL_EXPECT = new Set([
  'src/App.tsx', 'src/main.tsx', 'src/index.css', 'index.html',
  'tailwind.config.js', 'postcss.config.js', 'vite.config.ts',
]);

/** Walk a directory recursively, returning file paths relative to ROOT. */
function walk(rel, out = []) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = path.posix.join(rel, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else out.push(child);
  }
  return out;
}

/** Build the experiment target list. */
function enumerateTargets() {
  const targets = [];
  const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes('__tests__') || p.startsWith('src/test/') || / \d+\.(tsx?|json|css)$/.test(p);
  const dirs = ['src/components', 'src/features', 'src/plugins', 'src/hooks', 'src/i18n', 'src/lib', 'src/constants', 'src/utils', 'src/styles'];
  for (const dir of dirs) {
    for (const file of walk(dir)) {
      if (isTest(file)) continue;
      if (!/\.(ts|tsx|js|jsx|css|html)$/.test(file)) continue;
      targets.push(file);
    }
  }
  targets.push('src/App.tsx', 'src/main.tsx', 'src/index.css', 'index.html',
    'tailwind.config.js', 'postcss.config.js', 'vite.config.ts');
  for (const file of walk('public')) targets.push(file);
  targets.push('src/types/themeTokens.ts');
  // Top-level locale files (file-level fallback probe) + every key (key-level probe)
  for (const ns of readdirSync(path.join(ROOT, 'src/locales/zh'))) {
    if (!ns.endsWith('.json')) continue;
    targets.push({ kind: 'locale-file', path: `src/locales/zh/${ns}` });
  }
  return targets;
}

/** Enumerate every top-level locale key of every namespace with its consumers. */
function enumerateLocaleKeys() {
  const nsDir = path.join(ROOT, 'src/locales/zh');
  const allSrc = [...walk('src')].filter((f) => /\.(ts|tsx)$/.test(f) && !isTestPath(f));
  const srcCache = new Map(allSrc.map((f) => [f, readFileSync(path.join(ROOT, f), 'utf8')]));
  const result = [];
  for (const ns of readdirSync(nsDir)) {
    if (!ns.endsWith('.json') || / \d+\.json$/.test(ns)) continue;
    const data = JSON.parse(readFileSync(path.join(nsDir, ns), 'utf8'));
    for (const key of Object.keys(data)) {
      // Consumers: files whose text contains `<key>.` inside a string literal.
      const needle = new RegExp(`['"\`]${key}\\.[a-zA-Z-]`);
      const consumers = allSrc.filter((f) => needle.test(srcCache.get(f)));
      result.push({ ns, file: `src/locales/zh/${ns}`, key, consumers });
    }
  }
  return result;
}

const isTestPath = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes('__tests__') || p.startsWith('src/test/') || / \d+\.(tsx?|json|css)$/.test(p);

/** Extensions the probe knows how to modify safely; anything else
 *  (PNG/ICO/fonts under public/) is skipped — round-tripping binary bytes
 *  through a UTF-8 string would corrupt them beyond repair. */
const TEXT_PROBE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.css', '.html', '.json', '.svg']);

/** Apply a minimal synthetic change to a file; returns a revert function, or
 *  null when the file is binary and must not be probed. The original bytes
 *  are kept as a Buffer so the revert is byte-exact. */
function modifyFile(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!TEXT_PROBE_EXTENSIONS.has(path.extname(relPath))) {
    return null;
  }
  const original = readFileSync(abs);
  let modified;
  if (relPath.endsWith('.json')) {
    const data = JSON.parse(original.toString('utf8'));
    data.__ui_preview_probe__ = true;
    modified = `${JSON.stringify(data, null, 2)}\n`;
  } else {
    modified = `${original.toString('utf8')}\n/* ui-preview-probe */\n`;
  }
  writeFileSync(abs, modified);
  return () => writeFileSync(abs, original);
}

/** Apply a change to ONE top-level key of a locale file; returns revert fn. */
function modifyLocaleKey(relPath, key) {
  const abs = path.join(ROOT, relPath);
  const original = readFileSync(abs, 'utf8');
  const data = JSON.parse(original);
  const firstLeaf = (v) => {
    if (v && typeof v === 'object') return firstLeaf(Object.values(v)[0]);
    return typeof v === 'string' ? `${v} 探针` : v;
  };
  const value = data[key];
  if (value && typeof value === 'object') {
    const firstSub = Object.keys(value)[0];
    value[firstSub] = firstLeaf(value[firstSub]);
  } else if (typeof value === 'string') {
    data[key] = `${value} 探针`;
  }
  writeFileSync(abs, `${JSON.stringify(data, null, 2)}\n`);
  return () => writeFileSync(abs, original);
}

/** Local stand-in for the gh contents executor: base = git HEAD, head = worktree. */
function localExecutor(worktreeOverrides) {
  return (args) => {
    const url = args[1];
    const m = url.match(/contents\/(.+?)\?ref=(.+)$/);
    const file = decodeURIComponent(m[1]);
    const ref = decodeURIComponent(m[2]);
    if (ref === 'BASE') {
      return git('show', `HEAD:${file}`);
    }
    if (ref === 'HEAD' && worktreeOverrides.has(file)) {
      return worktreeOverrides.get(file);
    }
    return git('show', `HEAD:${file}`);
  };
}

const SCENE_ORDER = detect.ALL_SCENES;
const fmt = (scenes) => {
  // Unknown static scene names (interaction variants) sort deterministically
  // after the known catalog so actual/expected stay comparable.
  const rank = (s) => {
    const i = SCENE_ORDER.indexOf(s);
    return i === -1 ? SCENE_ORDER.length : i;
  };
  const statics = scenes.filter((s) => !s.startsWith('plugin:')).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  const specs = scenes.filter((s) => s.startsWith('plugin:')).sort();
  return [...statics, ...specs];
};

// --- run ---
const only = process.argv[2] === '--only' ? process.argv[3] : null;
const report = [];
const mismatches = [];

// Part 1: file-level probes
for (const target of enumerateTargets()) {
  const file = typeof target === 'string' ? target : target.path;
  if (only && !file.includes(only)) continue;
  const revert = modifyFile(file);
  if (!revert) continue; // binary file, not probeable
  try {
    let scenes;
    if (file.endsWith('.json') && file.startsWith('src/locales/')) {
      // locale FILE-level probe: brand-new unknown key → exercises the fallback
      const overrides = new Map([[file, readFileSync(path.join(ROOT, file), 'utf8')]]);
      const keys = await detect.diffLocaleKeys({
        repo: 'x/y', paths: [file], baseRef: 'BASE', headRef: 'HEAD',
        executor: localExecutor(overrides),
      });
      scenes = detect.mapPathsToScenes([file], keys);
    } else {
      scenes = detect.mapPathsToScenes([file], {});
    }
    report.push({ target: file, kind: 'file', scenes: fmt(scenes) });
  } finally {
    revert();
  }
}

// Part 2: locale key-level probes with consumer-derived ground truth
for (const { ns, file, key, consumers } of enumerateLocaleKeys()) {
  if (only && !`${ns}:${key}`.includes(only)) continue;
  const overrides = new Map();
  const revert = modifyLocaleKey(file, key);
  try {
    overrides.set(file, readFileSync(path.join(ROOT, file), 'utf8'));
    const keys = await detect.diffLocaleKeys({
      repo: 'x/y', paths: [file], baseRef: 'BASE', headRef: 'HEAD',
      executor: localExecutor(overrides),
    });
    const actual = fmt(detect.mapPathsToScenes([file], keys));
    // Ground truth: union of the consumers' own classifications. Overlay-only
    // consumers yield 'deferred', which collapses when a visible scene exists.
    const expectedTokens = new Set();
    for (const consumer of consumers) {
      const c = detect.classifyPath(consumer);
      if (!c) continue;
      for (const token of Array.isArray(c) ? c : [c]) {
        if (token === 'global') { for (const s of detect.ALL_SCENES) expectedTokens.add(s); }
        else if (token === 'deferred') expectedTokens.add('deferred');
        else if (token.startsWith('plugin:')) expectedTokens.add(token);
        else for (const s of (detect.VIEW_TO_SCENES[token] ?? [token])) expectedTokens.add(s);
      }
    }
    let expected;
    if (expectedTokens.size === 0) {
      expected = ['<dead-key>'];
    } else if (expectedTokens.has('global')) {
      expected = fmt(detect.ALL_SCENES);
    } else {
      const visible = [...expectedTokens].filter((t) => t !== 'deferred');
      expected = visible.length > 0 ? fmt(visible) : ['deferred-only'];
    }
    report.push({ target: `${ns}:${key}`, kind: 'locale-key', consumers: consumers.length, scenes: actual, expected });
  } finally {
    revert();
  }
}

// Compare and print
for (const entry of report) {
  if (entry.kind !== 'locale-key') continue;
  const isMismatch = entry.expected[0] !== '<dead-key>'
    && JSON.stringify(entry.scenes) !== JSON.stringify(entry.expected);
  if (isMismatch) mismatches.push(entry);
}

console.log(`=== FILE PROBES (${report.filter((r) => r.kind === 'file').length}) ===`);
for (const r of report.filter((r) => r.kind === 'file')) {
  console.log(`${r.target} -> [${r.scenes.join(', ')}]`);
}
console.log(`\n=== LOCALE KEY PROBES (${report.filter((r) => r.kind === 'locale-key').length}) ===`);
for (const r of report.filter((r) => r.kind === 'locale-key')) {
  const flag = r.expected[0] === '<dead-key>' ? 'DEAD' : (JSON.stringify(r.scenes) === JSON.stringify(r.expected) ? 'ok ' : 'MISMATCH');
  console.log(`${flag} ${r.target} (${r.consumers} consumers)`);
  if (flag !== 'ok ') {
    console.log(`     actual:   [${r.scenes.join(', ')}]`);
    console.log(`     expected: [${r.expected.join(', ')}]`);
  }
}
console.log(`\n=== MISMATCHES: ${mismatches.length} ===`);
