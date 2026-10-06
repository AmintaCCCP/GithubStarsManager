'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  wrapFetch,
  resetBodyBudgetForTest,
  BODY_CAPTURE_BUDGET_PER_MINUTE,
} = require('./netTap');

function makeResponse(body, { status = 200, headers = {} } = {}) {
  const headerMap = new Map(Object.entries(headers));
  const headerList = [...headerMap.entries()];
  const chunks = new TextEncoder().encode(body);
  return {
    status,
    headers: {
      get: (k) => headerMap.get(k.toLowerCase()) ?? null,
      forEach: (fn) => { for (const [k, v] of headerList) fn(v, k); },
    },
    // Realistic body stream: the tap reads via getReader with a byte cap.
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(chunks);
        controller.close();
      },
    }),
    async text() { return body; },
    clone() { return makeResponse(body, { status, headers }); },
  };
}

function collect() {
  const entries = [];
  return { entries, record: (e) => entries.push(e) };
}

describe('netTap.wrapFetch', () => {
  beforeEach(() => resetBodyBudgetForTest());

  it('passes through arguments and returns the response untouched', async () => {
    const seen = [];
    const impl = async (input, init) => {
      seen.push({ input, init });
      return makeResponse('ok');
    };
    const { record } = collect();
    const tapped = wrapFetch(impl, { source: 'test', record });
    const response = await tapped('https://api.example.com/x', { method: 'POST' });
    assert.equal(await response.text(), 'ok');
    assert.deepEqual(seen, [{ input: 'https://api.example.com/x', init: { method: 'POST' } }]);
  });

  it('normal mode records failures only: 2xx silent, 4xx/5xx warn', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async (input) => (String(input).endsWith('bad') ? makeResponse('no', { status: 404 }) : makeResponse('ok')),
      { source: 'test', record },
    );
    await tapped('https://api.example.com/good');
    await tapped('https://api.example.com/bad');
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, 'warn');
    assert.equal(entries[0].data.status, 404);
    assert.equal(entries[0].data.source, 'test');
    assert.equal(entries[0].data.method, 'GET');
    assert.ok(typeof entries[0].data.durationMs === 'number');
  });

  it('normal mode records network-layer failures as error and rethrows untouched', async () => {
    const { entries, record } = collect();
    const boom = Object.assign(new Error('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });
    const tapped = wrapFetch(async () => { throw boom; }, { source: 'test', record });
    await assert.rejects(() => tapped('https://api.example.com/x'), (err) => err === boom);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, 'error');
    assert.equal(entries[0].data.causeCode, 'ECONNREFUSED');
    assert.ok(entries[0].data.detail.includes('ECONNREFUSED'));
  });

  it('records user aborts (net::ERR_ABORTED) as info', async () => {
    const { entries, record } = collect();
    const boom = Object.assign(new Error('Failed to fetch'), { cause: new Error('net::ERR_ABORTED') });
    const tapped = wrapFetch(async () => { throw boom; }, { source: 'test', record });
    await assert.rejects(() => tapped('https://api.example.com/x'), (err) => err === boom);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, 'info');
    assert.match(entries[0].message, / aborted$/);
    // Chromium net errors carry no .code, so the marker survives in the
    // joined cause chain (detail), not in causeCode/causeMessage.
    assert.ok(entries[0].data.detail.includes('net::ERR_ABORTED'));
  });

  it('records transient network conditions (net::ERR_NETWORK_CHANGED) as warn', async () => {
    const { entries, record } = collect();
    const boom = Object.assign(new Error('Failed to fetch'), { cause: new Error('net::ERR_NETWORK_CHANGED') });
    const tapped = wrapFetch(async () => { throw boom; }, { source: 'test', record });
    await assert.rejects(() => tapped('https://api.example.com/x'), (err) => err === boom);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, 'warn');
    assert.match(entries[0].message, / failed$/);
  });

  it('classifies Chromium net error codes: abort → info, transient → warn, rest → error', () => {
    const { classifyNetErrorCode, classifyNetFailure } = require('./netTap');
    assert.equal(classifyNetErrorCode('net::ERR_ABORTED'), 'info');
    assert.equal(classifyNetErrorCode('net::ERR_NETWORK_CHANGED'), 'warn');
    assert.equal(classifyNetErrorCode('net::ERR_INTERNET_DISCONNECTED'), 'warn');
    assert.equal(classifyNetErrorCode('net::ERR_CONNECTION_RESET'), 'warn');
    assert.equal(classifyNetErrorCode('net::ERR_NAME_NOT_RESOLVED'), 'error');
    assert.equal(classifyNetErrorCode('net::ERR_CONNECTION_REFUSED'), 'error');
    assert.equal(classifyNetErrorCode(undefined), 'error');
    // causeCode (a .code property) and causeMessage (Chromium text) both work
    assert.equal(classifyNetFailure({ causeCode: 'net::ERR_ABORTED' }), 'info');
    assert.equal(classifyNetFailure({ causeMessage: 'net::ERR_NETWORK_CHANGED' }), 'warn');
    assert.equal(classifyNetFailure({}), 'error');
  });

  it('debug mode records success requests with sanitized headers', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async () => makeResponse('hello', { headers: { 'content-type': 'text/plain', 'content-length': '5' } }),
      { source: 'test', record, isDebugMode: () => true },
    );
    await tapped('https://api.example.com/x?token=secret', {
      headers: { Authorization: 'Bearer sk-abcdef123456789012345678', Cookie: 'a=b' },
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].level, 'debug');
    assert.ok(!String(entries[0].data.url).includes('secret'));
    assert.equal(entries[0].data.requestHeaders.Cookie, '***');
    assert.equal(entries[0].data.requestHeaders.Authorization, 'Bearer ***5678');
    assert.equal(entries[0].data.responseBody, 'hello');
  });

  it('skips body capture for SSE and binary responses', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async (input) => makeResponse('data', {
        headers: { 'content-type': String(input).endsWith('sse') ? 'text/event-stream' : 'image/png' },
      }),
      { source: 'test', record, isDebugMode: () => true },
    );
    await tapped('https://api.example.com/sse');
    await tapped('https://api.example.com/img');
    assert.equal(entries.length, 2);
    assert.equal(entries[0].data.responseBody, undefined);
    assert.equal(entries[1].data.responseBody, undefined);
  });

  it('enforces the per-minute body capture budget', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async () => makeResponse('body', { headers: { 'content-type': 'text/plain' } }),
      { source: 'test', record, isDebugMode: () => true },
    );
    for (let i = 0; i < BODY_CAPTURE_BUDGET_PER_MINUTE + 5; i++) {
      await tapped(`https://api.example.com/${i}`);
    }
    const withBody = entries.filter((e) => e.data.responseBody !== undefined).length;
    const withoutBody = entries.filter((e) => e.data.responseBody === undefined).length;
    assert.equal(withBody, BODY_CAPTURE_BUDGET_PER_MINUTE);
    assert.equal(withoutBody, 5);
  });

  it('skips body capture when content-length exceeds the size guard', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async () => makeResponse('never read', { headers: { 'content-type': 'text/plain', 'content-length': String(300 * 1024) } }),
      { source: 'test', record, isDebugMode: () => true },
    );
    await tapped('https://api.example.com/big');
    assert.equal(entries[0].data.responseBody, undefined);
  });

  it('abandons the preview when an uncapped chunked stream exceeds the byte limit', async () => {
    const { entries, record } = collect();
    const bigChunk = 'x'.repeat(64 * 1024);
    const tapped = wrapFetch(
      async () => makeResponse(bigChunk.repeat(6), { headers: { 'content-type': 'text/plain' } }),
      { source: 'test', record, isDebugMode: () => true },
    );
    await tapped('https://api.example.com/chunked');
    // 384 KiB read without a declared content-length must NOT be captured.
    assert.equal(entries[0].data.responseBody, undefined);
  });

  it('rejects missing fetch or record with a TypeError', () => {
    assert.throws(() => wrapFetch(null, { record: () => {} }), TypeError);
    assert.throws(() => wrapFetch(async () => {}, {}), TypeError);
  });

  it('masks credentials embedded in JSON request bodies', async () => {
    const { entries, record } = collect();
    const tapped = wrapFetch(
      async () => makeResponse('ok'),
      { source: 'test', record, isDebugMode: () => true },
    );
    const payload = JSON.stringify({ username: 'alice', password: 'wonderland-secret-value' });
    await tapped('https://nas.example.com/dav', { method: 'PROPFIND', body: payload });
    const requestBody = String(entries[0].data.requestBody);
    assert.ok(!requestBody.includes('wonderland-secret-value'));
    assert.ok(requestBody.includes('***'));
  });
});
