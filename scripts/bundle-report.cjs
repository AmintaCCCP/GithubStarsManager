const fs = require('node:fs');
const path = require('node:path');

const DIST_ASSETS_PATH = 'dist/assets';
const DIST_ASSETS_DIR = path.resolve(DIST_ASSETS_PATH);
const JAVASCRIPT_PATTERN = /\.js$/;
const LEGACY_CHUNK_PATTERN = /-legacy-.*\.js$/;
const MODERN_ENTRY_PATTERN = /^index-(?!legacy-).*\.js$/;
const LEGACY_ENTRY_PATTERN = /^index-legacy-.*\.js$/;
const KIB = 1024;

function formatKiB(bytes) {
  return `${(bytes / KIB).toFixed(2)} KiB`;
}

function compareChunks(left, right) {
  if (right.bytes !== left.bytes) {
    return right.bytes - left.bytes;
  }

  if (left.fileName < right.fileName) return -1;
  if (left.fileName > right.fileName) return 1;
  return 0;
}

function readChunks() {
  if (!fs.existsSync(DIST_ASSETS_DIR)) {
    console.error(`Bundle report failed: ${DIST_ASSETS_DIR} does not exist. Run the production build first.`);
    process.exit(1);
  }

  return fs
    .readdirSync(DIST_ASSETS_DIR)
    .filter((fileName) => JAVASCRIPT_PATTERN.test(fileName))
    .map((fileName) => ({
      fileName,
      bytes: fs.statSync(path.join(DIST_ASSETS_DIR, fileName)).size,
      target: LEGACY_CHUNK_PATTERN.test(fileName) ? 'legacy' : 'modern',
    }))
    .sort(compareChunks);
}

function printEntry(label, entries) {
  if (entries.length === 0) {
    console.log(`- ${label}: not found`);
    return;
  }

  for (const entry of entries) {
    console.log(`- ${label}: ${entry.fileName} = ${formatKiB(entry.bytes)}`);
  }
}

const chunks = readChunks();
const modernEntries = chunks.filter((chunk) => MODERN_ENTRY_PATTERN.test(chunk.fileName));
const legacyEntries = chunks.filter((chunk) => LEGACY_ENTRY_PATTERN.test(chunk.fileName));

console.log('Bundle report (raw filesystem bytes; sorted by size descending, then filename)');
console.log(`Assets directory: ${DIST_ASSETS_PATH}`);
console.log('');
console.log('Entrypoints');
printEntry('modern', modernEntries);
printEntry('legacy', legacyEntries);
console.log('');
console.log('JavaScript chunks');
console.log('target\tsize\tfile');
for (const chunk of chunks) {
  console.log(`${chunk.target}\t${formatKiB(chunk.bytes)}\t${chunk.fileName}`);
}
console.log('');
console.log('Largest load units (chunk-level dependency/module proxy)');
console.log('rank\ttarget\tsize\tfile');
for (const [index, chunk] of chunks.slice(0, 12).entries()) {
  console.log(`${index + 1}\t${chunk.target}\t${formatKiB(chunk.bytes)}\t${chunk.fileName}`);
}
