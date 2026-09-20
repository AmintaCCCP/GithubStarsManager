#!/usr/bin/env node
/**
 * scripts/check-i18n.cjs — i18n completeness and hardcoded-copy gate.
 *
 * Full tree (always):
 *   1. Every language in APP_LANGUAGES has every I18N_NAMESPACES json file.
 *   2. Key sets are identical across all languages.
 *   3. Literal t('key') / t("key") calls in src/** (except tests) exist in zh
 *      for the nearest useT/makeT namespace.
 *
 * Pull-request diffs (--base / PR_BASE_SHA):
 *   4. New/changed ja/es/pt-BR/ru/fr/de/ko phrases must not copy English;
 *      zh-TW must not copy Simplified Chinese.
 *   5. New useTPair / makeTPair / tPair( calls are banned.
 *   6. Added JSX / UI-prop string literals with CJK or a 3+ word English
 *      sentence fail unless the line has i18n-allow-literal.
 *
 * Keep APP_LANGUAGES / I18N_NAMESPACES in sync with src/i18n/languages.ts and
 * src/i18n/index.ts. The companion test asserts that on the real repo.
 *
 * Exit 0 = clean, 1 = violations, 2 = usage / git error.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

const DEFAULT_ROOT = path.resolve(__dirname, '..');

const APP_LANGUAGES = ['zh', 'en', 'ja', 'es', 'pt-BR', 'ru', 'zh-TW', 'fr', 'de', 'ko'];
const I18N_NAMESPACES = [
  'common',
  'app',
  'login',
  'repositories',
  'gists',
  'releases',
  'discovery',
  'chat',
  'search',
  'plugins',
  'settings',
  'ai',
  'services',
  'errors',
];
const SOURCE_LANG = 'en';
const ZH_SOURCE = 'zh';
const COPY_EXEMPT_LANGS = new Set(['en', 'zh']);
const ALLOW_LITERAL_RE = /i18n-allow-literal/;
const T_PAIR_RE = /\b(?:useTPair|makeTPair|tPair)\s*\(/;
const USE_T_RE = /\b(?:useT|makeT)\s*\(\s*(?:[a-zA-Z_][\w.]*\s*,\s*)?['"]([a-zA-Z0-9_-]+)['"]/g;
const T_CALL_RE = /\bt\s*\(\s*(['"])([^'"]+)\1/g;
const JSX_TEXT_RE = />\s*([^<{]+?)\s*</g;
const UI_PROP_RE =
  /\b(?:placeholder|title|aria-label|aria-description|alt|label|description|confirmText|cancelText|closeLabel|emptyText|helperText)\s*=\s*(['"`])([^'"`]+)\1/g;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const UI_PROP_NAMES = new Set([
  'placeholder',
  'title',
  'aria-label',
  'aria-description',
  'alt',
  'label',
  'description',
  'confirmText',
  'cancelText',
  'closeLabel',
  'emptyText',
  'helperText',
]);
const T_PAIR_NAMES = new Set(['useTPair', 'makeTPair', 'tPair']);
const ENGLISH_SENTENCE_RE = /\b[A-Za-z][A-Za-z'’-]*\s+[A-Za-z][A-Za-z'’-]*\s+[A-Za-z][A-Za-z'’-]*/;
const LOWERCASE_WORD_RE = /\b[a-z]{3,}\b/;
const TEST_FILE_RE = /\.test\.(ts|tsx)$/;
const SOURCE_FILE_RE = /\.(ts|tsx)$/;

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

function collectKeys(value, prefix = '') {
  if (value === null || typeof value !== 'object') return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) =>
    collectKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function flattenStrings(value, prefix = '', out = {}) {
  if (value === null || typeof value !== 'object') {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    flattenStrings(child, prefix ? `${prefix}.${key}` : key, out);
  }
  return out;
}

function loadLocales(root) {
  const localesDir = path.join(root, 'src', 'locales');
  const languages = {};
  for (const language of APP_LANGUAGES) {
    const dir = path.join(localesDir, language);
    const keys = new Set();
    const values = {};
    const namespaces = [];
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        const namespace = file.replace(/\.json$/, '');
        namespaces.push(namespace);
        const content = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
        for (const key of collectKeys(content)) keys.add(`${namespace}:${key}`);
        const flat = flattenStrings(content);
        for (const [key, val] of Object.entries(flat)) values[`${namespace}:${key}`] = val;
      }
    }
    languages[language] = { keys, values, namespaces: new Set(namespaces) };
  }
  return languages;
}

