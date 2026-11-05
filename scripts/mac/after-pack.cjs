const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * electron-builder afterPack hook.
 *
 * Ensures the macOS .app bundle has a valid, complete code signature seal.
 * If Developer ID signing was not performed (e.g. no developer certificate configured),
 * performs complete ad-hoc codesign across the app bundle and sealed resources (#569).
 */
module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin' || process.platform !== 'darwin') {
    return;
  }

  let appPath;
  if (context.packager && context.packager.appInfo && context.packager.appInfo.productFilename) {
    appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  }
  if (!appPath || !fs.existsSync(appPath)) {
    const entries = fs.readdirSync(context.appOutDir);
    const found = entries.find((e) => e.endsWith('.app'));
    if (found) {
      appPath = path.join(context.appOutDir, found);
    }
  }

  if (!appPath || !fs.existsSync(appPath)) {
    console.warn(`[afterPack] App bundle not found in ${context.appOutDir}`);
    return;
  }

  // Check if app bundle already satisfies strict code signature verification
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log(`[afterPack] App bundle already satisfies strict code signature verification: ${path.basename(appPath)}`);
    return;
  } catch {
    // App lacks complete signature seal, proceed with ad-hoc signing
  }

  console.log(`[afterPack] Applying complete ad-hoc code signature seal to ${path.basename(appPath)}...`);
  try {
    execFileSync(
      'codesign',
      ['--force', '--deep', '--preserve-metadata=entitlements,requirements,flags,runtime', '--sign', '-', appPath],
      { stdio: 'inherit' }
    );
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' });
    console.log(`[afterPack] ✓ Verified complete ad-hoc code signature seal on ${path.basename(appPath)}`);
  } catch (err) {
    console.error(`[afterPack] ❌ Failed to apply or verify ad-hoc code signature on ${appPath}: ${err.message}`);
    throw err;
  }
};
