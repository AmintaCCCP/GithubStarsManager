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
 * `--reason` prints the matched paths for debugging; it is always printed on
 * stdout when ui=true.
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

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
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
// workflow_dispatch); never trust it beyond a positive integer.
const pr = Number.parseInt(process.env.PR ?? '', 10);
if (!Number.isSafeInteger(pr) || pr <= 0) {
  console.error('detect: PR must be a positive integer');
  process.exit(1);
}
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

const filenames = (() => {
  // gh's --slurp and --jq are mutually exclusive, so fetch the raw paged JSON
  // and flatten it here instead of shaping it with jq.
  const pages = JSON.parse(gh([
    'api',
    '--paginate',
    '--slurp',
    `repos/${repo}/pulls/${pr}/files?per_page=100`,
  ]));
  return [...new Set(pages.flat().map((file) => file?.filename).filter(Boolean))];
})();

const uiPaths = filenames.filter((name) => UI_PREFIXES.some((prefix) => name === prefix || name.startsWith(prefix)));
const forcedByLabel = (pull.labels ?? []).some((label) => label?.name === 'ui-preview');

if (uiPaths.length === 0 && !forcedByLabel) {
  console.log(`detect: PR #${pr} (${filenames.length} files) does not touch the UI and carries no ui-preview label`);
  writeOutput({ ui: 'false', sha: pull.head.sha, number: pr });
  process.exit(0);
}

console.log(`detect: PR #${pr} touches ${uiPaths.length} UI path(s):\n  ${uiPaths.join('\n  ')}${uiPaths.length === 0 ? '\n  (no UI paths, forced by the ui-preview label)' : ''}`);
writeOutput({ ui: 'true', sha: pull.head.sha, number: pr });
