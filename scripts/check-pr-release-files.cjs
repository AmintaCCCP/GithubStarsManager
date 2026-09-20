#!/usr/bin/env node
/**
 * scripts/check-pr-release-files.cjs — block contributor PRs from bumping
 * the app version or rewriting the in-app update feed.
 *
 * Owner releases go straight to main, so this gate is a no-op unless a
 * pull-request base...head range is provided (CI sets that; locally:
 * `node scripts/check-pr-release-files.cjs --base origin/main`).
 *
 * Blocked:
 *   - package.json / server/package.json `version` field
 *   - package-lock.json / server/package-lock.json root + packages[""] version
 *   - any change to versions/version-info.xml
 *
 * Not blocked: dependency bumps inside lockfiles, README, workflows, or
 * scripts/update-version.cjs itself.
 *
 * Exit 0 = clean / skipped, 1 = blocked, 2 = usage / git error.
 */
'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const PACKAGE_VERSION_FILES = ['package.json', 'server/package.json'];
const LOCKFILE_VERSION_FILES = ['package-lock.json', 'server/package-lock.json'];
const UPDATE_FEED = 'versions/version-info.xml';

function parseArgs(argv) {
  const args = { base: null, head: 'HEAD', root: DEFAULT_ROOT };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '--base' && next) {
      args.base = next;
      i += 1;
    } else if (token === '--head' && next) {
      args.head = next;
      i += 1;
    } else if (token === '--root' && next) {
      args.root = path.resolve(next);
      i += 1;
    } else if (token === '--help' || token === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function resolveRange(args, env) {
  const base = args.base || env.PR_BASE_SHA || env.GITHUB_BASE_SHA || null;
  const head = args.head || env.PR_HEAD_SHA || 'HEAD';
  const eventName = env.GITHUB_EVENT_NAME;
  if (base) return { base, head, skip: false };
  if (eventName && eventName !== 'pull_request') {
    return { base: null, head, skip: true };
  }
  return { base: null, head, skip: true };
}

function git(root, gitArgs) {
  const result = spawnSync('git', ['-C', root, ...gitArgs], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    throw new Error(`git ${gitArgs.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${gitArgs.join(' ')} failed (${result.status}): ${detail}`);
  }
  return result.stdout;
}

function changedFiles(root, base, head) {
  const output = git(root, ['diff', '--name-only', '-z', `${base}...${head}`]);
  return output.split('\0').filter(Boolean);
}

function showFile(root, ref, filePath) {
  const result = spawnSync('git', ['-C', root, 'show', `${ref}:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function readJson(text, label) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${err.message}`);
  }
}

function packageVersion(doc) {
  return doc && typeof doc.version === 'string' ? doc.version : undefined;
}

function lockfileRootVersions(doc) {
  if (!doc || typeof doc !== 'object') return { version: undefined, packagesRoot: undefined };
  const packagesRoot = doc.packages && doc.packages[''] && typeof doc.packages[''].version === 'string'
    ? doc.packages[''].version
    : undefined;
  return {
    version: typeof doc.version === 'string' ? doc.version : undefined,
    packagesRoot,
  };
}

function collectViolations(root, base, head) {
  const comparisonBase = git(root, ['merge-base', base, head]).trim();
  const files = new Set(changedFiles(root, base, head));
  const violations = [];

  if (files.has(UPDATE_FEED)) {
    violations.push(`${UPDATE_FEED}: contributor PRs must not change the in-app update feed`);
  }

  for (const filePath of PACKAGE_VERSION_FILES) {
    if (!files.has(filePath)) continue;
    const before = packageVersion(
      readJson(showFile(root, comparisonBase, filePath), `${comparisonBase}:${filePath}`),
    );
    const after = packageVersion(readJson(showFile(root, head, filePath), `${head}:${filePath}`));
    if (before !== after) {
      violations.push(
        `${filePath}: version changed (${before ?? '(missing)'} → ${after ?? '(missing)'}). Owner bumps versions on main.`,
      );
    }
  }

  for (const filePath of LOCKFILE_VERSION_FILES) {
    if (!files.has(filePath)) continue;
    const before = lockfileRootVersions(
      readJson(showFile(root, comparisonBase, filePath), `${comparisonBase}:${filePath}`),
    );
    const after = lockfileRootVersions(readJson(showFile(root, head, filePath), `${head}:${filePath}`));
    if (before.version !== after.version) {
      violations.push(
        `${filePath}: root version changed (${before.version ?? '(missing)'} → ${after.version ?? '(missing)'}).`,
      );
    }
    if (before.packagesRoot !== after.packagesRoot) {
      violations.push(
        `${filePath}: packages[""].version changed (${before.packagesRoot ?? '(missing)'} → ${after.packagesRoot ?? '(missing)'}).`,
      );
    }
  }

  return violations;
}

function run(argv = process.argv.slice(2), env = process.env, io = console) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    io.error(err.message);
    return 2;
  }
  if (args.help) {
    io.log('Usage: node scripts/check-pr-release-files.cjs --base <sha-or-ref> [--head HEAD] [--root <dir>]');
    return 0;
  }

  const range = resolveRange(args, env);
  if (range.skip) {
    io.log('check-pr-release-files: skip (not a pull request)');
    return 0;
  }

  let violations;
  try {
    violations = collectViolations(args.root, range.base, range.head);
  } catch (err) {
    io.error(`check-pr-release-files: ${err.message}`);
    return 2;
  }

  if (violations.length > 0) {
    io.error('check-pr-release-files: contributor PRs must not bump the app version or update feed.');
    for (const violation of violations) io.error(`✖ ${violation}`);
    return 1;
  }

  io.log('check-pr-release-files: no release-file version changes in this PR.');
  return 0;
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  PACKAGE_VERSION_FILES,
  LOCKFILE_VERSION_FILES,
  UPDATE_FEED,
  parseArgs,
  resolveRange,
  collectViolations,
  run,
};
