#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Electron build process...');

// Check if we're on macOS and handle signing
const isMacOS = process.platform === 'darwin';
const hasSigningCerts = process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD;

if (isMacOS && !hasSigningCerts) {
  console.log('⚠️  No signing certificates found for macOS build');
  console.log('📦 Building unsigned macOS app...');
  
  // Set environment variables to skip signing
  process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
  process.env.CSC_LINK = '';
  process.env.CSC_KEY_PASSWORD = '';
}

// Ensure build directory exists
if (!fs.existsSync('build')) {
  fs.mkdirSync('build', { recursive: true });
  console.log('📁 Created build directory');
}

// Copy icon if it exists
const iconSources = ['assets/icon.png', 'public/icon.png', 'src/assets/icon.png'];
let iconCopied = false;

for (const iconPath of iconSources) {
  if (fs.existsSync(iconPath)) {
    fs.copyFileSync(iconPath, 'build/icon.png');
    console.log(`📷 Copied icon from ${iconPath}`);
    iconCopied = true;
    break;
  }
}

if (!iconCopied) {
  console.log('⚠️  No icon found, using default');
}

try {
  // Debug environment
  console.log('🔍 Environment info:');
  console.log(`Platform: ${process.platform}`);
  console.log(`Architecture: ${process.arch}`);
  console.log(`Node version: ${process.version}`);
  console.log(`CSC_IDENTITY_AUTO_DISCOVERY: ${process.env.CSC_IDENTITY_AUTO_DISCOVERY}`);
  
  // Check required files
  const requiredFiles = ['dist/index.html', 'electron/main.js', 'build/icon.png'];
  for (const file of requiredFiles) {
    if (fs.existsSync(file)) {
      console.log(`✅ Found: ${file}`);
    } else {
      console.log(`⚠️  Missing: ${file}`);
    }
  }
  
  // Run electron-builder
  console.log('🔨 Running electron-builder...');
  execSync('npx electron-builder --publish=never', { 
    stdio: 'inherit',
    env: { ...process.env }
  });
  
  console.log('✅ Electron build completed successfully!');
  
  // List output files
  if (fs.existsSync('release')) {
    console.log('📦 Build artifacts:');
    const files = fs.readdirSync('release');
    files.forEach(file => console.log(`  - ${file}`));
  }
} catch (error) {
  console.error('❌ Electron build failed:', error.message);
  console.error('Stack trace:', error.stack);
  process.exit(1);
}