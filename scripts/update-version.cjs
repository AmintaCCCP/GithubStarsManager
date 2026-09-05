#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(PROJECT_ROOT, 'package.json');
const LOCKFILE_PATH = path.join(PROJECT_ROOT, 'package-lock.json');
const SERVER_PACKAGE_PATH = path.join(PROJECT_ROOT, 'server/package.json');
const SERVER_LOCKFILE_PATH = path.join(PROJECT_ROOT, 'server/package-lock.json');
const VERSION_XML_PATH = path.join(PROJECT_ROOT, 'versions/version-info.xml');
const RELEASE_LOCK_PATH = path.join(PROJECT_ROOT, '.release-version.lock');

/**
 * 根 package.json 是应用版本的唯一来源。
 *
 * 用法：
 *   node scripts/update-version.cjs <changelog...> [--url=downloadUrl]
 *   node scripts/update-version.cjs --sync-lock
 *   node scripts/update-version.cjs --list
 *   node scripts/update-version.cjs --current
 */
function updateVersionInfo() {
  const args = process.argv.slice(2);

  if (args.length === 1) {
    if (args[0] === '--list') {
      listVersions();
      return;
    }
    if (args[0] === '--current') {
      showCurrentVersion();
      return;
    }
    if (args[0] === '--sync-lock') {
      syncLockfileFromRootVersion();
      return;
    }
    if (args[0] === '--help' || args[0] === '-h') {
      showHelp();
      return;
    }
  }

  if (args.length === 0) {
    console.error('❌ 参数不足');
    showHelp();
    process.exitCode = 1;
    return;
  }

  let releaseLock;
  let stagedLockfilePath;
  let stagedServerPackagePath;
  let stagedServerLockfilePath;
  let stagedXmlPath;

  try {
    releaseLock = acquireReleaseLock();
    const releaseArgs = parseReleaseArgs(args);
    if (releaseArgs.changelog.length === 0) {
      throw new Error('至少需要提供一条更新日志');
    }

    const version = readRootPackageVersion();
    validateVersion(version);
    const xmlContext = loadVersionXml(version);
    stagedLockfilePath = stageSyncedPackageLock(LOCKFILE_PATH, version);
    stagedServerPackagePath = stageSyncedServerPackage(version);
    stagedServerLockfilePath = stageSyncedPackageLock(SERVER_LOCKFILE_PATH, version);
    stagedXmlPath = stageVersionXml(xmlContext, version, releaseArgs.changelog, releaseArgs.customDownloadUrl);
    const packageSnapshots = createFileSnapshots([
      LOCKFILE_PATH,
      SERVER_PACKAGE_PATH,
      SERVER_LOCKFILE_PATH,
    ]);

    try {
      fs.renameSync(stagedLockfilePath, LOCKFILE_PATH);
      stagedLockfilePath = null;
      fs.renameSync(stagedServerPackagePath, SERVER_PACKAGE_PATH);
      stagedServerPackagePath = null;
      fs.renameSync(stagedServerLockfilePath, SERVER_LOCKFILE_PATH);
      stagedServerLockfilePath = null;
      verifyRootVersionSync(version);
      fs.renameSync(stagedXmlPath, VERSION_XML_PATH);
      stagedXmlPath = null;
    } catch (error) {
      restoreFileSnapshots(packageSnapshots);
      throw error;
    }

    console.log(`✅ 已根据根 package.json 的版本 v${version} 更新发布元数据`);
    console.log('📝 更新内容:');
    releaseArgs.changelog.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item}`);
    });
    if (releaseArgs.customDownloadUrl !== null) {
      console.log(`🔗 自定义下载链接: ${releaseArgs.customDownloadUrl}`);
    }
    console.log('\n🔄 请记得提交这些更改到 Git 仓库');
  } catch (error) {
    console.error('❌ 更新版本失败:', error.message);
    process.exitCode = 1;
  } finally {
    cleanupStagedFile(stagedLockfilePath);
    cleanupStagedFile(stagedServerPackagePath);
    cleanupStagedFile(stagedServerLockfilePath);
    cleanupStagedFile(stagedXmlPath);
    releaseReleaseLock(releaseLock);
  }
}

function syncLockfileFromRootVersion() {
  let releaseLock;
  let stagedLockfilePath;
  let stagedServerPackagePath;
  let stagedServerLockfilePath;

  try {
    releaseLock = acquireReleaseLock();
    const version = readRootPackageVersion();
    validateVersion(version);
    stagedLockfilePath = stageSyncedPackageLock(LOCKFILE_PATH, version);
    stagedServerPackagePath = stageSyncedServerPackage(version);
    stagedServerLockfilePath = stageSyncedPackageLock(SERVER_LOCKFILE_PATH, version);
    const packageSnapshots = createFileSnapshots([
      LOCKFILE_PATH,
      SERVER_PACKAGE_PATH,
      SERVER_LOCKFILE_PATH,
    ]);
    try {
      fs.renameSync(stagedLockfilePath, LOCKFILE_PATH);
      stagedLockfilePath = null;
      fs.renameSync(stagedServerPackagePath, SERVER_PACKAGE_PATH);
      stagedServerPackagePath = null;
      fs.renameSync(stagedServerLockfilePath, SERVER_LOCKFILE_PATH);
      stagedServerLockfilePath = null;
      verifyRootVersionSync(version);
    } catch (error) {
      restoreFileSnapshots(packageSnapshots);
      throw error;
    }
    console.log(`📦 已将根与 server package-lock.json 同步为根 package.json 的版本 v${version}`);
  } catch (error) {
    console.error('❌ 同步 package-lock.json 失败:', error.message);
    process.exitCode = 1;
  } finally {
    cleanupStagedFile(stagedLockfilePath);
    cleanupStagedFile(stagedServerPackagePath);
    cleanupStagedFile(stagedServerLockfilePath);
    releaseReleaseLock(releaseLock);
  }
}

function acquireReleaseLock() {
  try {
    fs.writeFileSync(
      RELEASE_LOCK_PATH,
      `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 }
    );
    return RELEASE_LOCK_PATH;
  } catch (error) {
    if (error.code === 'EEXIST') {
      throw new Error(`检测到另一个版本同步任务正在运行（${path.basename(RELEASE_LOCK_PATH)}）。确认其结束后再重试`);
    }
    throw error;
  }
}

