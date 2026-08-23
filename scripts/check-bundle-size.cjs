const fs = require('node:fs');
const path = require('node:path');

const DIST_ASSETS_DIR = path.resolve('dist/assets');
const MAX_BUNDLE_KIB = 3000;
const LEGACY_ASSET_PATTERN = /-legacy-.*\.js$/;

if (!fs.existsSync(DIST_ASSETS_DIR)) {
  console.error(`Bundle budget check failed: ${DIST_ASSETS_DIR} does not exist.`);
  process.exit(1);
}

const legacyEntries = fs
  .readdirSync(DIST_ASSETS_DIR)
  .filter((fileName) => LEGACY_ASSET_PATTERN.test(fileName));

if (legacyEntries.length === 0) {
  console.error('Bundle budget check failed: no legacy entry was generated in dist/assets.');
  process.exit(1);
}

const largestEntry = legacyEntries
  .map((fileName) => {
    const filePath = path.join(DIST_ASSETS_DIR, fileName);
    return { fileName, sizeKiB: fs.statSync(filePath).size / 1024 };
  })
  .sort((left, right) => right.sizeKiB - left.sizeKiB)[0];

console.log(`Bundle budget: ${largestEntry.fileName} = ${largestEntry.sizeKiB.toFixed(2)} KiB (limit ${MAX_BUNDLE_KIB} KiB)`);

if (largestEntry.sizeKiB > MAX_BUNDLE_KIB) {
  console.error(`Bundle budget exceeded by ${(largestEntry.sizeKiB - MAX_BUNDLE_KIB).toFixed(2)} KiB.`);
  process.exit(1);
}
