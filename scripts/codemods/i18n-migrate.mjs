#!/usr/bin/env node
/**
 * i18n 全量迁移 codemod。
 *
 * 转换内容（仅限白名单目录，services 层分流另行手工处理）：
 *  1. 局部 `const t = (zh, en) => language === 'zh' ? zh : en` 定义 → `const t = useT('<ns>')`
 *  2. `t('中文', 'English')` → `t('<component>.<slug>')`，双语写入 src/locales/{zh,en}/<ns>.json
 *  3. 模板字符串参数 → `t(key, { p: expr })` + 字典中的 {{p}} 占位
 *  4. `language === 'zh' ? 'A' : 'B'`（双侧字符串字面量）→ `t(key)`；必要时向宿主函数插入 useT
 *  5. 文本级：t prop 类型 `(zh: string, en: string) => string` → `TranslateFn`
 *
 * 无法安全转换的写法写入 scripts/codemods/i18n-migrate.report.json。
 * 用法：node scripts/codemods/i18n-migrate.mjs [--write]
 */
import { Project, SyntaxKind, Node } from 'ts-morph';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WRITE = process.argv.includes('--write');
const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcDir = path.join(rootDir, 'src');
const localesDir = path.join(srcDir, 'locales');

const SKIP = [
  /\.test\.(ts|tsx)$/,
  /__fixtures__/,
  /^src\/services\//,
  /^src\/i18n\//,
  /^src\/locales\//,
  /^src\/components\/ui\//,
  /^src\/main\.tsx$/,
  /^src\/components\/ErrorBoundary\.tsx$/,
  /^src\/utils\/backendErrors\.ts$/,
];

const FEATURE_NS = {
  repositories: 'repositories',
  gists: 'gists',
  releases: 'releases',
  discovery: 'discovery',
  settings: 'settings',
  plugins: 'plugins',
  'repository-chat': 'chat',
  lifecycle: 'app',
};

function namespaceFor(relPath) {
  const norm = relPath.replaceAll('\\', '/');
  if (norm.startsWith('src/features/')) {
    const feature = norm.split('/')[2];
    return FEATURE_NS[feature] ?? 'common';
  }
  if (norm.startsWith('src/plugins/')) return 'plugins';
  if (norm.startsWith('src/hooks/')) return 'app';
  if (norm.startsWith('src/store/')) return 'app';
  if (norm.startsWith('src/utils/')) return 'app';
  if (norm.startsWith('src/types/')) return 'app';
  if (norm.startsWith('src/constants/')) return 'app';
  if (norm.startsWith('src/components/')) {
    const base = path.basename(norm);
    if (base.startsWith('LoginScreen')) return 'login';
    if (base.startsWith('RepositoryChat') || base.startsWith('GlobalChatHistorySheet') || base.startsWith('Chat')) return 'chat';
    if (base.startsWith('RepositoryRelease') || base.startsWith('Release') || base.startsWith('Fork') || base.startsWith('SubscriptionRepoCard')) return 'releases';
    if (base.startsWith('Gist')) return 'gists';
    if (base.startsWith('Discovery') || base.startsWith('WeeklyIssueModal')) return 'discovery';
    if (base.startsWith('XTweet') || base.startsWith('Telegram')) return 'plugins';
    if (base.startsWith('Repository')) return 'repositories';
    return 'app';
  }
  return 'common';
}

function componentKeyFor(relPath) {
  const base = path.basename(relPath).replace(/\.(ts|tsx)$/, '');
  return base.charAt(0).toLowerCase() + base.slice(1).replace(/[^a-zA-Z0-9]/g, '');
}

function relativeI18nPath(relPath, module) {
  const depth = relPath.split('/').length - 2; // src/a/b.ts → 1；src/a/b/c.ts → 2
  return `${'../'.repeat(depth)}i18n/${module}`;
}

const slugify = (text) => {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || 'text';
};

