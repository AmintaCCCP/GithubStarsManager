import { useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '../../../store/useAppStore';
import { pluginClient } from '../../../plugins/pluginClient';
import { buildNetworkRequestUrl, isAllowedNetworkTarget } from '../../../plugins/networkTargets';

export interface PluginNetworkValue {
  status: number;
  body: unknown;
}

export type PluginNetworkResult =
  | { success: true; value: PluginNetworkValue }
  | { success: false; error: { code: string; message: string } };

const REQUEST_TIMEOUT_MS = 15_000;
// 洞察类数据集的最大响应体积：52 周统计、前 100 贡献者、精选 Release 列表
// 都远小于该值；边接收边计数，超限立即断开而不是把整个载荷缓冲进内存。
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function argsToRequest(args: unknown): { host: string; path: string; query?: Record<string, unknown> } | null {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  if (typeof record.host !== 'string' || typeof record.path !== 'string') return null;
  if (record.query !== undefined && (!record.query || typeof record.query !== 'object' || Array.isArray(record.query))) return null;
  return { host: record.host, path: record.path, query: record.query as Record<string, unknown> | undefined };
}

/**
 * 边接收边计数的响应文本读取：按字节（chunk.byteLength）限制体积，
 * 超限抛出 TOO_LARGE 并断开流，避免超大响应整包进内存。
 */
async function readBodyWithCap(response: Response, externalSignal: AbortSignal | null): Promise<string> {
  if (!response.body) return '';
  const declaredLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new RangeError('PLUGIN_NETWORK_RESPONSE_TOO_LARGE');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    if (externalSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      void reader.cancel().catch(() => {});
      throw new RangeError('PLUGIN_NETWORK_RESPONSE_TOO_LARGE');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * V1.5 页面网络能力（network.request）的渲染端执行器，与 usePluginAI /
 * usePluginWebSearch 同构：先经主进程 authorize（校验方法白名单与
 * `network:<host>` 权限），通过后由渲染端用用户自己的 GitHub Token 发起
 * 只读 GET。Token 不进 IPC 参数、不进日志；仅 GET、仅白名单端点。
 * `externalSignal`：宿主在页面关闭/重载时中止在途请求，避免带着 Token 的
 * 请求在无人消费结果后继续跑完。
 */
export function usePluginNetwork() {
  const githubToken = useAppStore(useShallow((state) => state.githubToken));

  return useCallback(async function request(
    pluginId: string,
    pageId: string,
    args: Record<string, unknown>,
    isCurrentPage: () => boolean,
    externalSignal?: AbortSignal,
  ): Promise<PluginNetworkResult> {
    const parsed = argsToRequest(args);
    if (!parsed || !isAllowedNetworkTarget(parsed)) {
      return { success: false, error: { code: 'PLUGIN_PAGE_REQUEST_INVALID', message: 'Network request arguments are invalid' } };
    }
    const authorization = await pluginClient.requestPageCapability({
      pluginId, pageId, method: 'network.request', args: { host: parsed.host, path: parsed.path, query: parsed.query ?? {} },
    });
    if (!authorization.success) return authorization;
    if (!isCurrentPage() || externalSignal?.aborted) {
      return { success: false, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };
    }

    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(buildNetworkRequestUrl(parsed), {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
        },
        signal: controller.signal,
        referrerPolicy: 'no-referrer',
      });
      if (response.status === 202 || response.status === 204) {
        return { success: true, value: { status: response.status, body: null } };
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        let hint = '';
        try { hint = String(JSON.parse(detail)?.message ?? ''); } catch { /* keep empty */ }
        return {
          success: false,
          error: {
            code: 'PLUGIN_NETWORK_HTTP_ERROR',
            message: `GitHub API returned ${response.status}${hint ? `: ${hint}` : ''}`,
          },
        };
      }
      let text: string;
      try {
        text = await readBodyWithCap(response, externalSignal ?? null);
      } catch (error) {
        if (error instanceof RangeError) {
          return { success: false, error: { code: 'PLUGIN_NETWORK_RESPONSE_TOO_LARGE', message: 'Network response is too large' } };
        }
        throw error;
      }
      try {
        return { success: true, value: { status: response.status, body: text ? JSON.parse(text) : null } };
      } catch {
        return { success: false, error: { code: 'PLUGIN_NETWORK_RESPONSE_INVALID', message: 'Network response is not valid JSON' } };
      }
    } catch (error) {
      if (!isCurrentPage() || externalSignal?.aborted) {
        return { success: false, error: { code: 'PLUGIN_PAGE_CLOSED', message: 'Plugin page closed' } };
      }
      const aborted = error instanceof DOMException && error.name === 'AbortError';
      return {
        success: false,
        error: {
          code: aborted ? 'PLUGIN_NETWORK_TIMEOUT' : 'PLUGIN_NETWORK_FAILED',
          message: aborted ? 'Network request timed out' : 'Network request failed',
        },
      };
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }, [githubToken]);
}
