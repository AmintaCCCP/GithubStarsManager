#!/usr/bin/env node
/**
 * codemod 后清理：
 *  1. 合并 i18n/useT 的重复 import、去重 named imports、移除未使用的 useT/useTPair/TranslateFn
 *  2. 按 tsc 报告的精确行列移除未使用的 language/useCallback 等声明
 * 用法：node scripts/codemods/post-fix.mjs [tsc-output-file]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tscOut = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : '';

const fileIssues = new Map(); // file -> [{ line, col, kind }]
for (const match of tscOut.matchAll(/^(src\/.+?\.(?:ts|tsx))\((\d+),(\d+)\): error TS6133: '(.*?)' is declared but its value is never read/gm)) {
  const [, file, line, , name] = match;
  if (!fileIssues.has(file)) fileIssues.set(file, []);
  fileIssues.get(file).push({ line: Number(line), name });
}
for (const match of tscOut.matchAll(/^(src\/.+?\.(?:ts|tsx))\(\d+,\d+\): error TS2300: Duplicate identifier 'useT'/gm)) {
  const file = match[1];
  if (!fileIssues.has(file)) fileIssues.set(file, []);
}

function normalizeImports(content) {
  const importRegex = /^import\s+(\{[^}]*\})\s+from\s+(['"])([^'"]+)\2;[ \t]*$/gm;
  const spans = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const [, braces, , specifier] = match;
    if (!specifier.includes('i18n/useT')) continue;
    const names = braces.replace(/[{}]/g, '').split(',').map((n) => n.trim()).filter(Boolean);
    spans.push({ start: match.index, end: match.index + match[0].length, specifier, names });
  }
  if (spans.length === 0) return content;
  const bySpecifier = new Map();
  for (const span of spans) {
    const list = bySpecifier.get(span.specifier) ?? [];
    list.push(...span.names);
    bySpecifier.set(span.specifier, list);
  }
  const body = spans.reduce((acc, span, index) => acc, content);
  for (const [specifier, names] of bySpecifier) {
    const unique = [...new Set(names)];
    const filtered = unique.filter((name) => {
      if (name !== 'useT' && name !== 'useTPair') return true;
      return new RegExp(`\\b${name}\\s*\\(`).test(body);
    });
    bySpecifier.set(specifier, filtered);
  }
  for (const span of [...spans].reverse()) {
    content = content.slice(0, span.start) + content.slice(span.end);
  }
  const firstImportMatch = content.match(/^import /m);
  const insertAt = firstImportMatch ? firstImportMatch.index : 0;
  const merged = [...bySpecifier.entries()].filter(([, names]) => names.length > 0);
  const insertion = merged.map(([specifier, names]) => `import { ${names.join(', ')} } from '${specifier}';\n`).join('');
  return content.slice(0, insertAt) + insertion + content.slice(insertAt);
}

function removeUnusedAt(content, line, name) {
  const lines = content.split('\n');
  const index = line - 1;
  if (index < 0 || index >= lines.length) return content;
  const original = lines[index];
  // 整行就是该声明
  const wholePatterns = [
    new RegExp(`^[ \\t]*${name}: state\\.${name},?[ \\t]*$`),
    new RegExp(`^[ \\t]*${name},?[ \\t]*$`),
    new RegExp(`^[ \\t]*${name}: state\\.${name},?[ \\t]*//.*$`),
  ];
  if (wholePatterns.some((pattern) => pattern.test(original))) {
    lines.splice(index, 1);
    return lines.join('\n');
  }
  // 行内移除单个 token：`foo, language, bar` / `language: state.language, theme`
  let updated = original
    .replace(new RegExp(`(\\b${name}: state\\.${name},)\\s*`), '')
    .replace(new RegExp(`,\\s*\\b${name}: state\\.${name}\\b`), '')
    .replace(new RegExp(`(\\b${name},)\\s*`), '')
    .replace(new RegExp(`,\\s*\\b${name}\\b(?!:)`), '');
  if (updated === original) return content;
  lines[index] = updated;
  return lines.join('\n');
}

for (const [file, issues] of fileIssues) {
  const filePath = path.join(rootDir, file);
  let content = readFileSync(filePath, 'utf8');
  // 先按 tsc 行号降序移除（避免行号偏移），再归一化 import（会增删行）
  for (const { line, name } of [...issues].sort((a, b) => b.line - a.line)) {
    content = removeUnusedAt(content, line, name);
  }
  content = normalizeImports(content);
  writeFileSync(filePath, content);
  console.log(`cleaned ${file} (${issues.length} issues)`);
}
console.log(`done, ${fileIssues.size} files`);