const dicts = {};
const manual = [];
const stats = { files: 0, tCalls: 0, ternaries: 0, defsReplaced: 0, useTInserted: 0, interpolations: 0, pairCalls: 0 };
const changedFiles = new Set();

const seenManual = new Set();
function pushManual(item) {
  const id = `${item.file}:${item.line}:${item.reason}`;
  if (seenManual.has(id)) return;
  seenManual.add(id);
  manual.push(item);
}

function addEntry(ns, componentKey, slug, zh, en) {
  if (!dicts[ns]) dicts[ns] = {};
  if (!dicts[ns][componentKey]) dicts[ns][componentKey] = {};
  const bucket = dicts[ns][componentKey];
  if (bucket[slug]) {
    if (bucket[slug].zh === zh && bucket[slug].en === en) return `${componentKey}.${slug}`;
    for (let i = 2; ; i += 1) {
      const candidate = `${slug}-${i}`;
      if (!bucket[candidate]) {
        bucket[candidate] = { zh, en };
        return `${componentKey}.${candidate}`;
      }
      if (bucket[candidate].zh === zh && bucket[candidate].en === en) return `${componentKey}.${candidate}`;
    }
  }
  bucket[slug] = { zh, en };
  return `${componentKey}.${slug}`;
}

const keyFor = (zh, en, ns, componentKey) => addEntry(ns, componentKey, slugify(en), zh, en);

function extractSide(node) {
  if (Node.isStringLiteral(node)) {
    return { text: node.getLiteralText(), params: [], ok: true };
  }
  if (Node.isTemplateExpression(node)) {
    const parts = [];
    const params = [];
    let ok = true;
    if (node.getHead().getLiteralText()) parts.push(node.getHead().getLiteralText());
    for (const span of node.getTemplateSpans()) {
      const expr = span.getExpression();
      const exprText = expr.getText().replace(/\s+/g, ' ');
      if (exprText.length > 150) {
        ok = false;
        break;
      }
      const paramName = Node.isIdentifier(expr) ? expr.getText() : `v${params.length + 1}`;
      if (!params.some((p) => p.name === paramName)) {
        params.push({ name: paramName, exprText });
      }
      parts.push(`{{${paramName}}}`);
      const literal = span.getLiteral();
      if (literal && literal.getLiteralText()) parts.push(literal.getLiteralText());
    }
    return { text: parts.join(''), params, ok };
  }
  return { ok: false };
}

const project = new Project({
  tsConfigFilePath: path.join(rootDir, 'tsconfig.json'),
  skipAddingFilesFromTsConfig: true,
});
project.addSourceFilesAtPaths([
  path.join(srcDir, '**/*.ts'),
  path.join(srcDir, '**/*.tsx'),
]);

function isLocalTDefinition(variableStatement) {
  const decl = variableStatement.getDeclarations()[0];
  if (!decl || decl.getName() !== 't') return false;
  const init = decl.getInitializer();
  if (!init) return false;
  const text = init.getText().replace(/\s+/g, '');
  const arrowBody =
    text.includes("=>language==='zh'?zh:en") ||
    text.includes("=>(language==='zh'?zh:en)") ||
    text.includes("=>state.language==='zh'?zh:en") ||
    text.includes("=>(state.language==='zh'?zh:en)");
  if (!arrowBody) return false;
  return /\(zh:string,en:string\)/.test(text);
}

function addI18nImport(sourceFile, filePath, extraTypes = []) {
  const moduleSpecifier = relativeI18nPath(filePath, 'useT');
  const names = ['useT', ...extraTypes];
  const existing = sourceFile.getImportDeclaration((decl) => decl.getModuleSpecifier().getLiteralText() === moduleSpecifier);
  if (existing) {
    for (const name of names) {
      if (!existing.getNamedImports().some((imp) => imp.getName() === name)) existing.addNamedImport(name);
    }
    return;
  }
  sourceFile.insertImportDeclaration(0, {
    namedImports: names,
    moduleSpecifier,
  });
}

