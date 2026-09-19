#!/usr/bin/env node
/**
 * 新语言字典初稿生成：以 zh 为源，经 Google 翻译免费端点产出 MT 初稿。
 * - {{placeholder}} 保真校验：缺失/错位时回退 en，再回退 zh
 * - 纯 ASCII 文案直接沿用 zh（多为产品名词）
 * - 每个命名空间完成即落盘，可断点续跑（已有译文的语言文件整体重译）
 * 用法：node scripts/codemods/generate-translations.mjs [--langs=ja,es,...] [--ns=common,login]
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localesDir = path.join(rootDir, 'src', 'locales');

const argLangs = process.argv.find((a) => a.startsWith('--langs='));
const argNs = process.argv.find((a) => a.startsWith('--ns='));
const LANGS = (argLangs ? argLangs.split('=')[1].split(',') : ['ja', 'es', 'pt-BR', 'ru', 'zh-TW', 'fr', 'de', 'ko']);
const ONLY_NS = argNs ? argNs.split('=')[1].split(',') : null;
const FILL = process.argv.includes('--fill');

const GTL = { 'pt-BR': 'pt-BR', 'zh-TW': 'zh-TW', ja: 'ja', es: 'es', ru: 'ru', fr: 'fr', de: 'de', ko: 'ko' };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function translate(text, target, attempt = 1) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh&tl=${GTL[target]}&dt=t&q=${encodeURIComponent(text)}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const out = (data?.[0] ?? []).map((part) => part?.[0] ?? '').join('');
    return out.trim();
  } catch (error) {
    if (attempt < 4) {
      await sleep(2500 * attempt);
      return translate(text, target, attempt + 1);
    }
    console.error(`  translate failed (${target}): ${error.message}`);
    return null;
  }
}

/** 占位符保护与校验 */
function protectPlaceholders(text) {
  const names = [];
  const protectedText = text.replace(/\{\{(\w+)\}\}/g, (_, name) => {
    names.push(name);
    return `{{${names.length - 1}}}`;
  });
  return { protectedText, names };
}

function restorePlaceholders(translated, names, fallback) {
  if (!translated) return fallback;
  // 索引集合必须与占位符完全一致（0..n-1 顺序无缺漏），否则整条回退
  const indices = [...translated.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
  const invalid = indices.length !== names.length || indices.some((value, index) => value !== index);
  if (invalid) return fallback;
  return translated.replace(/\{\{(\d+)\}\}/g, (_, index) => `{{${names[Number(index)]}}}`);
}

const isMostlyAscii = (text) => /^[\x00-\x7F]+$/.test(text);

async function main() {
  const zhNamespaces = {};
  const enNamespaces = {};
  const nsFiles = (ONLY_NS ?? ['common', 'app', 'login', 'repositories', 'gists', 'releases', 'discovery', 'chat', 'search', 'plugins', 'settings', 'ai', 'services', 'errors']);
  for (const ns of nsFiles) {
    try {
      zhNamespaces[ns] = JSON.parse(readFileSync(path.join(localesDir, 'zh', `${ns}.json`), 'utf8'));
      enNamespaces[ns] = JSON.parse(readFileSync(path.join(localesDir, 'en', `${ns}.json`), 'utf8'));
    } catch {
      zhNamespaces[ns] = {};
      enNamespaces[ns] = {};
    }
  }

  for (const lang of LANGS) {
    console.log(`=== ${lang} ===`);
    for (const ns of nsFiles) {
      const zhData = zhNamespaces[ns] ?? {};
      const enData = enNamespaces[ns] ?? {};
      if (Object.keys(zhData).length === 0) continue;
      let existing;
      try { existing = JSON.parse(readFileSync(path.join(localesDir, lang, `${ns}.json`), 'utf8')); } catch { existing = {}; }
      const out = {};
      let count = 0;
      const jobs = [];
      for (const [component, entries] of Object.entries(zhData)) {
        out[component] = {};
        for (const [key, zhValue] of Object.entries(entries)) {
          const enValue = enData[component]?.[key] ?? zhValue;
          const currentValue = existing?.[component]?.[key];
          if (isMostlyAscii(zhValue)) {
            out[component][key] = enValue;
            continue;
          }
          // --fill：已是译文（≠ en 或 zh 本身就是 en 相同值）的跳过
          if (FILL && typeof currentValue === 'string' && currentValue !== '' && currentValue !== enValue) {
            out[component][key] = currentValue;
            continue;
          }
          jobs.push({ component, key, zhValue, enValue });
        }
      }
      const CONCURRENCY = 2;
      let cursor = 0;
      async function worker() {
        while (cursor < jobs.length) {
          const job = jobs[cursor];
          cursor += 1;
          const { protectedText, names } = protectPlaceholders(job.zhValue);
          const translated = await translate(protectedText, lang);
          out[job.component][job.key] = restorePlaceholders(translated, names, job.enValue) || job.enValue;
          count += 1;
          if (count % 100 === 0) console.log(`  ${ns}: ${count}/${jobs.length}`);
          await sleep(150);
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      const target = path.join(localesDir, lang, `${ns}.json`);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, `${JSON.stringify(out, null, 2)}\n`);
      console.log(`  ${ns}: ${count} translated`);
    }
  }
  console.log('ALL DONE');
}

main().catch((error) => {
  console.error('FATAL', error);
  process.exit(1);
});
