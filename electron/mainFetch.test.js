const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  extractCauseChain,
  summarizeFetchError,
  fetchAcrossStacks,
  timeoutSignalFromBudget,
  followRedirectsManually,
  toFailureResult,
} = require('./mainFetch');

describe('summarizeFetchError: 还原 undici "fetch failed" 的 cause 链', () => {
  it('提取最深层 cause 的 code 与 message', () => {
    // undici 形态：TypeError('fetch failed') -> cause: Error(code=ECONNREFUSED)
    const cause = new Error('connect ECONNREFUSED 127.0.0.1:5006');
    cause.code = 'ECONNREFUSED';
    const err = new TypeError('fetch failed', { cause });

    const summary = summarizeFetchError(err);

    assert.equal(summary.causeCode, 'ECONNREFUSED');
    assert.equal(summary.causeMessage, 'connect ECONNREFUSED 127.0.0.1:5006');
    assert.match(summary.message, /fetch failed/);
    assert.match(summary.message, /ECONNREFUSED: connect ECONNREFUSED 127\.0\.0\.1:5006/);
    assert.equal(summary.timedOut, false);
  });

  it('cause 链去重（外层与 cause 文案相同只保留一次）', () => {
    const cause = new Error('getaddrinfo ENOTFOUND dav.lan');
    cause.code = 'ENOTFOUND';
    const err = new TypeError('fetch failed', { cause });

    const summary = summarizeFetchError(err);

    assert.equal(
      summary.message,
      'fetch failed <- ENOTFOUND: getaddrinfo ENOTFOUND dav.lan',
    );
  });

  it('AggregateError（Happy Eyeballs）展开子错误', () => {
    const a = new Error('connect ETIMEDOUT 203.0.113.1:443');
    a.code = 'ETIMEDOUT';
    const b = new Error('connect ENETUNREACH 2001:db8::1:443');
    b.code = 'ENETUNREACH';
    const agg = new AggregateError([a, b], 'fetch failed');

    const summary = summarizeFetchError(agg);

    const codes = extractCauseChain(agg).filter((c) => c.code).map((c) => c.code);
    assert.deepEqual(codes, ['ETIMEDOUT', 'ENETUNREACH']);
    assert.equal(summary.timedOut, true);
  });

  it('AggregateError 自身的 cause 不被丢弃', () => {
    const own = new Error('aggregate own cause');
    own.code = 'EOWN';
    const sub = new Error('sub');
    sub.code = 'ESUB';
    const agg = new AggregateError([sub], 'agg', { cause: own });

    const codes = extractCauseChain(agg).filter((c) => c.code).map((c) => c.code);

    assert.ok(codes.includes('ESUB'));
    assert.ok(codes.includes('EOWN'));
  });

  it('跨递归边界的环形 cause 不会栈溢出', () => {
    const agg = new AggregateError([], 'agg');
    const sub = new Error('loopy');
    agg.errors.push(sub);
    sub.cause = agg; // 子错误反向引用父错误

    const chain = extractCauseChain(agg);

    assert.ok(chain.length >= 2);
    assert.ok(chain.length < 10);
  });

  it('TimeoutError / AbortError 归一为超时', () => {
    assert.equal(summarizeFetchError(new DOMException('signal timed out', 'TimeoutError')).timedOut, true);
    assert.equal(summarizeFetchError(new DOMException('aborted', 'AbortError')).timedOut, true);
  });

  it('UND_ERR_*_TIMEOUT 出现在 cause 上也算超时', () => {
    const cause = new Error('connect timeout');
    cause.code = 'UND_ERR_CONNECT_TIMEOUT';
    const err = new TypeError('fetch failed', { cause });
    assert.equal(summarizeFetchError(err).timedOut, true);
  });
});

