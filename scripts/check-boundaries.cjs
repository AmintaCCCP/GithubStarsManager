#!/usr/bin/env node
/**
 * scripts/check-boundaries.cjs — frontend layering boundary guard.
 *
 * A standalone, offline scanner that mirrors the ESLint `no-restricted-imports`
 * rules in eslint.config.js. It runs in CI as a defense-in-depth check so that
 * a misconfigured lint pass (or a contributor who disables the rule inline)
 * cannot silently let a View component import a business service, or an
 * application command import React/JSX/the Store/a service.
 *
 * Contract source of truth: docs/adr/0001-frontend-layering.md
 *
 * Properties:
 *  - No network, no dynamic import, no execution of repo code. It only reads
 *    source files as text and pattern-matches import statements.
 *  - Exempts test files (*.test.ts / *.test.tsx) so vi.mock('../services/...')
 *    stays legal.
 *
 * Exit code: 0 = clean, 1 = violations found (or unreadable file).
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

const BANNED_COMPONENT_SERVICES = [
  'githubApi',
  'aiService',
  'aiAnalysisHelper',
  'aiAnalysisOptimizer',
  'vectorSearchService',
  'autoSync',
  'webdavService',
  'backendAdapter',
  'rpcDownloadService',
  'githubApiFactory',
  'updateService',
  'translateService',
];

// application purity: banned module specifiers (exact) + banned path patterns.
// Mirrors eslint.config.js: **/store/** (not just useAppStore) so store/selectors
// and store/helpers cannot bypass the check. No application module currently
// imports any store path, so broadening is safe.
const APPLICATION_BANNED_PATHS = ['react', 'react-dom'];
const APPLICATION_BANNED_PATTERNS = [/\/store\//, /\/services\//];

const isTestFile = (rel) => /\.test\.(ts|tsx)$/.test(rel);

// Match static imports/exports in both forms:
//   ... from 'spec'   (default/named/namespace bindings and re-exports)
//   import 'spec'     (bare side-effect import, no from clause)
// The specifier is capture group 2 (from-form) or group 4 (side-effect form).
const IMPORT_RE =
  /\b(?:import|export)\b[^'";]*?\bfrom\s*(['"])([^'"]+)\1|\bimport\s*(['"])([^'"]+)\3/g;

// Match dynamic imports: import('...'). Captures the module specifier.
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;

/** Specifier of a static-import match, whichever alternative matched. */
function staticImportSpecifier(match) {
  return match[2] ?? match[4];
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function rel(full) {
  return path.relative(ROOT, full).split(path.sep).join('/');
}

let violations = 0;

function checkComponentFile(full, relPath) {
  if (isTestFile(relPath)) return;
  let src;
  try {
    src = fs.readFileSync(full, 'utf8');
  } catch (err) {
    console.error(`check-boundaries: cannot read ${relPath}: ${err.message}`);
    violations++;
    return;
  }
  // Static imports/exports.
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    const spec = staticImportSpecifier(m);
    for (const name of BANNED_COMPONENT_SERVICES) {
      // match ../services/name, ../../services/name, services/name, etc.
      if (new RegExp(`(^|/)services/${name}(\\.js)?$`).test(spec)) {
        console.error(
          `✖ ${relPath}: View component must not import business service '${name}' (imported '${spec}'). See docs/adr/0001-frontend-layering.md.`,
        );
        violations++;
      }
    }
  }
  // Dynamic imports.
  while ((m = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
    const spec = m[2];
    for (const name of BANNED_COMPONENT_SERVICES) {
      if (new RegExp(`(^|/)services/${name}(\\.js)?$`).test(spec)) {
        console.error(
          `✖ ${relPath}: View component must not dynamically import() business service '${name}' (imported '${spec}'). See docs/adr/0001-frontend-layering.md.`,
        );
        violations++;
      }
    }
  }
}

function checkApplicationFile(full, relPath) {
  if (isTestFile(relPath)) return;
  let src;
  try {
    src = fs.readFileSync(full, 'utf8');
  } catch (err) {
    console.error(`check-boundaries: cannot read ${relPath}: ${err.message}`);
    violations++;
    return;
  }
  const reportApplication = (spec, kind) => {
    console.error(
      `✖ ${relPath}: Application command must not ${kind} '${spec}' (pure state transition). See docs/adr/0001-frontend-layering.md.`,
    );
    violations++;
  };
  const checkSpec = (spec, kind) => {
    if (APPLICATION_BANNED_PATHS.includes(spec)) {
      reportApplication(spec, kind === 'import' ? 'import' : `${kind}`);
      return true;
    }
    if (APPLICATION_BANNED_PATTERNS.some((re) => re.test(spec))) {
      const storeKind = /\/store\//.test(spec) ? 'the Store' : 'a service';
      console.error(
        `✖ ${relPath}: Application command must not ${kind} ${storeKind} (imported '${spec}'). See docs/adr/0001-frontend-layering.md.`,
      );
      violations++;
      return true;
    }
    return false;
  };
  // Static imports/exports.
  let m;
  while ((m = IMPORT_RE.exec(src)) !== null) {
    checkSpec(staticImportSpecifier(m), 'import');
  }
  // Dynamic imports.
  while ((m = DYNAMIC_IMPORT_RE.exec(src)) !== null) {
    checkSpec(m[2], 'dynamically import()');
  }
}

const files = walk(path.join(ROOT, 'src'));
for (const full of files) {
  const relPath = rel(full);
  if (relPath.startsWith('src/components/')) checkComponentFile(full, relPath);
  else if (/^src\/features\/[^/]+\/application\//.test(relPath)) checkApplicationFile(full, relPath);
}

if (violations > 0) {
  console.error(`\ncheck-boundaries: ${violations} violation(s) found.`);
  process.exit(1);
}

console.log('check-boundaries: no frontend layering violations found.');
process.exit(0);
