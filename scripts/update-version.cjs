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
const RELEASE_LOCK_TAKENOVER_PATH = path.join(PROJECT_ROOT, '.release-version.lock.takenover');
const PACKAGE_SYNC_TRANSACTION = 'package-version-sync';
const PACKAGE_SYNC_JOURNAL_PATH = path.join(PROJECT_ROOT, '.package-sync.transaction.json');
const PACKAGE_SYNC_BACKUP_DIR = path.join(PROJECT_ROOT, '.package-sync-backups');
const PACKAGE_SYNC_TARGETS = [
  { name: 'package-lock.json', path: LOCKFILE_PATH },
  { name: 'server/package.json', path: SERVER_PACKAGE_PATH },
  { name: 'server/package-lock.json', path: SERVER_LOCKFILE_PATH },
];

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
  let packageTransaction;
  let packageSnapshots;
  let packageFilesCommitted = false;

  try {
    releaseLock = acquireReleaseLockAfterRecovery();
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
    packageSnapshots = createFileSnapshots(PACKAGE_SYNC_TARGETS.map(({ path: targetPath }) => targetPath));
    packageTransaction = createPackageSyncTransaction(version);

    try {
      commitPackageSyncTargets(version, packageTransaction, {
        stagedLockfilePath,
        stagedServerPackagePath,
        stagedServerLockfilePath,
      });
      packageFilesCommitted = true;
      packageTransaction = null;
      fs.renameSync(stagedXmlPath, VERSION_XML_PATH);
      stagedXmlPath = null;
    } catch (error) {
      try {
        if (packageTransaction?.state === 'prepared') {
          rollbackPackageSyncTransaction(packageTransaction, packageSnapshots);
        } else if (!packageTransaction && packageFilesCommitted) {
          restoreFileSnapshots(packageSnapshots);
        }
      } catch (rollbackError) {
        throw new Error(`${error.message}; ${rollbackError.message}`);
      }
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
  let packageTransaction;
  let packageSnapshots;

  try {
    releaseLock = acquireReleaseLockAfterRecovery();
    const version = readRootPackageVersion();
    validateVersion(version);
    packageSnapshots = createFileSnapshots(PACKAGE_SYNC_TARGETS.map(({ path: targetPath }) => targetPath));
    packageTransaction = createPackageSyncTransaction(version);
    try {
      commitPackageSyncTargets(version, packageTransaction);
      packageTransaction = null;
    } catch (error) {
      try {
        if (packageTransaction?.state === 'prepared') {
          rollbackPackageSyncTransaction(packageTransaction, packageSnapshots);
        }
      } catch (rollbackError) {
        throw new Error(`${error.message}; ${rollbackError.message}`);
      }
      throw error;
    }
    console.log(`📦 已将根与 server package-lock.json 同步为根 package.json 的版本 v${version}`);
  } catch (error) {
    console.error('❌ 同步 package-lock.json 失败:', error.message);
    process.exitCode = 1;
  } finally {
    releaseReleaseLock(releaseLock);
  }
}

function acquireReleaseLockAfterRecovery() {
  const lock = acquireReleaseLockWithTakeover();
  // 恢复必须在持有独占锁之后进行，否则两个进程可能并发恢复同一份事务日志：
  // 一个还在读备份，另一个已经把备份删掉了。
  recoverInterruptedPackageSync();
  return lock;
}

function acquireReleaseLockWithTakeover() {
  // 只有死属主残留的锁才会被接管；活进程或状态未知时保持获取失败（EEXIST 拒绝）。
  tryTakeOverStaleReleaseLock();
  return acquireReleaseLock();
}

function tryTakeOverStaleReleaseLock() {
  const stalePid = readReleaseLockPid(RELEASE_LOCK_PATH);
  if (stalePid === null || getProcessState(stalePid) !== 'dead') {
    return false;
  }

  try {
    // rename 抢占是原子的：并发接管者中只有一个能把陈旧锁移走
    fs.renameSync(RELEASE_LOCK_PATH, RELEASE_LOCK_TAKENOVER_PATH);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return true;
    }
    throw error;
  }

  if (readReleaseLockPid(RELEASE_LOCK_TAKENOVER_PATH) !== stalePid) {
    // rename 前锁可能已被在线属主重建：原样放回并放弃接管，绝不删除在线进程的锁
    try {
      fs.renameSync(RELEASE_LOCK_TAKENOVER_PATH, RELEASE_LOCK_PATH);
    } catch {
      // 无法放回时同样放弃，由属主自身的释放逻辑兜底
    }
    return false;
  }

  unlinkIfExists(RELEASE_LOCK_TAKENOVER_PATH);
  return true;
}