describe('fetchAcrossStacks: 多网络栈回退', () => {
  const fakeResponse = (status) => ({ status, ok: status < 400 });

  it('主栈抛异常时回退到下一个栈', async () => {
    const calls = [];
    const { response, stack } = await fetchAcrossStacks([
      {
        name: 'undici',
        run: async () => { calls.push('undici'); throw new TypeError('fetch failed'); },
      },
      {
        name: 'chromium',
        run: async () => { calls.push('chromium'); return fakeResponse(200); },
      },
    ]);

    assert.deepEqual(calls, ['undici', 'chromium']);
    assert.equal(stack, 'chromium');
    assert.equal(response.status, 200);
  });

  it('HTTP 错误状态也算成功（不触发回退）', async () => {
    let fallbackCalled = false;
    const { response } = await fetchAcrossStacks([
      { name: 'undici', run: async () => fakeResponse(401) },
      { name: 'chromium', run: async () => { fallbackCalled = true; return fakeResponse(200); } },
    ]);

    assert.equal(response.status, 401);
    assert.equal(fallbackCalled, false);
  });

  it('全部失败时合并各栈明细并带结构化 cause', async () => {
    const cause = new Error('getaddrinfo ENOTFOUND dav.lan');
    cause.code = 'ENOTFOUND';

    const attempt = fetchAcrossStacks([
      { name: 'undici', run: async () => { throw new TypeError('fetch failed', { cause }); } },
      { name: 'chromium', run: async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED'); } },
    ]);
    await assert.rejects(attempt, (err) => {
      assert.match(err.message, /undici: fetch failed <- ENOTFOUND: getaddrinfo ENOTFOUND dav\.lan/);
      assert.match(err.message, /chromium: net::ERR_NAME_NOT_RESOLVED/);
      assert.equal(err.timedOut, false);
      assert.equal(err.causeCode, undefined); // 最后一个栈（chromium）没有 code
      assert.equal(err.failures.length, 2);
      assert.equal(err.failures[0].summary.causeCode, 'ENOTFOUND');
      return true;
    });
  });

  it('timedOut 仅当所有栈都超时', async () => {
    await assert.rejects(fetchAcrossStacks([
      { name: 'a', run: async () => { throw new DOMException('t', 'TimeoutError'); } },
      { name: 'b', run: async () => { throw new DOMException('t', 'TimeoutError'); } },
    ]), (err) => err.timedOut === true);

    await assert.rejects(fetchAcrossStacks([
      { name: 'a', run: async () => { throw new DOMException('t', 'TimeoutError'); } },
      { name: 'b', run: async () => { throw new Error('boom'); } },
    ]), (err) => err.timedOut === false);
  });

  it('超时预算耗尽后不再尝试下一个栈', async () => {
    let fallbackCalled = false;
    await assert.rejects(fetchAcrossStacks([
      {
        name: 'undici',
        run: async ({ remainingMs }) => {
          assert.ok(remainingMs <= 300 && remainingMs > 250);
          await new Promise((r) => setTimeout(r, 350)); // 烧光预算再失败
          throw new TypeError('fetch failed');
        },
      },
      { name: 'chromium', run: async () => { fallbackCalled = true; return fakeResponse(200); } },
    ], { totalTimeoutMs: 300, minStackBudgetMs: 250 }), /undici: fetch failed/);

    assert.equal(fallbackCalled, false);
  });

  it('总预算不足最小单栈预算时一个栈都不执行', async () => {
    const calls = [];
    await assert.rejects(fetchAcrossStacks([
      { name: 'undici', run: async () => { calls.push('undici'); return fakeResponse(200); } },
    ], { totalTimeoutMs: 500 }), /all network stacks failed/);

    assert.deepEqual(calls, []);
  });
});

describe('fetchAcrossStacks: onResponseRetryable 响应级让位', () => {
  const fakeResponse = (status) => ({ status, ok: status < 400 });

  it('命中谓词的响应让位给下一栈（如 x.com 边缘按 TLS 指纹 403 undici）', async () => {
    const calls = [];
    const { response, stack } = await fetchAcrossStacks([
      {
        name: 'undici',
        run: async () => { calls.push('undici'); return fakeResponse(403); },
        onResponseRetryable: (r) => r.status === 403 || r.status === 429,
      },
      {
        name: 'chromium',
        run: async () => { calls.push('chromium'); return fakeResponse(200); },
      },
    ]);

    assert.deepEqual(calls, ['undici', 'chromium']);
    assert.equal(stack, 'chromium');
    assert.equal(response.status, 200);
  });

  it('谓词不命中的响应照常直接返回，不触发回退', async () => {
    let fallbackCalled = false;
    const { response } = await fetchAcrossStacks([
      {
        name: 'undici',
        run: async () => fakeResponse(200),
        onResponseRetryable: (r) => r.status === 403,
      },
      {
        name: 'chromium',
        run: async () => { fallbackCalled = true; return fakeResponse(200); },
      },
    ]);

    assert.equal(response.status, 200);
    assert.equal(fallbackCalled, false);
  });

  it('所有栈的响应都被判未命中时返回最后一个响应而不抛错', async () => {
    const { response, stack } = await fetchAcrossStacks([
      {
        name: 'undici',
        run: async () => fakeResponse(403),
        onResponseRetryable: (r) => r.status === 403,
      },
      {
        name: 'chromium',
        run: async () => fakeResponse(403),
        onResponseRetryable: (r) => r.status === 403,
      },
    ]);

    assert.equal(response.status, 403);
    assert.equal(stack, 'chromium');
  });
});

describe('timeoutSignalFromBudget', () => {
  it('用剩余预算构造信号；无预算时退回固定值；下限 1000ms', () => {
    assert.equal(timeoutSignalFromBudget(5000, 20000).aborted, false);
    assert.equal(timeoutSignalFromBudget(undefined, 20000).aborted, false);
    assert.equal(timeoutSignalFromBudget(-5, 20000).aborted, false); // 负预算被钳到 1000ms
  });
});

describe('followRedirectsManually: 凭据不随跨域跳转泄露', () => {
  const respond = (status, location) => ({
    status,
    headers: { get: (k) => (k.toLowerCase() === 'location' ? location ?? null : null) },
  });
  const recorder = (script) => {
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options });
      return script(calls.length - 1, url, options) ?? respond(200);
    };
    return { calls, fetchImpl };
  };

  it('2xx 直接返回，不触发跳转逻辑', async () => {
    const { calls, fetchImpl } = recorder(() => respond(200));
    const res = await followRedirectsManually(fetchImpl, 'https://dav.example.com/b/f.json', {
      method: 'PUT', headers: { Authorization: 'Basic abc' }, body: 'x',
    });
    assert.equal(res.status, 200);
    assert.equal(calls.length, 1);
  });

  it('同源 307 保留方法与 Authorization', async () => {
    const { calls, fetchImpl } = recorder((i) =>
      i === 0 ? respond(307, 'https://dav.example.com/backup/') : respond(201));
    const res = await followRedirectsManually(fetchImpl, 'https://dav.example.com/backup', {
      method: 'PUT', headers: { Authorization: 'Basic abc' }, body: 'x',
    });
    assert.equal(res.status, 201);
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.method, 'PUT');
    assert.equal(calls[1].options.headers.Authorization, 'Basic abc');
  });

  it('跨域 302 剥离 Authorization 与 Cookie', async () => {
    const { calls, fetchImpl } = recorder((i) =>
      i === 0 ? respond(302, 'https://evil.example/harvest') : respond(200));
    await followRedirectsManually(fetchImpl, 'https://dav.example.com/f.json', {
      method: 'GET', headers: { Authorization: 'Basic abc', Cookie: 's=1', 'X-Other': 'keep' },
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.equal(calls[1].options.headers.Cookie, undefined);
    assert.equal(calls[1].options.headers['X-Other'], 'keep');
  });

  it('跳转到非 http(s) 协议被拒绝', async () => {
    const { fetchImpl } = recorder(() => respond(302, 'file:///etc/passwd'));
    await assert.rejects(
      followRedirectsManually(fetchImpl, 'https://dav.example.com/f.json', { method: 'GET' }),
      /unsupported protocol/,
    );
  });

  it('超过跳转上限抛错', async () => {
    const { fetchImpl } = recorder(() => respond(302, 'https://dav.example.com/loop'));
    await assert.rejects(
      followRedirectsManually(fetchImpl, 'https://dav.example.com/f.json', { method: 'GET' }, { maxRedirects: 3 }),
      /too many redirects/,
    );
  });

  it('302 无 Location 时把 3xx 响应原样返回', async () => {
    const { calls, fetchImpl } = recorder(() => respond(302, null));
    const res = await followRedirectsManually(fetchImpl, 'https://dav.example.com/f.json', { method: 'GET' });
    assert.equal(res.status, 302);
    assert.equal(calls.length, 1);
  });

  it('303 把 PUT 降级为 GET，并剥离 body 与 Content-* 请求头', async () => {
    const { calls, fetchImpl } = recorder((i) =>
      i === 0 ? respond(303, 'https://dav.example.com/done') : respond(200));
    await followRedirectsManually(fetchImpl, 'https://dav.example.com/f.json', {
      method: 'PUT',
      headers: { Authorization: 'Basic abc', 'Content-Type': 'application/json', 'Content-Length': '3' },
      body: '{"a":1}',
    });
    assert.equal(calls[1].options.method, 'GET');
    assert.equal(calls[1].options.body, undefined);
    assert.equal(calls[1].options.headers['Content-Type'], undefined);
    assert.equal(calls[1].options.headers['Content-Length'], undefined);
    assert.equal(calls[1].options.headers.Authorization, 'Basic abc'); // 同源保留凭据
  });
});

