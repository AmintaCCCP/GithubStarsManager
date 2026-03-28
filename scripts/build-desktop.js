#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 开始构建桌面应用...');

// 1. 构建Web应用
console.log('📦 构建Web应用...');
execSync('npm run build', { stdio: 'inherit' });

// 2. 创建Electron目录和文件
console.log('⚡ 设置Electron环境...');
const electronDir = path.join(__dirname, '../electron');
if (!fs.existsSync(electronDir)) {
  fs.mkdirSync(electronDir, { recursive: true });
}

// 3. 创建主进程文件
const mainJs = `
const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const isDev = process.env.NODE_ENV === 'development';

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
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, '../dist/icon.svg'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
  });

  // 加载应用
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 处理外部链接
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 获取快照文件路径（固定位置）
function getSnapshotPath() {
  const appDataPath = app.getPath('userData');
  return path.join(appDataPath, 'github-stars.snapshot.json');
}

// 写快照文件
ipcMain.handle('write-snapshot', async (event, data) => {
  try {
    const snapshotPath = getSnapshotPath();
    const dir = path.dirname(snapshotPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
    fs.writeFileSync(snapshotPath, content, 'utf8');
    return { ok: true, path: snapshotPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 读快照文件
ipcMain.handle('read-snapshot', async () => {
  try {
    const snapshotPath = getSnapshotPath();
    if (!fs.existsSync(snapshotPath)) {
      return { ok: false, error: 'Snapshot file not found', path: snapshotPath };
    }
    const content = fs.readFileSync(snapshotPath, 'utf8');
    return { ok: true, data: JSON.parse(content), path: snapshotPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// 获取快照路径
ipcMain.handle('get-snapshot-path', async () => {
  return getSnapshotPath();
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});
`;

fs.writeFileSync(path.join(electronDir, 'main.js'), mainJs);

// 4. 创建 preload.js（安全桥接）
const preloadJs = `
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  writeSnapshot: (data) => ipcRenderer.invoke('write-snapshot', data),
  readSnapshot: () => ipcRenderer.invoke('read-snapshot'),
  getSnapshotPath: () => ipcRenderer.invoke('get-snapshot-path'),
});
`;

fs.writeFileSync(path.join(electronDir, 'preload.js'), preloadJs);

// 5. 创建Electron package.json
const electronPackageJson = {
  name: 'github-stars-manager-desktop',
  version: '1.0.0',
  description: 'GitHub Stars Manager Desktop App',
  main: 'main.js',
  author: 'GitHub Stars Manager',
  license: 'MIT',
};

fs.writeFileSync(
  path.join(electronDir, 'package.json'),
  JSON.stringify(electronPackageJson, null, 2)
);

// 6. 安装Electron依赖
console.log('📥 安装Electron依赖...');
try {
  execSync('npm install --save-dev electron electron-builder', { stdio: 'inherit' });
} catch (error) {
  console.error('安装依赖失败:', error.message);
  process.exit(1);
}

// 7. 构建应用
console.log('🔨 构建桌面应用...');
try {
  execSync('npx electron-builder', { stdio: 'inherit' });
  console.log('✅ 桌面应用构建完成！');
  console.log('📁 构建文件位于 release/ 目录');
} catch (error) {
  console.error('构建失败:', error.message);
  process.exit(1);
}
