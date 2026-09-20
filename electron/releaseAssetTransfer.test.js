'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  cancelReleaseAssetTransfer,
  isAllowedGitHubDownloadUrl,
  safeAssetName,
  saveReleaseAssetToDisk,
  streamUrlToFile,
} = require('./releaseAssetTransfer');

const temporaryDirectory = (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gsm-release-transfer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
};

const bodyOf = (text) => new Blob([text]).stream();

const okResponse = (url, body) => ({ ok: true, status: 200, url, body });

test('allows only GitHub download hosts over HTTPS', () => {
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com/o/r/releases/download/v1/a.exe'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://api.github.com/repos/o/r/releases/assets/1'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://codeload.github.com/o/r/zip/v1'), true);
  assert.equal(isAllowedGitHubDownloadUrl('https://release-assets.githubusercontent.com/file'), true);
  assert.equal(isAllowedGitHubDownloadUrl('http://github.com/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://github.com.evil.example/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://user:pass@github.com/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('https://evil.example/github.com/file'), false);
  assert.equal(isAllowedGitHubDownloadUrl('not a url'), false);
});

test('normalizes suggested asset names without accepting paths', () => {
  assert.equal(safeAssetName('../folder/setup?.exe'), 'setup_.exe');
  assert.equal(safeAssetName(''), 'release-asset');
  assert.equal(safeAssetName('..'), 'release-asset');
  assert.equal(safeAssetName('CON'), '_CON');
  assert.equal(safeAssetName('report. '), 'report');
});

test('streams a release asset to disk and reports byte progress', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'asset.zip');
  const progress = [];

  const result = await streamUrlToFile({
    fetchImpl: async () => okResponse('https://release-assets.githubusercontent.com/file', bodyOf('hello')),
    url: 'https://github.com/owner/repository/releases/download/v1.0.0/asset.zip',
    destinationPath: destination,
    expectedSize: 5,
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(result, { bytes: 5 });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'hello');
  assert.deepEqual(progress.at(-1), { receivedBytes: 5, totalBytes: 5 });
});

test('rejects a download that lands on a non-GitHub host after redirects', async (t) => {
  const directory = temporaryDirectory(t);

  await assert.rejects(
    streamUrlToFile({
      fetchImpl: async () => okResponse('https://evil.example/asset.zip', bodyOf('hello')),
      url: 'https://github.com/owner/repository/releases/download/v1.0.0/asset.zip',
      destinationPath: path.join(directory, 'asset.zip'),
    }),
    (error) => error.code === 'DOWNLOAD_REDIRECT_INVALID',
  );
});

test('rejects a download whose size contradicts GitHub metadata', async (t) => {
  const directory = temporaryDirectory(t);

  await assert.rejects(
    streamUrlToFile({
      fetchImpl: async () => okResponse('https://github.com/owner/repository/releases/download/v1.0.0/asset.zip', bodyOf('hello')),
      url: 'https://github.com/owner/repository/releases/download/v1.0.0/asset.zip',
      destinationPath: path.join(directory, 'asset.zip'),
      expectedSize: 99,
    }),
    (error) => error.code === 'DOWNLOAD_SIZE_MISMATCH',
  );
});

test('rejects an oversized content length before creating a partial file', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'asset.zip');

  await assert.rejects(
    streamUrlToFile({
      fetchImpl: async () => ({
        ...okResponse('https://github.com/owner/repository/releases/download/v1.0.0/asset.zip', bodyOf('hello')),
        headers: { get: (name) => name === 'content-length' ? '10' : null },
      }),
      url: 'https://github.com/owner/repository/releases/download/v1.0.0/asset.zip',
      destinationPath: destination,
      maxBytes: 4,
    }),
    (error) => error.code === 'DOWNLOAD_TOO_LARGE',
  );

  assert.equal(fs.existsSync(destination), false);
});

