const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const { createMcpLocalServer } = require('./mcpLocalServer');

const isDev = process.env.NODE_ENV === 'development';

/** @type {BrowserWindow | null} */
let mainWindow = null;

// Proxy state (optional; may be extended later)
let proxyConfig = { enabled: false, type: 'http', host: '', port: 7890 };

// MCP local state
let mcpConfig = {
  enabled: false,
  host: '127.0.0.1',
  port: 3927,
  token: '',
};
/** @type {object | null} */
let mcpSnapshot = null;

const mcpServer = createMcpLocalServer(() => ({
  config: mcpConfig,
  snapshot: mcpSnapshot,
}));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      // Disable webSecurity for local services (aria2 RPC, etc.)
      webSecurity: false,
    },
    icon: path.join(__dirname, '../dist/icon.svg'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (process.platform === 'darwin') {
      const template = [
        {
          label: 'GitHub Stars Manager',
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideothers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' },
          ],
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
            { role: 'selectAll' },
          ],
        },
        {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        },
        {
          label: 'Window',
          submenu: [{ role: 'minimize' }, { role: 'close' }],
        },
      ];
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC — proxy stubs (keep API surface for Network panel)
ipcMain.handle('proxy:set', async (_e, config) => {
  proxyConfig = { ...proxyConfig, ...config };
  return { success: true };
});
ipcMain.handle('proxy:get', async () => proxyConfig);
ipcMain.handle('proxy:test', async () => ({
  success: false,
  error: 'Proxy test not implemented in this build',
}));

// IPC — MCP
ipcMain.handle('mcp:setConfig', async (_e, config) => {
  const rawHost =
    typeof config?.host === 'string' && config.host.trim() ? config.host.trim() : '127.0.0.1';
  // Never allow non-loopback binds for the desktop MCP token surface
  const host =
    rawHost === '127.0.0.1' || rawHost === 'localhost' || rawHost === '::1'
      ? rawHost === 'localhost'
        ? '127.0.0.1'
        : rawHost
      : '127.0.0.1';
  mcpConfig = {
    enabled: !!config?.enabled,
    host,
    port:
      typeof config?.port === 'number' && config.port >= 1 && config.port <= 65535
        ? config.port
        : 3927,
    token: typeof config?.token === 'string' ? config.token : '',
  };
  if (!mcpConfig.enabled) {
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  void mcpServer.stop();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void mcpServer.stop();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});
