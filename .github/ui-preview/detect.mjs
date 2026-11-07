#!/usr/bin/env node
/**
 * Decide whether a pull request touches the UI, for the detect job.
 *
 * Runs on a checkout of the default branch (never PR code) and only reads the
 * PR through the API. Outputs (to $GITHUB_OUTPUT):
 *   ui     true|false
 *   sha    the PR head commit to record
 *   number the PR number
 *
 * Environment: GH_TOKEN (read), GITHUB_REPOSITORY, PR (number), GITHUB_OUTPUT.
 */
import { execFileSync } from 'node:child_process';

/** Any changed path starting with one of these counts as a UI change. */
const UI_PREFIXES = [
  'src/',
  'public/',
  'LandingPage/',
  'index.html',
  'tailwind.config.js',
  'postcss.config.js',
  'vite.config.ts',
];

const FILES_PER_PAGE = 100;
/** Safety bound: 100 pages = 10k changed files; real UI PRs stay far below. */
const MAX_PAGES = 100;

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`detect: missing env ${name}`);
    process.exit(1);
  }
  return value;
}

const repo = requireEnv('GITHUB_REPOSITORY');
// PR arrives via env from the workflow (number for PR events, free text for
// workflow_dispatch): only a plain positive integer is ever accepted.
const prRaw = (process.env.PR ?? '').trim();
if (!/^\d{1,9}$/.test(prRaw)) {
  console.error(`detect: PR must be a positive integer, got ${JSON.stringify(process.env.PR)}`);
  process.exit(1);
}
const pr = Number(prRaw);
const output = requireEnv('GITHUB_OUTPUT');

const writeOutput = (pairs) => {
  const body = Object.entries(pairs)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  execFileSync('tee', ['-a', output], { input: `${body}\n`, encoding: 'utf8' });
};

const pull = JSON.parse(gh(['api', `repos/${repo}/pulls/${pr}`]));
if (pull.state !== 'open') {
  console.log(`detect: PR #${pr} is ${pull.state}; skipping`);
  writeOutput({ ui: 'false', sha: '', number: pr });
  process.exit(0);
}

/**
 * Collect changed paths page by page, extracting only the names with jq so a
 * patch-heavy response never has to be buffered whole. Renames contribute both
 * their previous and current path: a file moved out of src/ is still a UI
 * change worth re-shooting.
 */
const collectChangedPaths = () => {
  const paths = new Set();
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = `repos/${repo}/pulls/${pr}/files?per_page=${FILES_PER_PAGE}&page=${page}`;
    const count = Number(gh(['api', url, '--jq', 'length']));
    if (count === 0) break;
    for (const name of gh(['api', url, '--jq', '.[] | .filename, (.previous_filename // empty)']).split('\n')) {
      const trimmed = name.trim();
      if (trimmed) paths.add(trimmed);
    }
    if (count < FILES_PER_PAGE) return [...paths];
  }
  console.warn(`detect: PR #${pr} has more than ${MAX_PAGES * FILES_PER_PAGE} changed files; result may be incomplete`);
  return [...paths];
};

const filenames = collectChangedPaths();
const uiPaths = filenames.filter((name) => UI_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix)));
const forcedByLabel = (pull.labels ?? []).some((label) => label?.name === 'ui-preview');

if (uiPaths.length === 0 && !forcedByLabel) {
  console.log(`detect: PR #${pr} (${filenames.length} changed paths) does not touch the UI and carries no ui-preview label`);
  writeOutput({ ui: 'false', sha: pull.head.sha, number: pr });
  process.exit(0);
}

console.log(`detect: PR #${pr} touches ${uiPaths.length} UI path(s):\n  ${uiPaths.join('\n  ')}${uiPaths.length === 0 ? '\n  (no UI paths, forced by the ui-preview label)' : ''}`);
writeOutput({ ui: 'true', sha: pull.head.sha, number: pr });
