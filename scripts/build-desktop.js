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
const required = ['main.js', 'preload.js', 'mcpLocalServer.js', 'package.json'];
for (const file of required) {
  const p = path.join(electronDir, file);
  if (!fs.existsSync(p)) {
    console.error(`❌ Missing required Electron file: electron/${file}`);
    process.exit(1);
  }
}
console.log('⚡ 使用已提交的 electron/ 源码（含 MCP 与 preload）');

// 3. 安装Electron依赖
console.log('📥 安装Electron依赖...');
try {
  execSync('npm install --save-dev electron electron-builder', { stdio: 'inherit' });
} catch (error) {
  console.error('安装依赖失败:', error.message);
  process.exit(1);
}

// 4. 构建应用
console.log('🔨 构建桌面应用...');
try {
  execSync('npx electron-builder', { stdio: 'inherit' });
  console.log('✅ 桌面应用构建完成！');
  console.log('📁 构建文件位于 release/ 目录');
} catch (error) {
  console.error('构建失败:', error.message);
  process.exit(1);
}
