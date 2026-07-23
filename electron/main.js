const { app, BrowserWindow, Menu, shell, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';
const { createMcpLocalServer } = require('./mcpLocalServer');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      // Production: keep same-origin + block mixed content. Local files load via loadFile.
      // Dev may relax for Vite HMR / local services if needed later — keep secure by default.
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: isDev,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../build/icon.png'),
    titleBarStyle: 'default', // 使用默认标题栏，避免重叠问题
    show: false,
    autoHideMenuBar: false, // 显示菜单栏，确保编辑快捷键行为一致
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
    // 页面加载完成后显示窗口
    if (!mainWindow.isVisible()) {
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
    mainWindow.show();
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
    await mainWindow.webContents.session.setProxy({ proxyRules: 'direct://' });
    console.log('[Proxy] Disabled, using direct connection');
  }
}

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

app.whenReady().then(() => {
  createWindow();
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
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  void mcpServer.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});