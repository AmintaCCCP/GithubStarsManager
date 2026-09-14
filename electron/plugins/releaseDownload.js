'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const MAX_RELEASE_ASSET_BYTES = 8 * 1024 * 1024 * 1024;

function isAllowedGitHubDownloadUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (
      host === 'github.com' ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function safeAssetName(name) {
  const result = path.basename(typeof name === 'string' ? name : '').replace(/[\x00-\x1f<>:"/\\|?*]/g, '_');
  return result && result !== '.' ? result : 'release-asset';
}

async function downloadReleaseAsset({ fetchImpl, showSaveDialog, ownerWindow, release, asset }) {
  if (!isAllowedGitHubDownloadUrl(asset.browser_download_url)) {
    return { success: false, error: { code: 'PLUGIN_DOWNLOAD_URL_INVALID', message: 'The Host rejected the release asset URL' } };
  }
  if (!Number.isFinite(asset.size) || asset.size < 0 || asset.size > MAX_RELEASE_ASSET_BYTES) {
    return { success: false, error: { code: 'PLUGIN_DOWNLOAD_SIZE_INVALID', message: 'The release asset size is not allowed' } };
  }
  const selection = await showSaveDialog(ownerWindow, {
    title: 'Download plugin-recommended release asset',
    message: `${release.repository.full_name} ${release.tag_name}\n${asset.name}\nExpected size: ${asset.size} bytes`,
    defaultPath: safeAssetName(asset.name),
    properties: ['showOverwriteConfirmation', 'createDirectory'],
  });
  if (selection.canceled || !selection.filePath) return { success: false, canceled: true };

  const temporaryPath = `${selection.filePath}.part-${process.pid}-${Date.now()}`;
  try {
    const response = await fetchImpl(asset.browser_download_url, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      throw Object.assign(new Error(`GitHub download returned HTTP ${response.status}`), { code: 'PLUGIN_DOWNLOAD_FAILED' });
    }
    if (!isAllowedGitHubDownloadUrl(response.url)) {
      throw Object.assign(new Error('GitHub redirected the asset to a disallowed host'), { code: 'PLUGIN_DOWNLOAD_REDIRECT_INVALID' });
    }
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        if (received > MAX_RELEASE_ASSET_BYTES || (asset.size > 0 && received > asset.size)) {
          callback(Object.assign(new Error('Downloaded asset exceeded the expected size'), { code: 'PLUGIN_DOWNLOAD_TOO_LARGE' }));
          return;
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), limit, fs.createWriteStream(temporaryPath, { flags: 'wx' }));
    if (asset.size > 0 && received !== asset.size) {
      throw Object.assign(new Error('Downloaded asset size did not match GitHub metadata'), { code: 'PLUGIN_DOWNLOAD_SIZE_MISMATCH' });
    }
    if (fs.existsSync(selection.filePath)) fs.rmSync(selection.filePath, { force: false });
    fs.renameSync(temporaryPath, selection.filePath);
    return { success: true, fileName: path.basename(selection.filePath), bytes: received };
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch {}
    return {
      success: false,
      error: {
        code: typeof error?.code === 'string' ? error.code : 'PLUGIN_DOWNLOAD_FAILED',
        message: error instanceof Error ? error.message : 'Release asset download failed',
      },
    };
  }
}

module.exports = { MAX_RELEASE_ASSET_BYTES, downloadReleaseAsset, isAllowedGitHubDownloadUrl, safeAssetName };
