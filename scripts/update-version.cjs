#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(PROJECT_ROOT, 'package.json');
const LOCKFILE_PATH = path.join(PROJECT_ROOT, 'package-lock.json');
const VERSION_XML_PATH = path.join(PROJECT_ROOT, 'versions/version-info.xml');

/**
 * 更新版本信息的脚本。
 *
 * 用法：
 *   node scripts/update-version.cjs <version> <changelog...> [--url=downloadUrl]
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
    if (args[0] === '--help' || args[0] === '-h') {
      showHelp();
      return;
    }
  }

  if (args.length < 2) {
    console.error('❌ 参数不足');
    showHelp();
    process.exit(1);
  }

  const newVersion = args[0];
  let releaseArgs;
  try {
    releaseArgs = parseReleaseArgs(args.slice(1));
    validateReleaseVersion(newVersion);
  } catch (error) {
    console.error('❌ 版本更新前检查失败:', error.message);
    process.exit(1);
  }

  let stagedXmlPath;
  try {
    const xmlContext = loadVersionXml(newVersion);
    stagedXmlPath = stageVersionXml(xmlContext, newVersion, releaseArgs.changelog, releaseArgs.customDownloadUrl);
    const packageSnapshots = createFileSnapshots([PACKAGE_PATH, LOCKFILE_PATH]);

    try {
      updateRootPackageVersion(newVersion);
      verifyRootVersionSync(newVersion);
      fs.renameSync(stagedXmlPath, VERSION_XML_PATH);
      stagedXmlPath = null;
      console.log('📄 已更新 version-info.xml');
    } catch (error) {
      restoreFileSnapshots(packageSnapshots);
      throw error;
    }

    console.log(`✅ 版本已更新到 ${newVersion}`);
    console.log('📝 更新内容:');
    releaseArgs.changelog.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item}`);
    });
    if (releaseArgs.customDownloadUrl) {
      console.log(`🔗 自定义下载链接: ${releaseArgs.customDownloadUrl}`);
    }
    console.log('\n🔄 请记得提交这些更改到 Git 仓库');
  } catch (error) {
    console.error('❌ 更新版本失败:', error.message);
    process.exitCode = 1;
  } finally {
    if (stagedXmlPath && fs.existsSync(stagedXmlPath)) {
      fs.unlinkSync(stagedXmlPath);
    }
  }
}

function parseReleaseArgs(args) {
  let customDownloadUrl = null;
  const changelog = [];

  for (const arg of args) {
    if (arg.startsWith('--url=')) {
      customDownloadUrl = arg.substring(6);
    } else {
      changelog.push(arg);
    }
  }

  if (customDownloadUrl) {
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

function validateReleaseVersion(version) {
  if (!isValidVersion(version)) {
    throw new Error('版本号应该是无前导零的 x.y.z 格式');
  }

  const currentVersion = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8')).version;
  if (!isValidVersion(currentVersion)) {
    throw new Error(`根 package.json 的当前版本无效：${currentVersion}`);
  }

  if (compareVersions(version, currentVersion) <= 0) {
    throw new Error(`新版本必须高于当前版本 ${currentVersion}`);
  }
}

function isValidVersion(version) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);

  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] - rightParts[index];
    }
  }
  return 0;
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

function buildVersionXml(xmlContext, version, changelog, customDownloadUrl) {
  const currentDate = new Date().toISOString().split('T')[0];
  const downloadUrl = customDownloadUrl ||
    `https://github.com/AmintaCCCP/GithubStarsManager/releases/download/v${version}/github-stars-manager-${version}.dmg`;
  const versionEntry = `  <version>
    <number>${version}</number>
    <releaseDate>${currentDate}</releaseDate>
    <changelog>
${changelog.map((item) => `      <item>${escapeXml(item)}</item>`).join('\n')}
    </changelog>
    <downloadUrl>${escapeXml(downloadUrl)}</downloadUrl>
  </version>\n`;

  return `${xmlContext.content.slice(0, xmlContext.closingTagIndex)}${versionEntry}${xmlContext.content.slice(xmlContext.closingTagIndex)}`;
}

function stageVersionXml(xmlContext, version, changelog, customDownloadUrl) {
  const stagedPath = path.join(
    path.dirname(VERSION_XML_PATH),
    `.${path.basename(VERSION_XML_PATH)}.${process.pid}.${Date.now()}.tmp`
  );

  fs.writeFileSync(stagedPath, buildVersionXml(xmlContext, version, changelog, customDownloadUrl), { flag: 'wx' });
  return stagedPath;
}

function createFileSnapshots(filePaths) {
  return filePaths.map((filePath) => ({
    path: filePath,
    exists: fs.existsSync(filePath),
    content: fs.existsSync(filePath) ? fs.readFileSync(filePath) : null
  }));
}

function restoreFileSnapshots(snapshots) {
  const restorationErrors = [];

  for (const snapshot of [...snapshots].reverse()) {
    try {
      if (snapshot.exists) {
        fs.writeFileSync(snapshot.path, snapshot.content);
      } else if (fs.existsSync(snapshot.path)) {
        fs.unlinkSync(snapshot.path);
      }
    } catch (error) {
      restorationErrors.push(`${path.basename(snapshot.path)}: ${error.message}`);
    }
  }

  if (restorationErrors.length > 0) {
    throw new Error(`版本更新失败，且回滚未完成：${restorationErrors.join('; ')}`);
  }
}

function updateRootPackageVersion(version) {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(
    npmCommand,
    ['version', version, '--no-git-tag-version', '--ignore-scripts'],
    { cwd: PROJECT_ROOT, stdio: 'inherit' }
  );
}

function verifyRootVersionSync(version) {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
  const packageLock = JSON.parse(fs.readFileSync(LOCKFILE_PATH, 'utf8'));
  const lockRootVersion = packageLock.packages?.['']?.version;

  if (packageJson.version !== version) {
    throw new Error(`package.json 版本未更新为 ${version}`);
  }

  if (packageLock.version !== version || lockRootVersion !== version) {
    throw new Error(`package-lock.json 的根包版本未同步为 ${version}`);
  }

  console.log(`📦 已将根 package.json 与 package-lock.json 同步为 ${version}`);
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
    const packageJson = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf8'));
    console.log(`📦 当前版本: v${packageJson.version}`);
  } catch (error) {
    console.error('❌ 读取当前版本失败:', error.message);
    process.exitCode = 1;
  }
}

function showHelp() {
  console.log('📖 版本管理工具使用说明\n');
  console.log('用法:');
  console.log('  node scripts/update-version.cjs <version> <changelog...> [--url=downloadUrl]');
  console.log('  node scripts/update-version.cjs --list');
  console.log('  node scripts/update-version.cjs --current');
  console.log('  node scripts/update-version.cjs --help\n');
  console.log('示例:');
  console.log('  npm run update-version -- 0.1.5 "修复已知问题" "提升用户体验"');
  console.log('  npm run update-version -- 0.1.6 "优化性能" --url=https://example.com/download\n');
  console.log('注意:');
  console.log('  • 版本号必须遵循无前导零的 x.y.z 格式。');
  console.log('  • 新版本必须高于当前版本，且不能与更新记录重复。');
  console.log('  • 根 package.json 是唯一版本来源；package-lock.json 自动同步。');
  console.log('  • electron/package.json 不维护独立应用版本号。');
  console.log('  • 更新元数据会先暂存；前置校验失败时不会改动版本文件。');
}

updateVersionInfo();