test('saves a release asset to the user-selected path under a temp name', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'setup.exe');
  const progress = [];

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://release-assets.githubusercontent.com/file', bodyOf('binary')),
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    request: {
      transferId: 'transfer-1',
      url: 'https://api.github.com/repos/owner/repository/releases/assets/7',
      fileName: 'setup.exe',
      expectedSize: 6,
      authorization: 'Bearer token',
    },
    onProgress: (value) => progress.push(value),
  });

  assert.deepEqual(result, { success: true, fileName: 'setup.exe', filePath: destination, bytes: 6 });
  assert.equal(fs.readFileSync(destination, 'utf8'), 'binary');
  assert.deepEqual(progress.at(-1), { transferId: 'transfer-1', receivedBytes: 6, totalBytes: 6 });
  assert.deepEqual(fs.readdirSync(directory), ['setup.exe']);
});

test('forwards the caller-supplied authorization header without reading a token itself', async (t) => {
  const directory = temporaryDirectory(t);
  const seen = [];

  await saveReleaseAssetToDisk({
    fetchImpl: async (url, options) => {
      seen.push(options.headers);
      return okResponse('https://release-assets.githubusercontent.com/file', bodyOf('x'));
    },
    showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, 'a.bin') }),
    request: {
      transferId: 'transfer-2',
      url: 'https://api.github.com/repos/owner/repository/releases/assets/7',
      fileName: 'a.bin',
      authorization: 'Bearer token',
    },
  });

  assert.deepEqual(seen, [{ Accept: 'application/octet-stream', Authorization: 'Bearer token' }]);
});

test('omits the authorization header when the caller has no token', async (t) => {
  const directory = temporaryDirectory(t);
  const seen = [];

  await saveReleaseAssetToDisk({
    fetchImpl: async (_url, options) => {
      seen.push(options.headers);
      return okResponse('https://release-assets.githubusercontent.com/file', bodyOf('x'));
    },
    showSaveDialog: async () => ({ canceled: false, filePath: path.join(directory, 'a.bin') }),
    request: {
      transferId: 'transfer-3',
      url: 'https://github.com/owner/repository/releases/download/v1/a.bin',
      fileName: 'a.bin',
    },
  });

  assert.deepEqual(seen, [{ Accept: 'application/octet-stream' }]);
});

test('rejects malformed authorization before showing the save dialog', async () => {
  let dialogCalls = 0;

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://github.com/o/r/releases/download/v1/a.bin', bodyOf('x')),
    showSaveDialog: async () => { dialogCalls += 1; return { canceled: false, filePath: 'x' }; },
    request: {
      transferId: 'invalid-auth',
      url: 'https://github.com/o/r/releases/download/v1/a.bin',
      fileName: 'a.bin',
      authorization: 'Bearer token\r\nX-Injected: yes',
    },
  });

  assert.equal(result.error.code, 'DOWNLOAD_REQUEST_INVALID');
  assert.equal(dialogCalls, 0);
});

test('rejects a fractional expected size before showing the save dialog', async () => {
  let dialogCalls = 0;

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://github.com/o/r/releases/download/v1/a.bin', bodyOf('x')),
    showSaveDialog: async () => { dialogCalls += 1; return { canceled: false, filePath: 'x' }; },
    request: {
      transferId: 'invalid-size',
      url: 'https://github.com/o/r/releases/download/v1/a.bin',
      fileName: 'a.bin',
      expectedSize: 1.5,
    },
  });

  assert.equal(result.error.code, 'DOWNLOAD_SIZE_INVALID');
  assert.equal(dialogCalls, 0);
});

test('refuses a non-GitHub URL before showing the save dialog', async () => {
  let dialogCalls = 0;

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://evil.example/a.bin', bodyOf('x')),
    showSaveDialog: async () => { dialogCalls += 1; return { canceled: false, filePath: 'x' }; },
    request: { transferId: 'transfer-4', url: 'https://evil.example/a.bin', fileName: 'a.bin' },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'DOWNLOAD_URL_INVALID');
  assert.equal(dialogCalls, 0);
});

