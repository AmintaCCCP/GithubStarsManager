const { app, BrowserWindow, Menu, Tray, clipboard, nativeImage, nativeTheme, shell, globalShortcut, ipcMain, dialog, net, protocol, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const isDev = process.env.NODE_ENV === 'development';
const { createMcpLocalServer } = require('./mcpLocalServer');
// 主进程出站请求的网络栈选择：npm undici@8 的 ProxyAgent（getFetchDispatcher）
// 与 Node 内置 fetch 的 handler 协议不兼容，混用会在拨号前抛
// UND_ERR_INVALID_ARG: invalid onRequestStart method——携带 dispatcher 的
// 调用必须用同版本的 undiciFetch；无代理场景多数目标用内置 fetch 即可，
// 且 x.com 边缘 WAF 按 TLS 指纹放行内置 undici、403 npm undici@8（详见
// X 各 handler 内注释）。
const { fetch: undiciFetch, ProxyAgent } = require('undici');
const { summarizeFetchError, fetchAcrossStacks, timeoutSignalFromBudget, followRedirectsManually, toFailureResult } = require('./mainFetch');
// 诊断抓包装饰器：纯旁路记录（参数/响应/异常原样透传，见 netTap.js）。
// Chromium 栈（net.fetch）由 session.webRequest 观察者零调用点覆盖
// （官方文档：net.fetch 默认触发 webRequest handlers），不做双重包装。
// 新标识符均含大写 Fetch，且 `fetch.bind(` 不匹配 outboundFetchGate 的
// 裸调用正则（该门禁同时要求本解构行字节级原样保留）。
const diagTap = require('./netTap');
const { createDiagLogger } = require('./diagLogger');
const { buildSystemInfo } = require('./systemInfo');
const redact = require('./redact');
const { setNetworkRecorder } = require('./plugins/webSearch');
let diagDebug = false;
const diagLog = createDiagLogger({
  logsDir: path.join(app.getPath('userData'), 'logs', 'diagnostics'),
  // 调试模式放宽磁盘预算：20MB/日、总量 40MB（普通模式 5MB/日、20MB）
  maxFileBytes: () => (diagDebug ? 20 * 1024 * 1024 : 5 * 1024 * 1024),
  maxTotalBytes: () => (diagDebug ? 40 * 1024 * 1024 : 20 * 1024 * 1024),
  maxFiles: 7,
});
const undiciFetchTapped = diagTap.wrapFetch(undiciFetch, {
  source: 'main:undici',
  record: (entry) => diagLog.record(entry),
  isDebugMode: () => diagDebug,
});
const builtinFetchTapped = diagTap.wrapFetch(fetch.bind(globalThis), {
  source: 'main:node-fetch',
  record: (entry) => diagLog.record(entry),
  isDebugMode: () => diagDebug,
});
const { createPluginManager } = require('./plugins/pluginManager');
const { createPluginMarketplace } = require('./plugins/pluginMarketplace');
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

// ── Process-level diagnostics (previously invisible crash evidence) ──
// Recording must never itself throw: every handler is guarded, and a failure
// inside diagLog degrades to its in-memory ring.
process.on('uncaughtException', (error) => {
  try {
    diagLog.record({
      level: 'error',
      module: 'electron.process',
      message: 'uncaughtException',
      data: redact.sanitizeError(error),
    });
  } catch { /* swallow — diagnostics must not crash the crash handler */ }
});
process.on('unhandledRejection', (reason) => {
  try {
    diagLog.record({
      level: 'error',
      module: 'electron.process',
      message: 'unhandledRejection',
      data: redact.sanitizeError(reason),
    });
  } catch { /* swallow */ }
});
app.on('render-process-gone', (_event, details) => {
  try {
    diagLog.record({
      level: 'error',
      module: 'electron.app',
      message: `Render process gone: ${details?.reason ?? 'unknown'}`,
      data: { reason: details?.reason, exitCode: details?.exitCode, details: redact.sanitizeForLog(details) },
    });
  } catch { /* swallow */ }
});
app.on('child-process-gone', (_event, details) => {
  try {
    diagLog.record({
      level: 'error',
      module: 'electron.app',
      message: `Child process gone: ${details?.type ?? 'unknown'} ${details?.reason ?? ''}`,
      data: { type: details?.type, reason: details?.reason, exitCode: details?.exitCode },
    });
  } catch { /* swallow */ }
});

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

  // Renderer console errors that escaped every try/catch: record a capped
  // sample (unique-error storms bypass repeat aggregation, so a token bucket
  // here is the hard bound). Handles both the legacy (event, level, message)
  // and the details-object event shapes across Electron versions.
  let rendererConsoleErrorBudget = { windowStart: 0, used: 0 };
  mainWindow.webContents.on('console-message', (...args) => {
    try {
      const first = args[1];
      const level = first && typeof first === 'object' ? first.level : args[1];
      const message = first && typeof first === 'object' ? first.message : args[2];
      const isError = level === 3 || level === 'error';
      if (!isError) return;
      const nowMs = Date.now();
      if (nowMs - rendererConsoleErrorBudget.windowStart >= 60_000) {
        rendererConsoleErrorBudget.windowStart = nowMs;
        rendererConsoleErrorBudget.used = 0;
      }
      if (rendererConsoleErrorBudget.used >= 30) return;
      rendererConsoleErrorBudget.used += 1;
      const details = first && typeof first === 'object' ? first : {};
      const data = {};
      if (details.sourceId || details.lineNumber) {
        data.sourceId = details.sourceId;
        data.lineNumber = details.lineNumber;
      }
      // New-style (details-object) events carry stackTrace: an array of stack
      // lines for uncaught errors. The legacy (event, level, message, line,
      // sourceId) shape has no such field and keeps the location-only data.
      // Sample is capped like the message above (20 lines x 500 chars);
      // diagLog re-runs redact.sanitizeForLog over data on write, and the
      // per-line redactInline pass covers credentials embedded mid-line that
      // whole-value string rules cannot see.
      if (Array.isArray(details.stackTrace) && details.stackTrace.length > 0) {
        data.stackTrace = details.stackTrace
          .slice(0, 20)
          .map((line) => redact.redactInline(String(line).slice(0, 500)));
      }
      diagLog.record({
        level: 'error',
        module: 'electron.renderer-console',
        message: String(message ?? '').slice(0, 2000),
        ...(Object.keys(data).length > 0 ? { data } : {}),
      });
    } catch { /* never break the window */ }
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
      return new ProxyAgent(proxyUrl);
    } catch (err) {
      throw new Error(`Failed to initialize configured proxy agent: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const envProxy = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy;
  if (envProxy) {
    try {
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
    const timelineUrl = `https://x.com/${handle}`;
    const timelineHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const { response } = await fetchAcrossStacks([
      // 首选 Node 栈：无应用代理时用内置 fetch——x.com 边缘 WAF 按 TLS 指纹
      // 放行内置 undici（#356 起长期可用）却 403 npm undici@8（HTML 挑战页，
      // 实测）；配置应用代理时内置 fetch 无法接收 undici@8 的 ProxyAgent
      // （handler 协议不兼容），只能用同版本 undici fetch
      {
        name: 'undici',
        run: async ({ remainingMs }) => {
          const dispatcher = getFetchDispatcher();
          const fetchImpl = dispatcher ? undiciFetchTapped : builtinFetchTapped;
          return fetchImpl(timelineUrl, {
            headers: timelineHeaders,
            signal: timeoutSignalFromBudget(remainingMs, 20_000),
            ...(dispatcher ? { dispatcher } : {}),
          });
        },
        // 边缘按指纹 403/429 时该栈视为未命中，让位给 Chromium 栈
        onResponseRetryable: (response) => response.status === 403 || response.status === 429,
      },
      // 回退 Chromium 栈：跟随 session 代理（含“系统代理”），并使用系统证书库
      {
        name: 'chromium',
        run: ({ remainingMs }) => net.fetch(timelineUrl, {
          headers: timelineHeaders,
          signal: timeoutSignalFromBudget(remainingMs, 20_000),
        }),
      },
    ], { totalTimeoutMs: 20_000 });
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
    const telegramUrl = `https://t.me/s/${channel}${suffix}`;
    const telegramHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    };
    const { response } = await fetchAcrossStacks([
      // 首选 Chromium 栈：跟随 session 代理（含应用内代理与“系统代理”模式）
      {
        name: 'chromium',
        run: ({ remainingMs }) => net.fetch(telegramUrl, {
          headers: telegramHeaders,
          signal: timeoutSignalFromBudget(remainingMs, 20_000),
        }),
      },
      // 回退 undici：跟随应用内代理/环境变量代理（Chromium 栈整体不可用时兜底）
      {
        name: 'undici',
        run: async ({ remainingMs }) => {
          const dispatcher = getFetchDispatcher();
          return undiciFetchTapped(telegramUrl, {
            headers: telegramHeaders,
            signal: timeoutSignalFromBudget(remainingMs, 20_000),
            ...(dispatcher ? { dispatcher } : {}),
          });
        },
      },
    ], { totalTimeoutMs: 20_000 });
    if (!response.ok) {
      return { success: false, error: `t.me responded ${response.status}` };
    }
    const html = await response.text();
    return { success: true, html };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// WebDAV：主进程代发 DAV 请求。
// 渲染进程开启了 webSecurity，且桌面版以 file:// 为源、又不携带后端，
// 浏览器直连会被 WebDAV 服务器的 CORS 策略拦下（PROPFIND/MKCOL/PUT 等）。
// 首选 Node fetch（undici，跟随应用内代理/环境变量代理）；网络层失败时回退
// Chromium 栈（net.fetch），它跟随 session 代理（含“系统代理”）并使用系统
// 证书库——undici 直连失败（系统代理/VPN 仅对 Chromium 生效、企业根证书装在
// 系统钥匙串、自签名证书已被系统信任等）的大量场景可由此成功。
// 主机不设白名单：WebDAV 普遍部署在用户自有的云盘或局域网 NAS 上。
const WEBDAV_ALLOWED_METHODS = new Set([
  'GET', 'HEAD', 'PUT', 'POST', 'DELETE', 'OPTIONS',
  'PROPFIND', 'PROPPATCH', 'MKCOL', 'COPY', 'MOVE', 'LOCK', 'UNLOCK',
]);
ipcMain.handle('webdav-request', async (_event, params) => {
  const { url, method, headers, body, timeoutMs } = params ?? {};
  if (typeof url !== 'string') {
    return { success: false, error: 'invalid url' };
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { success: false, error: 'invalid url' };
  }
  // 仅允许 http(s)：避免 file:/data: 等本地协议被主进程读取
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { success: false, error: 'unsupported protocol' };
  }
  const upperMethod = typeof method === 'string' ? method.toUpperCase() : '';
  if (!WEBDAV_ALLOWED_METHODS.has(upperMethod)) {
    return { success: false, error: 'invalid method' };
  }
  // 头值必须是非 CRLF 字符串，防止请求头注入
  const safeHeaders = {};
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string' || /[\r\n]/.test(key) || /[\r\n]/.test(value)) continue;
      safeHeaders[key] = value;
    }
  }
  // 与前端一致的超时上限（WebDAV 上传最长 300s）；多栈尝试共享这一预算
  const timeout = Number.isFinite(timeoutMs)
    ? Math.min(Math.max(Math.trunc(timeoutMs), 1000), 300000)
    : 60000;
  // GET/HEAD 带 body 会被 undici 拒绝（Chromium 栈同样不允许）
  const hasBody = !!body && upperMethod !== 'GET' && upperMethod !== 'HEAD';
  const stacks = [
    {
      name: 'undici',
      run: async ({ remainingMs }) => {
        const dispatcher = getFetchDispatcher();
        return undiciFetchTapped(parsed.toString(), {
          method: upperMethod,
          headers: safeHeaders,
          ...(hasBody ? { body } : {}),
          signal: timeoutSignalFromBudget(remainingMs, timeout),
          ...(dispatcher ? { dispatcher } : {}),
        });
      },
    },
    // net.fetch 的自动重定向在跨域跳转时仍会转发 Authorization（Electron 44 实测），
    // 携带 Basic 凭据的 DAV 请求必须手动跟随跳转，跨源时剥离凭据头
    {
      name: 'chromium',
      run: ({ remainingMs }) => followRedirectsManually(net.fetch, parsed.toString(), {
        method: upperMethod,
        headers: safeHeaders,
        ...(hasBody ? { body } : {}),
        signal: timeoutSignalFromBudget(remainingMs, timeout),
      }),
    },
  ];
  // LOCK/POST 非幂等：网络层失败时跨栈重放可能产生重复锁/重复提交，只用单栈
  const eligibleStacks = upperMethod === 'LOCK' || upperMethod === 'POST'
    ? stacks.slice(0, 1)
    : stacks;
  try {
    const { response } = await fetchAcrossStacks(eligibleStacks, { totalTimeoutMs: timeout });
    const text = await response.text();
    return {
      success: true,
      status: response.status,
      statusText: response.statusText,
      body: text,
      contentType: response.headers.get('content-type') ?? undefined,
    };
  } catch (error) {
    // 归一超时与结构化 cause，供渲染进程映射为可操作的修复建议
    return toFailureResult(error);
  }
});