function readReleaseLockPid(lockPath) {
  try {
    const pid = JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid;
    return Number.isSafeInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function commitPackageSyncTargets(version, transaction, staged = {}) {
  const stagedPaths = {
    lockfile: staged.stagedLockfilePath || null,
    serverPackage: staged.stagedServerPackagePath || null,
    serverLockfile: staged.stagedServerLockfilePath || null,
  };

  try {
    stagedPaths.lockfile ||= stageSyncedPackageLock(LOCKFILE_PATH, version);
    stagedPaths.serverPackage ||= stageSyncedServerPackage(version);
    stagedPaths.serverLockfile ||= stageSyncedPackageLock(SERVER_LOCKFILE_PATH, version);

    fs.renameSync(stagedPaths.lockfile, LOCKFILE_PATH);
    fs.renameSync(stagedPaths.serverPackage, SERVER_PACKAGE_PATH);
    fs.renameSync(stagedPaths.serverLockfile, SERVER_LOCKFILE_PATH);
    for (const target of PACKAGE_SYNC_TARGETS) {
      syncDirectory(path.dirname(target.path));
    }
    verifyRootVersionSync(version);
    markPackageSyncState(transaction, 'committed');
    cleanupPackageSyncTransaction(transaction);
  } finally {
    cleanupStagedFile(stagedPaths.lockfile);
    cleanupStagedFile(stagedPaths.serverPackage);
    cleanupStagedFile(stagedPaths.serverLockfile);
  }
}

function createPackageSyncTransaction(version) {
  if (fs.existsSync(PACKAGE_SYNC_JOURNAL_PATH)) {
    throw new Error('检测到未完成的 package 版本同步事务，无法开始新的事务');
  }

  preparePackageSyncBackupDir();
  const targets = PACKAGE_SYNC_TARGETS.map((target, index) => ({
    targetPath: target.path,
    backupPath: path.join(PACKAGE_SYNC_BACKUP_DIR, `${index}-${path.basename(target.path)}.bak`),
  }));

  try {
    for (const target of targets) {
      writeDurableFile(target.backupPath, fs.readFileSync(target.targetPath));
    }

    const transaction = {
      transaction: PACKAGE_SYNC_TRANSACTION,
      version,
      targets,
      startedAt: new Date().toISOString(),
      state: 'prepared',
    };
    writeDurableJson(PACKAGE_SYNC_JOURNAL_PATH, transaction);
    return transaction;
  } catch (error) {
    cleanupUncommittedPackageSyncArtifacts(targets);
    throw error;
  }
}

function preparePackageSyncBackupDir() {
  if (fs.existsSync(PACKAGE_SYNC_BACKUP_DIR)) {
    if (!fs.statSync(PACKAGE_SYNC_BACKUP_DIR).isDirectory()) {
      throw new Error('package sync 备份路径不是目录，无法开始新事务');
    }
    // 事务日志在所有备份写完后才落盘：没有日志时，目录中的备份必然来自
    // 写日志前被中断的同步，目标文件尚未改写、备份无人引用，可安全清除。
    for (const entry of fs.readdirSync(PACKAGE_SYNC_BACKUP_DIR)) {
      const entryPath = path.join(PACKAGE_SYNC_BACKUP_DIR, entry);
      if (!fs.statSync(entryPath).isFile()) {
        throw new Error(`package sync 备份目录存在无法清理的异常条目：${entry}`);
      }
      unlinkIfExists(entryPath);
    }
    fs.rmdirSync(PACKAGE_SYNC_BACKUP_DIR);
  }
  fs.mkdirSync(PACKAGE_SYNC_BACKUP_DIR, { mode: 0o700 });
}

function recoverInterruptedPackageSync() {
  const transaction = readPackageSyncJournal();
  if (!transaction) {
    return;
  }

  if (transaction.state === 'prepared') {
    restorePackageSyncBackups(transaction);
    markPackageSyncState(transaction, 'recovered');
  }

  cleanupPackageSyncTransaction(transaction);
}

function readPackageSyncJournal() {
  if (!fs.existsSync(PACKAGE_SYNC_JOURNAL_PATH)) {
    return null;
  }

  let transaction;
  try {
    transaction = JSON.parse(fs.readFileSync(PACKAGE_SYNC_JOURNAL_PATH, 'utf8'));
  } catch (error) {
    throw new Error(packageSyncJournalError(`package sync 事务日志读取失败：${error.message}`));
  }

  validatePackageSyncJournal(transaction);
  return transaction;
}

function packageSyncJournalError(message) {
  return `${message}。如确认当前没有同步在进行，可手动删除 .package-sync.transaction.json 与 .package-sync-backups/ 后重试`;
}

function validatePackageSyncJournal(transaction) {
  if (!transaction || transaction.transaction !== PACKAGE_SYNC_TRANSACTION) {
    throw new Error(packageSyncJournalError('package sync 事务日志类型不正确'));
  }
  if (typeof transaction.version !== 'string') {
    throw new Error(packageSyncJournalError('package sync 事务日志的 version 字段不正确'));
  }
  validateVersion(transaction.version);
  if (typeof transaction.startedAt !== 'string' || transaction.startedAt.length === 0) {
    throw new Error(packageSyncJournalError('package sync 事务日志的 startedAt 字段不正确'));
  }
  if (!['prepared', 'committed', 'recovered'].includes(transaction.state)) {
    throw new Error(packageSyncJournalError('package sync 事务日志的 state 字段不正确'));
  }
  if (!Array.isArray(transaction.targets) || transaction.targets.length !== PACKAGE_SYNC_TARGETS.length) {
    throw new Error(packageSyncJournalError('package sync 事务日志的 targets 列表不正确'));
  }

  PACKAGE_SYNC_TARGETS.forEach((expected, index) => {
    const actual = transaction.targets[index];
    const expectedBackupPath = path.join(
      PACKAGE_SYNC_BACKUP_DIR,
      `${index}-${path.basename(expected.path)}.bak`
    );
    if (!actual || actual.targetPath !== expected.path || actual.backupPath !== expectedBackupPath) {
      throw new Error(packageSyncJournalError(`package sync 事务日志的 target ${index} 与预期不一致`));
    }
  });
}

function restorePackageSyncBackups(transaction) {
  for (const target of transaction.targets) {
    if (!fs.existsSync(target.backupPath)) {
      throw new Error(
        `package sync 备份文件缺失：${path.basename(target.backupPath)}，无法恢复中断的事务。` +
        '可删除 .package-sync.transaction.json 与 .package-sync-backups/，用 git 还原目标文件后重试'
      );
    }
    writeDurableFile(target.targetPath, fs.readFileSync(target.backupPath));
  }
}

function markPackageSyncState(transaction, state) {
  const updated = { ...transaction, state };
  writeDurableJson(PACKAGE_SYNC_JOURNAL_PATH, updated);
  Object.assign(transaction, updated);
}

function cleanupPackageSyncTransaction(transaction) {
  for (const target of transaction.targets) {
    unlinkIfExists(target.backupPath);
  }

  if (fs.existsSync(PACKAGE_SYNC_BACKUP_DIR)) {
    if (fs.readdirSync(PACKAGE_SYNC_BACKUP_DIR).length > 0) {
      throw new Error('package sync 备份目录清理未完成，存在残留文件');
    }
    syncDirectory(PACKAGE_SYNC_BACKUP_DIR);
    fs.rmdirSync(PACKAGE_SYNC_BACKUP_DIR);
    syncDirectory(PROJECT_ROOT);
  }

  unlinkIfExists(PACKAGE_SYNC_JOURNAL_PATH);
  syncDirectory(PROJECT_ROOT);
}

function cleanupUncommittedPackageSyncArtifacts(targets) {
  for (const target of targets) {
    unlinkIfExists(target.backupPath);
  }
  if (fs.existsSync(PACKAGE_SYNC_BACKUP_DIR) && fs.readdirSync(PACKAGE_SYNC_BACKUP_DIR).length === 0) {
    fs.rmdirSync(PACKAGE_SYNC_BACKUP_DIR);
  }
  unlinkIfExists(PACKAGE_SYNC_JOURNAL_PATH);
}

function rollbackPackageSyncTransaction(transaction, snapshots) {
  restoreFileSnapshots(snapshots);
  markPackageSyncState(transaction, 'recovered');
  cleanupPackageSyncTransaction(transaction);
}

function getProcessState(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return 'unknown';
  }

  try {
    process.kill(pid, 0);
    return 'live';
  } catch (error) {
    if (error.code === 'ESRCH') {
      return 'dead';
    }
    if (error.code === 'EPERM') {
      return 'live';
    }
    return 'unknown';
  }
}

function writeDurableJson(filePath, value) {
  writeDurableFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeDurableFile(filePath, content) {
  const stagedPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.durable.tmp`
  );
  let fileDescriptor;
  try {
    fileDescriptor = fs.openSync(stagedPath, 'wx', 0o600);
    fs.writeFileSync(fileDescriptor, content);
    fs.fsyncSync(fileDescriptor);
    fs.closeSync(fileDescriptor);
    fileDescriptor = undefined;
    fs.renameSync(stagedPath, filePath);
    syncDirectory(path.dirname(filePath));
  } finally {
    if (fileDescriptor !== undefined) {
      try {
        fs.closeSync(fileDescriptor);
      } catch {
        // Preserve the original write/rename error.
      }
    }
    unlinkIfExists(stagedPath);
  }
}

function syncDirectory(directoryPath) {
  try {
    const fileDescriptor = fs.openSync(directoryPath, 'r');
    try {
      fs.fsyncSync(fileDescriptor);
    } finally {
      fs.closeSync(fileDescriptor);
    }
  } catch (error) {
    if (['EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) {
      return;
    }
    throw error;
  }
}

function unlinkIfExists(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
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
