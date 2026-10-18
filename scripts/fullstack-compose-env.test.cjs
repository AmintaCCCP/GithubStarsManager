const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const composeFile = path.resolve(__dirname, '..', 'docker-compose.fullstack.yml');
const compose = fs.readFileSync(composeFile, 'utf8');

test('fullstack compose forwards CSP_UPGRADE_INSECURE_REQUESTS with a safe default', () => {
  assert.match(
    compose,
    /CSP_UPGRADE_INSECURE_REQUESTS:\s*\$\{CSP_UPGRADE_INSECURE_REQUESTS:-true\}/,
    'the fullstack service must pass the variable through and default it to true'
  );
});
