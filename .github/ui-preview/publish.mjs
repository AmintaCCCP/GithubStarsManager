#!/usr/bin/env node
/**
 * Publish UI preview screenshots to a pull request.
 *
 * Subcommands:
 *   commit  --pr <n> --sha <sha> --dir <shots>
 *       Push the screenshots to the `ui-previews` branch under
 *       pr-<n>/<sha>/, replacing any earlier sha directory for this PR so the
 *       branch only ever holds the latest commit's previews.
 *   comment --pr <n> --sha <sha> --dir <shots> [--run-url <url>]
 *       Upsert the PR comment (found by the `<!-- ui-preview:begin -->`
 *       marker) with the screenshots embedded as raw.githubusercontent URLs.
 *   comment --pr <n> --failed --run-url <url>
 *       Upsert the same comment with a failure notice instead.
 *
 * Runs only on trusted (default-branch) code with a token that may write to
 * the repo and the PR. PR code is never executed here.
 */
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, rm, mkdir, copyFile, readFile, stat, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const MARKER_BEGIN = '<!-- ui-preview:begin -->';
const MARKER_END = '<!-- ui-preview:end -->';
const DEFAULT_BRANCH = 'ui-previews';

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--failed') args.failed = true;
    else if (flag.startsWith('--')) args[flag.slice(2)] = argv[++i];
    else args._.push(flag);
  }
  return args;
}

function requireArg(args, name) {
  const value = args[name] ?? process.env[name.toUpperCase()];
  if (!value) {
    console.error(`publish: missing --${name}`);
    process.exit(1);
  }
  return value;
}

/** The PR number is interpolated into paths and comment bodies: only accept
 *  plain positive integers, whoever supplied it (it is workflow_dispatch input). */
