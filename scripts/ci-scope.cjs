#!/usr/bin/env node
/**
 * Decide whether heavy code-validation jobs need to run for this event.
 *
 * Pull requests containing only Markdown or docs/ changes skip the expensive
 * jobs. Main pushes and tags always run because every release commit must be
 * fully verified. The workflow keeps a lightweight gate job so required checks
 * are still reported instead of remaining pending forever.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

/** Return true when a repository-relative path is documentation. */
function isDocsPath(filePath) {
  return filePath === 'README.md'
    || filePath === 'README_zh.md'
    || filePath.endsWith('.md')
    || filePath.startsWith('docs/');
}

/** Return true only for a non-empty changeset containing documentation. */
function docsOnly(files) {
  return files.length > 0 && files.every(isDocsPath);
}

/** List every path changed between two commits, including rename endpoints. */
function changedFiles(root, base, head) {
  const result = spawnSync(
    'git',
    // Disable rename detection so moving code into docs still reports the
    // deleted code path and cannot be misclassified as docs-only.
    ['-C', root, 'diff', '--no-renames', '--name-only', '-z', `${base}...${head}`],
    { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || 'git diff failed').trim());
  }
  return result.stdout.split('\0').filter(Boolean);
}

/** Publish the decision as a GitHub Actions step output. */
function writeOutput(run) {
  const value = run ? 'true' : 'false';
  if (process.env.GITHUB_OUTPUT) {
    require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `run=${value}\n`);
  }
  console.log(`ci-scope: run=${value}`);
}

/** Classify the current event and decide whether full CI is required. */
function run(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'pull_request') {
    writeOutput(true);
    return;
  }

  const base = env.PR_BASE_SHA;
  const head = env.PR_HEAD_SHA || 'HEAD';
  if (!base) {
    console.warn('ci-scope: pull request base SHA missing; running full CI');
    writeOutput(true);
    return;
  }

  try {
    const files = changedFiles(env.CI_SCOPE_ROOT || DEFAULT_ROOT, base, head);
    console.log(`ci-scope: ${files.length} changed file(s)`);
    writeOutput(!docsOnly(files));
  } catch (err) {
    console.warn(`ci-scope: ${err.message}; running full CI`);
    writeOutput(true);
  }
}

if (require.main === module) run();

module.exports = { docsOnly, isDocsPath };