function isPhraseLike(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (CJK_RE.test(trimmed)) return true;
  if (/^\{\{[^}]+\}\}(?:\s+\{\{[^}]+\}\})*$/.test(trimmed)) return false;
  return /\s/.test(trimmed) && LOWERCASE_WORD_RE.test(trimmed);
}

function walkSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkSourceFiles(full, out);
    else if (SOURCE_FILE_RE.test(entry.name)) out.push(full);
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function nearestNamespace(src, index) {
  let last = null;
  USE_T_RE.lastIndex = 0;
  let match;
  while ((match = USE_T_RE.exec(src)) !== null) {
    if (match.index > index) break;
    last = match[1];
  }
  return last;
}

const PLURAL_SUFFIX_RE = /_(?:zero|one|two|few|many|other)$/;

function localKey(qualified) {
  const colon = qualified.indexOf(':');
  return colon === -1 ? qualified : qualified.slice(colon + 1);
}

function keyMatches(candidateLocal, rawKey) {
  if (candidateLocal === rawKey) return true;
  return candidateLocal.startsWith(`${rawKey}_`) && PLURAL_SUFFIX_RE.test(candidateLocal.slice(rawKey.length));
}

function keyExists(zhKeys, rawKey, preferredNs) {
  if (rawKey.includes(':')) {
    if (zhKeys.has(rawKey)) return true;
    const ns = rawKey.slice(0, rawKey.indexOf(':'));
    const local = rawKey.slice(rawKey.indexOf(':') + 1);
    for (const candidate of zhKeys) {
      if (candidate.startsWith(`${ns}:`) && keyMatches(localKey(candidate), local)) return true;
    }
    return false;
  }
  if (preferredNs) {
    if (zhKeys.has(`${preferredNs}:${rawKey}`)) return true;
    for (const candidate of zhKeys) {
      if (candidate.startsWith(`${preferredNs}:`) && keyMatches(localKey(candidate), rawKey)) return true;
    }
    return false;
  }
  for (const candidate of zhKeys) {
    if (keyMatches(localKey(candidate), rawKey)) return true;
  }
  return false;
}

function checkKeyReferences(root, languages) {
  const violations = [];
  const zhKeys = languages[ZH_SOURCE].keys;
  const files = walkSourceFiles(path.join(root, 'src'));
  for (const full of files) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    if (TEST_FILE_RE.test(rel) || rel.startsWith('src/locales/')) continue;
    const src = fs.readFileSync(full, 'utf8');
    const scanned = stripComments(src);
    T_CALL_RE.lastIndex = 0;
    let match;
    while ((match = T_CALL_RE.exec(scanned)) !== null) {
      const rawKey = match[2];
      if (!rawKey || rawKey.includes('${')) continue;
      if (!keyExists(zhKeys, rawKey, nearestNamespace(scanned, match.index))) {
        violations.push(`${rel}: t('${rawKey}') is missing from zh locales`);
      }
    }

    const makeTCallRe = /\bmakeT\s*\(\s*(?:[^,)]+,\s*)?['"]([a-zA-Z0-9_-]+)['"]\s*\)\s*\(\s*(['"])([^'"]+)\2/g;
    while ((match = makeTCallRe.exec(scanned)) !== null) {
      const rawKey = match[3];
      if (!rawKey || rawKey.includes('${')) continue;
      if (!keyExists(zhKeys, rawKey, match[1])) {
        violations.push(`${rel}: makeT(...)('${rawKey}') is missing from zh locales`);
      }
    }
  }
  return violations;
}

function checkLocaleParity(languages) {
  const violations = [];
  const zh = languages[ZH_SOURCE];
  for (const language of APP_LANGUAGES) {
    const current = languages[language];
    for (const ns of I18N_NAMESPACES) {
      if (!current.namespaces.has(ns)) {
        violations.push(`${language}: missing namespace file ${ns}.json`);
      }
    }
    const missing = [...zh.keys].filter((key) => !current.keys.has(key)).sort();
    const extra = [...current.keys].filter((key) => !zh.keys.has(key)).sort();
    if (missing.length) {
      violations.push(`${language}: missing ${missing.length} key(s), e.g. ${missing.slice(0, 5).join(', ')}`);
    }
    if (extra.length) {
      violations.push(`${language}: extra ${extra.length} key(s), e.g. ${extra.slice(0, 5).join(', ')}`);
    }
  }
  return violations;
}

