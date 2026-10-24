import axios, { AxiosRequestConfig } from 'axios';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { Agent as HttpAgent, type AgentOptions as HttpAgentOptions } from 'node:http';
import { Agent as HttpsAgent, type AgentOptions as HttpsAgentOptions } from 'node:https';
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

// 无论严格/宽松档，DNS 解析结果或 IP 字面量命中一律拒绝：云元数据（IMDS 的
// v4/v6 端点）与未指定地址不可能是合法业务目标。宽松档（allowPrivate）仅
// 豁免私网/回环段。
const ALWAYS_BLOCKED_RESOLVED_IPS = new Set(['169.254.169.254', 'fd00:ec2::254', '0.0.0.0', '::']);

// axios 自动跟随重定向时不会重跑目标校验，改为手动逐跳处理（见 proxyRequest）。
const MAX_REDIRECT_HOPS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// 跨主机重定向不携带的凭证头，防止 Authorization/Cookie 泄露到跳转目标。
const CREDENTIAL_HEADERS = new Set(['authorization', 'cookie', 'proxy-authorization']);

/** 解析 hostname 并校验全部解析结果（IMDS 封禁 + 严格档私网段）。
 *  解析失败时放行——后续连接会以同样的 DNS 错误自然失败。
 *  仅用于代理模式：直连请求由 createSafeLookup 的连接级固定负责。 */
async function assertResolvedHostsSafe(rawUrl: string, allowPrivate: boolean): Promise<void> {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname;
  } catch {
    return; // URL 本身非法，validateUrl 会给出明确错误
  }
  // URL.hostname 不含方括号，这里防御性剥离后判断 IP 字面量
  const bareHostname = hostname.replace(/^\[|\]$/g, '');
  if (isIP(bareHostname)) {
    // IP 字面量已在 validateUrl 按字面量校验；宽松档的 validateUrl 只封 v4
    // IMDS，这里对全部字面量再兜底一道 IMDS/未指定地址死守
    if (ALWAYS_BLOCKED_RESOLVED_IPS.has(bareHostname)) {
      throw new Error(`Blocked proxy request: protected address '${bareHostname}' is not allowed`);
    }
    return;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return;
  }
  // 归一化覆盖 ::ffff:169.254.169.254 等 IPv4 映射型写法
  const violating = addresses.find(({ address }) => {
    const normalized = normalizeHostname(address);
    return ALWAYS_BLOCKED_RESOLVED_IPS.has(normalized) || (!allowPrivate && isPrivateOrLoopback(normalized));
  });
  if (violating) {
    const normalized = normalizeHostname(violating.address);
    const kind = ALWAYS_BLOCKED_RESOLVED_IPS.has(normalized) ? 'protected' : 'private';
    throw new Error(`Blocked proxy request: hostname '${hostname}' resolves to ${kind} address '${normalized}'`);
  }
}

/** 过滤出策略允许的解析结果：IMDS/未指定地址任何档位拒绝，严格档额外拒绝私网/回环段。 */
function filterAllowedAddresses(allowPrivate: boolean, addresses: LookupAddress[]): LookupAddress[] {
  return addresses.filter(({ address }) => {
    const normalized = normalizeHostname(address);
    if (ALWAYS_BLOCKED_RESOLVED_IPS.has(normalized)) return false;
    if (!allowPrivate && isPrivateOrLoopback(normalized)) return false;
    return true;
  });
}

type SafeLookupCallback = (err: Error | null, address?: string | LookupAddress[], family?: number) => void;
type SafeLookup = (hostname: string, options: LookupOptions, callback: SafeLookupCallback) => void;

/** 连接级固定：自定义 lookup 在解析时即执行策略校验，Node 直接连接校验通过的
 *  IP，消除「校验通过后、实际连接前被 DNS 重绑定」的窗口。校验失败的候选被
 *  剔除；若全部候选都被拒绝则整个解析失败（连接不发起）。 */
export function createSafeLookup(allowPrivate: boolean): SafeLookup {
  return (hostname, options, callback) => {
    lookup(hostname, { all: true, verbatim: true })
      .then((all) => {
        const valid = filterAllowedAddresses(allowPrivate, all);
        if (!valid.length) {
          callback(new Error(`Blocked proxy request: hostname '${hostname}' has no allowed resolved address`));
          return;
        }
        if (options.all) {
          callback(null, valid);
          return;
        }
        if (options.family === 4 || options.family === 6) {
          const match = valid.find((a) => a.family === options.family);
          if (!match) {
            const err = new Error(`No IPv${options.family} record for '${hostname}' passed policy`) as NodeJS.ErrnoException;
            err.code = 'ENOTFOUND';
            callback(err);
            return;
          }
          callback(null, match.address, match.family);
          return;
        }
        callback(null, valid[0].address, valid[0].family);
      })
      .catch((err: Error) => callback(err));
  };
}