function requirePr(args) {
  const raw = String(requireArg(args, 'pr')).trim();
  if (!/^\d{1,9}$/.test(raw)) {
    console.error(`publish: --pr must be a positive integer, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return Number(raw);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`publish: missing env ${name}`);
    process.exit(1);
  }
  return value;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    // Fail fast instead of prompting on CI; keep the token out of any error
    // message that could echo the command line.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

/** Scene file names look like `repositories-light.png`; nothing else ships. */
const SHOT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*\.png$/;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** GitHub rejects pushes with files over 100 MiB; keep both bounds explicit
 *  so a runaway screenshot cannot wedge the publish job or bloat history. */
const MAX_SHOT_BYTES = 100 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

async function isPng(file) {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(PNG_MAGIC.length), 0, PNG_MAGIC.length, 0);
    return bytesRead === PNG_MAGIC.length && buffer.equals(PNG_MAGIC);
  } finally {
    await handle.close();
  }
}

async function listShotFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  // The record job runs PR code that shares $RUNNER_TEMP with the shots
  // directory, so only names shoot.mjs could have produced are accepted.
  let allowed = null;
  try {
    const scenes = JSON.parse(await readFile(path.join(dir, 'scenes.json'), 'utf8'));
    if (Array.isArray(scenes)) {
      allowed = new Set(scenes.map((entry) => path.basename(String(entry?.path ?? ''))));
    }
  } catch {
    // scenes.json is optional; the name pattern below still applies.
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && SHOT_NAME_PATTERN.test(entry.name))
    .filter((entry) => !allowed || allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();

  const shots = [];
  let totalBytes = 0;
  for (const name of candidates) {
    const file = path.join(dir, name);
    const { size } = await stat(file);
    if (size > MAX_SHOT_BYTES) {
      console.error(`publish: ${name} is ${size} bytes (limit ${MAX_SHOT_BYTES}); refusing to publish`);
      process.exit(1);
    }
    if (!(await isPng(file))) {
      console.warn(`publish: skipping ${name}: not a PNG file`);
      continue;
    }
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) {
      console.error(`publish: screenshots exceed ${MAX_TOTAL_BYTES} bytes in total; refusing to publish`);
      process.exit(1);
    }
    shots.push(name);
  }
  if (shots.length === 0) {
    console.error(`publish: no .png screenshots found in ${dir}`);
    process.exit(1);
  }
  return shots;
}

async function commitShots(args) {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const token = requireEnv('GITHUB_TOKEN');
  const pr = requirePr(args);
  const sha = requireArg(args, 'sha');
  const shotsDir = requireArg(args, 'dir');
  const branch = process.env.UI_PREVIEW_BRANCH ?? DEFAULT_BRANCH;

  const shots = await listShotFiles(shotsDir);
  const remote = `https://x-access-token:${token}@github.com/${repo}.git`;
  const workdir = await mkdtemp(path.join(tmpdir(), 'ui-previews-'));

  try {
    const gitInit = (...args) => execFileSync('git', args, {
      cwd: workdir,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    gitInit('init', '-q', workdir);
    gitInit('config', 'user.name', 'github-actions[bot]');
    gitInit('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    gitInit('config', 'commit.gpgsign', 'false');
    gitInit('remote', 'add', 'origin', remote);
    // Credentials go through a helper instead of the remote URL so the token
    // can never leak via a git error message echoing the command line.
    gitInit('config', 'credential.helper', `!f() { echo "username=x-access-token"; echo "password=${token}"; }; f`);

    // The branch usually exists; a missing one is the very first preview.
    let hasBranch = true;
    try {
      execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', branch], { cwd: workdir, encoding: 'utf8' });
    } catch {
      hasBranch = false;
    }
    if (hasBranch) {
      git(workdir, 'checkout', '-q', '-B', branch, 'FETCH_HEAD');
    } else {
      git(workdir, 'checkout', '-q', '--orphan', branch);
    }

    const targetDir = path.join(workdir, `pr-${pr}`);
    // Only the latest commit's previews survive: raw URLs are rewritten in the
    // same comment update, so stale sha directories would be dead weight.
    await rm(targetDir, { recursive: true, force: true });
    const shaDir = path.join(targetDir, sha);
    await mkdir(shaDir, { recursive: true });
    for (const shot of shots) {
      await copyFile(path.join(shotsDir, shot), path.join(shaDir, shot));
    }

    git(workdir, 'add', path.join('pr-' + pr));
    // `git diff --cached --quiet` exits non-zero when there IS a staged diff;
    // execFileSync surfaces that as a thrown error.
    let hasStagedDiff = false;
    try {
      git(workdir, 'diff', '--cached', '--quiet');
    } catch {
      hasStagedDiff = true;
    }
    if (!hasStagedDiff) {
      console.log('publish: screenshots unchanged; nothing to commit');
      return;
    }
    git(workdir, 'commit', '-q', '-m', `ui-preview: screenshots for PR #${pr} @ ${sha.slice(0, 7)}`);
    const previewCommit = git(workdir, 'rev-parse', 'HEAD').trim();

    // Push with one retry: concurrency groups cancel same-PR runs, but two
    // different PRs can still race on the shared branch. On a moved branch,
    // rebase onto the fresh head and cherry-pick ONLY this run's commit —
    // never the fetched baseline, or deleted sha directories could resurface.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        execFileSync('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], {
          cwd: workdir,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        console.log(`publish: pushed ${shots.length} screenshot(s) to ${branch} under pr-${pr}/${sha}`);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        console.warn('publish: push rejected (branch moved); replaying only this run\'s commit');
        execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', branch], {
          cwd: workdir,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        });
        git(workdir, 'checkout', '-q', '-B', branch, 'FETCH_HEAD');
        git(workdir, 'cherry-pick', previewCommit);
      }
    }
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

const api = async (repo, token, pathName, init) => {
  const response = await fetch(`https://api.github.com/repos/${repo}/${pathName}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${init?.method ?? 'GET'} ${pathName} failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return response.json();
};

async function findPreviewComment(repo, token, pr) {
  // Walk every page until the marker comment shows up or the list is
  // exhausted; a fixed cap could miss it and create duplicates forever.
  const MAX_PAGES = 100; // 10k comments; a runaway guard, not an expected hit
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const batch = await api(repo, token, `issues/${pr}/comments?per_page=100&page=${page}`);
    const existing = batch.find((comment) =>
      comment.body?.includes(MARKER_BEGIN) && comment.user?.login === 'github-actions[bot]');
    if (existing) return existing;
    if (batch.length < 100) return null;
  }
  console.warn('publish: comment listing hit the page cap; an older preview comment may exist beyond it');
  return null;
}

function sceneLabel(filename) {
  return path.basename(filename, '.png').replaceAll('-', ' ');
}

function buildSuccessBody({ repo, branch, pr, sha, runUrl, shots }) {
  const shaShort = sha.slice(0, 7);
  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}/pr-${pr}/${sha}`;
  const source = runUrl ? `[ui-preview 工作流](${runUrl})` : 'ui-preview 工作流';
  const lines = [
    MARKER_BEGIN,
    '## 📸 UI 预览',
    '',
    `\`${shaShort}\` 的界面截图，由 ${source} 自动生成（内置演示数据，无真实凭据）：`,
    '',
  ];
  for (const shot of shots) {
    lines.push(`### ${sceneLabel(shot)}`);
    lines.push(`![${sceneLabel(shot)}](${rawBase}/${encodeURIComponent(shot)})`);
    lines.push('');
  }
  lines.push(...[
    `> 截图托管于 [\`${branch}\`](https://github.com/${repo}/tree/${branch}) 分支；`,
    'PR 中新的 UI 提交会自动刷新本评论。',
    MARKER_END,
    '',
  ]);
  return lines.join('\n');
}

function buildFailureBody({ runUrl, pr }) {
  return [
    MARKER_BEGIN,
    '## ⚠️ UI 预览生成失败',
    '',
    `本次截图或发布任务未能完成，[查看日志](${runUrl ?? 'the workflow run'})。`,
    `可在修复后手动重跑：\`gh workflow run ui-preview.yml -f pr=${pr}\``,
    MARKER_END,
    '',
  ].join('\n');
}

async function upsertComment(args) {
  const repo = requireEnv('GITHUB_REPOSITORY');
  const token = requireEnv('GITHUB_TOKEN');
  const pr = requirePr(args);
  const runUrl = args['run-url'] ?? '';
  const sha = args.sha ?? '';
  const shotsDir = args.dir;

  let body;
  if (args.failed) {
    body = buildFailureBody({ runUrl, pr });
  } else {
    const branch = process.env.UI_PREVIEW_BRANCH ?? DEFAULT_BRANCH;
    const shots = await listShotFiles(shotsDir);
    body = buildSuccessBody({ repo, branch, pr, sha, runUrl, shots });
  }

  const existing = await findPreviewComment(repo, token, pr);
  if (existing) {
    await api(repo, token, `issues/comments/${existing.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
    console.log(`publish: updated existing preview comment ${existing.id} on PR #${pr}`);
  } else {
    const created = await api(repo, token, `issues/${pr}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
    console.log(`publish: created preview comment ${created.id} on PR #${pr}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0];
  if (mode === 'commit') {
    await commitShots(args);
  } else if (mode === 'comment') {
    await upsertComment(args);
  } else {
    console.error('Usage: publish.mjs commit|comment [--pr n] [--sha sha] [--dir shots] [--failed] [--run-url url]');
    process.exitCode = 2;
    return;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
