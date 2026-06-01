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

async function getBaseUrl(): Promise<string> {
  // Ensure backendAdapter has probed for the backend URL
  if (!backend.isAvailable) {
    await backend.init();
  }
  if (!backend.backendUrl) {
    throw new Error('Backend not available');
  }
  return backend.backendUrl;
}

export async function testRpcDownload(
  config: RpcDownloadConfig,
  apiSecret?: string,
): Promise<RpcTestResult> {
  try {
    const base = await getBaseUrl();
    const resp = await fetch(`${base}/settings/rpc-download/test`, {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({
        host: config.host,
        port: config.port,
        // Only send secret if user typed one; omit to let backend use stored value
        ...(config.secret ? { secret: config.secret } : {}),
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
  try {
    const base = await getBaseUrl();
    const resp = await fetch(`${base}/download/rpc`, {
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
