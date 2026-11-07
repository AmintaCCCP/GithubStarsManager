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
import { mkdtemp, readdir, rm, mkdir, copyFile, readFile } from 'node:fs/promises';
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
 *  positive integers, whoever supplied it (it is workflow_dispatch input). */
function requirePr(args) {
  const pr = Number.parseInt(requireArg(args, 'pr'), 10);
  if (!Number.isSafeInteger(pr) || pr <= 0) {
    console.error('publish: --pr must be a positive integer');
    process.exit(1);
  }
  return pr;
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
  const shots = entries
    .filter((entry) => entry.isFile() && SHOT_NAME_PATTERN.test(entry.name))
    .filter((entry) => !allowed || allowed.has(entry.name))
    .map((entry) => entry.name)
    .sort();
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

    // Push with one rebase retry: concurrency groups cancel same-PR runs, but
    // two different PRs can still race on the shared branch.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        execFileSync('git', ['push', '-q', 'origin', `HEAD:refs/heads/${branch}`], { cwd: workdir, encoding: 'utf8' });
        console.log(`publish: pushed ${shots.length} screenshot(s) to ${branch} under pr-${pr}/${sha}`);
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        console.warn('publish: push rejected (branch moved); rebasing and retrying');
        execFileSync('git', ['fetch', '-q', '--depth', '1', 'origin', branch], { cwd: workdir, encoding: 'utf8' });
        git(workdir, 'rebase', 'FETCH_HEAD');
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

async function listAllComments(repo, token, pr) {
  const comments = [];
  let page = 1;
  // Guard the loop with a hard page cap so a paging bug can never spin.
  while (page <= 20) {
    const batch = await api(repo, token, `issues/${pr}/comments?per_page=100&page=${page}`);
    comments.push(...batch);
    if (batch.length < 100) return comments;
    page += 1;
  }
  console.warn('publish: comment listing hit the page cap; an older preview comment may exist beyond it');
  return comments;
}

function sceneLabel(filename) {
  return path.basename(filename, '.png').replaceAll('-', ' ');
}

function buildSuccessBody({ repo, branch, pr, sha, runUrl, shots }) {
  const shaShort = sha.slice(0, 7);
  const rawBase = `https://raw.githubusercontent.com/${repo}/${branch}/pr-${pr}/${sha}`;
  const lines = [
    MARKER_BEGIN,
    '## 📸 UI 预览',
    '',
    `\`${shaShort}\` 的界面截图，由 [ui-preview 工作流](${runUrl ?? 'the ui-preview workflow'}) 自动生成（内置演示数据，无真实凭据）：`,
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

  const existing = (await listAllComments(repo, token, pr)).find((comment) =>
    comment.body?.includes(MARKER_BEGIN) && comment.user?.login === 'github-actions[bot]');
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
