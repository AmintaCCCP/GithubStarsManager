'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const redact = require('./redact');

const VECTORS = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tests', 'fixtures', 'sanitization-vectors.json'), 'utf8'),
);

describe('redact shared sanitization vectors', () => {
  for (const vector of VECTORS.strings) {
    it(`string: ${vector.name}`, () => {
      assert.equal(redact.sanitizeForLog(vector.input), vector.expected);
    });
  }

  for (const vector of VECTORS.objects) {
    it(`object: ${vector.name}`, () => {
      assert.deepEqual(redact.sanitizeForLog(vector.input), vector.expected);
    });
  }

  for (const vector of VECTORS.errorMessages) {
    it(`error text: ${vector.name}`, () => {
      assert.equal(redact.sanitizeError(new Error(vector.input)).message, vector.expected);
      assert.equal(redact.sanitizeError(vector.input).message, vector.expected);
    });
  }
});

describe('redact main-process extras', () => {
  it('dropped header values never enter the journal', () => {
    const out = redact.sanitizeForLog({
      headers: { Cookie: 'auth_token=super-secret; ct0=also-secret', 'Set-Cookie': 'sid=xyz', Accept: 'application/json' },
    });
    assert.equal(out.headers.Cookie, '***');
    assert.equal(out.headers['Set-Cookie'], '***');
    assert.equal(out.headers.Accept, 'application/json');
  });

  it('oversized strings are truncated', () => {
    // Prose-like text (spaces) so masking never shortens it first
    const huge = 'lorem ipsum dolor '.repeat(2000);
    const out = redact.sanitizeForLog(huge);
    assert.ok(out.length < redact.MAX_STRING_LENGTH + 20);
    assert.match(out, /…\[truncated\]$/);
  });

  it('sanitizeError keeps name/message and masks full-string secrets', () => {
    const err = new Error('boom');
    const out = redact.sanitizeError(err);
    assert.equal(out.name, 'Error');
    assert.equal(out.message, 'boom');
    assert.ok(typeof out.stack === 'string');
    // A message that is exactly a token is masked; embedded tokens are
    // covered by the shared errorMessages vectors (redactInline).
    const tokenError = new Error(`ghp_${'a'.repeat(36)}`);
    assert.equal(redact.sanitizeError(tokenError).message, '***aaaa');
  });

  it('sanitizeError tolerates non-Error values', () => {
    assert.deepEqual(redact.sanitizeError('plain failure'), { message: 'plain failure' });
  });

  it('redactUrl leaves non-URL input untouched', () => {
    assert.equal(redact.redactUrl('not a url'), 'not a url');
  });
});
