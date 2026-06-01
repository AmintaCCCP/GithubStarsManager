import type { RpcDownloadConfig } from '../types';
import { backend } from './backendAdapter';

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
  const baseUrl = backend.backendUrl;
  if (!baseUrl) {
    return { success: false, error: 'Backend not available' };
  }
  try {
    const resp = await fetch(`${baseUrl}/settings/rpc-download/test`, {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({
        host: config.host,
        port: config.port,
        secret: config.secret,
      }),
    });
    if (!resp.ok) {
      return { success: false, error: `Server returned ${resp.status}` };
    }
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
  const baseUrl = backend.backendUrl;
  if (!baseUrl) {
    return { success: false, error: 'Backend not available' };
  }
  try {
    const resp = await fetch(`${baseUrl}/download/rpc`, {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({ url, filename }),
    });
    if (!resp.ok) {
      return { success: false, error: `Server returned ${resp.status}` };
    }
    return await resp.json();
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : 'Request failed',
    };
  }
}
