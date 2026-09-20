'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

// 与插件下载路径共用同一份上限：单个 release 资产 8 GiB。
const MAX_RELEASE_ASSET_BYTES = 8 * 1024 * 1024 * 1024;

// 进度事件节流。500 MB 的资产若每个 chunk 都发一次 IPC，会把渲染进程淹掉。
const PROGRESS_INTERVAL_MS = 200;

// 只有 GitHub 自家的下载域名可以进入这段代码：
// - github.com          browser_download_url（公开资产）
// - api.github.com      资产元数据端点，会 302 到签名 URL
// - codeload.github.com zipball / tarball 的重定向目标
// - *.githubusercontent.com  签名后的 release-assets / objects 直链
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
]);

function isAllowedGitHubDownloadUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && (
      ALLOWED_DOWNLOAD_HOSTS.has(host) ||
      host.endsWith('.githubusercontent.com')
    );
  } catch {
    return false;
  }
}

function safeAssetName(name) {
  const leaf = (typeof name === 'string' ? name : '').split(/[\\/]/).at(-1) || '';
  let result = leaf
    .replace(/[\x00-\x1f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 200)
    .replace(/[. ]+$/g, '');
  if (!result || result === '.' || result === '..') result = 'release-asset';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(result)) result = `_${result}`;
  return result;
}

class ReleaseAssetTransferError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ReleaseAssetTransferError';
    this.code = code;
  }
}

const toErrorPayload = (error) => ({
  code: typeof error?.code === 'string' ? error.code : 'DOWNLOAD_FAILED',
  message: error instanceof Error ? error.message : 'Release asset download failed',
});

function removeQuietly(filePath) {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // 临时文件清理失败不改变下载结果，残留的 .part-* 文件可被用户手动删除。
  }
}

function readContentLength(response) {
  const raw = response?.headers?.get?.('content-length');
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function resolveTotalBytes(expectedSize, response) {
  if (Number.isSafeInteger(expectedSize) && expectedSize >= 0) return expectedSize;
  return readContentLength(response);
}

/**
 * 把 GitHub 下载地址流式写入目标路径。
 *
 * 逐块写盘而不是先聚合成 Buffer/Blob：数百 MB 的资产不应经过主进程内存，
 * 这也是渲染进程侧 response.blob() 路径被替换掉的原因。
 */
async function streamUrlToFile({
  fetchImpl,
  url,
  headers = {},
  destinationPath,
  expectedSize = null,
  maxBytes = MAX_RELEASE_ASSET_BYTES,
  signal,
  onProgress,
}) {
  if (!isAllowedGitHubDownloadUrl(url)) {
    throw new ReleaseAssetTransferError('DOWNLOAD_URL_INVALID', 'The release asset URL is not a GitHub download URL');
  }

  const response = await fetchImpl(url, { redirect: 'follow', headers, signal });
  if (!response.ok || !response.body) {
    throw new ReleaseAssetTransferError('DOWNLOAD_FAILED', `GitHub download returned HTTP ${response.status}`);
  }
  // 重定向可能把我们带到任意主机，落盘前必须重新校验最终地址。
  if (!isAllowedGitHubDownloadUrl(response.url)) {
    throw new ReleaseAssetTransferError('DOWNLOAD_REDIRECT_INVALID', 'GitHub redirected the asset to a disallowed host');
  }

  const totalBytes = resolveTotalBytes(expectedSize, response);
  const contentLength = readContentLength(response);
  if (contentLength !== null && (
    contentLength > maxBytes || (expectedSize !== null && contentLength > expectedSize)
  )) {
    throw new ReleaseAssetTransferError('DOWNLOAD_TOO_LARGE', 'Downloaded asset exceeded the expected size');
  }
  let receivedBytes = 0;
  let lastReportedAt = 0;

  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes || (expectedSize !== null && receivedBytes > expectedSize)) {
        callback(new ReleaseAssetTransferError('DOWNLOAD_TOO_LARGE', 'Downloaded asset exceeded the expected size'));
        return;
      }
      if (onProgress) {
        const now = Date.now();
        // 末块一定上报，避免进度条停在 99%。
        if (now - lastReportedAt >= PROGRESS_INTERVAL_MS || receivedBytes === totalBytes) {
          lastReportedAt = now;
          onProgress({ receivedBytes, totalBytes });
        }
      }
      callback(null, chunk);
    },
  });

  await pipeline(Readable.fromWeb(response.body), meter, fs.createWriteStream(destinationPath, { flags: 'wx' }));

  if (expectedSize !== null && receivedBytes !== expectedSize) {
    throw new ReleaseAssetTransferError('DOWNLOAD_SIZE_MISMATCH', 'Downloaded asset size did not match GitHub metadata');
  }
  onProgress?.({ receivedBytes, totalBytes });
  return { bytes: receivedBytes };
}