test('refuses a missing transfer id', async () => {
  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://github.com/o/r/releases/download/v1/a.bin', bodyOf('x')),
    showSaveDialog: async () => ({ canceled: false, filePath: 'x' }),
    request: { url: 'https://github.com/o/r/releases/download/v1/a.bin', fileName: 'a.bin' },
  });

  assert.equal(result.error.code, 'DOWNLOAD_REQUEST_INVALID');
});

test('reports a canceled save dialog without touching the network', async () => {
  let fetchCalls = 0;

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => { fetchCalls += 1; return okResponse('https://github.com/o/r/releases/download/v1/a.bin', bodyOf('x')); },
    showSaveDialog: async () => ({ canceled: true }),
    request: { transferId: 'transfer-5', url: 'https://github.com/o/r/releases/download/v1/a.bin', fileName: 'a.bin' },
  });

  assert.deepEqual(result, { success: false, canceled: true });
  assert.equal(fetchCalls, 0);
});

test('cancels an in-flight transfer and removes its partial file', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'big.zip');
  const abortableBody = (signal) => new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('partial'));
      const fail = () => controller.error(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      if (signal?.aborted) {
        fail();
        return;
      }
      signal?.addEventListener('abort', fail);
    },
  });

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async (_url, options) => {
      // 走到这里说明 transfer 已注册，取消一定是确定性的
      const canceled = cancelReleaseAssetTransfer('transfer-6');
      assert.equal(canceled.success, true);
      return { ok: true, status: 200, url: 'https://release-assets.githubusercontent.com/file', body: abortableBody(options.signal) };
    },
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    request: {
      transferId: 'transfer-6',
      url: 'https://github.com/owner/repository/releases/download/v1.0.0/big.zip',
      fileName: 'big.zip',
      expectedSize: 5000,
    },
  });

  assert.deepEqual(result, { success: false, canceled: true });
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('rejects a duplicate active transfer id without opening another dialog', async (t) => {
  const directory = temporaryDirectory(t);
  let dialogCalls = 0;
  let resolveDialog;
  const dialogSelection = new Promise((resolve) => { resolveDialog = resolve; });
  const firstResult = saveReleaseAssetToDisk({
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
      }, { once: true });
    }),
    showSaveDialog: async () => {
      dialogCalls += 1;
      return dialogSelection;
    },
    request: {
      transferId: 'duplicate-transfer',
      url: 'https://github.com/o/r/releases/download/v1/a.bin',
      fileName: 'a.bin',
    },
  });

  const duplicateResult = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://github.com/o/r/releases/download/v1/a.bin', bodyOf('x')),
    showSaveDialog: async () => {
      dialogCalls += 1;
      return { canceled: false, filePath: path.join(directory, 'second.bin') };
    },
    request: {
      transferId: 'duplicate-transfer',
      url: 'https://github.com/o/r/releases/download/v1/a.bin',
      fileName: 'a.bin',
    },
  });

  assert.equal(duplicateResult.error.code, 'DOWNLOAD_ALREADY_ACTIVE');
  assert.equal(dialogCalls, 1);
  resolveDialog({ canceled: false, filePath: path.join(directory, 'first.bin') });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cancelReleaseAssetTransfer('duplicate-transfer'), { success: true });
  assert.deepEqual(await firstResult, { success: false, canceled: true });
});

test('fails a transfer that exceeds the expected size and leaves no partial file', async (t) => {
  const directory = temporaryDirectory(t);
  const destination = path.join(directory, 'asset.zip');

  const result = await saveReleaseAssetToDisk({
    fetchImpl: async () => okResponse('https://github.com/o/r/releases/download/v1/asset.zip', bodyOf('0123456789')),
    showSaveDialog: async () => ({ canceled: false, filePath: destination }),
    request: {
      transferId: 'transfer-7',
      url: 'https://github.com/o/r/releases/download/v1/asset.zip',
      fileName: 'asset.zip',
      expectedSize: 4,
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.error.code, 'DOWNLOAD_TOO_LARGE');
  assert.deepEqual(fs.readdirSync(directory), []);
});

test('cancelling an unknown transfer is a no-op', () => {
  assert.deepEqual(cancelReleaseAssetTransfer('never-started'), { success: false });
});
