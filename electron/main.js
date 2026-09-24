const { app, BrowserWindow, Menu, Tray, nativeImage, nativeTheme, shell, globalShortcut, ipcMain, dialog, net, protocol, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const isDev = process.env.NODE_ENV === 'development';
const { createMcpLocalServer } = require('./mcpLocalServer');
const { createPluginManager } = require('./plugins/pluginManager');
const { downloadReleaseAsset } = require('./plugins/releaseDownload');
const { loadPluginRegistry } = require('./plugins/pluginRegistryFeed');
const { PAGE_SCHEME, pageCsp } = require('./plugins/pluginPage');
const {
  DEFAULT_DESKTOP_PREFS,
  normalizeDesktopPrefs,
  loadDesktopPrefs,
  saveDesktopPrefs,
  getLinuxAutostartPath,
  buildLinuxDesktopEntry,
} = require('./desktopPrefs');
const {
  saveEncryptedXAuth,
  loadEncryptedXAuth,
  clearEncryptedXAuth,
} = require('./xAuthStorage');

let mainWindow;
let tray = null;
// True only when the user explicitly quits (tray menu / Cmd+Q / before-quit).
// Distinguishes "hide to tray" from "really exit" for close-to-tray (#345).
let isQuitting = false;
// In-memory desktop prefs (#345). Source of truth on disk:
// `<userData>/desktop-prefs.json`. Defaults: autoLaunch OFF, tray ON.
let desktopPrefs = { ...DEFAULT_DESKTOP_PREFS };

// `--hidden` is appended to our own Linux autostart entry so login starts in tray.
const startHidden = process.argv.includes('--hidden');

// ── Single instance (#345): a second launch restores the existing window
// instead of spawning a duplicate tray icon.
const gotSingleInstanceLock = app.requestSingleInstanceLock();

protocol.registerSchemesAsPrivileged([{ scheme: PAGE_SCHEME, privileges: { standard: true, secure: true } }]);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      enableRemoteModule: false,
      // Production: keep same-origin + block mixed content. Local files load via loadFile.
      // Dev may relax for Vite HMR / local services if needed later — keep secure by default.
      webSecurity: true,
      allowRunningInsecureContent: false,
      // 生产环境也放开 DevTools（菜单 toggleDevTools role 可作为入口）
      devTools: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../build/icon.png'),
    titleBarStyle: 'default', // 使用默认标题栏，避免重叠问题
    show: false,
    // Windows/Linux 隐藏原生顶部菜单栏（Edit/View/Window），按 Alt 可临时呼出；
    // 应用菜单仍通过 Menu.setApplicationMenu 安装，role 快捷键（Ctrl+C/V、Ctrl+Shift+I 等）照常生效。
    // macOS 顶部菜单为系统级常驻，保持可见。
    autoHideMenuBar: process.platform === 'darwin' ? false : true,
    frame: true, // 保持窗口框架
    backgroundColor: '#ffffff', // 设置背景色，避免白屏闪烁
    titleBarOverlay: false, // 禁用标题栏覆盖
    trafficLightPosition: { x: 20, y: 20 } // macOS 交通灯按钮位置
  });

  // 添加错误处理和加载事件（fallback 只尝试一次，避免 did-fail-load 死循环）
  let fallbackAttempted = false;
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
    const fallbackPath = path.join(__dirname, '../dist/index.html');
    const alreadyOnFallback =
      typeof validatedURL === 'string' &&
      (validatedURL.includes('/dist/index.html') || validatedURL.endsWith('dist/index.html'));
    if (!fallbackAttempted && !alreadyOnFallback && fs.existsSync(fallbackPath)) {
      fallbackAttempted = true;
      console.log('Loading fallback page:', fallbackPath);
      mainWindow.loadFile(fallbackPath);
    }
  });

  mainWindow.webContents.on('dom-ready', () => {
    if (isDev) console.log('DOM ready');
    // 注入一些基础样式，防止白屏
    mainWindow.webContents.insertCSS('body { background-color: #ffffff; }');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (isDev) console.log('Page finished loading');
    // 页面加载完成后显示窗口（--hidden 自启常驻托盘时不闪现）
    if (!startHidden && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：尝试多个可能的路径
    const possiblePaths = [
      path.join(__dirname, '../dist/index.html'),
      path.join(process.resourcesPath, 'app.asar/dist/index.html'),
      path.join(process.resourcesPath, 'app/dist/index.html'),
      path.join(process.resourcesPath, 'dist/index.html'),
      path.join(__dirname, '../build/index.html')
    ];

    let indexPath = null;
    for (const testPath of possiblePaths) {
      try {
        if (fs.existsSync(testPath)) {
          indexPath = testPath;
          break;
        }
      } catch (error) {
        // 忽略文件系统错误，继续尝试下一个路径
        continue;
      }
    }

    if (indexPath) {
      console.log('Loading application from:', indexPath);
      mainWindow.loadFile(indexPath).catch(error => {
        console.error('Failed to load file:', error);
        // 加载失败时显示错误页面
        mainWindow.loadURL('data:text/html,<h1>Application Load Error</h1><p>Could not load the main application. Please restart the app.</p>');
      });
    } else {
      console.error('Could not find index.html in any expected location');
      console.log('Checked paths:', possiblePaths);
      console.log('Current directory:', __dirname);
      console.log('Process resources path:', process.resourcesPath);
      // 显示详细的错误信息
      const errorHtml = '<h1>Application Not Found</h1><p>Could not locate the application files.</p><p>Please reinstall the application.</p>';
      mainWindow.loadURL('data:text/html,' + encodeURIComponent(errorHtml));
    }
  }

  mainWindow.once('ready-to-show', () => {
    if (!startHidden) mainWindow.show();
  });

  // 提供稳定的菜单与编辑快捷键（生产环境）
  const menuTemplate = process.platform === 'darwin' ? [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ] : [
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (event.isMainFrame) return;
    if (!event.url.startsWith(`${PAGE_SCHEME}://`)) {
      event.preventDefault();
      return;
    }
    const current = event.frame?.url;
    if (current?.startsWith(`${PAGE_SCHEME}://`)) {
      const previousPage = new URL(current);
      const nextPage = new URL(event.url);
      if (previousPage.hostname !== nextPage.hostname ||
        previousPage.pathname.split('/')[1] !== nextPage.pathname.split('/')[1]) event.preventDefault();
    }
  });

  mainWindow.on('close', (event) => {
    // #345: 关闭默认常驻托盘（设置-通用可改）。真退出只走 isQuitting 路径。
    if (!isQuitting && desktopPrefs.closeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('minimize', (event) => {
    // #345: 最小化默认隐藏到托盘。
    if (desktopPrefs.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

const PROXY_CONFIG_PATH = path.join(app.getPath('userData'), 'proxy-config.json');

function loadProxyConfig() {
  try {
    if (fs.existsSync(PROXY_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(PROXY_CONFIG_PATH, 'utf-8'));
    }
  } catch (e) { console.error('Failed to load proxy config:', e); }
  return { enabled: false, type: 'http', host: '', port: 7890 };
}

function saveProxyConfig(config) {
  fs.writeFileSync(PROXY_CONFIG_PATH, JSON.stringify(config, null, 2));
}

async function applyProxy(config) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (config.enabled && config.host && config.port) {
    let auth = '';
    if (config.username) {
      auth = config.password
        ? encodeURIComponent(config.username) + ':' + encodeURIComponent(config.password) + '@'
        : encodeURIComponent(config.username) + '@';
    }
    const proxyUrl = config.type === 'socks5'
      ? 'socks5://' + auth + config.host + ':' + config.port
      : 'http://' + auth + config.host + ':' + config.port;
    await mainWindow.webContents.session.setProxy({
      proxyRules: proxyUrl,
      proxyBypassRules: '<local>;localhost;127.0.0.1'
    });
    // Never log credentials embedded in proxy URLs
    const redactedProxyUrl = proxyUrl.replace(/\/\/[^@/]+@/, '//***:***@');
    console.log('[Proxy] Applied:', redactedProxyUrl);
  } else {
    await mainWindow.webContents.session.setProxy({ mode: 'system' });
    console.log('[Proxy] Disabled, using system proxy settings');
  }
}

function getFetchDispatcher() {
  const config = loadProxyConfig();
  if (config.enabled && config.host && config.port) {
    let auth = '';
    if (config.username) {
      auth = config.password
        ? encodeURIComponent(config.username) + ':' + encodeURIComponent(config.password) + '@'
        : encodeURIComponent(config.username) + '@';
    }
    const proxyUrl = config.type === 'socks5'
      ? 'socks5://' + auth + config.host + ':' + config.port
      : 'http://' + auth + config.host + ':' + config.port;
    try {
      const { ProxyAgent } = require('undici');
      return new ProxyAgent(proxyUrl);
    } catch (err) {
      throw new Error(`Failed to initialize configured proxy agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (envProxy) {
    try {
      const { ProxyAgent } = require('undici');
      return new ProxyAgent(envProxy);
    } catch (err) {
      throw new Error(`Failed to initialize environment proxy agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return undefined;
}

// X 推文频道：主进程代抓 x.com 未登录主页
ipcMain.handle('x-fetch-timeline', async (_event, handle) => {
  if (typeof handle !== 'string' || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    return { success: false, error: 'invalid handle' };
  }
  try {
    const dispatcher = getFetchDispatcher();
    const response = await fetch(`https://x.com/${handle}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (!response.ok) {
      return { success: false, error: `x.com responded ${response.status}` };
    }
    const html = await response.text();
    return { success: true, html };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// Telegram 频道：主进程代抓 t.me/s/<name> 公开网页预览（渲染进程受 CORS 限制；
// net.fetch 走 Chromium 网络栈，自动跟随应用内已设置的代理）
ipcMain.handle('telegram-fetch-channel', async (_event, channel, before) => {
  if (typeof channel !== 'string' || !/^[A-Za-z0-9_]{3,64}$/.test(channel)) {
    return { success: false, error: 'invalid channel' };
  }
  if (before !== undefined && before !== null && before !== '' &&
      (typeof before !== 'string' || !/^\d{1,20}$/.test(before))) {
    return { success: false, error: 'invalid before cursor' };
  }
  try {
    const suffix = before ? `?before=${before}` : '';
    const response = await net.fetch(`https://t.me/s/${channel}${suffix}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      return { success: false, error: `t.me responded ${response.status}` };
    }
    const html = await response.text();
    return { success: true, html };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// X 推文频道鉴权路径：主进程代发 x.com GraphQL / 静态资源 GET 请求
// （带用户的 auth_token/ct0 Cookie；使用 Node fetch 保持 TLS 指纹并规避 Chromium 对自定义 Header 的限制）
// 只允许受控操作对应的 URL（调用方不可任意指定 x.com 路径）：
// - 登录态首页（queryId 提取入口）
// - abs.twimg.com 主脚本（queryId 提取源，绝不附带 X Cookie）
// - GraphQL UserTweets / UserByScreenName（queryId 动态，操作名固定）
const X_HOME_URL = 'https://x.com/home';
const X_MAIN_JS_PATTERN = /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-zA-Z0-9_-]+\.js$/;
const X_GRAPHQL_API_PATTERN = /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(UserTweets|UserByScreenName)(\?.*)?$/;
const isAllowedXProxyUrl = (url) =>
  url === X_HOME_URL || X_MAIN_JS_PATTERN.test(url) || X_GRAPHQL_API_PATTERN.test(url);
const X_COOKIE_VALUE_PATTERN = /^[\w%+/=.~-]+$/;

ipcMain.handle('x-fetch-graphql', async (_event, url, auth) => {
  if (typeof url !== 'string' || !isAllowedXProxyUrl(url)) {
    return { success: false, error: 'invalid url' };
  }
  const authToken = typeof auth?.authToken === 'string' ? auth.authToken.trim().replace(/^["']|["']$/g, '').trim() : '';
  const ct0 = typeof auth?.ct0 === 'string' ? auth.ct0.trim().replace(/^["']|["']$/g, '').trim() : '';
  if (!authToken || !ct0 || !X_COOKIE_VALUE_PATTERN.test(authToken) || !X_COOKIE_VALUE_PATTERN.test(ct0)) {
    return { success: false, error: 'invalid auth cookies' };
  }
  try {
    // GraphQL API 请求带 Bearer/CSRF 等专有头；HTML 页面与静态资源带这些头
    // 反而被 x.com 拒 401（实测），只发 UA + Cookie
    const isApiCall = url.startsWith('https://x.com/i/api/');
    const headers = isApiCall
      ? {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept': '*/*',
          'Authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
          'X-CSRF-Token': ct0,
          'X-Twitter-Auth-Type': 'OAuth2Session',
          'X-Twitter-Active-User': 'yes',
          'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
        }
      : {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          ...(url.startsWith('https://x.com/') ? { 'Cookie': `auth_token=${authToken}; ct0=${ct0}` } : {}),
        };
    // redirect: 'error' — 拒绝跨域（及一切）重定向，避免 Cookie 被转到允许域名之外
    const dispatcher = getFetchDispatcher();
    const response = await fetch(url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
      ...(dispatcher ? { dispatcher } : {}),
    });
    if (typeof response.url === 'string' && response.url && !isAllowedXProxyUrl(response.url)) {
      return { success: false, error: 'redirect blocked' };
    }
    if (!response.ok) {
      return { success: false, error: `x.com responded ${response.status}` };
    }
    const body = await response.text();
    return { success: true, body };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('x-auth:save', async (_event, auth) => {
  if (auth === null || auth === undefined) {
    console.log('[x-auth:save] clearing (null payload)');
    return saveEncryptedXAuth({ fs, pathModule: path, userDataPath: app.getPath('userData'), safeStorage }, null);
  }
  if (typeof auth !== 'object' || Array.isArray(auth)) {
    console.warn('[x-auth:save] rejected: invalid auth payload type');
    return { success: false, error: 'invalid auth payload' };
  }
  const authToken = typeof auth.authToken === 'string' ? auth.authToken.trim().replace(/^["']|["']$/g, '').trim() : '';
  const ct0 = typeof auth.ct0 === 'string' ? auth.ct0.trim().replace(/^["']|["']$/g, '').trim() : '';
  if (!authToken && !ct0) {
    console.log('[x-auth:save] clearing (empty tokens)');
    return saveEncryptedXAuth({ fs, pathModule: path, userDataPath: app.getPath('userData'), safeStorage }, null);
  }
  if (
    !authToken ||
    !ct0 ||
    authToken.length > 512 ||
    ct0.length > 512 ||
    !X_COOKIE_VALUE_PATTERN.test(authToken) ||
    !X_COOKIE_VALUE_PATTERN.test(ct0)
  ) {
    console.warn('[x-auth:save] rejected: invalid auth cookies', { authTokenLen: authToken.length, ct0Len: ct0.length });
    return { success: false, error: 'invalid auth cookies' };
  }
  const result = saveEncryptedXAuth({ fs, pathModule: path, userDataPath: app.getPath('userData'), safeStorage }, { authToken, ct0 });
  console.log('[x-auth:save] result:', result.success ? 'OK' : `FAIL: ${result.error}`);
  return result;
});

ipcMain.handle('x-auth:get', async () => {
  const result = loadEncryptedXAuth({ fs, pathModule: path, userDataPath: app.getPath('userData'), safeStorage });
  console.log('[x-auth:get] result:', result ? 'found credentials' : 'no credentials on disk');
  return result;
});

ipcMain.handle('x-auth:clear', async () => {
  const result = clearEncryptedXAuth({ fs, pathModule: path, userDataPath: app.getPath('userData') });
  console.log('[x-auth:clear] result:', result.success ? 'OK' : `FAIL: ${result.error}`);
  return result;
});

ipcMain.handle('set-proxy', async (event, config) => {
  saveProxyConfig(config);
  await applyProxy(config);
  return { success: true };
});

ipcMain.handle('get-proxy', () => {
  return loadProxyConfig();
});

ipcMain.handle('test-proxy', async (event, config) => {
  const net = require('net');
  const connectToProxy = () => new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.on('connect', () => resolve(socket));
    socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')); });
    socket.on('error', (err) => reject(err));
    socket.connect(config.port, config.host);
  });
  try {
    if (config.type === 'socks5') {
      const socket = await connectToProxy();
      return await new Promise((resolve) => {
        const greeting = config.username
          ? Buffer.from([0x05, 0x02, 0x00, 0x02])
          : Buffer.from([0x05, 0x01, 0x00]);
        socket.setTimeout(5000);
        socket.write(greeting);
        let step = 0;
        let buffered = Buffer.alloc(0);
        socket.on('data', (chunk) => {
          buffered = Buffer.concat([buffered, chunk]);
          if (step === 0) {
            if (buffered.length < 2) return;
            const data = buffered;
            if (data[0] !== 0x05) { socket.destroy(); resolve({ success: false, error: 'Invalid SOCKS5 version' }); return; }
            if (data[1] === 0xFF) { socket.destroy(); resolve({ success: false, error: 'No acceptable auth method' }); return; }
            if (data[1] === 0x02 && config.username && config.password) {
              step = 1;
              buffered = Buffer.alloc(0);
              const userBuf = Buffer.from(config.username, 'utf8');
              const passBuf = Buffer.from(config.password, 'utf8');
              const authReq = Buffer.alloc(3 + userBuf.length + passBuf.length);
              authReq[0] = 0x01; authReq[1] = userBuf.length;
              userBuf.copy(authReq, 2);
              authReq[2 + userBuf.length] = passBuf.length;
              passBuf.copy(authReq, 3 + userBuf.length);
              socket.write(authReq);
            } else { socket.destroy(); resolve({ success: true }); }
          } else if (step === 1) {
            if (buffered.length < 2) return;
            const data = buffered;
            socket.destroy();
            resolve(data[0] === 0x01 && data[1] === 0x00
              ? { success: true }
              : { success: false, error: 'SOCKS5 authentication failed' });
          }
        });
        socket.on('timeout', () => { socket.destroy(); resolve({ success: false, error: 'SOCKS5 handshake timeout' }); });
        socket.on('error', (err) => resolve({ success: false, error: err.message }));
      });
    } else {
      const socket = await connectToProxy();
      return await new Promise((resolve) => {
        socket.setTimeout(5000);
        const authHeader = config.username && config.password
          ? 'Proxy-Authorization: Basic ' + Buffer.from(config.username + ':' + config.password).toString('base64') + '\r\n'
          : '';
        socket.write('CONNECT httpbin.org:443 HTTP/1.1\r\nHost: httpbin.org:443\r\n' + authHeader + '\r\n');
        let responseData = '';
        socket.on('data', (data) => {
          responseData += data.toString();
          if (responseData.includes('\r\n\r\n')) {
            socket.destroy();
            if (responseData.includes('200')) resolve({ success: true });
            else if (responseData.includes('407')) resolve({ success: false, error: 'Proxy authentication required' });
            else resolve({ success: false, error: 'Proxy rejected: ' + (responseData.split('\r\n')[0] || 'Unknown') });
          }
        });
        socket.on('timeout', () => { socket.destroy(); resolve({ success: false, error: 'HTTP proxy handshake timeout' }); });
        socket.on('error', (err) => resolve({ success: false, error: err.message }));
      });
    }
  } catch (e) { return { success: false, error: e.message }; }
});


// ── Desktop prefs: auto-launch + tray behavior (#345) ──
// Defaults: autoLaunch OFF, closeToTray/minimizeToTray ON (see desktopPrefs.js).

function getDesktopUserDataPath() {
  return app.getPath('userData');
}

function reloadDesktopPrefs() {
  desktopPrefs = loadDesktopPrefs({ fs, pathModule: path, userDataPath: getDesktopUserDataPath() });
  return desktopPrefs;
}

function persistDesktopPrefs(next) {
  desktopPrefs = saveDesktopPrefs(
    { fs, pathModule: path, userDataPath: getDesktopUserDataPath() },
    normalizeDesktopPrefs({ ...desktopPrefs, ...next }),
  );
  return desktopPrefs;
}

/**
 * Apply the auto-launch OS setting. Best-effort: never throws, reports errors.
 * - Windows/macOS: Electron built-in login-item settings.
 * - Linux: freedesktop `~/.config/autostart/*.desktop` entry.
 */
async function applyAutoLaunch(enabled) {
  try {
    if (process.platform === 'win32' || process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: !!enabled,
        openAsHidden: true,
        // Windows: start resident in tray like the Linux --hidden entry.
        ...(process.platform === 'win32' ? { args: ['--hidden'] } : {}),
      });
    } else if (process.platform === 'linux') {
      const autostartPath = getLinuxAutostartPath({ homeDir: os.homedir(), pathModule: path });
      if (enabled) {
        fs.mkdirSync(path.dirname(autostartPath), { recursive: true });
        fs.writeFileSync(
          autostartPath,
          buildLinuxDesktopEntry({ execPath: process.execPath }),
        );
      } else if (fs.existsSync(autostartPath)) {
        fs.unlinkSync(autostartPath);
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve the tray icon path for the current platform and theme.
 * macOS prefers the monochrome template image (system recolors it for
 * light/dark menu bars); other platforms pick the black/white monochrome
 * variant from the system theme, falling back to the legacy color icons.
 */
function resolveTrayIcon() {
  // macOS 菜单栏要求单色 template 图（纯黑+alpha），系统自动适配深浅外观；
  // 其他平台没有 template 机制，按系统主题在黑/白两份之间切换。
  const candidates = [];
  if (process.platform === 'darwin') {
    candidates.push(path.join(__dirname, 'assets', 'trayTemplate.png'));
  } else {
    candidates.push(path.join(__dirname, 'assets', nativeTheme.shouldUseDarkColors ? 'tray-white.png' : 'tray-black.png'));
  }
  candidates.push(
    path.join(__dirname, 'assets', 'tray-32.png'),
    path.join(__dirname, 'assets', 'tray-16.png'),
    path.join(__dirname, '..', 'public', 'icon.png'),
    path.join(__dirname, '..', 'dist', 'icon.png'),
  );
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function restoreMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const template = [
    {
      label: '显示主窗口',
      click: () => restoreMainWindow(),
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: desktopPrefs.autoLaunch,
      click: async (item) => {
        await setAutoLaunchWithRollback(!!item.checked);
        refreshTrayMenu();
      },
    },
    {
      label: '关闭时最小化到托盘',
      type: 'checkbox',
      checked: desktopPrefs.closeToTray,
      click: (item) => {
        persistDesktopPrefs({ closeToTray: !!item.checked });
        refreshTrayMenu();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.setToolTip('GitHub Stars Manager');
}

/** Set auto-launch with disk persistence; rolls back the pref on OS failure. */
async function setAutoLaunchWithRollback(enabled) {
  const previous = { ...desktopPrefs };
  persistDesktopPrefs({ autoLaunch: !!enabled });
  const applied = await applyAutoLaunch(!!enabled);
  if (!applied.success) {
    try {
      persistDesktopPrefs(previous);
    } catch {
      desktopPrefs = previous;
    }
    return { success: false, prefs: { ...desktopPrefs }, error: applied.error };
  }
  refreshTrayMenu();
  return { success: true, prefs: { ...desktopPrefs } };
}

/** Create the tray with the resolved icon (marked as template on macOS) and menu wiring. */
function createTray() {
  if (tray && !tray.isDestroyed()) {
    refreshTrayMenu();
    return;
  }
  try {
    const iconPath = resolveTrayIcon();
    const icon = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty();
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        restoreMainWindow();
      }
    });
    refreshTrayMenu();
  } catch (err) {
    console.error('Failed to create tray:', err);
    tray = null;
  }
}

function destroyTray() {
  try {
    if (tray && !tray.isDestroyed()) tray.destroy();
  } catch {
    // Best-effort cleanup during shutdown.
  }
  tray = null;
}

// 非 macOS 托盘图标跟随系统深浅主题切换（macOS 用 template 图自动适配）。
nativeTheme.on('updated', () => {
  if (process.platform === 'darwin') return;
  if (!tray || tray.isDestroyed()) return;
  const iconPath = resolveTrayIcon();
  if (iconPath) tray.setImage(nativeImage.createFromPath(iconPath));
});

ipcMain.handle('desktop:getPrefs', () => ({ ...desktopPrefs }));

ipcMain.handle('desktop:setAutoLaunch', async (_e, enabled) =>
  setAutoLaunchWithRollback(!!enabled),
);

ipcMain.handle('desktop:setCloseToTray', (_e, enabled) => {
  const prefs = persistDesktopPrefs({ closeToTray: !!enabled });
  refreshTrayMenu();
  return { success: true, prefs: { ...prefs } };
});

ipcMain.handle('desktop:setMinimizeToTray', (_e, enabled) => {
  const prefs = persistDesktopPrefs({ minimizeToTray: !!enabled });
  refreshTrayMenu();
  return { success: true, prefs: { ...prefs } };
});

ipcMain.handle('desktop:show', () => {
  restoreMainWindow();
  return { success: true };
});


// ── MCP local server (read-only tools for agents) ──
let mcpConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 3927,
  token: '',
};
let mcpSnapshot = null;
const mcpServer = createMcpLocalServer(() => ({
  config: mcpConfig,
  snapshot: mcpSnapshot,
}));

/** Desktop MCP must only bind loopback. */
function normalizeMcpHost(_rawHost) {
  return '127.0.0.1';
}

ipcMain.handle('mcp:setConfig', async (_e, config) => {
  const previousHost = mcpConfig.host;
  const previousPort = mcpConfig.port;
  mcpConfig = {
    enabled: !!config?.enabled,
    host: normalizeMcpHost(config?.host),
    port:
      typeof config?.port === 'number' && config.port >= 1 && config.port <= 65535
        ? config.port
        : 3927,
    token: typeof config?.token === 'string' ? config.token : '',
  };
  const addressChanged = mcpConfig.host !== previousHost || mcpConfig.port !== previousPort;
  if (!mcpConfig.enabled || addressChanged) {
    await mcpServer.stop();
  }
  return { success: true };
});

ipcMain.handle('mcp:getConfig', async () => mcpConfig);

ipcMain.handle('mcp:pushSnapshot', async (_e, snapshot) => {
  mcpSnapshot = snapshot || null;
  return { success: true };
});

ipcMain.handle('mcp:start', async () => {
  try {
    return await mcpServer.start();
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
});

ipcMain.handle('mcp:stop', async () => mcpServer.stop());

ipcMain.handle('mcp:getStatus', async () => mcpServer.getStatus());

// ── Trusted local plugin host (discovery, lifecycle, and restricted IPC) ──
let pluginManager = null;

function getPluginManager() {
  if (!pluginManager) {
    pluginManager = createPluginManager({
      pluginsRoot: path.join(app.getPath('userData'), 'plugins'),
    });
  }
  return pluginManager;
}

ipcMain.handle('plugins:list', async () => getPluginManager().list());
ipcMain.handle('plugins:installFromDirectory', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Select plugin directory',
    properties: ['openDirectory'],
  });
  if (selection.canceled || selection.filePaths.length !== 1) return { success: false, canceled: true };
  return getPluginManager().installFromDirectory(selection.filePaths[0]);
});
ipcMain.handle('plugins:enable', async (_event, pluginId, grantedPermissions) =>
  getPluginManager().enable(pluginId, grantedPermissions)
);
ipcMain.handle('plugins:disable', async (_event, pluginId) =>
  getPluginManager().disable(pluginId)
);
ipcMain.handle('plugins:uninstall', async (_event, pluginId, removePluginData) =>
  getPluginManager().uninstall(pluginId, removePluginData)
);
ipcMain.handle('plugins:runAction', async (_event, request) => {
  const operation = await getPluginManager().runAction(request);
  if (operation.success && operation.result.type === 'open-external') {
    try {
      await shell.openExternal(operation.result.url);
    } catch {
      return {
        success: false,
        error: { code: 'PLUGIN_EXTERNAL_OPEN_FAILED', message: 'Failed to open the external URL' },
      };
    }
  }
  return operation;
});
ipcMain.handle('plugins:runProcessor', async (_event, request) =>
  getPluginManager().runProcessor(request)
);
ipcMain.handle('plugins:pushSnapshot', async (_event, snapshot) =>
  getPluginManager().updateSnapshot(snapshot)
);
ipcMain.handle('plugins:runReleaseProcessor', async (_event, request) =>
  getPluginManager().runReleaseProcessor(request)
);
ipcMain.handle('plugins:downloadReleaseAsset', async (_event, request) => {
  const resolved = getPluginManager().getDownloadAsset(
    request?.pluginId,
    request?.releaseId,
    request?.assetId
  );
  if (!resolved.success) return resolved;
  return downloadReleaseAsset({
    fetchImpl: (url, options) => net.fetch(url, options),
    showSaveDialog: (...args) => dialog.showSaveDialog(...args),
    ownerWindow: mainWindow,
    ...resolved.value,
  });
});
// 社区插件注册表（开发守则 §17）：主进程取回并逐条校验，渲染进程只拿到校验过的结构。
// 这里不下载任何插件包，也不做任何安装动作。
ipcMain.handle('plugins:loadRegistry', async () => loadPluginRegistry({
  fetchImpl: (url, options) => net.fetch(url, options),
}));
ipcMain.handle('plugins:runExporter', async (_event, request) =>
  getPluginManager().runExporter(request)
);
function isMainPluginFrame(event) {
  return mainWindow && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame;
}
ipcMain.handle('plugins:getPage', async (event, pluginId, pageId) => {
  if (!isMainPluginFrame(event)) return { success: false, error: { code: 'PLUGIN_IPC_DENIED', message: 'Plugin IPC requires the main frame' } };
  return getPluginManager().getPage(pluginId, pageId);
});
ipcMain.handle('plugins:requestPageCapability', async (event, request) => {
  if (!isMainPluginFrame(event)) return { success: false, error: { code: 'PLUGIN_IPC_DENIED', message: 'Plugin IPC requires the main frame' } };
  return getPluginManager().requestPageCapability(request);
});
ipcMain.handle('plugins:getSearchEndpoint', async (event) => {
  if (!isMainPluginFrame(event)) return { endpoint: null };
  return getPluginManager().getSearchEndpoint();
});
ipcMain.handle('plugins:configureWebSearch', async (event, endpoint) => {
  if (!isMainPluginFrame(event)) return { success: false, error: { code: 'PLUGIN_IPC_DENIED', message: 'Plugin IPC requires the main frame' } };
  return getPluginManager().configureWebSearch(endpoint);
});
ipcMain.handle('plugins:searchWeb', async (event, request) => {
  if (!isMainPluginFrame(event)) return { success: false, error: { code: 'PLUGIN_IPC_DENIED', message: 'Plugin IPC requires the main frame' } };
  return getPluginManager().searchWeb(request);
});

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    restoreMainWindow();
  });
}

app.whenReady().then(() => {
  protocol.handle(PAGE_SCHEME, (request) => {
    const resource = getPluginManager().readPageResource(request.url);
    if (!resource) return new Response('Not Found', { status: 404 });
    return new Response(resource.body, {
      headers: {
        'Content-Type': resource.mimeType,
        'Content-Security-Policy': pageCsp(new URL(request.url).hostname),
        'Access-Control-Allow-Origin': 'null',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    });
  });
  reloadDesktopPrefs();
  void getPluginManager().initialize().catch((error) => {
    console.error('Failed to initialize plugins:', error instanceof Error ? error.message : 'Unknown error');
  });
  // Self-heal the OS login item on every start (e.g. path changed after update).
  if (desktopPrefs.autoLaunch) {
    void applyAutoLaunch(true).then((result) => {
      if (!result.success) console.error('Failed to apply auto-launch:', result.error);
    });
  }
  createTray();
  createWindow();
  // `--hidden` (Linux autostart) starts resident in tray without flashing.
  if (startHidden && mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  const savedProxy = loadProxyConfig();
  if (savedProxy.enabled && savedProxy.host && savedProxy.port) {
    applyProxy(savedProxy);
  }
  // DevTools shortcut only in development
  if (isDev) {
    globalShortcut.register('CommandOrControl+Shift+I', () => {
      const focused = BrowserWindow.getFocusedWindow();
      if (focused && !focused.isDestroyed()) {
        focused.webContents.toggleDevTools();
      }
    });
  }
});

app.on('window-all-closed', () => {
  void mcpServer.stop();
  // #345: close-to-tray prevents this from firing while resident; when the
  // user disabled it, keep the historical behavior (quit on Win/Linux).
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Allow the real quit path to bypass the close-to-tray interceptor.
  isQuitting = true;
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyTray();
  void mcpServer.stop();
  pluginManager?.shutdown();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
