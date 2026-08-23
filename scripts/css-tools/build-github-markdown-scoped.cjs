#!/usr/bin/env node
/**
 * Generates src/styles/github-markdown.scoped.css from the github-markdown-css package.
 *
 * Why: the app uses class-based dark mode (`html.dark`, toggled by App.tsx), while the
 * package's per-theme files ship bare `.markdown-body …` rules and its `auto` file uses
 * `prefers-color-scheme` media queries. We therefore vendor:
 *   - github-markdown-light.css rules as-is
 *   - github-markdown-dark.css rules with every top-level selector prefixed `html.dark `
 *   - glue rules (hljs transparent background so highlight.js tokens sit on .markdown-body pre)
 *
 * Regenerate after bumping github-markdown-css:
 *   node scripts/css-tools/build-github-markdown-scoped.cjs
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const pkgVersion = require('../../node_modules/github-markdown-css/package.json').version;
const pkgDir = path.join(__dirname, '..', '..', 'node_modules', 'github-markdown-css');
const outFile = path.join(__dirname, '..', '..', 'src', 'styles', 'github-markdown.scoped.css');

/**
 * Split a CSS selector list on commas that sit at parenthesis/bracket depth
 * zero, so functional pseudo-class arguments like `a:has(>p,>div)` survive
 * as a single selector instead of being torn apart into invalid fragments.
 */
function splitSelectorList(selectorList) {
  const parts = [];
  let current = '';
  let depth = 0;
  for (const ch of selectorList) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** Prefix every selector of every top-level rule in `css` with `prefix`. */
function prefixSelectors(css, prefix) {
  let out = '';
  let i = 0;
  while (i < css.length) {
    if (/\s/.test(css[i])) { out += css[i++]; continue; }
    if (css.startsWith('/*', i)) {
      const end = css.indexOf('*/', i + 2);
      const stop = end < 0 ? css.length : end + 2;
      out += css.slice(i, stop);
      i = stop;
      continue;
    }
    // read prelude up to '{' or ';'
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') j++;
    const prelude = css.slice(i, j);
    if (css[j] === ';') { out += prelude + ';'; i = j + 1; continue; }
    let depth = 0;
    let k = j;
    for (; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}') { depth--; if (depth === 0) break; }
    }
    if (k >= css.length) throw new Error('Unbalanced braces in input CSS');
    const body = css.slice(j + 1, k);
    const trimmedPrelude = prelude.trim();
    if (trimmedPrelude.startsWith('@')) {
      if (/^@(media|supports|layer|container|scope)\b/i.test(trimmedPrelude)) {
        out += prelude + '{' + prefixSelectors(body, prefix) + '}';
      } else {
        // @font-face / @keyframes / @charset — no selectors to prefix
        out += prelude + '{' + body + '}';
      }
    } else {
      const prefixed = splitSelectorList(trimmedPrelude)
        .map((s) => prefix + ' ' + s.trim())
        .join(',\n');
      out += '\n' + prefixed + ' {' + body + '}';
    }
    i = k + 1;
  }
  return out;
}

const light = fs.readFileSync(path.join(pkgDir, 'github-markdown-light.css'), 'utf8');
const dark = fs.readFileSync(path.join(pkgDir, 'github-markdown-dark.css'), 'utf8');
const darkScoped = prefixSelectors(dark, 'html.dark');

const banner = `/*
 * GENERATED FILE — do not edit by hand.
 * Source: github-markdown-css@${pkgVersion} (MIT, https://github.com/sindresorhus/github-markdown-css)
 * Build:  node scripts/css-tools/build-github-markdown-scoped.cjs
 *
 * Light theme rules are used as-is; dark theme rules are scoped under \`html.dark\`
 * because this app uses class-based dark mode instead of prefers-color-scheme.
 */
`;

const glue = `
/* ---- app glue ---------------------------------------------------------- */

/* highlight.js token colors must sit on the .markdown-body pre background,
   not paint their own (hljs themes ship a solid background). */
.markdown-body .hljs {
  background: transparent !important;
}

/* The app renders .markdown-body inside cards and modals that already paint
   their own surface. GitHub's opaque root background would otherwise appear
   as a hard-edged box with text flush against its edges (release notes,
   README modal). Keep the root transparent; block elements (pre, table rows)
   still bring their own backgrounds. Must stay after both theme rule sets. */
.markdown-body {
  background-color: transparent;
}

html.dark .markdown-body {
  background-color: transparent;
}
`;

fs.writeFileSync(outFile, banner + light.trimEnd() + '\n\n' + darkScoped.trim() + '\n' + glue);
console.log(`Wrote ${outFile}`);
console.log(`light ${light.length}B, dark ${dark.length}B -> scoped total`);
