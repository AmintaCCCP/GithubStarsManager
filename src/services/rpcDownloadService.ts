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

/**
 * Resolve API base URL.
 *  - Backend mode: use backend.backendUrl (proxied through Express)
 *  - Client-only mode: call aria2 directly at http://host:port
 */
async function getBaseUrl(config?: RpcDownloadConfig): Promise<string> {
  // Try backend first
  if (!backend.isAvailable) {
    await backend.init();
  }
  if (backend.backendUrl) {
    return backend.backendUrl;
  }
  // Fallback: direct aria2 call (client-only mode)
  if (config && config.host && config.port) {
    return `http://${config.host}:${config.port}`;
  }
  throw new Error('Backend not available and no RPC config');
}

/** Call aria2 JSON-RPC directly (client-only mode) */
async function callAria2Direct(
  config: RpcDownloadConfig,
  method: string,
  params: unknown[],
): Promise<Record<string, unknown>> {
  const rpcUrl = `http://${config.host}:${config.port}/jsonrpc`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const resp = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: '1', method, params }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`aria2 returned HTTP ${resp.status}`);
    }
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function testRpcDownload(
  config: RpcDownloadConfig,
  apiSecret?: string,
): Promise<RpcTestResult> {
  try {
    // Client-only mode: call aria2 directly
    if (!backend.isAvailable) {
      const params = config.secret ? [`token:${config.secret}`] : [];
      const data = await callAria2Direct(config, 'aria2.getVersion', params);
      if (data.error) {
        const err = data.error as { message?: string };
        return { success: false, error: err.message || 'RPC error' };
      }
      const result = data.result as Record<string, unknown> | undefined;
      return { success: true, version: result?.version as string | undefined };
    }

    // Backend mode: proxy through Express
    const base = await getBaseUrl();
    const resp = await fetch(`${base}/settings/rpc-download/test`, {
      method: 'POST',
      headers: getAuthHeaders(apiSecret),
      body: JSON.stringify({
        host: config.host,
        port: config.port,
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
    // Client-only mode: call aria2 directly
    if (!backend.isAvailable) {
      const { rpcDownloadConfig } = await import('../store/useAppStore').then(m => m.useAppStore.getState());
      if (!rpcDownloadConfig.enabled || !rpcDownloadConfig.host || !rpcDownloadConfig.port) {
        return { success: false, error: 'RPC download not configured' };
      }
      const params: unknown[] = rpcDownloadConfig.secret
        ? [`token:${rpcDownloadConfig.secret}`, [url]]
        : [[url]];
      if (filename) params.push({ out: filename });
      const data = await callAria2Direct(rpcDownloadConfig, 'aria2.addUri', params);
      if (data.error) {
        const err = data.error as { message?: string };
        return { success: false, error: err.message || 'RPC error' };
      }
      return { success: true, gid: data.result as string };
    }

    // Backend mode: proxy through Express
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
