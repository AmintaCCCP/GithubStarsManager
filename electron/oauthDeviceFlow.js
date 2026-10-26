'use strict';

/**
 * GitHub OAuth Device Flow (RFC 8628) for the desktop client.
 *
 * The desktop app has no server to hold a client_secret, so it uses a public
 * client_id and the device-code grant: show the user code, open the browser,
 * then poll the token endpoint every 5 seconds until GitHub approves, denies,
 * or the code expires (slow_down stretches the interval by 5s per hit).
 */

const DEFAULT_POLL_INTERVAL_MS = 5000;

/** Desktop client_id is injected via GITHUB_OAUTH_DEVICE_CLIENT_ID at launch;
 * without it the Device Flow entry must stay hidden (PAT login remains). */
function deviceClientIdFromEnv(env = process.env) {
  return env.GITHUB_OAUTH_DEVICE_CLIENT_ID || null;
}

function defaultPostForm(fetchImpl) {
  return (url, params) =>
    fetchImpl(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(params).toString(),
    });
}

function defaultCreateCodeWindow(BrowserWindow, shell, openExternalUrl) {
  return (userCode, verificationUri) => {
    const win = new BrowserWindow({
      width: 420,
      height: 260,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'GitHub login',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    win.setMenuBarVisibility(false);
    win.loadURL(`data:text/html,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head><meta charset="utf-8"><title>GitHub login</title>
        <style>
          body { font-family: -apple-system, 'Segoe UI', sans-serif; text-align: center;
                 padding: 28px 20px; color: #1f2328; background: #fff; }
          code { display: inline-block; font-size: 30px; letter-spacing: 4px;
                 padding: 10px 22px; border: 1px solid #d0d7de; border-radius: 8px;
                 background: #f6f8fa; margin: 12px 0 20px; user-select: all; }
          .btn { font-size: 15px; padding: 9px 20px; border-radius: 6px; text-decoration: none;
                   background: #1f883d; color: #fff; cursor: pointer; }
          p { color: #57606a; font-size: 13px; margin: 6px 0; }
        </style></head>
        <body>
          <p>Enter this code on the GitHub device login page:</p>
          <code>${userCode}</code>
          <p>then authorize "GitHub Stars Manager".</p>
          <a class="btn" href="${verificationUri}" target="_blank" rel="noopener">Open github.com/login/device</a>
        </body>
      </html>`)}`);
    // The code window must never navigate away (the user code would be lost);
    // both the button and any popup go through the main process.
    win.webContents.setWindowOpenHandler(({ url }) => {
      void openExternalUrl(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (event) => {
      event.preventDefault();
      void openExternalUrl(event.url);
    });
    win.once('ready-to-show', () => {
      win.show();
    });
    return win;
  };
}

/**
 * Dependency-injected core: unit tests pass fake BrowserWindow/shell/fetch; the
 * exported startDeviceFlow wires the real Electron surface and global fetch.
 */
function createDeviceFlow({
  BrowserWindow,
  shell,
  fetchImpl = (...args) => fetch(...args),
  openExternalUrl = (url) => shell.openExternal(url),
  clientId,
  pollIntervalMs: basePollIntervalMs,
  delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!clientId) throw new Error('GITHUB_OAUTH_DEVICE_CLIENT_ID is not configured');
  const postForm = defaultPostForm(fetchImpl);
  const createCodeWindow = defaultCreateCodeWindow(BrowserWindow, shell, openExternalUrl);

  async function startDeviceFlow() {
    const codeRes = await postForm('https://github.com/login/device/code', {
      client_id: clientId,
      scope: 'read:user user:email repo gist',
    });
    if (!codeRes.ok) {
      throw new Error(`GitHub device-code endpoint responded ${codeRes.status}`);
    }
    const device = await codeRes.json();
    if (!device.device_code || !device.user_code) {
      throw new Error('GitHub device-code response missing fields');
    }

    let pollIntervalMs = device.interval
      ? device.interval * 1000
      : basePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + (device.expires_in ?? 900) * 1000;

    const win = createCodeWindow(device.user_code, device.verification_uri);
    // Closed-state is tracked via a promise so a window closed between awaits
    // still cancels the flow deterministically.
    let signalWindowClosed;
    const windowClosedPromise = new Promise((resolve) => {
      signalWindowClosed = () => resolve('closed');
    });
    win.once('closed', () => signalWindowClosed());

    try {
      while (Date.now() < deadline) {
        const outcome = await Promise.race([
          delay(pollIntervalMs),
          windowClosedPromise,
        ]);
        if (outcome === 'closed') throw new Error('Device flow canceled');

        let tokenRes;
        try {
          tokenRes = await postForm('https://github.com/login/oauth/access_token', {
            client_id: clientId,
            device_code: device.device_code,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          });
        } catch {
          // Transient network failure: keep polling until the code expires.
          continue;
        }
        if (!tokenRes.ok) continue;
        const tokenData = await tokenRes.json();
        if (tokenData.access_token) return tokenData.access_token;
        if (tokenData.error === 'authorization_pending') continue;
        if (tokenData.error === 'slow_down') {
          pollIntervalMs += 5000;
          continue;
        }
        if (tokenData.error === 'expired_token') throw new Error('Device code expired');
        if (tokenData.error === 'access_denied') throw new Error('GitHub login was denied');
        throw new Error(tokenData.error_description || tokenData.error || 'Device flow failed');
      }
      throw new Error('Device code expired');
    } finally {
      if (!win.isDestroyed()) win.destroy();
    }
  }

  return { startDeviceFlow };
}

// Electron is required lazily so unit tests can inject fakes via
// createDeviceFlow() without loading the real module.
function startDeviceFlow() {
  // Lazy: avoids loading electron in unit tests, which inject fakes instead.
  const { BrowserWindow, shell } = require('electron');
  const clientId = deviceClientIdFromEnv();
  if (!clientId) throw new Error('GITHUB_OAUTH_DEVICE_CLIENT_ID is not configured');
  return createDeviceFlow({ BrowserWindow, shell, clientId }).startDeviceFlow();
}

module.exports = { createDeviceFlow, startDeviceFlow, deviceClientIdFromEnv };