// X 推文频道鉴权路径：主进程代发 x.com GraphQL / 静态资源 GET 请求
// （带用户的 auth_token/ct0 Cookie；使用 Node fetch 保持 TLS 指纹并规避 Chromium 对自定义 Header 的限制）
// 只允许受控操作对应的 URL（调用方不可任意指定 x.com 路径）：
// - 登录态首页（queryId 提取入口）
// - abs.twimg.com 主脚本（queryId 提取源，绝不附带 X Cookie）
// - GraphQL UserTweets / UserByScreenName（queryId 动态，操作名固定）
// 免登录 guest 流程（auth 为 null）：auth 缺失或鉴权请求被边缘 403 时由渲染
// 进程降级调用——x.com 主站的边缘 WAF 对 Node 网络栈按 TLS 指纹拦 403 HTML
// 挑战页，guest GraphQL 必须走 Chromium 栈（net.fetch，实测 200）；guest
// token 的激活端点在 api.x.com，不做指纹拦截，undici（跟随应用代理）优先。
// guest 拿不到登录态首页，queryId 提取入口 x.com/home 改用公开落地页。
const X_HOME_URL = 'https://x.com/home';
const X_MAIN_JS_PATTERN = /^https:\/\/abs\.twimg\.com\/responsive-web\/client-web\/main\.[a-zA-Z0-9_-]+\.js$/;
const X_GRAPHQL_API_PATTERN = /^https:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(UserTweets|UserByScreenName)(\?.*)?$/;
const isAllowedXProxyUrl = (url) =>
  url === X_HOME_URL || X_MAIN_JS_PATTERN.test(url) || X_GRAPHQL_API_PATTERN.test(url);