/** 在宿主组件/hook 中插入符号声明（useT / useTPair），宿主已有该符号则跳过 */
function ensureSymbolInScope(sourceFile, node, symbolName, declText, importNames, ns, filePath) {
  let cur = node.getParent();
  let fallback = undefined;
  while (cur) {
    if (Node.isFunctionLikeDeclaration(cur)) {
      const params = cur.getParameters?.() ?? [];
      const hasParam = params.some((p) => {
        const text = p.getText();
        return p.getName() === symbolName || new RegExp(`\\{[^)]*\\b${symbolName}\\b\\s*[,}]`).test(text) || text === symbolName;
      });
      if (hasParam) return 'param';
      const body = cur.getBody?.();
      if (body && Node.isBlock(body)) {
        const hostHasSymbol = body.getStatements().some(
          (statement) => Node.isVariableStatement(statement) && statement.getDeclarations().some((d) => d.getName() === symbolName),
        );
        if (hostHasSymbol) return 'exists';
      }
      const name = cur.getName?.() ?? '';
      if (!fallback) fallback = cur;
      if (/^(?:use[A-Z]|[A-Z])/.test(name ?? '')) {
        fallback = cur;
        break;
      }
    }
    cur = cur.getParent();
  }
  const host = fallback;
  if (!host) {
    pushManual({ file: filePath, line: node.getStartLineNumber(), reason: `no host function for ${symbolName}`, snippet: node.getText().slice(0, 120) });
    return 'failed';
  }
  const body = host.getBody();
  if (!body || !Node.isBlock(body)) {
    pushManual({ file: filePath, line: node.getStartLineNumber(), reason: 'host has no block body', snippet: node.getText().slice(0, 120) });
    return 'failed';
  }
  body.insertStatements(0, declText);
  addI18nImport(sourceFile, filePath, importNames);
  if (symbolName === 't') stats.useTInserted += 1;
  return 'inserted';
}

const ensureTInScope = (sourceFile, node, ns, filePath) =>
  ensureSymbolInScope(sourceFile, node, 't', `const t = useT('${ns}');`, ['useT'], ns, filePath);


/** 单趟占位符重映射：en 模板的参数名对齐到 zh 模板（按位序），避免链式 replaceAll 的名称碰撞 */
function renamePlaceholders(text, enNames, zhNames) {
  return text.replace(/\{\{(\w+)\}\}/g, (matched, name) => {
    const index = enNames.indexOf(name);
    if (index < 0 || enNames.indexOf(name) !== enNames.lastIndexOf(name)) return matched;
    return `{{${zhNames[index]}}}`;
  });
}


/** 校验 t 标识符来自受支持的翻译函数来源（本地定义/useT/TranslateFn 参数），避免误改同名函数 */
function isSupportedTSource(sourceFile, call) {
  const expr = call.getExpression();
  const definition = expr.getDefinitionNodes?.()[0] ?? expr.getDefinition?.()[0]?.getDeclarationNode?.();
  if (!definition) return false;
  if (Node.isParameter(definition)) {
    const typeText = definition.getTypeNode()?.getText() ?? '';
    return definition.getName() === 't' && (typeText.includes('TranslateFn') || typeText.includes('zh'));
  }
  if (Node.isVariableDeclaration(definition)) {
    const initText = definition.getInitializer()?.getText() ?? '';
    return definition.getName() === 't' && (initText.includes('useT(') || initText.includes("language === 'zh'") || initText.includes('makeT('));
  }
  if (Node.isPropertySignature(definition) || Node.isPropertyAssignment(definition)) {
    return definition.getName() === 't';
  }
  return false;
}

