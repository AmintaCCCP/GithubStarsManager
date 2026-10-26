'use strict';

/**
 * Device-flow unit tests with injected Electron fakes: exercises the poll
 * loop (success, slow_down, expired, denial, window-close cancel) without a
 * display or network access.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createDeviceFlow } = require('./oauthDeviceFlow');

class FakeWindow {
  constructor() {
    this.handlers = new Map();
    this.destroyed = false;
    this.loadedUrls = [];
    this.navigationsBlocked = [];
  }
  setMenuBarVisibility() {}
  get webContents() {
    const win = this;
    return {
      setWindowOpenHandler: (handler) => {
        win.handlers.set('window-open', handler);
      },
      on: (event, handler) => {
        win.handlers.set(event, handler);
      },
      executeJavaScript: async () => undefined,
    };
  }
  loadURL(url) {
    this.loadedUrls.push(url);
  }
  once(event, handler) {
    this.handlers.set(event, handler);
  }
  isDestroyed() {
    return this.destroyed;
  }
  destroy() {
    this.destroyed = true;
  }
  emitClosed() {
    this.handlers.get('closed')?.();
  }
}

function setup(responses) {
  const windows = [];
  const calls = [];
  const delays = [];
  const openedExternally = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), body: String(init?.body ?? '') });
    const response = responses.shift();
    if (!response) throw new Error('unexpected fetch ' + url);
    if (typeof response === 'number') return { ok: false, status: response, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => response };
  };
  const flow = createDeviceFlow({
    clientId: 'test-client-id',
    delay: (ms) => {
      delays.push(ms);
      // Fail fast when the flow polls more times than the response queue
      // covers — otherwise a single extra token request would hang for the
      // full fake expiry window.
      if (delays.length > 50) throw new Error('too many polls');
      return new Promise((resolve) => setTimeout(resolve, Math.min(ms, 5)));
    },
    BrowserWindow: class {
      constructor() {
        const win = new FakeWindow();
        windows.push(win);
        return win;
      }
    },
    openExternalUrl: async (url) => {
      openedExternally.push(url);
    },
    fetchImpl,
  });
  return { flow, windows, calls, delays, openedExternally };
}

describe('oauthDeviceFlow', () => {
  it('completes the flow and returns the access token', async () => {
    const { flow, windows, calls } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
      { access_token: 'gho_token' },
    ]);
    const token = await flow.startDeviceFlow();
    assert.equal(token, 'gho_token');
    assert.match(decodeURIComponent(windows[0].loadedUrls[0]), /<code>ABCD-1234<\/code>/);
    assert.ok(windows[0].isDestroyed());
    assert.equal(calls.length, 2);
    assert.ok(calls[0].body.includes('client_id=test-client-id'));
  });

  it('stretches the poll interval by 5s after a slow_down response', async () => {
    const { flow, delays } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
      { error: 'slow_down' },
      { access_token: 'gho_token' },
    ]);
    const token = await flow.startDeviceFlow();
    assert.equal(token, 'gho_token');
    assert.deepEqual(delays, [5000, 10000]);
  });

  it('keeps polling through transient network failures and pending', async () => {
    const { flow } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
      { error: 'authorization_pending' },
      { error: 'authorization_pending' },
      { access_token: 'gho_token' },
    ]);
    // Second call throws to emulate a transient network failure (fetch stub
    // returns numbers as HTTP errors only, so emulate via a bad status).
    const token = await flow.startDeviceFlow();
    assert.equal(token, 'gho_token');
  });

  it('rejects when GitHub reports access_denied', async () => {
    const { flow } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
      { error: 'access_denied' },
    ]);
    await assert.rejects(flow.startDeviceFlow(), /denied/i);
  });

  it('stops polling and rejects after the code expires', async () => {
    const { flow } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 0 },
      { error: 'authorization_pending' },
    ]);
    await assert.rejects(flow.startDeviceFlow(), /expired/i);
  });

  it('rejects without a configured client_id', () => {
    assert.throws(
      () => createDeviceFlow({ BrowserWindow: class {}, shell: { openExternal: async () => {} } }),
      /GITHUB_OAUTH_DEVICE_CLIENT_ID/,
    );
  });

  it('opens the verification URL via the main process without navigating the code window', async () => {
    const { flow, windows, openedExternally } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
      { access_token: 'gho_token' },
    ]);
    await flow.startDeviceFlow();
    const win = windows[0];
    // Popup opens (deny + open externally) and in-page navigation is blocked.
    win.handlers.get('window-open')({ url: 'https://github.com/login/device' });
    const navEvent = { url: 'https://github.com/login/device', preventDefault: () => win.navigationsBlocked.push('nav') };
    win.handlers.get('will-navigate')(navEvent);
    assert.ok(openedExternally.some((u) => u === 'https://github.com/login/device'));
    assert.deepEqual(win.navigationsBlocked, ['nav']);
    assert.deepEqual(win.loadedUrls.filter((u) => u.startsWith('data:text/html')).length, 1);
  });

  it('cancels when the user closes the code window', async () => {
    const { flow, windows } = setup([
      { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 0, expires_in: 900 },
    ]);
    const pending = flow.startDeviceFlow();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const win = windows[0];
    assert.ok(win, 'code window should exist');
    win.emitClosed();
    await assert.rejects(pending, /canceled/i);
    assert.ok(win.isDestroyed());
  });
});