/** transferId -> { controller, temporaryPath }，供渲染进程取消正在进行的下载。 */
const activeTransfers = new Map();

function cancelReleaseAssetTransfer(transferId) {
  const entry = activeTransfers.get(transferId);
  if (!entry) return { success: false };
  entry.controller.abort();
  return { success: true };
}

/**
 * 一次用户确认的 release 资产下载：选路径 -> 流式写入临时文件 -> 校验大小 -> 改名落位。
 *
 * 与插件路径同构（先写 .part-* 再 rename），区别是这里带进度回调和取消，
 * 并且认证头由渲染进程显式给出，主进程不持有 Token。
 */
async function saveReleaseAssetToDisk({
  fetchImpl,
  showSaveDialog,
  ownerWindow = null,
  defaultDirectory = null,
  request,
  onProgress,
}) {
  const transferId = typeof request?.transferId === 'string' ? request.transferId : '';
  const url = typeof request?.url === 'string' ? request.url : '';
  const fileName = safeAssetName(request?.fileName);
  const expectedSize = request?.expectedSize === undefined || request?.expectedSize === null
    ? null
    : request.expectedSize;
  const authorization = typeof request?.authorization === 'string' && request.authorization
    ? request.authorization
    : null;

  if (!transferId) {
    return { success: false, error: { code: 'DOWNLOAD_REQUEST_INVALID', message: 'Missing transfer id' } };
  }
  if (activeTransfers.has(transferId)) {
    return { success: false, error: { code: 'DOWNLOAD_ALREADY_ACTIVE', message: 'A download with this transfer id is already active' } };
  }
  if (!isAllowedGitHubDownloadUrl(url)) {
    return { success: false, error: { code: 'DOWNLOAD_URL_INVALID', message: 'The release asset URL is not a GitHub download URL' } };
  }
  if (expectedSize !== null && (
    !Number.isSafeInteger(expectedSize) || expectedSize < 0 || expectedSize > MAX_RELEASE_ASSET_BYTES
  )) {
    return { success: false, error: { code: 'DOWNLOAD_SIZE_INVALID', message: 'The release asset size is not allowed' } };
  }
  if (authorization !== null && !/^Bearer [^\s\x00-\x1f\x7f]+$/.test(authorization)) {
    return { success: false, error: { code: 'DOWNLOAD_REQUEST_INVALID', message: 'The authorization header is invalid' } };
  }

  const controller = new AbortController();
  const transfer = { controller, temporaryPath: null };
  // 在第一个 await 之前占位，避免两个同 ID 请求同时穿过校验并互相覆盖。
  activeTransfers.set(transferId, transfer);

  try {
    const selection = await showSaveDialog(ownerWindow, {
      title: `Download ${fileName}`,
      defaultPath: defaultDirectory ? path.join(defaultDirectory, fileName) : fileName,
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePath || controller.signal.aborted) {
      return { success: false, canceled: true };
    }

    const temporaryPath = `${selection.filePath}.part-${process.pid}-${Date.now()}`;
    transfer.temporaryPath = temporaryPath;
    const headers = { Accept: 'application/octet-stream' };
    if (authorization) headers.Authorization = authorization;

    const { bytes } = await streamUrlToFile({
      fetchImpl,
      url,
      headers,
      destinationPath: temporaryPath,
      expectedSize,
      signal: controller.signal,
      onProgress: (progress) => onProgress?.({ transferId, ...progress }),
    });
    fs.renameSync(temporaryPath, selection.filePath);
    return { success: true, fileName: path.basename(selection.filePath), filePath: selection.filePath, bytes };
  } catch (error) {
    if (transfer.temporaryPath) removeQuietly(transfer.temporaryPath);
    if (controller.signal.aborted) return { success: false, canceled: true };
    return { success: false, error: toErrorPayload(error) };
  } finally {
    if (activeTransfers.get(transferId) === transfer) activeTransfers.delete(transferId);
  }
}

module.exports = {
  MAX_RELEASE_ASSET_BYTES,
  PROGRESS_INTERVAL_MS,
  ReleaseAssetTransferError,
  cancelReleaseAssetTransfer,
  isAllowedGitHubDownloadUrl,
  safeAssetName,
  saveReleaseAssetToDisk,
  streamUrlToFile,
};
