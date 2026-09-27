#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 开始构建桌面应用...');

// 1. 构建Web应用
console.log('📦 构建Web应用...');
execSync('npm run build', { stdio: 'inherit' });

// 2. Electron sources are committed under electron/ (main.js, preload.js, mcpLocalServer.js).
// Do NOT overwrite them with a generated shell — MCP + preload require first-class sources.
const electronDir = path.join(__dirname, '../electron');
const required = ['main.js', 'preload.js', 'mcpLocalServer.js', 'desktopPrefs.js', 'package.json'];
for (const file of required) {
  const p = path.join(electronDir, file);
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing required Electron file: electron/${file}`);
    process.exit(1);
  }
}
// Tray icons (#345) ship inside electron/assets (covered by electron-builder `electron/**`).
// trayTemplate*.png: macOS menu bar template image; tray-black/white*.png: themed monochrome
// for Windows/Linux taskbars; tray-16/32.png: legacy color fallback.
for (const icon of [
  'trayTemplate.png',
  'trayTemplate@2x.png',
  'tray-black.png',
  'tray-black@2x.png',
  'tray-white.png',
  'tray-white@2x.png',
  'tray-16.png',
  'tray-32.png',
]) {
  const p = path.join(electronDir, 'assets', icon);
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing required tray icon: electron/assets/${icon}`);
    process.exit(1);
  }
}
console.log('⚡ 使用已提交的 electron/ 源码（含 MCP 与 preload）');

// 2.5 构建资源图标（与 CI 的 "Prepare build resources" 步骤一致，
// electron-builder 会自动把 PNG 转换为 .ico/.icns）。
const buildDir = path.join(__dirname, '../build');
fs.mkdirSync(buildDir, { recursive: true });
const iconSource = path.join(__dirname, '../assets/icon.png');
if (!fs.existsSync(iconSource)) {
  console.error('❌ Missing source icon: assets/icon.png');
  process.exit(1);
}
fs.copyFileSync(iconSource, path.join(buildDir, 'icon.png'));
fs.copyFileSync(iconSource, path.join(buildDir, 'icon-512x512.png'));

// 3. electron / electron-builder 已固定在 devDependencies（与 CI 共用
// electron-builder.yml 配置），确认工具链就绪即可。
if (!fs.existsSync(path.join(__dirname, '../node_modules/electron-builder/package.json'))) {
  console.error('❌ 缺少 electron-builder，请先运行 npm ci');
  process.exit(1);
}

// 4. 构建应用
console.log('🔨 构建桌面应用...');
try {
  execSync('npx electron-builder --publish=never', { stdio: 'inherit' });
  console.log('✅ 桌面应用构建完成！');
  console.log('📁 构建文件位于 release/ 目录');
} catch (error) {
  console.error('构建失败:', error.message);
  process.exit(1);
}