/** 找到第一个匹配的 t 双参调用并改写；返回是否找到 */
function rewriteOneTCall(sourceFile, ns, componentKey, filePath) {
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    if (call.wasForgotten()) continue;
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr) || expr.getText() !== 't') continue;
    if (!isSupportedTSource(sourceFile, call)) continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    if (args.length === 2 && Node.isObjectLiteralExpression(args[1])) continue; // 已转换的插值调用
    const zhSide = extractSide(args[0]);
    const enSide = extractSide(args[1]);
    const convertible = zhSide.ok && enSide.ok && zhSide.params.length === enSide.params.length
      && args.length === 2
      && Node.isStringLiteral(args[0]) === false ? false : true;
    void convertible;
    const canKeyify = zhSide.ok && enSide.ok && zhSide.params.length === enSide.params.length && args.length === 2;
    if (!canKeyify) {
      // 动态文案对（labelZh/labelEn、运行时拼接）：走 tPair 兼容通道，zh/en 行为不变
      ensureSymbolInScope(sourceFile, call, 'tPair', 'const tPair = useTPair();', ['useTPair'], ns, filePath);
      call.replaceWithText(`tPair(${args.map((a) => a.getText().replace(/\s+/g, ' ')).join(', ')})`);
      stats.pairCalls += 1;
      changedFiles.add(filePath);
      return true;
    }
    const zhNames = zhSide.params.map((p) => p.name);
    const enNames = enSide.params.map((p) => p.name);
    enSide.text = renamePlaceholders(enSide.text, enNames, zhNames);
    const key = keyFor(zhSide.text, enSide.text, ns, componentKey);
    if (zhSide.params.length === 0) {
      call.replaceWithText(`t('${key}')`);
    } else {
      const paramExprs = zhSide.params.map((p) => `${p.name}: ${p.exprText}`).join(', ');
      call.replaceWithText(`t('${key}', { ${paramExprs} })`);
      stats.interpolations += 1;
    }
    stats.tCalls += 1;
    changedFiles.add(filePath);
    return true;
  }
  return false;
}

function isFormatterParent(conditional) {
  let parent = conditional.getParent();
  if (parent && Node.isPropertyAssignment(parent)) parent = parent.getParent();
  if (parent && Node.isCallExpression(parent)) {
    const callee = parent.getExpression().getText();
    if (/toLocale|getDateTimeFormat|getNumberFormat|format/.test(callee)) return true;
  }
  return false;
}

function rewriteOneTernary(sourceFile, ns, componentKey, filePath) {
  for (const conditional of sourceFile.getDescendantsOfKind(SyntaxKind.ConditionalExpression)) {
    const conditionText = conditional.getCondition().getText().replace(/\s+/g, ' ');
    if (!/^(?:state\.)?language === 'zh'$/.test(conditionText)) continue;
    const whenTrue = conditional.getWhenTrue();
    const whenFalse = conditional.getWhenFalse();
    if (isFormatterParent(conditional)) {
      pushManual({ file: filePath, line: conditional.getStartLineNumber(), reason: 'locale ternary in formatter', snippet: conditional.getText().slice(0, 140) });
      continue;
    }
    const zhSide = extractSide(whenTrue);
    const enSide = extractSide(whenFalse);
    if (!zhSide.ok || !enSide.ok) continue;
    if (zhSide.params.length !== enSide.params.length) continue;
    const status = ensureTInScope(sourceFile, conditional, ns, filePath);
    if (status === 'failed') continue;
    const zhNames = zhSide.params.map((p) => p.name);
    const enNames = enSide.params.map((p) => p.name);
    enSide.text = renamePlaceholders(enSide.text, enNames, zhNames);
    const key = keyFor(zhSide.text, enSide.text, ns, componentKey);
    if (zhSide.params.length === 0) {
      conditional.replaceWithText(`t('${key}')`);
    } else {
      const paramExprs = zhSide.params.map((p) => `${p.name}: ${p.exprText}`).join(', ');
      conditional.replaceWithText(`t('${key}', { ${paramExprs} })`);
      stats.interpolations += 1;
    }
    stats.ternaries += 1;
    changedFiles.add(filePath);
    return true;
  }
  return false;
}

