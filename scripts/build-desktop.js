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
const isDev = process.env.NODE_ENV === 'development';

let mainWindow;
let mcpModule = null;

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
      // Disable webSecurity to allow cross-origin requests to local services (aria2 RPC, etc.)
      // Safe for desktop app: only loads local files, no arbitrary web content
      webSecurity: false
    },
    icon: path.join(__dirname, '../dist/icon.svg'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false
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
    
    // 设置应用菜单
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
            { role: 'selectall' }
          ]
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
      Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    }
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

app.whenReady().then(async () => {
  createWindow();

  // 加载内置 MCP 服务模块（仅当用户在设置中启用 MCP 时才会真正监听端口）
  try {
    mcpModule = await import('./mcpServer.mjs');
    mcpModule.setSemanticHandler(async (query, topK) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (!win) return [];
      try {
        return await win.webContents.executeJavaScript(
          'window.__gsmMcpSemanticSearch ? await window.__gsmMcpSemanticSearch(' +
            JSON.stringify(query) + ', ' + JSON.stringify(topK) + ') : []'
        );
      } catch {
        return [];
      }
    });

    ipcMain.handle('mcp:start', async (_e, cfg) => {
      try {
        await mcpModule.startMcp(cfg);
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    });
    ipcMain.handle('mcp:stop', async () => {
      try { await mcpModule.stopMcp(); } catch { /* ignore */ }
    });
    ipcMain.on('mcp:snapshot', (_e, snapshot) => {
      mcpModule?.setSnapshot(snapshot);
    });
  } catch (e) {
    console.error('[GSM] Failed to load MCP module:', e);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 安全设置
app.on('web-contents-created', (event, contents) => {
  contents.on('new-window', (event, navigationUrl) => {
    event.preventDefault();
    shell.openExternal(navigationUrl);
  });
});
`;

fs.writeFileSync(path.join(electronDir, 'main.js'), mainJs);

// 4. 创建 MCP 服务模块（自包含，使用官方 SDK + zod）
const mcpServerMjs = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import http from 'node:http';

let snapshot = { repositories: [], releases: [], categories: [], vectorEnabled: false };
let authToken = '';
let httpServer = null;
let semanticHandler = null;

export function setSnapshot(s) {
  if (s && typeof s === 'object') snapshot = s;
}

export function setSemanticHandler(fn) {
  semanticHandler = fn;
}

function json(content) {
  return { content: [{ type: 'text', text: typeof content === 'string' ? content : JSON.stringify(content, null, 2) }] };
}

function extractBearer(req) {
  const h = req.headers['authorization'] || '';
  return typeof h === 'string' && h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

// Constant-time comparison (matches the existing API auth pattern)
function tokenMatches(provided, expected) {
  const a = Buffer.from(provided || '');
  const b = Buffer.from(expected || '');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function registerTools(server) {
  server.registerTool(
    'search_repositories',
    {
      description: 'Search the user\\'s starred GitHub repositories stored by GitHub Stars Manager. Supports keyword query plus filters by tags, languages, categories, star range and AI-analyzed status.',
      inputSchema: {
        query: z.string().optional(),
        tags: z.array(z.string()).optional(),
        languages: z.array(z.string()).optional(),
        categories: z.array(z.string()).optional(),
        minStars: z.number().optional(),
        maxStars: z.number().optional(),
        isAnalyzed: z.boolean().optional(),
        sortBy: z.enum(['stars', 'updated', 'name', 'starred']).optional(),
        sortOrder: z.enum(['desc', 'asc']).optional(),
        limit: z.number().optional()
      }
    },
    async (args) => json(searchRepos(args))
  );

  server.registerTool(
    'get_repository',
    { description: 'Get full detail of a starred repository by full_name (owner/repo).', inputSchema: { fullName: z.string() } },
    async (args) => {
      const r = snapshot.repositories.find((x) => x.fullName === args.fullName);
      return r ? json(r) : json({ error: 'Repository not found: ' + args.fullName });
    }
  );

  server.registerTool(
    'get_repository_comments',
    { description: 'Get user-authored notes / custom description of a starred repository by full_name.', inputSchema: { fullName: z.string() } },
    async (args) => {
      const r = snapshot.repositories.find((x) => x.fullName === args.fullName);
      if (!r) return json({ error: 'Repository not found: ' + args.fullName });
      return json({ fullName: r.fullName, customDescription: r.customDescription, notes: r.customDescription });
    }
  );

  server.registerTool(
    'list_categories',
    { description: 'List categories with repository counts.', inputSchema: {} },
    async () => json(snapshot.categories || [])
  );

  server.registerTool(
    'list_tags',
    { description: 'List the most used tags across starred repositories with counts.', inputSchema: {} },
    async () => json(topTags())
  );

  server.registerTool(
    'list_releases',
    { description: 'List recent releases of starred repositories, optionally filtered by publish date (ISO).', inputSchema: { since: z.string().optional(), limit: z.number().optional() } },
    async (args) => {
      let rels = snapshot.releases || [];
      if (args.since) rels = rels.filter((r) => r.publishedAt && r.publishedAt >= args.since);
      return json(rels.slice(0, Math.min(args.limit || 50, 200)));
    }
  );

  server.registerTool(
    'get_stats',
    { description: 'Aggregate statistics of starred repositories.', inputSchema: {} },
    async () => json(getStats())
  );

  server.registerTool(
    'semantic_search_repositories',
    { description: 'Semantic / natural-language search over starred repositories using the configured vector index.', inputSchema: { query: z.string(), topK: z.number().optional() } },
    async (args) => {
      if (!snapshot.vectorEnabled || !semanticHandler) {
        return json({ disabled: true, message: 'Vector search is not configured in GitHub Stars Manager.' });
      }
      try {
        const results = await semanticHandler(args.query, args.topK || 10);
        return json(results);
      } catch {
        return json([]);
      }
    }
  );
}

function searchRepos(args) {
  let results = snapshot.repositories || [];
  const q = args.query ? args.query.trim().toLowerCase() : '';
  if (q) {
    results = results.filter((r) =>
      [r.fullName, r.description, r.customDescription, (r.aiSummary || '')].filter(Boolean).some((t) => String(t).toLowerCase().includes(q)) ||
      [...(r.topics || []), ...(r.customTags || []), ...(r.aiTags || [])].some((t) => String(t).toLowerCase().includes(q))
    );
  }
  if (args.languages && args.languages.length) results = results.filter((r) => r.language && args.languages.includes(r.language));
  if (args.categories && args.categories.length) results = results.filter((r) => r.category && args.categories.includes(r.category));
  if (typeof args.minStars === 'number') results = results.filter((r) => r.stars >= args.minStars);
  if (typeof args.maxStars === 'number') results = results.filter((r) => r.stars <= args.maxStars);
  if (args.isAnalyzed !== undefined) results = results.filter((r) => r.analyzed === args.isAnalyzed);
  if (args.tags && args.tags.length) {
    const tags = args.tags.map((t) => t.toLowerCase());
    results = results.filter((r) => [...(r.customTags || []), ...(r.aiTags || []), ...(r.topics || [])].some((t) => tags.includes(String(t).toLowerCase())));
  }
  const sortBy = args.sortBy || 'stars';
  const dir = args.sortOrder === 'asc' ? 1 : -1;
  results = [...results].sort((a, b) => {
    const av = sortBy === 'name' ? a.fullName : sortBy === 'updated' ? a.updatedAt || '' : sortBy === 'starred' ? a.starredAt || '' : a.stars;
    const bv = sortBy === 'name' ? b.fullName : sortBy === 'updated' ? b.updatedAt || '' : sortBy === 'starred' ? b.starredAt || '' : b.stars;
    return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
  });
  return results.slice(0, Math.min(args.limit || 50, 200));
}

function topTags() {
  const tally = new Map();
  for (const r of snapshot.repositories || []) {
    for (const t of [...(r.customTags || []), ...(r.aiTags || []), ...(r.topics || [])]) {
      if (!t) continue;
      tally.set(t, (tally.get(t) || 0) + 1);
    }
  }
  return [...tally.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count).slice(0, 100);
}

function getStats() {
  const repos = snapshot.repositories || [];
  const byLanguage = {};
  const byCategory = {};
  for (const r of repos) {
    if (r.language) byLanguage[r.language] = (byLanguage[r.language] || 0) + 1;
    if (r.category) byCategory[r.category] = (byCategory[r.category] || 0) + 1;
  }
  return { totalRepositories: repos.length, analyzedCount: repos.filter((r) => r.analyzed).length, byLanguage, byCategory, topTags: topTags().slice(0, 20) };
}

async function handleRequest(server, transport, req, res, body) {
  if (!tokenMatches(extractBearer(req), authToken)) {
    res.statusCode = 401;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return;
  }
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}

export async function startMcp({ port, token }) {
  authToken = token || '';
  if (!authToken) throw new Error('MCP token is required');
  if (httpServer) await stopMcp();

  const server = new McpServer({ name: 'github-stars-manager', version: '0.7.0' }, { capabilities: { tools: {} } });
  registerTools(server);

  const sseTransports = new Map();
  const httpServerInstance = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = undefined;
    if (req.method === 'POST' || req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { body = undefined; }
    }

    try {
      if (url.pathname === '/mcp') {
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => transport.close().catch(() => undefined));
        await handleRequest(server, transport, req, res, body);
      } else if (url.pathname === '/mcp/sse' && req.method === 'GET') {
        if (!tokenMatches(extractBearer(req), authToken)) {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const transport = new SSEServerTransport('/mcp/sse/messages', res);
        sseTransports.set(transport.sessionId, transport);
        res.on('close', () => sseTransports.delete(transport.sessionId));
        await server.connect(transport);
        await transport.start();
      } else if (url.pathname === '/mcp/sse/messages' && req.method === 'POST') {
        if (!tokenMatches(extractBearer(req), authToken)) {
          res.statusCode = 401;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const sid = url.searchParams.get('sessionId');
        const transport = sid ? sseTransports.get(sid) : undefined;
        if (!transport) { res.statusCode = 404; res.end(JSON.stringify({ error: 'unknown session' })); return; }
        await transport.handlePostMessage(req, res, body);
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
      }
    } catch (e) {
      if (!res.headersSent) { res.statusCode = 500; res.end(JSON.stringify({ error: 'internal error' })); }
    }
  });

  await new Promise((resolve) => httpServerInstance.listen(port, '127.0.0.1', resolve));
  httpServer = httpServerInstance;
  console.log('[GSM] MCP server listening on 127.0.0.1:' + port + '/mcp');
}

export async function stopMcp() {
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    httpServer = null;
  }
}
`;

fs.writeFileSync(path.join(electronDir, 'mcpServer.mjs'), mcpServerMjs);

// 5. 创建Electron package.json（含 MCP 运行所需依赖）
const electronPackageJson = {
  name: 'github-stars-manager-desktop',
  version: '1.0.0',
  description: 'GitHub Stars Manager Desktop App',
  main: 'main.js',
  type: 'commonjs',
  author: 'GitHub Stars Manager',
  license: 'MIT',
  dependencies: {
    '@modelcontextprotocol/sdk': '^1.29.0',
    zod: '^3.23.0'
  }
};

fs.writeFileSync(
  path.join(electronDir, 'package.json'),
  JSON.stringify(electronPackageJson, null, 2)
);

// 6. 安装依赖（含 MCP SDK 与 zod，构建期完成，用户无感）
console.log('📥 安装Electron依赖...');
try {
  execSync('npm install', { stdio: 'inherit', cwd: electronDir });
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
