import type { RpcDownloadConfig } from '../types';

interface RpcTestResult {
  success: boolean;
  error?: string;
  version?: string;
}

interface RpcDownloadResult {
  success: boolean;
  error?: string;
  gid?: string;
}

function getAuthHeaders(apiSecret?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiSecret) {
    headers['Authorization'] = `Bearer ${apiSecret}`;
  }
  return headers;
}

export async function testRpcDownload(
  config: RpcDownloadConfig,
  apiSecret?: string,
): Promise<RpcTestResult> {
  try {
    const resp = await fetch('/api/settings/rpc-download/test', {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({
        host: config.host,
        port: config.port,
        secret: config.secret,
      }),
    });
    return await resp.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Request failed',
    };
  }
}

export async function sendToRpcDownload(
  url: string,
  filename: string,
  apiSecret?: string,
): Promise<RpcDownloadResult> {
  try {
    const resp = await fetch('/api/download/rpc', {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({ url, filename }),
    });
    return await resp.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Request failed',
    };
  }
}
