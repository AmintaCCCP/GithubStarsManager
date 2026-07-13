import axios, { AxiosRequestConfig } from 'axios';
import { logger } from './logger.js';
import { redactUrl } from './logSanitizer.js';

export interface ProxyConfig {
  enabled: boolean;
  type: 'http' | 'socks5';
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface ProxyRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
  proxyConfig?: ProxyConfig | null;
  preserveRawResponse?: boolean;
  /** 放行回环/私有网段（仅用于用户自有配置来源的 URL）。 */
  allowPrivate?: boolean;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254']);
const PRIVATE_IP_PATTERNS = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];

export interface ValidateUrlOptions {
  /** 宽松模式：放行回环地址与私有网段。仅用于「用户主动保存的自行配置」所来源的 URL
   *  （如 AI / WebDAV / 下载目标），不应作用于任意或半可信的输入。 */
  allowPrivate?: boolean;
}

/** 归一化 hostname：去掉 IPv6 方括号，并把 IPv4 映射型 IPv6（如 [::ffff:169.254.169.254]）
 *  还原为对应的 IPv4 字符串，使 SSRF 过滤看到真实的目标地址。 */
function normalizeHostname(hostname: string): string {
  const h = hostname.replace(/^\[(.+)\]$/, '$1').toLowerCase();
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const octets = [mapped[1], mapped[2]].flatMap((hex) => {
      const v = parseInt(hex, 16);
      return [(v >>> 8) & 0xff, v & 0xff];
    });
    return octets.join('.');
  }
  return h;
}

/** 判断 hostname 是否为回环地址或私有网段。 */
export function isPrivateOrLoopback(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (BLOCKED_HOSTS.has(h)) return true;
  if (PRIVATE_IP_PATTERNS.some(p => p.test(h))) return true;
  return false;
}

export function validateUrl(rawUrl: string, opts: ValidateUrlOptions = {}): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked proxy request: unsupported protocol '${parsed.protocol}'`);
  }

  // 始终拦截 URL 内嵌的用户名/密码（防止凭证泄露到日志）
  if (parsed.username || parsed.password) {
    throw new Error(`Blocked proxy request: URL containing credentials is not allowed`);
  }

  // 归一化后可同时覆盖明文 169.254.169.254 与 [::ffff:a9fe:a9fe] 等 IPv4 映射型写法。
  const hostname = normalizeHostname(parsed.hostname);

  if (opts.allowPrivate) {
    // 宽松模式：仍死守云元数据 IMDS 地址——最高危的 SSRF 目标（云厂商密钥）。
    if (hostname === '169.254.169.254') {
      throw new Error(`Blocked proxy request: IMDS address '169.254.169.254' is not allowed`);
    }
    return;
  }

  // 严格模式（默认）：拦截回环地址与私有网段。
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`Blocked proxy request: hostname '${hostname}' is not allowed`);
  }
  if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) {
    throw new Error(`Blocked proxy request: private IP '${hostname}' is not allowed`);
  }
}

export async function proxyRequest(options: ProxyRequestOptions): Promise<ProxyResponse> {
  const { url, method, headers = {}, body, timeout = 30000, proxyConfig, preserveRawResponse = false } = options;

  try {
    validateUrl(url, { allowPrivate: options.allowPrivate });
    logger.info('proxy.request', `${method} ${redactUrl(url)}`);

    const axiosConfig: AxiosRequestConfig = {
      url,
      method: method.toLowerCase() as AxiosRequestConfig['method'],
      headers,
      timeout,
      validateStatus: () => true, // 不抛出 HTTP 错误状态码
    };
    if (preserveRawResponse) {
      axiosConfig.responseType = 'text';
      axiosConfig.transformResponse = [(data) => data];
    }

    if (body && method !== 'GET' && method !== 'HEAD') {
      axiosConfig.data = body;
      const hasContentType = Object.keys(headers).some(
        k => k.toLowerCase() === 'content-type'
      );
      if (!hasContentType && typeof body === 'object') {
        axiosConfig.headers = { ...axiosConfig.headers, 'Content-Type': 'application/json' };
      }
    }

    // 配置代理
    if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.port) {
      if (proxyConfig.type === 'socks5') {
        // SOCKS5: axios 不原生支持，使用 socks-proxy-agent
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        const socksUrl = `socks5://${proxyConfig.host}:${proxyConfig.port}`;
        const agent = new SocksProxyAgent(socksUrl);
        axiosConfig.httpAgent = agent;
        axiosConfig.httpsAgent = agent;
        axiosConfig.proxy = false; // 禁用 axios 内置代理，使用自定义 agent
      } else {
        // HTTP/HTTPS 代理
        axiosConfig.proxy = {
          protocol: 'http',
          host: proxyConfig.host,
          port: proxyConfig.port,
        };
        if (proxyConfig.username && proxyConfig.password) {
          axiosConfig.proxy.auth = {
            username: proxyConfig.username,
            password: proxyConfig.password,
          };
        }
      }
    } else {
      // 显式禁用代理，防止 axios 回退到环境变量 HTTP_PROXY/HTTPS_PROXY
      axiosConfig.proxy = false;
    }

    const response = await axios(axiosConfig);

    logger.info('proxy.response', `${method} ${redactUrl(url)} -> ${response.status}`);

    const responseHeaders: Record<string, string> = {};
    if (response.headers) {
      for (const [key, value] of Object.entries(response.headers)) {
        responseHeaders[key] = String(value);
      }
    }

    let data: unknown;
    if (preserveRawResponse) {
      data = typeof response.data === 'string' ? response.data : String(response.data ?? '');
    } else {
      const contentType = String(response.headers['content-type'] || '');
      if (contentType.includes('application/json') && typeof response.data === 'object') {
        data = response.data;
      } else if (typeof response.data === 'string') {
        try {
          data = JSON.parse(response.data);
        } catch {
          data = response.data;
        }
      } else {
        data = response.data;
      }
    }

    return { status: response.status, headers: responseHeaders, data };
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        return { status: 504, headers: {}, data: { error: 'Gateway Timeout', code: 'GATEWAY_TIMEOUT' } };
      }
      if (error.code === 'ECONNREFUSED') {
        return { status: 502, headers: {}, data: { error: 'Proxy connection refused', code: 'PROXY_CONNECTION_REFUSED', details: error.message } };
      }
      if (error.code === 'ETIMEDOUT') {
        return { status: 504, headers: {}, data: { error: 'Proxy connection timeout', code: 'PROXY_TIMEOUT', details: error.message } };
      }
      if (error.response) {
        // 请求已发出，服务器返回了错误状态码
        return {
          status: error.response.status,
          headers: {},
          data: error.response.data || { error: 'Upstream error' }
        };
      }
    }
    logger.errorFromError('proxy.error', 'Proxy request failed', error);
    return { status: 502, headers: {}, data: { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: error instanceof Error ? error.message : 'Unknown error' } };
  }
}
