'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { findDeepLinkArg, normalizeDeepLink } = require('./deepLink');

test('accepts deep links of this app only', () => {
  assert.equal(
    normalizeDeepLink('githubstarsmanager://repo/owner/name'),
    'githubstarsmanager://repo/owner/name',
  );
  assert.equal(
    normalizeDeepLink('  GitHubStarsManager://release/o/r/v1.0.0  '),
    'githubstarsmanager://release/o/r/v1.0.0',
  );
});

test('rejects foreign protocols, relative paths and non-strings', () => {
  assert.equal(normalizeDeepLink('https://github.com/owner/name'), null);
  assert.equal(normalizeDeepLink('githubstarsmanager:repo/owner/name'), null);
  assert.equal(normalizeDeepLink('githubstarsmanager://'), null);
  assert.equal(normalizeDeepLink(''), null);
  assert.equal(normalizeDeepLink('   '), null);
  assert.equal(normalizeDeepLink(null), null);
  assert.equal(normalizeDeepLink(undefined), null);
  assert.equal(normalizeDeepLink(42), null);
});

test('finds the deep link inside a process argv list', () => {
  assert.equal(
    findDeepLinkArg(['/Applications/App.app', '--flag', 'githubstarsmanager://developer/torvalds']),
    'githubstarsmanager://developer/torvalds',
  );
  assert.equal(findDeepLinkArg(['/Applications/App.app', '--flag']), null);
  assert.equal(findDeepLinkArg([]), null);
  assert.equal(findDeepLinkArg(null), null);
});