// 直连 Agent 按 allowPrivate 两档缓存（默认无 keepAlive，socket 用完即断，无泄漏）
const directAgentCache = new Map<boolean, { httpAgent: HttpAgent; httpsAgent: HttpsAgent }>();
function getDirectAgents(allowPrivate: boolean): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
  let cached = directAgentCache.get(allowPrivate);
  if (!cached) {
    const safeLookup = createSafeLookup(allowPrivate) as unknown as HttpAgentOptions['lookup'];
    cached = {
      httpAgent: new HttpAgent({ lookup: safeLookup } as HttpAgentOptions),
      httpsAgent: new HttpsAgent({ lookup: safeLookup } as unknown as HttpsAgentOptions),
    };
    directAgentCache.set(allowPrivate, cached);
  }
  return cached;
}

export interface ValidateUrlOptions {
  /** 宽松模式：放行回环地址与私有网段。仅用于「用户主动提供的自有配置」所来源的 URL
   *  （已保存的 AI / WebDAV 配置、WebDAV 测试连接的内联地址、下载目标），
   *  不应作用于任意或半可信的输入（如 AI 内联 config）。 */
  allowPrivate?: boolean;
}

/** 归一化 hostname：去掉 IPv6 方括号、去掉结尾点号（防 `localhost.`/`127.0.0.1.` 绕过），
 *  并把 IPv4 映射型 IPv6（如 [::ffff:169.254.169.254]）还原为对应的 IPv4 字符串，
 *  使 SSRF 过滤看到真实的目标地址。 */
function normalizeHostname(hostname: string): string {
  // Strip trailing dot first to prevent SSRF bypasses (e.g. "localhost." or "127.0.0.1.")
  const h = hostname.replace(/\.$/, '').replace(/^\[(.+)\]$/, '$1').toLowerCase();
  // Handle hybrid IPv4-mapped IPv6 written with dotted decimals (::ffff:169.254.169.254)
  if (h.startsWith('::ffff:') && h.includes('.')) {
    return h.slice(7);
  }
  // Handle IPv4-mapped IPv6 written in hex form (::ffff:a9fe:a9fe)
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

/** IPv6 私有/本地网段前缀：唯一本地地址 fc00::/7、链路本地 fe80::/10、组播 ff00::/8 */
function isPrivateOrLocalIpv6(h: string): boolean {
  if (!h.includes(':')) return false;
  return (
    h.startsWith('fc') || h.startsWith('fd') ||
    h.startsWith('fe8') || h.startsWith('fe9') ||
    h.startsWith('fea') || h.startsWith('feb') ||
    h.startsWith('ff')
  );
}

function isLocalOrLanHostname(h: string): boolean {
  return (
    h.endsWith('.local') ||
    h.endsWith('.lan') ||
    h.endsWith('.home') ||
    h.endsWith('.internal') ||
    h.endsWith('.corp') ||
    h.endsWith('.home.arpa')
  );
}

/** 判断 hostname 是否为回环地址或私有网段（含 IPv6 私有/本地网段）。 */
export function isPrivateOrLoopback(hostname: string): boolean {
  const h = normalizeHostname(hostname);
  if (BLOCKED_HOSTS.has(h)) return true;
  if (isLocalOrLanHostname(h)) return true;
  if (PRIVATE_IP_PATTERNS.some(p => p.test(h))) return true;
  if (isPrivateOrLocalIpv6(h)) return true;
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
    // 宽松模式：仍死守云元数据 IMDS 地址（v4/v6 端点）与未指定地址——最高危的 SSRF 目标（云厂商密钥）。
    if (ALWAYS_BLOCKED_RESOLVED_IPS.has(hostname)) {
      throw new Error(`Blocked proxy request: protected address '${hostname}' is not allowed`);
    }
    return;
  }

  // 严格模式（默认）：拦截回环地址与私有网段（含 IPv6 私有/本地网段及局域网主机名）。
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`Blocked proxy request: hostname '${hostname}' is not allowed`);
  }
  if (isLocalOrLanHostname(hostname)) {
    throw new Error(`Blocked proxy request: LAN hostname '${hostname}' is not allowed`);
  }
  if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) {
    throw new Error(`Blocked proxy request: private IP '${hostname}' is not allowed`);
  }
  if (isPrivateOrLocalIpv6(hostname)) {
    throw new Error(`Blocked proxy request: private IPv6 address '${hostname}' is not allowed`);
  }
}