const X_COOKIE_VALUE_PATTERN = /^[\w%+/=.~-]+$/;
const X_BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// x.com 公共 Web 客户端 Bearer（public-by-design）：随 x.com 前端 JS 分发给
// 所有访客、浏览器请求 x.com 一律携带的公开常量，非用户凭据、无特权访问，
// GitGuardian 的通用高熵检测对它属误报。
const X_BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
const X_GUEST_ACTIVATE_URL = 'https://api.x.com/1.1/guest/activate.json';
/** guest token 进程内缓存：激活端点有频控，跨请求复用；403/401 时强制刷新 */
let xGuestToken = null;

async function fetchXGuestToken() {
  const activateHeaders = {
    'User-Agent': X_BROWSER_UA,
    'Authorization': `Bearer ${X_BEARER_TOKEN}`,
  };
  const { response } = await fetchAcrossStacks([
    {
      name: 'undici',
      run: async ({ remainingMs }) => {
        const dispatcher = getFetchDispatcher();
        const fetchImpl = dispatcher ? undiciFetchTapped : builtinFetchTapped;
        return fetchImpl(X_GUEST_ACTIVATE_URL, {
          method: 'POST',
          headers: activateHeaders,
          signal: timeoutSignalFromBudget(remainingMs, 15_000),
          ...(dispatcher ? { dispatcher } : {}),
        });
      },
    },
    {
      name: 'chromium',
      run: ({ remainingMs }) => net.fetch(X_GUEST_ACTIVATE_URL, {
        method: 'POST',
        headers: activateHeaders,
        signal: timeoutSignalFromBudget(remainingMs, 15_000),
      }),
    },
  ], { totalTimeoutMs: 15_000 });
  if (!response.ok) {
    throw new Error(`x.com guest token activate failed (${response.status})`);
  }
  const payload = await response.json();
  if (typeof payload?.guest_token !== 'string' || !/^\d{6,}$/.test(payload.guest_token)) {
    throw new Error('x.com guest token activate returned invalid payload');
  }
  return payload.guest_token;
}