describe('toFailureResult: IPC 失败返回体归一', () => {
  it('透传 fetchAcrossStacks 合并错误的结构化 cause', async () => {
    const cause = new Error('connect ECONNREFUSED 10.0.0.5:5006');
    cause.code = 'ECONNREFUSED';
    let combined;
    try {
      await fetchAcrossStacks([
        { name: 'undici', run: async () => { throw new TypeError('fetch failed', { cause }); } },
      ]);
    } catch (err) {
      combined = err;
    }

    const result = toFailureResult(combined);

    assert.equal(result.success, false);
    assert.equal(result.causeCode, 'ECONNREFUSED');
    assert.equal(result.causeMessage, 'connect ECONNREFUSED 10.0.0.5:5006');
    assert.match(result.error, /undici: fetch failed/);
    assert.equal(result.timedOut, false);
  });

  it('普通异常走 summarize 兜底', () => {
    const result = toFailureResult(new Error('boom'));
    assert.equal(result.success, false);
    assert.equal(result.error, 'boom');
    assert.equal(result.timedOut, false);
    assert.equal(result.causeCode, undefined);
  });

  it('全部栈超时归一为 timedOut', async () => {
    let combined;
    try {
      await fetchAcrossStacks([
        { name: 'a', run: async () => { throw new DOMException('t', 'TimeoutError'); } },
      ]);
    } catch (err) {
      combined = err;
    }
    assert.equal(toFailureResult(combined).timedOut, true);
  });
});
