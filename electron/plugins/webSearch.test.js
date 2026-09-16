const assert = require('node:assert/strict');
const test = require('node:test');
const dns = require('node:dns');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const { searchUrl, validateSearchArgs, searchSearxng, publicLookup } = require('./webSearch');

test('builds only a SearXNG HTTPS search endpoint without embedded credentials', () => {
  assert.equal(searchUrl('https://search.example.com/searx').toString(), 'https://search.example.com/searx/search');
  for (const endpoint of [
    'http://search.example.com', 'https://localhost', 'https://127.0.0.1',
    'https://search.local', 'https://[::ffff:127.0.0.1]', 'https://user:secret@search.example.com',
    'https://search.example.com/?key=secret', 'https://search.example.com/#fragment',
  ]) assert.throws(() => searchUrl(endpoint), { code: 'PLUGIN_SEARCH_ENDPOINT_INVALID' });
});

test('search arguments cannot choose an arbitrary target or oversized query', () => {
  assert.deepEqual(validateSearchArgs({ query: '  Example  ', limit: 3 }), { query: 'Example', limit: 3 });
  assert.deepEqual(validateSearchArgs({ query: 'Example' }), { query: 'Example', limit: 5 });
  for (const args of [{ query: '' }, { query: 'x'.repeat(201) }, { query: 'Example', limit: 11 },
    { query: 'Example', url: 'https://other.example' }]) {
    assert.throws(() => validateSearchArgs(args), { code: 'PLUGIN_SEARCH_REQUEST_INVALID' });
  }
});

test('DNS lookup pins a public IPv4 address and rejects private-only answers', async () => {
  const original = dns.lookup;
  try {
    dns.lookup = (_hostname, _options, callback) => callback(null, [
      { address: '127.0.0.1', family: 4 }, { address: '8.8.8.8', family: 4 },
    ]);
    const address = await new Promise((resolve, reject) => publicLookup('search.example.com', {}, (error, value) =>
      error ? reject(error) : resolve(value)));
    assert.equal(address, '8.8.8.8');
    dns.lookup = (_hostname, _options, callback) => callback(null, [{ address: '192.168.1.1', family: 4 }]);
    await assert.rejects(new Promise((resolve, reject) => publicLookup('search.example.com', {}, (error, value) =>
      error ? reject(error) : resolve(value))), { code: 'PLUGIN_SEARCH_ENDPOINT_BLOCKED' });
  } finally {
    dns.lookup = original;
  }
});

test('sends a bounded semantic query and returns only sanitized HTTPS results', async () => {
  const original = https.request;
  let requestedUrl;
  let requestedOptions;
  try {
    https.request = (url, options, callback) => {
      requestedUrl = url.toString();
      requestedOptions = options;
      const request = new EventEmitter();
      request.end = () => {
        const response = Readable.from([Buffer.from(JSON.stringify({ results: [
          { title: 'Valid', url: 'https://example.com', content: 'Summary' },
          { title: 'Unsafe', url: 'javascript:alert(1)', content: 'Ignore' },
        ] }))]);
        response.statusCode = 200;
        callback(response);
      };
      request.destroy = (error) => request.emit('error', error);
      return request;
    };
    assert.deepEqual(await searchSearxng('https://search.example.com', { query: 'Example repo', limit: 2 }), [
      { title: 'Valid', url: 'https://example.com', snippet: 'Summary' },
    ]);
    assert.equal(requestedUrl, 'https://search.example.com/search?q=Example+repo&format=json');
    assert.equal(requestedOptions.method, 'GET');
    assert.equal(requestedOptions.agent, false);
    assert.equal(typeof requestedOptions.lookup, 'function');
  } finally {
    https.request = original;
  }
});