function releaseReleaseLock(lockPath) {
  if (!lockPath) {
    return;
  }

  try {
    fs.unlinkSync(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`❌ 无法移除版本同步锁 ${path.basename(lockPath)}:`, error.message);
      process.exitCode = 1;
    }
  }
}

function parseReleaseArgs(args) {
  let customDownloadUrl = null;
  let hasCustomDownloadUrl = false;
  const changelog = [];

  for (const arg of args) {
    if (arg.startsWith('--url=')) {
      customDownloadUrl = arg.substring(6);
      hasCustomDownloadUrl = true;
    } else {
      changelog.push(arg);
    }
  }

  if (hasCustomDownloadUrl) {
    let url;
    try {
      url = new URL(customDownloadUrl);
    } catch {
      throw new Error('自定义下载链接必须是合法的绝对 URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('自定义下载链接只允许使用 http 或 https 协议');
    }
  }

  return { changelog, customDownloadUrl };
}

function readRootPackageVersion() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  return packageJson.version;
}

function validateVersion(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error(`根 package.json 的版本无效：${version}`);
  }
}

function loadVersionXml(version) {
  let xmlContent;
  try {
    fs.accessSync(VERSION_XML_PATH, fs.constants.W_OK);
    xmlContent = fs.readFileSync(VERSION_XML_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    fs.accessSync(path.dirname(VERSION_XML_PATH), fs.constants.W_OK);
    xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<versions>\n</versions>\n';
  }

  const closingTagIndex = xmlContent.lastIndexOf('</versions>');
  if (closingTagIndex === -1) {
    throw new Error('versions/version-info.xml 缺少 </versions> 结束标签');
  }

  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const versionPattern = new RegExp(`<number>\\s*${escapedVersion}\\s*</number>`);
  if (versionPattern.test(xmlContent)) {
    throw new Error(`版本 ${version} 已存在于 versions/version-info.xml，拒绝重复发布`);
  }

  return { content: xmlContent, closingTagIndex };
}

function stageSyncedPackageLock(lockfilePath, version) {
  const packageLock = JSON.parse(fs.readFileSync(lockfilePath, 'utf8'));
  if (!packageLock.packages || !packageLock.packages['']) {
    throw new Error(`${path.basename(lockfilePath)} 缺少根包条目，无法同步版本`);
  }

  packageLock.version = version;
  packageLock.packages[''].version = version;
  return stageFile(lockfilePath, `${JSON.stringify(packageLock, null, 2)}\n`);
}

function stageSyncedServerPackage(version) {
  const packageJson = JSON.parse(fs.readFileSync(SERVER_PACKAGE_PATH, 'utf8'));
  packageJson.version = version;
  return stageFile(SERVER_PACKAGE_PATH, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function stageVersionXml(xmlContext, version, changelog, customDownloadUrl) {
  const currentDate = new Date().toISOString().split('T')[0];
  const downloadUrl = customDownloadUrl === null
    ? `https://github.com/AmintaCCCP/GithubStarsManager/releases/download/v${version}/github-stars-manager-${version}.dmg`
    : customDownloadUrl;
  const versionEntry = `  <version>
    <number>${version}</number>
    <releaseDate>${currentDate}</releaseDate>
    <changelog>
${changelog.map((item) => `      <item>${escapeXml(item)}</item>`).join('\n')}
    </changelog>
    <downloadUrl>${escapeXml(downloadUrl)}</downloadUrl>
  </version>\n`;
  const updatedXml = `${xmlContext.content.slice(0, xmlContext.closingTagIndex)}${versionEntry}${xmlContext.content.slice(xmlContext.closingTagIndex)}`;

  return stageFile(VERSION_XML_PATH, updatedXml);
}

function stageFile(targetPath, content) {
  const stagedPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(stagedPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  return stagedPath;
}

function cleanupStagedFile(stagedPath) {
  if (!stagedPath || !fs.existsSync(stagedPath)) {
    return;
  }

  try {
    fs.unlinkSync(stagedPath);
  } catch (error) {
    console.error(`❌ 无法清理临时文件 ${path.basename(stagedPath)}:`, error.message);
    process.exitCode = 1;
  }
}

function createFileSnapshot(filePath) {
  return {
    path: filePath,
    exists: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  };
}

function createFileSnapshots(filePaths) {
  return filePaths.map(createFileSnapshot);
}

function restoreFileSnapshots(snapshots) {
  for (const snapshot of [...snapshots].reverse()) {
    restoreFileSnapshot(snapshot);
  }
}

function restoreFileSnapshot(snapshot) {
  try {
    if (snapshot.exists) {
      fs.writeFileSync(snapshot.path, snapshot.content);
    } else if (fs.existsSync(snapshot.path)) {
      fs.unlinkSync(snapshot.path);
    }
  } catch (error) {
    throw new Error(`版本同步失败，且 ${path.basename(snapshot.path)} 回滚未完成：${error.message}`);
  }
}

function verifyRootVersionSync(version) {
  const serverPackage = JSON.parse(fs.readFileSync(SERVER_PACKAGE_PATH, 'utf8'));
  const serverPackageLock = JSON.parse(fs.readFileSync(SERVER_LOCKFILE_PATH, 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, 'utf8'));
  const lockRootVersion = packageLock.packages?.['']?.version;
  const serverLockRootVersion = serverPackageLock.packages?.['']?.version;

  if (readRootPackageVersion() !== version) {
    throw new Error(`package.json 版本在同步期间变更，预期为 ${version}`);
  }

  if (packageLock.version !== version || lockRootVersion !== version) {
    throw new Error(`package-lock.json 的根包版本未同步为 ${version}`);
  }

  if (serverPackage.version !== version) {
    throw new Error(`server/package.json 版本未同步为 ${version}`);
  }

  if (serverPackageLock.version !== version || serverLockRootVersion !== version) {
    throw new Error(`server/package-lock.json 的根包版本未同步为 ${version}`);
  }
}

function escapeXml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function listVersions() {
  try {
    const xmlContent = fs.readFileSync(VERSION_XML_PATH, 'utf8');
    const parser = require('xml2js');

    parser.parseString(xmlContent, (error, result) => {
      if (error) {
        console.error('❌ XML 解析失败:', error.message);
        process.exitCode = 1;
        return;
      }

      const versions = result.versions?.version || [];
      console.log('📋 版本历史:\n');
      versions.forEach((version, index) => {
        console.log(`${index + 1}. v${version.number[0]} (${version.releaseDate[0]})`);
        if (version.changelog?.[0]?.item) {
          version.changelog[0].item.forEach((item) => console.log(`   • ${item}`));
        }
        console.log('');
      });
    });
  } catch (error) {
    console.error('❌ 读取版本信息失败:', error.message);
    process.exitCode = 1;
  }
}

function showCurrentVersion() {
  try {
    console.log(`📦 当前版本: v${readRootPackageVersion()}`);
  } catch (error) {
    console.error('❌ 读取当前版本失败:', error.message);
    process.exitCode = 1;
  }
}

function showHelp() {
  console.log('📖 版本管理工具使用说明\n');
  console.log('根 package.json 的 version 是唯一版本输入。请先修改它，再执行以下命令。\n');
  console.log('用法:');
  console.log('  node scripts/update-version.cjs <changelog...> [--url=downloadUrl]');
  console.log('  node scripts/update-version.cjs --sync-lock');
  console.log('  node scripts/update-version.cjs --list');
  console.log('  node scripts/update-version.cjs --current\n');
  console.log('示例:');
  console.log('  npm run sync-version');
  console.log('  npm run update-version -- "修复已知问题" "提升用户体验"');
  console.log('  npm run update-version -- "优化性能" --url=https://example.com/download\n');
  console.log('注意:');
  console.log('  • 根与 server 的 package-lock.json，以及 server/package.json 的版本由根 package.json 自动同步。');
  console.log('  • electron/package.json 不维护独立应用版本；Electron Builder 使用根 package.json。');
  console.log('  • 版本同步期间会持有仓库独占锁，防止并发发布互相覆盖。');
  console.log('  • --url= 会被视为无效参数，避免静默回退到默认下载链接。');
}

updateVersionInfo();
