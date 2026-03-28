#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const normalize = (value) => (value || '').toLowerCase().trim();

const repoText = (repo) => [
  repo.name,
  repo.full_name,
  repo.description,
  repo.language,
  repo.ai_summary,
  ...(repo.topics || []),
  ...(repo.ai_tags || []),
  ...(repo.custom_tags || []),
  ...(repo.ai_platforms || []),
  repo.custom_description,
  repo.custom_category,
].filter(Boolean).join(' ').toLowerCase();

const scoreRepository = (repo, queryWords) => {
  const text = repoText(repo);
  const name = normalize(repo.name);
  const fullName = normalize(repo.full_name);
  let score = 0;
  for (const word of queryWords) {
    if (name === word) score += 10;
    if (name.includes(word)) score += 6;
    if (fullName.includes(word)) score += 5;
    if (text.includes(word)) score += 2;
  }
  return score;
};

const searchRepositories = (repositories, query, limit) => {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return repositories.slice(0, limit);
  }

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  return repositories
    .map((repo) => ({ repo, score: scoreRepository(repo, queryWords) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.repo.stargazers_count - a.repo.stargazers_count)
    .slice(0, limit)
    .map((item) => item.repo);
};

const dedupe = (values) => {
  const seen = new Set();
  const result = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

const printJson = (value) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

const parseArgs = (args) => {
  const flags = new Map();
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        flags.set(arg, true);
      } else {
        flags.set(arg, next);
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional };
};

const getSnapshotPath = (flags) => {
  const direct = flags.get('--snapshot');
  if (typeof direct === 'string' && direct.trim()) return path.resolve(direct);
  return path.resolve(process.cwd(), 'github-stars.snapshot.json');
};

const loadSnapshot = (snapshotPath) => {
  if (!fs.existsSync(snapshotPath)) {
    throw new Error(`Snapshot not found: ${snapshotPath}`);
  }
  return JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
};

const saveSnapshot = (snapshotPath, snapshot) => {
  snapshot.exportedAt = new Date().toISOString();
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2));
};

const findByRepo = (repositories, fullName) => {
  const normalized = normalize(fullName);
  const repo = repositories.find((item) => normalize(item.full_name) === normalized);
  if (!repo) throw new Error(`Repository not found: ${fullName}`);
  return repo;
};

const replaceRepository = (repositories, updated) => {
  return repositories.map((repo) => (repo.id === updated.id ? updated : repo));
};

const main = () => {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printJson({ ok: false, error: 'Missing command' });
    process.exit(1);
  }

  if (command === 'search') {
    const { flags, positional } = parseArgs(args.slice(1));
    const snapshotPath = getSnapshotPath(flags);
    const query = positional.join(' ').trim();
    const limit = Number(flags.get('--limit') || 20);
    const snapshot = loadSnapshot(snapshotPath);
    const repositories = searchRepositories(snapshot.repositories, query, limit);
    printJson({ ok: true, query, total: repositories.length, repositories });
    return;
  }

  const subcommand = args[1];
  const { flags } = parseArgs(args.slice(2));
  const snapshotPath = getSnapshotPath(flags);

  if (command === 'category' && subcommand === 'set') {
    const snapshot = loadSnapshot(snapshotPath);
    const category = String(flags.get('--category') || '').trim();
    const repoName = typeof flags.get('--repo') === 'string' ? String(flags.get('--repo')) : '';
    if (!category || !repoName) throw new Error('category set requires --repo and --category');
    const repo = findByRepo(snapshot.repositories, repoName);
    const updated = { ...repo, custom_category: category, last_edited: new Date().toISOString() };
    snapshot.repositories = replaceRepository(snapshot.repositories, updated);
    if (!flags.has('--dry-run')) saveSnapshot(snapshotPath, snapshot);
    printJson({ ok: true, action: 'category.set', dryRun: flags.has('--dry-run'), repository: updated });
    return;
  }

  if (command === 'tags' && subcommand === 'add') {
    const snapshot = loadSnapshot(snapshotPath);
    const tags = String(flags.get('--tags') || '').split(',').map((item) => item.trim()).filter(Boolean);
    const repoName = typeof flags.get('--repo') === 'string' ? String(flags.get('--repo')) : '';
    if (!tags.length || !repoName) throw new Error('tags add requires --repo and --tags');
    const repo = findByRepo(snapshot.repositories, repoName);
    const updated = {
      ...repo,
      custom_tags: dedupe([...(repo.custom_tags || []), ...tags]),
      last_edited: new Date().toISOString(),
    };
    snapshot.repositories = replaceRepository(snapshot.repositories, updated);
    if (!flags.has('--dry-run')) saveSnapshot(snapshotPath, snapshot);
    printJson({ ok: true, action: 'tags.add', dryRun: flags.has('--dry-run'), repository: updated });
    return;
  }

  printJson({ ok: false, error: `Unsupported command: ${command}${subcommand ? ` ${subcommand}` : ''}` });
  process.exit(1);
};

try {
  main();
} catch (error) {
  printJson({ ok: false, error: error instanceof Error ? error.message : String(error) });
  process.exit(1);
}