function git(root, gitArgs) {
  const result = spawnSync('git', ['-C', root, ...gitArgs], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new Error(`git ${gitArgs.join(' ')} failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(`git ${gitArgs.join(' ')} failed (${result.status}): ${detail}`);
  }
  return result.stdout;
}

function showFile(root, ref, filePath) {
  const result = spawnSync('git', ['-C', root, 'show', `${ref}:${filePath}`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return null;
  return result.stdout;
}

function resolveRange(args, env) {
  const base = args.base || env.PR_BASE_SHA || env.GITHUB_BASE_SHA || null;
  const head = args.head || env.PR_HEAD_SHA || 'HEAD';
  if (base) return { base, head };
  return null;
}

function parseAddedSourceLines(diffText) {
  const added = [];
  let file = null;
  let skipFile = true;
  let newLine = 0;
  for (const raw of diffText.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6);
      skipFile =
        !file ||
        file === '/dev/null' ||
        !file.startsWith('src/') ||
        !SOURCE_FILE_RE.test(file) ||
        TEST_FILE_RE.test(file) ||
        file.startsWith('src/locales/');
      continue;
    }
    if (raw.startsWith('@@')) {
      const match = raw.match(/\+(\d+)/);
      newLine = match ? Number(match[1]) : 0;
      continue;
    }
    if (!file || skipFile) continue;
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      added.push({ file, line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith('-') && !raw.startsWith('---')) {
      // deleted line does not advance the new-file cursor
    } else if (!raw.startsWith('\\')) {
      newLine += 1;
    }
  }
  return added;
}

function looksHardcodedCopy(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (T_PAIR_RE.test(trimmed)) return 'new tPair/useTPair/makeTPair call';
  if (ALLOW_LITERAL_RE.test(trimmed)) return false;
  if (trimmed.startsWith('//') || trimmed.startsWith('*')) return false;
  if (trimmed.includes('t(') || trimmed.includes('useT(') || trimmed.includes('makeT(')) return false;

  JSX_TEXT_RE.lastIndex = 0;
  let match;
  while ((match = JSX_TEXT_RE.exec(trimmed)) !== null) {
    const value = match[1].trim();
    if (CJK_RE.test(value) || ENGLISH_SENTENCE_RE.test(value)) {
      return `hardcoded JSX text ${JSON.stringify(value)}`;
    }
  }

  UI_PROP_RE.lastIndex = 0;
  while ((match = UI_PROP_RE.exec(trimmed)) !== null) {
    const value = match[2].trim();
    if (CJK_RE.test(value) || ENGLISH_SENTENCE_RE.test(value)) {
      return `hardcoded UI string ${JSON.stringify(value)}`;
    }
  }
  return false;
}

function offsetToLine(sourceFile, pos) {
  return sourceFile.getLineAndCharacterOfPosition(pos).line + 1;
}

function nodeTouchesAddedLines(sourceFile, node, addedLines) {
  const start = offsetToLine(sourceFile, node.getStart(sourceFile));
  const end = offsetToLine(sourceFile, node.end);
  for (let line = start; line <= end; line += 1) {
    if (addedLines.has(line)) return start;
  }
  return null;
}

function callName(node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text;
  return null;
}

function collectHardcodedNodes(source, filePath, addedLines) {
  const scriptKind = filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const sourceLines = source.split('\n');
  const violations = [];

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = callName(node);
      if (name && T_PAIR_NAMES.has(name)) {
        const line = nodeTouchesAddedLines(sourceFile, node, addedLines);
        if (line != null) {
          violations.push(`${filePath}:${line}: new tPair/useTPair/makeTPair call`);
        }
      }
    }

    if (ts.isJsxText(node)) {
      const value = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
      if (value && (CJK_RE.test(value) || ENGLISH_SENTENCE_RE.test(value))) {
        const line = nodeTouchesAddedLines(sourceFile, node, addedLines);
        if (line != null && !ALLOW_LITERAL_RE.test(sourceLines[line - 1] || '')) {
          violations.push(`${filePath}:${line}: hardcoded JSX text ${JSON.stringify(value)}`);
        }
      }
    }

    if (ts.isJsxAttribute(node) && UI_PROP_NAMES.has(node.name.getText(sourceFile))) {
      const initializer = node.initializer;
      if (initializer && ts.isStringLiteral(initializer)) {
        const value = initializer.text.trim();
        if (value && (CJK_RE.test(value) || ENGLISH_SENTENCE_RE.test(value))) {
          const line = nodeTouchesAddedLines(sourceFile, initializer, addedLines);
          if (line != null && !ALLOW_LITERAL_RE.test(sourceLines[line - 1] || '')) {
            violations.push(`${filePath}:${line}: hardcoded UI string ${JSON.stringify(value)}`);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
}

function checkAddedLines(root, base, head) {
  const diff = git(root, ['diff', '-U0', `${base}...${head}`, '--', 'src']);
  const added = parseAddedSourceLines(diff);
  const addedByFile = new Map();
  for (const line of added) {
    const lines = addedByFile.get(line.file) || new Set();
    lines.add(line.line);
    addedByFile.set(line.file, lines);
  }

  const violations = [];
  for (const [filePath, addedLines] of addedByFile) {
    const source = showFile(root, head, filePath);
    if (source == null) continue;
    violations.push(...collectHardcodedNodes(source, filePath, addedLines));
  }
  return violations;
}

function checkChangedTranslations(root, base, head, languages) {
  const output = git(root, ['diff', '--name-only', '-z', `${base}...${head}`, '--', 'src/locales']);
  const files = output.split('\0').filter(Boolean);
  const enValues = languages[SOURCE_LANG].values;
  const zhValues = languages[ZH_SOURCE].values;
  const violations = [];

  for (const filePath of files) {
    const match = filePath.match(/^src\/locales\/([^/]+)\/([^/]+)\.json$/);
    if (!match) continue;
    const [, language, namespace] = match;
    if (COPY_EXEMPT_LANGS.has(language)) continue;

    const beforeDoc = JSON.parse(showFile(root, base, filePath) || '{}');
    const afterDoc = JSON.parse(showFile(root, head, filePath) || '{}');
    const before = flattenStrings(beforeDoc);
    const after = flattenStrings(afterDoc);
    const sourceValues = language === 'zh-TW' ? zhValues : enValues;
    const sourceLabel = language === 'zh-TW' ? 'Simplified Chinese' : 'English';

    for (const [key, value] of Object.entries(after)) {
      if (before[key] === value) continue;
      const source = sourceValues[`${namespace}:${key}`];
      if (typeof value !== 'string' || typeof source !== 'string') continue;
      if (!isPhraseLike(source) && !isPhraseLike(value)) continue;
      if (value === source) {
        violations.push(
          `${filePath}: ${key} copies the ${sourceLabel} source; translate it for ${language}`,
        );
      }
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
    io.log('Usage: node scripts/check-i18n.cjs [--base <sha-or-ref>] [--head HEAD] [--root <dir>]');
    return 0;
  }

  const languages = loadLocales(args.root);
  const violations = [...checkLocaleParity(languages), ...checkKeyReferences(args.root, languages)];

  const range = resolveRange(args, env);
  if (range) {
    try {
      violations.push(...checkChangedTranslations(args.root, range.base, range.head, languages));
      violations.push(...checkAddedLines(args.root, range.base, range.head));
    } catch (err) {
      io.error(`check-i18n: ${err.message}`);
      return 2;
    }
  }

  if (violations.length > 0) {
    io.error('check-i18n: i18n gate failed.');
    for (const violation of violations) io.error(`✖ ${violation}`);
    return 1;
  }

  io.log('check-i18n: locale parity, translations, and key references look good.');
  return 0;
}

if (require.main === module) {
  process.exitCode = run();
}

module.exports = {
  APP_LANGUAGES,
  I18N_NAMESPACES,
  parseArgs,
  loadLocales,
  checkLocaleParity,
  checkKeyReferences,
  checkChangedTranslations,
  parseAddedSourceLines,
  looksHardcodedCopy,
  collectHardcodedNodes,
  isPhraseLike,
  run,
};
