#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

/**
 * 更新版本信息的脚本
 * 使用方法: 
 *   node scripts/update-version.cjs [version] [changelog...] [--url=downloadUrl]
 *   node scripts/update-version.cjs --list  (列出所有版本)
 *   node scripts/update-version.cjs --current  (显示当前版本)
 * 
 * 例如: 
 *   node scripts/update-version.cjs 0.1.3 "修复搜索bug" "添加新功能"
 *   node scripts/update-version.cjs 0.1.3 "修复bug" --url="https://github.com/banjuer/GithubStarsManager/releases/tag/v0.1.3-fix"
 */

function updateVersionInfo() {
  const args = process.argv.slice(2);

  // 处理特殊命令
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
  
  // 解析参数，查找自定义下载链接
  let customDownloadUrl = null;
  const changelog = [];
  
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--url=')) {
      customDownloadUrl = arg.substring(6);
    } else {
      changelog.push(arg);
    }
  }

  // 验证版本号格式
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    console.error('❌ 版本号格式错误，应该是 x.y.z 格式');
    process.exit(1);
  }
  
  // 验证至少有一条更新日志
  if (changelog.length === 0) {
    console.error('❌ 至少需要提供一条更新日志');
    process.exit(1);
  }

  try {
    // 更新 package.json
    updatePackageJson(newVersion);

    // 更新 version-info.xml
    updateVersionXML(newVersion, changelog, customDownloadUrl);

    // 更新 UpdateService 中的版本号
    updateServiceVersion(newVersion);

    console.log(`✅ 版本已更新到 ${newVersion}`);
    console.log('📝 更新内容:');
    changelog.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item}`);
    });
    if (customDownloadUrl) {
      console.log(`🔗 自定义下载链接: ${customDownloadUrl}`);
    }
    console.log('\n🔄 请记得提交这些更改到 Git 仓库');

  } catch (error) {
    console.error('❌ 更新版本失败:', error.message);
    process.exit(1);
  }
}

function updatePackageJson(version) {
  const packagePath = path.join(__dirname, '../package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

  packageJson.version = version;

  fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n');
  console.log(`📦 已更新 package.json 版本到 ${version}`);
}

function updateVersionXML(version, changelog, customDownloadUrl) {
  const xmlPath = path.join(__dirname, '../versions/version-info.xml');
  const currentDate = new Date().toISOString().split('T')[0];

  let xmlContent;
  try {
    xmlContent = fs.readFileSync(xmlPath, 'utf8');
  } catch (error) {
    // 如果文件不存在，创建新的XML文件
    xmlContent = '<?xml version="1.0" encoding="UTF-8"?>\n<versions>\n</versions>';
  }

  // 生成下载链接
  const downloadUrl = customDownloadUrl || 
    `https://github.com/banjuer/GithubStarsManager/releases/download/v${version}/github-stars-manager-${version}.dmg`;

  // 解析现有的XML
  const versionEntry = `  <version>
    <number>${version}</number>
    <releaseDate>${currentDate}</releaseDate>
    <changelog>
${changelog.map(item => `      <item>${escapeXml(item)}</item>`).join('\n')}
    </changelog>
    <downloadUrl>${escapeXml(downloadUrl)}</downloadUrl>
  </version>`;

  // 在 </versions> 前插入新版本
  const updatedXml = xmlContent.replace('</versions>', `${versionEntry}\n</versions>`);

  fs.writeFileSync(xmlPath, updatedXml);
  console.log(`📄 已更新 version-info.xml`);
}

function updateServiceVersion(version) {
  const servicePath = path.join(__dirname, '../src/services/updateService.ts');
  let serviceContent = fs.readFileSync(servicePath, 'utf8');

  // 更新版本号
  serviceContent = serviceContent.replace(
    /return '\d+\.\d+\.\d+';/,
    `return '${version}';`
  );

  fs.writeFileSync(servicePath, serviceContent);
  console.log(`🔧 已更新 UpdateService 版本到 ${version}`);
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
  const xmlPath = path.join(__dirname, '../versions/version-info.xml');

  try {
    const xmlContent = fs.readFileSync(xmlPath, 'utf8');
    const parser = require('xml2js');

    parser.parseString(xmlContent, (err, result) => {
      if (err) {
        console.error('❌ XML解析失败:', err.message);
        return;
      }

      const versions = result.versions.version || [];
      console.log('📋 版本历史:');
      console.log('');

      versions.forEach((version, index) => {
        console.log(`${index + 1}. v${version.number[0]} (${version.releaseDate[0]})`);
        if (version.changelog && version.changelog[0].item) {
          version.changelog[0].item.forEach(item => {
            console.log(`   • ${item}`);
          });
        }
        console.log('');
      });
    });
  } catch (error) {
    console.error('❌ 读取版本信息失败:', error.message);
  }
}

function showCurrentVersion() {
  try {
    const packagePath = path.join(__dirname, '../package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    console.log(`📦 当前版本: v${packageJson.version}`);
  } catch (error) {
    console.error('❌ 读取当前版本失败:', error.message);
  }
}

function showHelp() {
  console.log('📖 版本管理工具使用说明');
  console.log('');
  console.log('用法:');
  console.log('  node scripts/update-version.cjs <version> <changelog...> [--url=downloadUrl]');
  console.log('  node scripts/update-version.cjs --list                                      列出所有版本');
  console.log('  node scripts/update-version.cjs --current                                   显示当前版本');
  console.log('  node scripts/update-version.cjs --help                                      显示帮助');
  console.log('');
  console.log('示例:');
  console.log('  node scripts/update-version.cjs 0.1.3 "修复搜索bug" "添加新功能"');
  console.log('  node scripts/update-version.cjs 0.1.4 "优化性能" --url="https://github.com/banjuer/GithubStarsManager/releases/tag/v0.1.4-fix"');
  console.log('  npm run update-version 0.1.5 "修复已知问题" "提升用户体验"');
  console.log('');
  console.log('参数说明:');
  console.log('  <version>      版本号，格式为 x.y.z');
  console.log('  <changelog...> 更新日志，至少需要一条');
  console.log('  --url=<url>    自定义下载链接（可选）');
  console.log('');
  console.log('注意:');
  console.log('  • 版本号必须遵循 x.y.z 格式');
  console.log('  • 更新日志至少需要一条');
  console.log('  • 如果不指定 --url，将使用默认的 GitHub Release 链接格式');
  console.log('  • 更新后记得提交到Git仓库');
}

// 运行脚本
updateVersionInfo();