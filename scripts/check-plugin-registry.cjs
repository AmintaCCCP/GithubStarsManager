#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

function readRegistry(root, relativePath) {
  const filePath = path.join(root, relativePath);
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`${relativePath}: ${error.message}`);
  }
  if (!Array.isArray(value)) throw new Error(`${relativePath}: root value must be an array`);
  return value;
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function collectViolations(root = DEFAULT_ROOT) {
  const community = readRegistry(root, 'registry/community-plugins.json');
  const removed = readRegistry(root, 'registry/removed-plugins.json');
  const violations = [];
  const versions = new Set();

  for (const [index, entry] of community.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const key = `${entry.id ?? ''}\0${entry.version ?? ''}`;
    if (versions.has(key)) {
      violations.push(`community-plugins.json[${index}]: duplicate (id, version) ${entry.id}@${entry.version}`);
    }
    versions.add(key);

    const permissionTargets = sortedUnique(
      (Array.isArray(entry.permissions) ? entry.permissions : [])
        .filter((permission) => typeof permission === 'string' && permission.startsWith('network:'))
        .map((permission) => permission.slice('network:'.length)),
    );
    const declaredTargets = sortedUnique(
      (Array.isArray(entry.networkTargets) ? entry.networkTargets : [])
        .filter((target) => typeof target === 'string'),
    );
    if (!sameStrings(permissionTargets, declaredTargets)) {
      violations.push(
        `community-plugins.json[${index}]: networkTargets must exactly match network:* permissions`,
      );
    }
  }

  const removalCoverage = new Map();
  for (const [index, entry] of removed.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || typeof entry.id !== 'string') continue;
    const previous = removalCoverage.get(entry.id) ?? [];
    const versionsForEntry = Array.isArray(entry.versions) ? entry.versions : [];
    const coversAll = versionsForEntry.length === 0;
    for (const item of previous) {
      const overlaps = coversAll || item.coversAll
        || versionsForEntry.some((version) => item.versions.has(version));
      if (overlaps) {
        violations.push(
          `removed-plugins.json[${index}]: overlaps entry ${item.index} for ${entry.id}; removal records must be unambiguous`,
        );
      }
    }
    previous.push({ index, coversAll, versions: new Set(versionsForEntry) });
    removalCoverage.set(entry.id, previous);
  }

  return violations;
}

function run(argv = process.argv.slice(2), io = console) {
  let root = DEFAULT_ROOT;
  if (argv.length === 2 && argv[0] === '--root') root = path.resolve(argv[1]);
  else if (argv.length !== 0) {
    io.error('Usage: node scripts/check-plugin-registry.cjs [--root <dir>]');
    return 2;
  }

  let violations;
  try {
    violations = collectViolations(root);
  } catch (error) {
    io.error(`check-plugin-registry: ${error.message}`);
    return 2;
  }
  if (violations.length > 0) {
    io.error('check-plugin-registry: registry semantics are invalid.');
    for (const violation of violations) io.error(`✖ ${violation}`);
    return 1;
  }
  io.log('check-plugin-registry: registry semantics look good.');
  return 0;
}

if (require.main === module) process.exitCode = run();

module.exports = { collectViolations, run };