export async function proxyRequest(options: ProxyRequestOptions): Promise<ProxyResponse> {
  const { url, method, headers = {}, body, timeout = 30000, proxyConfig, preserveRawResponse = false } = options;

  try {
    validateUrl(url, { allowPrivate: options.allowPrivate });
    if (proxyConfig?.enabled) {
      // 代理模式下目标由远程代理解析，无法本地固定连接地址：以本地解析结果做
      // 预检（覆盖同宿主/共享解析器的常见部署），远程代理自身的出口策略是用户
      // 显式选择的委派边界。直连请求由下方注入的 safe lookup 在连接级强制执行。
      await assertResolvedHostsSafe(url, Boolean(options.allowPrivate));
    }
    logger.info('proxy.request', `${method} ${redactUrl(url)}`);

    // 代理配置只依赖 proxyConfig，循环外构建一次，每一跳复用。
    // 直连时注入带策略校验的 lookup（连接级固定，杜绝校验后重绑定）。
    let httpAgent: AxiosRequestConfig['httpAgent'];
    let httpsAgent: AxiosRequestConfig['httpsAgent'];
    let proxySetting: AxiosRequestConfig['proxy'];
    if (proxyConfig?.enabled && proxyConfig.host && proxyConfig.port) {
      if (proxyConfig.type === 'socks5') {
        // SOCKS5: axios 不原生支持，使用 socks-proxy-agent
        const { SocksProxyAgent } = await import('socks-proxy-agent');
        const socksUrl = `socks5://${proxyConfig.host}:${proxyConfig.port}`;
        const agent = new SocksProxyAgent(socksUrl);
        httpAgent = agent;
        httpsAgent = agent;
        proxySetting = false; // 禁用 axios 内置代理，使用自定义 agent
      } else {
        // HTTP/HTTPS 代理
        proxySetting = {
          protocol: 'http',
          host: proxyConfig.host,
          port: proxyConfig.port,
        };
        if (proxyConfig.username && proxyConfig.password) {
          proxySetting.auth = {
            username: proxyConfig.username,
            password: proxyConfig.password,
          };
        }
      }
    } else {
      // 显式禁用代理，防止 axios 回退到环境变量 HTTP_PROXY/HTTPS_PROXY
      proxySetting = false;
      const direct = getDirectAgents(Boolean(options.allowPrivate));
      httpAgent = direct.httpAgent;
      httpsAgent = direct.httpsAgent;
    }

    // 关闭 axios 自动重定向，手动逐跳跟随：每一跳都重跑 validateUrl 与
    // DNS 解析校验，防止初始 URL 合法、重定向到内网/IMDS 绕过策略。
    let currentUrl = url;
    let currentMethod = method;
    let currentBody = body;
    let currentHeaders = headers;

    for (let hop = 0; ; hop++) {
      const axiosConfig: AxiosRequestConfig = {
        url: currentUrl,
        method: currentMethod.toLowerCase() as AxiosRequestConfig['method'],
        headers: currentHeaders,
        timeout,
        maxRedirects: 0, // 重定向由本循环处理，axios 只发单跳
        proxy: proxySetting,
        validateStatus: () => true, // 不抛出 HTTP 错误状态码
      };
      if (httpAgent) {
        axiosConfig.httpAgent = httpAgent;
        axiosConfig.httpsAgent = httpsAgent;
      }
      if (preserveRawResponse) {
        axiosConfig.responseType = 'text';
        axiosConfig.transformResponse = [(data) => data];
      }

      if (currentBody && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
        axiosConfig.data = currentBody;
        const hasContentType = Object.keys(currentHeaders).some(
          k => k.toLowerCase() === 'content-type'
        );
        if (!hasContentType && typeof currentBody === 'object') {
          axiosConfig.headers = { ...axiosConfig.headers, 'Content-Type': 'application/json' };
        }
      }

      // codeql[js/request-forgery] 目标 URL 均先过 validateUrl（协议白名单、IMDS 硬封禁、私网段策略，
      // 含逐跳重定向校验与 DNS 解析结果校验）；用户主动提供的自有配置来源（已保存的 AI/WebDAV 配置、
      // WebDAV 测试连接的内联地址、下载目标）按业务必须支持无证书 http 内网地址，allowPrivate 仅对这些
      // 来源放开；AI 内联 config 等任意输入保持严格档。
      const response = await axios(axiosConfig);

      if (REDIRECT_STATUSES.has(response.status) && hop < MAX_REDIRECT_HOPS) {
        const location = response.headers?.location;
        if (typeof location === 'string' && location) {
          const nextUrl = new URL(location, currentUrl).toString();
          // 跨 origin（跨主机，或同主机 HTTPS→HTTP 降级）跳转不携带凭证头，
          // 防止 Authorization/Cookie 泄露到其他主机或明文通道
          if (new URL(nextUrl).origin !== new URL(currentUrl).origin) {
            currentHeaders = Object.fromEntries(
              Object.entries(currentHeaders).filter(([k]) => !CREDENTIAL_HEADERS.has(k.toLowerCase())),
            );
          }
          // 与 follow-redirects 既有语义保持一致：303 固定转 GET；
          // 301/302 对 POST 转 GET；307/308 及其余方法（WebDAV PROPFIND 等）
          // 保留原方法与请求体
          if (response.status === 303
            || ((response.status === 301 || response.status === 302) && currentMethod.toUpperCase() === 'POST')) {
            currentMethod = 'GET';
            currentBody = undefined;
          }
          currentUrl = nextUrl;
          validateUrl(currentUrl, { allowPrivate: options.allowPrivate });
          if (proxyConfig?.enabled) {
            await assertResolvedHostsSafe(currentUrl, Boolean(options.allowPrivate));
          }
          logger.info('proxy.redirect', `${response.status} -> ${redactUrl(currentUrl)}`);
          continue;
        }
      }

      logger.info('proxy.response', `${currentMethod} ${redactUrl(currentUrl)} -> ${response.status}`);

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
    }
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