function rewriteOneTDef(sourceFile, ns, filePath) {
  for (const variableStatement of sourceFile.getDescendantsOfKind(SyntaxKind.VariableStatement)) {
    if (variableStatement.wasForgotten()) continue;
    if (!isLocalTDefinition(variableStatement)) continue;
    variableStatement.replaceWithText(`const t = useT('${ns}');`);
    addI18nImport(sourceFile, filePath);
    stats.defsReplaced += 1;
    changedFiles.add(filePath);
    return true;
  }
  return false;
}

const rootSrcPrefix = srcDir.length + 1;
for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath().replaceAll('\\', '/');
  // 相对仓库根的路径（含 src/ 前缀），SKIP 与命名空间规则都按它匹配
  const relPath = filePath.slice(filePath.indexOf('/src/') + 1);
  if (SKIP.some((pattern) => pattern.test(relPath))) continue;
  stats.files += 1;
  const ns = namespaceFor(relPath);
  const componentKey = componentKeyFor(relPath);

  while (rewriteOneTDef(sourceFile, ns, relPath)) {}
  while (rewriteOneTCall(sourceFile, ns, componentKey, relPath)) {}
  while (rewriteOneTernary(sourceFile, ns, componentKey, relPath)) {}

  if (WRITE && changedFiles.has(relPath)) {
    sourceFile.saveSync();
  }
}

// ---------- 文本级后处理：t prop 类型 → TranslateFn ----------
const PROP_TYPE = /\bt(\?)?: \(zh: string, en: string\) => string\b/g;
let propTypeCount = 0;
for (const sourceFile of project.getSourceFiles()) {
  const filePath = sourceFile.getFilePath().replaceAll('\\', '/');
  const relPath = filePath.slice(filePath.indexOf('/src/') + 1);
  if (SKIP.some((pattern) => pattern.test(relPath))) continue;
  const text = sourceFile.getFullText();
  if (!PROP_TYPE.test(text)) {
    PROP_TYPE.lastIndex = 0;
    continue;
  }
  PROP_TYPE.lastIndex = 0;
  const updated = text.replace(PROP_TYPE, 't$1: TranslateFn');
  propTypeCount += (text.match(PROP_TYPE) ?? []).length;
  sourceFile.replaceWithText(updated);
  addI18nImport(sourceFile, relPath, ['TranslateFn']);
  if (WRITE) sourceFile.saveSync();
}

function writeDictionaries() {
  for (const ns of Object.keys(dicts).sort()) {
    for (const language of ['zh', 'en']) {
      const target = path.join(localesDir, language, `${ns}.json`);
      let existing = {};
      if (existsSync(target)) {
        try { existing = JSON.parse(readFileSync(target, 'utf8')); } catch { existing = {}; }
      }
      const merged = { ...existing };
      for (const [componentKey, entries] of Object.entries(dicts[ns])) {
        if (!merged[componentKey]) merged[componentKey] = {};
        for (const [slug, pair] of Object.entries(entries)) {
          merged[componentKey][slug] = pair[language];
        }
      }
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(merged, null, 2)}\n`);
    }
  }
}

if (WRITE) {
  writeDictionaries();
  writeFileSync(path.join(rootDir, 'scripts/codemods/i18n-migrate.report.json'), `${JSON.stringify(manual, null, 2)}\n`);
}

console.log(`files=${stats.files} tCalls=${stats.tCalls} ternaries=${stats.ternaries} defs=${stats.defsReplaced} useTInserted=${stats.useTInserted} interpolations=${stats.interpolations} pairCalls=${stats.pairCalls} propTypes=${propTypeCount} manual=${manual.length}`);
for (const item of manual.slice(0, 60)) {
  console.log(`  MANUAL ${item.file}:${item.line} ${item.reason} :: ${item.snippet.replace(/\n/g, ' ')}`);
}