async function getXGuestToken(forceRefresh = false) {
  if (xGuestToken && !forceRefresh) return xGuestToken;
  xGuestToken = await fetchXGuestToken();
  return xGuestToken;
}

ipcMain.handle('x-fetch-graphql', async (_event, url, auth) => {
  if (typeof url !== 'string' || !isAllowedXProxyUrl(url)) {
    return { success: false, error: 'invalid url' };
  }
  const authToken = typeof auth?.authToken === 'string' ? auth.authToken.trim().replace(/^["']|["']$/g, '').trim() : '';
  const ct0 = typeof auth?.ct0 === 'string' ? auth.ct0.trim().replace(/^["']|["']$/g, '').trim() : '';
  const hasCookieAuth = !!(authToken && ct0 && X_COOKIE_VALUE_PATTERN.test(authToken) && X_COOKIE_VALUE_PATTERN.test(ct0));
  // 显式携带 Cookie 但格式非法：调用方指定了鉴权路径，直接拒绝而非静默降级 guest
  if (auth && !hasCookieAuth) {
    return { success: false, error: 'invalid auth cookies' };
  }
  try {
    if (hasCookieAuth) {
      // GraphQL API 请求带 Bearer/CSRF 等专有头；HTML 页面与静态资源带这些头
      // 反而被 x.com 拒 401（实测），只发 UA + Cookie
      const isApiCall = url.startsWith('https://x.com/i/api/');
      const headers = isApiCall
        ? {
            'User-Agent': X_BROWSER_UA,
            'Accept': '*/*',
            'Authorization': `Bearer ${X_BEARER_TOKEN}`,
            'X-CSRF-Token': ct0,
            'X-Twitter-Auth-Type': 'OAuth2Session',
            'X-Twitter-Active-User': 'yes',
            'Cookie': `auth_token=${authToken}; ct0=${ct0}`,
          }
        : {
            'User-Agent': X_BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            ...(url.startsWith('https://x.com/') ? { 'Cookie': `auth_token=${authToken}; ct0=${ct0}` } : {}),
          };
      // redirect: 'error' — 拒绝跨域（及一切）重定向，避免 Cookie 被转到允许域名之外
      const dispatcher = getFetchDispatcher();
      // 内置 fetch 的 TLS 指纹被 x.com 边缘放行（#356 起长期可用）；npm undici@8
      // 的指纹会被 403。仅当需要应用代理 dispatcher 时才用同版本 undici fetch
      //（此时若仍被边缘 403，渲染进程会自动降级 guest 流程）
      const fetchImpl = dispatcher ? undiciFetchTapped : builtinFetchTapped;
      const response = await fetchImpl(url, {
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
    }

    // 免登录 guest 流程：Chromium 栈（net.fetch；Cookie 属受禁请求头，
    // 无法经 net.fetch 显式携带，但 guest 流程本就不需要）
    const targetUrl = url === X_HOME_URL ? 'https://x.com/' : url;
    const isApiCall = targetUrl.startsWith('https://x.com/i/api/');
    for (let attempt = 0; attempt < 2; attempt++) {
      const headers = isApiCall
        ? {
            'User-Agent': X_BROWSER_UA,
            'Accept': '*/*',
            'Authorization': `Bearer ${X_BEARER_TOKEN}`,
            'x-guest-token': await getXGuestToken(attempt > 0),
            'X-Twitter-Active-User': 'yes',
          }
        : {
            'User-Agent': X_BROWSER_UA,
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          };
      const response = await net.fetch(targetUrl, {
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
      if (response.ok) {
        const body = await response.text();
        return { success: true, body };
      }
      // guest token 可能过期/被吊销：API 请求 403/401 时强制刷新一次再试
      if (isApiCall && (response.status === 403 || response.status === 401) && attempt === 0) {
        continue;
      }
      return { success: false, error: `x.com responded ${response.status}` };
    }
    return { success: false, error: 'x.com responded 403' };
  } catch (error) {
    // undici 的网络层失败统一是 "fetch failed"，真实原因在 cause 链上
    return { success: false, error: summarizeFetchError(error).message };
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
let pluginMarketplace = null;

// 页面 Bridge 的系统输出操作（V1.4）：写入剪贴板与“宿主下载”。实现只在
// 主进程可用，经 capabilityRouter 的权限检查后调用；保存位置始终由用户在
// 原生对话框中确认，与 Release Asset 下载一致。
const pluginHostOperations = {
  clipboardWrite({ text }) {
    clipboard.writeText(text);
    return null;
  },
  clipboardWriteImage({ buffer }) {
    const image = nativeImage.createFromBuffer(buffer);
    if (image.isEmpty()) {
      throw Object.assign(new Error('Clipboard image payload is invalid'), { code: 'PLUGIN_CLIPBOARD_IMAGE_INVALID' });
    }
    clipboard.writeImage(image);
    return null;
  },
  async saveFile({ fileName, buffer }) {
    // 插件只提供建议名：去掉路径分隔与控制字符，扩展名缺失时补 .png。
    // 最终落盘位置仍由用户在原生对话框中确认，与 Release Asset 下载一致。
    const suggested = path.basename(typeof fileName === 'string' ? fileName : '')
      .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_');
    const safeName = suggested && suggested !== '.' ? suggested : 'plugin-export';
    const defaultPath = path.extname(safeName) ? safeName : `${safeName}.png`;
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath,
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, buffer);
    // 不写剪贴板：本操作只校验 downloads:create，写剪贴板会绕过 clipboard:write。
    return { fileName: path.basename(result.filePath) };
  },
};

function getPluginManager() {
  if (!pluginManager) {
    pluginManager = createPluginManager({
      pluginsRoot: path.join(app.getPath('userData'), 'plugins'),
      hostOperations: pluginHostOperations,
      // 插件 capability log 镜像：写入插件自身日志文件的同时进诊断日志
      logMirror: (entry) => diagLog.record(entry),
    });
  }
  return pluginManager;
}

// 插件市场（自助插件源）：源列表与目录缓存在主进程维护，安装复用 pluginManager。
function getPluginMarketplace() {
  if (!pluginMarketplace) {
    pluginMarketplace = createPluginMarketplace({
      statePath: path.join(app.getPath('userData'), 'plugins-marketplace.json'),
      stagingRoot: path.join(app.getPath('userData'), 'plugin-staging'),
      fetchImpl: (url, options) => net.fetch(url, options),
      pluginManager: getPluginManager(),
    });
  }
  return pluginMarketplace;
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
// 插件市场（自助插件源）：源的增删改查与遍历、从源安装/更新插件。
// 安装动作下载的是整个插件目录，复用 pluginManager 的校验与落位，不在渲染进程沾手文件。
ipcMain.handle('plugins:marketplace:getState', async () => getPluginMarketplace().getState());
ipcMain.handle('plugins:marketplace:addSource', async (_event, input) =>
  getPluginMarketplace().addSource(input)
);
ipcMain.handle('plugins:marketplace:updateSource', async (_event, input) =>
  getPluginMarketplace().updateSource(input)
);
ipcMain.handle('plugins:marketplace:removeSource', async (_event, input) =>
  getPluginMarketplace().removeSource(input)
);
ipcMain.handle('plugins:marketplace:refresh', async (_event, options) =>
  getPluginMarketplace().refresh(options)
);
ipcMain.handle('plugins:marketplace:install', async (_event, request) =>
  getPluginMarketplace().install(request)
);
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

// ── Diagnostics IPC (append/flush/read/exportBundle) ──
// The renderer bridge batches entries (2s / 32 items) and piggybacks its
// current debug-mode flag so main-process capture level follows the same
// switch with zero extra IPC round-trips.

function applyDiagnosticsPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (typeof payload.debugMode === 'boolean') diagDebug = payload.debugMode;
  return payload.entries;
}

ipcMain.handle('diagnostics:append', (_event, payload) => {
  try {
    const entries = applyDiagnosticsPayload(payload);
    if (entries === null) return { success: false, error: 'invalid payload' };
    return diagLog.ingestRenderer(entries);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

// One-way shutdown path: pagehide/beforeunload flush before the page dies.
ipcMain.on('diagnostics:flush', (_event, payload) => {
  try {
    const entries = applyDiagnosticsPayload(payload);
    if (entries !== null) diagLog.ingestRenderer(entries);
  } catch { /* shutdown must never throw */ }
});

ipcMain.handle('diagnostics:read', async (_event, options) => {
  try {
    const since = typeof options?.since === 'string' ? options.since : undefined;
    const limit = Number.isFinite(options?.limit)
      ? Math.min(Math.max(Math.trunc(options.limit), 1), 5000)
      : 2000;
    const main = await diagLog.readTail({ since, sources: ['main'], limit });
    return { success: true, main, plugins: readPluginLogTails({ limit }) };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error), main: [], plugins: [] };
  }
});

ipcMain.handle('diagnostics:exportBundle', async (_event, payload) => exportDiagnosticsBundle(payload));

/** Read the tail of every plugin's own JSONL log (<userData>/plugin-logs). */
function readPluginLogTails({ limit = 1000 } = {}) {
  const logsRoot = path.join(app.getPath('userData'), 'plugin-logs');
  const result = [];
  try {
    const names = fs.readdirSync(logsRoot)
      .filter((name) => name.endsWith('.log'))
      .sort()
      .slice(0, 100);
    for (const name of names) {
      const pluginId = name.slice(0, -4);
      let content = '';
      try { content = fs.readFileSync(path.join(logsRoot, name), 'utf8'); } catch { continue; }
      const lines = content.split('\n').filter(Boolean).slice(-200);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          result.push({
            id: `${name}-${result.length}`,
            timestamp: typeof parsed.at === 'string' ? parsed.at : new Date(0).toISOString(),
            level: parsed.level === 'warning' ? 'warn' : (['debug', 'info', 'warn', 'error'].includes(parsed.level) ? parsed.level : 'info'),
            module: pluginId,
            message: typeof parsed.message === 'string' ? parsed.message : '',
            ...(parsed.metadata === undefined ? {} : { data: parsed.metadata }),
            source: 'plugins',
          });
        } catch { /* torn line after rotation — skip */ }
      }
    }
  } catch { /* no plugin logs yet */ }
  return result.slice(-limit);
}

/**
 * Halve-then-drop the oldest records (by timestamp, across every source)
 * until the SERIALIZED (indent=2, same as the writeFile) bundle fits the
 * budget. Returns null when even a metadata-only bundle would exceed the
 * cap — the caller must then fail the export instead of writing a file.
 */
function fitBundleSize(bundle, maxBytes) {
  const serializedLength = (obj) => Buffer.byteLength(JSON.stringify(obj, null, 2), 'utf8');
  if (serializedLength(bundle) <= maxBytes) return bundle;
  const out = { ...bundle, truncated: true, sources: { ...bundle.sources } };
  const lists = [
    { host: out, key: 'frontendLogs' },
    { host: out, key: 'backendLogs' },
    { host: out.sources, key: 'main' },
    { host: out.sources, key: 'network' },
    { host: out.sources, key: 'plugins' },
  ];
  for (;;) {
    if (serializedLength(out) <= maxBytes) return out;
    // Find the source holding the globally oldest record and drop its
    // oldest eighth (at least one entry). Each array is chronological, so
    // prefix drops mirror "drop oldest first" while keeping this O(log n)
    // re-serializations instead of one per record.
    let target = -1;
    let targetTs = null;
    lists.forEach(({ host, key }, li) => {
      const arr = Array.isArray(host[key]) ? host[key] : [];
      if (arr.length === 0) return;
      const ts = typeof arr[0]?.timestamp === 'string' ? arr[0].timestamp : '';
      if (targetTs === null || ts < targetTs) {
        targetTs = ts;
        target = li;
      }
    });
    if (target < 0) return null;
    const { host, key } = lists[target];
    const arr = host[key];
    host[key] = arr.slice(Math.max(1, Math.floor(arr.length / 8)));
  }
}

/**
 * Export-side trust boundary: the renderer may submit networkEntries or
 * frontendLogs directly, so string values that look like embedded JSON
 * (e.g. a captured request body containing X auth cookies) are parsed and
 * re-sanitized as objects before they can land in the exported file.
 */
function deepRedactEmbeddedJson(value, depth = 0) {
  if (depth > 6) return value;
  if (typeof value === 'string') {
    const trimmed = value.length <= 256 * 1024 ? value.trim() : '';
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object') {
          const sanitized = redact.sanitizeForLog(parsed);
          return JSON.stringify(sanitized);
        }
      } catch {
        // Not JSON — leave the string as-is (already sanitized upstream).
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => deepRedactEmbeddedJson(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepRedactEmbeddedJson(v, depth + 1);
    return out;
  }
  return value;
}

function redactExportedEntries(entries) {
  return entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry;
    if (entry.data === undefined) return entry;
    return { ...entry, data: deepRedactEmbeddedJson(entry.data) };
  });
}

async function exportDiagnosticsBundle(payload = {}) {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'main window unavailable' };
    const windowHours = payload.windowHours === null || payload.windowHours === undefined
      ? null
      : Math.min(Math.max(Math.trunc(Number(payload.windowHours) || 24), 1), 168);
    const since = windowHours ? new Date(Date.now() - windowHours * 3_600_000).toISOString() : undefined;
    const capEntries = (value, max) => (Array.isArray(value) ? value.filter((e) => (
      e
      && typeof e === 'object'
      && (!since || (typeof e.timestamp === 'string' && e.timestamp >= since))
    )) : []).slice(-max);
    const mainLogs = await diagLog.readTail({ since, limit: 2000 });
    const bundle = fitBundleSize({
      format: 'github-stars-manager-logs-v2',
      exportDate: new Date().toISOString(),
      appVersion: app.getVersion(),
      sessionId: diagLog.sessionId,
      environment: buildSystemInfo({
        os,
        versions: process.versions,
        appVersion: app.getVersion(),
        sessionId: diagLog.sessionId,
        proxyConfig: loadProxyConfig(),
        plugins: await listPluginsForSnapshot(),
        renderer: payload.environment && typeof payload.environment === 'object' ? payload.environment : {},
      }),
      sanitizationNote: typeof payload.sanitizationNote === 'string'
        ? payload.sanitizationNote
        : 'Tokens, API keys, passwords and emails are masked before writing.',
      frontendLogs: redactExportedEntries(capEntries(payload.frontendLogs, 2000)),
      backendLogs: redactExportedEntries(capEntries(payload.backendLogs, 2000)),
      sources: {
        main: mainLogs,
        network: redactExportedEntries(capEntries(payload.networkEntries, 1000)),
        plugins: capEntries(readPluginLogTails({ limit: 1500 }), 1500),
      },
    }, 5 * 1024 * 1024);
    if (!bundle) {
      return { success: false, error: 'diagnostics bundle exceeds size budget even after truncation' };
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `github-stars-manager-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (result.canceled || !result.filePath) return { success: false, canceled: true };
    await fs.promises.writeFile(result.filePath, JSON.stringify(bundle, null, 2), 'utf8');
    diagLog.record({
      level: 'info',
      module: 'electron.diagnostics',
      message: 'Diagnostics bundle exported',
      data: { windowHours },
    });
    return { success: true, filePath: result.filePath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Best-effort plugin manifest summary for snapshots; never throws. */
async function listPluginsForSnapshot() {
  try {
    const result = await getPluginManager().list();
    return (result?.plugins ?? []).map((plugin) => ({
      id: plugin?.manifest?.id,
      version: plugin?.manifest?.version,
      enabled: !!plugin?.enabled,
    }));
  } catch {
    return [];
  }
}

// ── Chromium-stack request observer (zero call-site coverage for net.fetch,
// and every renderer/Chromium request through the default session) ──
const DIAGNOSTICS_WEBREQUEST_FILTER = { urls: ['http://*/*', 'https://*/*'] };

function isLoopbackHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function shouldSkipDiagnosticsUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true;
    if (!isLoopbackHost(url.hostname)) return false;
    // MCP 本地服务是入站只读接口，不属于对外请求
    if (mcpConfig.enabled && url.port === String(mcpConfig.port)) return true;
    // Dev 模式跳过 Vite 开发服务器自身流量
    if (isDev && url.port === '5173') return true;
    return false;
  } catch {
    return true;
  }
}

function flattenHeaderRecord(headers) {
  const flat = {};
  for (const [key, value] of Object.entries(headers || {})) {
    flat[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return flat;
}

function attachDiagnosticsWebRequestObserver(targetSession) {
  const inflight = new Map();
  const rememberRequest = (details) => {
    if (shouldSkipDiagnosticsUrl(details.url)) return;
    if (inflight.size >= 1000) {
      const oldest = inflight.keys().next().value;
      inflight.delete(oldest);
    }
    inflight.set(details.id, {
      url: details.url,
      method: details.method,
      startedAt: Date.now(),
      redirects: 0,
      via: details.webContentsId ? 'renderer' : 'main',
      resourceType: details.resourceType,
    });
  };
  // ⚠️ onBeforeRequest is a BLOCKING listener: on Electron 44 a listener that
  // never calls its callback hangs EVERY matching request until the caller's
  // own timeout aborts it (net::ERR_ABORTED) — empirically verified. The
  // callback form with an immediate callback({}) is required, even though the
  // bookkeeping itself is synchronous.
  targetSession.webRequest.onBeforeRequest(DIAGNOSTICS_WEBREQUEST_FILTER, (details, callback) => {
    try {
      rememberRequest(details);
    } finally {
      callback({});
    }
  });
  targetSession.webRequest.onBeforeRedirect(DIAGNOSTICS_WEBREQUEST_FILTER, (details) => {
    const pending = inflight.get(details.id);
    if (pending) pending.redirects += 1;
  });
  targetSession.webRequest.onCompleted(DIAGNOSTICS_WEBREQUEST_FILTER, (details) => {
    const pending = inflight.get(details.id) ?? {
      url: details.url,
      method: details.method,
      startedAt: Date.now(),
      redirects: 0,
      via: details.webContentsId ? 'renderer' : 'main',
      resourceType: details.resourceType,
    };
    inflight.delete(details.id);
    if (shouldSkipDiagnosticsUrl(details.url)) return;
    const failed = details.statusCode >= 400;
    if (!diagDebug && !failed) return;
    try {
      diagLog.record({
        level: failed ? 'warn' : 'debug',
        module: 'electron.webRequest',
        message: `${pending.method} ${redact.redactUrl(pending.url)} → ${details.statusCode}`,
        data: {
          url: redact.redactUrl(pending.url),
          method: pending.method,
          status: details.statusCode,
          durationMs: Date.now() - pending.startedAt,
          redirects: pending.redirects,
          via: pending.via,
          resourceType: pending.resourceType,
          fromCache: !!details.fromCache,
          ...(diagDebug && details.responseHeaders
            ? { responseHeaders: redact.sanitizeForLog({ headers: flattenHeaderRecord(details.responseHeaders) }).headers }
            : {}),
        },
      });
    } catch { /* observer must never break the request path */ }
  });
  targetSession.webRequest.onErrorOccurred(DIAGNOSTICS_WEBREQUEST_FILTER, (details) => {
    const pending = inflight.get(details.id);
    inflight.delete(details.id);
    if (shouldSkipDiagnosticsUrl(details.url)) return;
    try {
      // Same level policy as netTap: user aborts (net::ERR_ABORTED) are
      // normal control flow → info; transient network conditions → warn.
      const netLevel = diagTap.classifyNetErrorCode(details.error);
      diagLog.record({
        level: netLevel,
        module: 'electron.webRequest',
        message: `${details.method} ${redact.redactUrl(details.url)} ${netLevel === 'info' ? 'aborted' : 'failed'}`,
        data: {
          url: redact.redactUrl(details.url),
          method: details.method,
          error: details.error,
          // details.timestamp is the event clock, not an epoch offset — only
          // the remembered start time yields a meaningful duration.
          ...(pending ? { durationMs: Date.now() - pending.startedAt } : {}),
          via: details.webContentsId ? 'renderer' : 'main',
          resourceType: details.resourceType,
        },
      });
    } catch { /* observer must never break the request path */ }
  });
}


if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    restoreMainWindow();
  });
}

app.whenReady().then(() => {
  // Chromium 栈观察者：覆盖全部 net.fetch（插件市场/注册表/资源下载/X/Telegram/
  // WebDAV 回退栈）与渲染进程经 session 发出的请求；webSearch.js 的 node:https
  // 既不经 undici 也不经 Chromium，由该文件内手动补记（setNetworkRecorder）。
  attachDiagnosticsWebRequestObserver(session.defaultSession);
  setNetworkRecorder((entry) => diagLog.record(entry));
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
  // Startup environment snapshot (previously absent from the journal).
  // The snapshot's own sessionId field is dropped: the journal entry carries
  // sessionId at the top level, and a UUID value inside `data` would trip the
  // sanitizer's generic-secret pattern.
  void listPluginsForSnapshot().then((plugins) => {
    const snapshot = buildSystemInfo({
      os,
      versions: process.versions,
      appVersion: app.getVersion(),
      sessionId: diagLog.sessionId,
      proxyConfig: savedProxy,
      plugins,
      routeMode: null,
    });
    delete snapshot.sessionId;
    diagLog.record({
      level: 'info',
      module: 'electron.system',
      message: 'Session started',
      data: snapshot,
    });
  });
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
  // Synchronous final drain: journal writes are appendFileSync, so this
  // completes instantly with nothing left in flight — the quit path stays
  // free of async waiting (and of the hang risks that come with it).
  try {
    diagLog.flushSync();
  } catch { /* quit must never be blocked by diagnostics */ }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
