#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const releaseTag = process.argv[2];
if (!releaseTag) {
  console.error('Usage: node scripts/check-release-version.cjs vX.Y.Z');
  process.exit(2);
}

const packagePath = path.resolve(__dirname, '..', 'package.json');
const { version } = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const expectedTag = `v${version}`;

if (releaseTag !== expectedTag) {
  console.error(`Release tag ${releaseTag} does not match client version ${version}. Expected ${expectedTag}.`);
  process.exit(1);
}

console.log(`Release tag ${releaseTag} matches client version ${version}.`);
