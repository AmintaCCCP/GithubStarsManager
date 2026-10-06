import { WebDAVConfig } from '../types';
import { logger } from './logger';
import { backend } from './backendAdapter';

export class WebDAVService {
  private config: WebDAVConfig;

  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  // 压缩JSON数据，减少传输大小
  private compressData(content: string): string {
    try {
      const data = JSON.parse(content);
      return JSON.stringify(data);
    } catch (e) {
      logger.warn('webdav', 'JSON压缩失败，使用原始内容', e);
      return content;
    }
  }

  // 检测文件是否过大，提供优化建议
  private analyzeFileSize(content: string): { sizeKB: number; isLarge: boolean; suggestions: string[] } {
    const sizeKB = Math.round(content.length / 1024);
    const isLarge = sizeKB > 1024; // 超过1MB认为是大文件
    const suggestions: string[] = [];

    if (isLarge) {
      suggestions.push('考虑减少备份数据量');
      if (content.length > 5 * 1024 * 1024) { // 5MB
        suggestions.push('文件过大，建议启用数据筛选或分片备份');
      }
    }

    return { sizeKB, isLarge, suggestions };
  }

  // 确定的非瞬时错误：DNS 解析失败、连接被拒、证书/TLS 校验失败、代理隧道失败。
  // 这类失败重试只会得到同样的结果，直接抛出让用户尽快看到可操作提示
  private static readonly NON_TRANSIENT_CAUSE =
    /ENOTFOUND|ERR_NAME_NOT_RESOLVED|EAI_AGAIN|ECONNREFUSED|ERR_CONNECTION_REFUSED|_CERT|UNABLE_TO_|ERR_SSL|EPROTO|ERR_PROXY|ERR_TUNNEL/i;

  // 重试机制
  private async retryUpload<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: unknown) {
        lastError = error as Error;

        if (attempt === maxRetries) {
          throw lastError;
        }

        const errMsg = lastError.message;
        const causeCode = (lastError as { causeCode?: string }).causeCode ?? '';
        const shouldRetry =
          !WebDAVService.NON_TRANSIENT_CAUSE.test(`${causeCode} ${errMsg}`) &&
          (errMsg.includes('超时') ||
            errMsg.includes('timeout') ||
            errMsg.includes('NetworkError') ||
            errMsg.includes('fetch'));

        if (!shouldRetry) {
          throw lastError;
        }

        logger.warn('webdav', `上传失败，第${attempt}次重试`, { attempt, errMsg, delay });
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // 指数退避
      }
    }

    throw lastError!;
  }

  private getAuthHeader(): string {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return `Basic ${credentials}`;
  }

  private getFullPath(filename: string): string {
    const basePath = this.config.path.endsWith('/') ? this.config.path : `${this.config.path}/`;
    return `${this.config.url}${basePath}${filename}`;
  }

  // 相对配置 URL 的路径（不含协议与主机），用于交给后端代理
  private getRelativePath(filename: string): string {
    const basePath = this.config.path.endsWith('/') ? this.config.path : `${this.config.path}/`;
    return `${basePath}${filename}`;
  }

  /**
   * 发起 WebDAV 请求，按可用性依次选择传输层：
   * 1. Electron 桌面版：主进程代发（渲染进程没有后端，且 file:// 源同样受 CORS 约束）
   * 2. 后端可用：POST /api/proxy/webdav，由服务端代为请求
   * 3. 纯浏览器 / 静态部署：回退为浏览器直连
   * @param requestPath 相对配置 URL 的路径，如 "/backup/data.json"
   * @param init.timeoutMs 业务级超时，需与调用方的 AbortController 保持一致
   */
  private async davFetch(
    method: string,
    requestPath: string,
    init?: { headers?: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Response> {
    const targetUrl = `${this.config.url}${requestPath}`;

    if (window.electronAPI?.webdavRequest) {
      return this.desktopDavFetch(method, targetUrl, init);
    }

    if (backend.isAvailable) {
      // Authorization 由后端依据配置生成，避免两份凭据冲突
      const forwardHeaders: Record<string, string> = { ...(init?.headers ?? {}) };
      delete forwardHeaders['Authorization'];
      return backend.proxyWebDAV(
        this.config.id,
        method,
        requestPath,
        init?.body,
        forwardHeaders,
        { url: this.config.url, username: this.config.username, password: this.config.password },
        init?.signal,
        init?.timeoutMs,
      );
    }

    return fetch(targetUrl, {
      method,
      headers: init?.headers,
      body: init?.body,
      signal: init?.signal,
    });
  }

  /**
   * 桌面版主进程代发 WebDAV 请求，并还原成标准 Response，
   * 使上层调用方（依赖 response.ok / status / text()）无需区分传输层。
   */
  private async desktopDavFetch(
    method: string,
    targetUrl: string,
    init?: { headers?: Record<string, string>; body?: string; signal?: AbortSignal; timeoutMs?: number },
  ): Promise<Response> {
    const result = await window.electronAPI!.webdavRequest!({
      url: targetUrl,
      method,
      headers: init?.headers ?? {},
      body: init?.body,
      timeoutMs: init?.timeoutMs,
    });

    if (!result.success) {
      // 归一成 AbortError，让上层沿用既有的超时提示文案
      if (result.timedOut) {
        throw new DOMException('WebDAV request timed out', 'AbortError');
      }
      const err = new TypeError(result.error || 'WebDAV request failed');
      // 结构化 cause 供 handleNetworkError 映射为可操作的排查建议
      if (result.causeCode) (err as Error & { causeCode?: string }).causeCode = result.causeCode;
      throw err;
    }

    const bodyless = result.status === 204 || result.status === 304 || method === 'HEAD';
    return new Response(bodyless ? null : (result.body ?? ''), {
      status: result.status,
      statusText: result.statusText,
      headers: result.contentType ? { 'Content-Type': result.contentType } : undefined,
    });
  }

  private handleNetworkError(error: unknown, operation: string): never {
    logger.error('webdav', `WebDAV ${operation} failed`, error);

    const err = error as Error & { causeCode?: string };

    // 桌面版：请求由主进程代发，不存在 CORS 限制；失败是真实的网络/TLS 问题，
    // 按主进程透传的底层错误码给出可操作的排查建议。判断条件须与 davFetch 的
    // 传输层选择一致（electronAPI 存在但未暴露 webdavRequest 的旧 preload 会
    // 走后端/浏览器直连路径，不能套用主进程文案）
    if (window.electronAPI?.webdavRequest) {
      throw new Error(this.describeDesktopFailure(err, operation));
    }

    const isCorsError = (
      (err.name === 'TypeError' && err.message.includes('Failed to fetch')) ||
      (err.message && err.message.includes('NetworkError when attempting to fetch resource')) ||
      (err.name === 'NetworkError') ||
      (err.message && err.message.includes('NetworkError')) ||
      // Safari 对同类网络失败的文案
      (err.message && err.message.includes('Load failed'))
    );

    if (isCorsError) {
      throw new Error(`CORS策略阻止了连接到WebDAV服务器。

这是一个常见的浏览器安全限制。要解决此问题，您需要：

1. 在WebDAV服务器上配置CORS头：
   • Access-Control-Allow-Origin: ${window.location.origin}
   • Access-Control-Allow-Methods: GET, PUT, PROPFIND, HEAD, OPTIONS, MKCOL
   • Access-Control-Allow-Headers: Authorization, Content-Type, Depth

2. 常见WebDAV服务器配置示例：

   Apache (.htaccess):
   Header always set Access-Control-Allow-Origin "${window.location.origin}"
   Header always set Access-Control-Allow-Methods "GET, PUT, PROPFIND, HEAD, OPTIONS, MKCOL"
   Header always set Access-Control-Allow-Headers "Authorization, Content-Type, Depth"

   Nginx:
   add_header Access-Control-Allow-Origin "${window.location.origin}";
   add_header Access-Control-Allow-Methods "GET, PUT, PROPFIND, HEAD, OPTIONS, MKCOL";
   add_header Access-Control-Allow-Headers "Authorization, Content-Type, Depth";

3. 其他检查项：
   • 确保WebDAV服务器正在运行
   • 验证URL格式正确（包含协议 http:// 或 https://）
   • 如果应用使用HTTPS，WebDAV服务器也应使用HTTPS

技术详情: ${err.message}`);
    }
    
    throw new Error(`WebDAV ${operation} 失败: ${err.message || '未知错误'}`);
  }

  /**
   * 桌面版（主进程代发）网络失败的可操作描述。主进程会回传 cause 链与
   * causeCode（undici 的 "fetch failed" 本身不含信息），这里映射为排查建议：
   * 先按结构化 causeCode 精确归类（它是主进程认定的最相关失败），
   * 匹配不到再退一步对消息全文做包含匹配（覆盖另一网络栈的明细文本）。
   */
  private describeDesktopFailure(err: Error & { causeCode?: string }, operation: string): string {
    const ADVICE_BY_TOKENS: Array<{ tokens: string[]; advice: string }> = [
      {
        tokens: ['ENOTFOUND', 'EAI_AGAIN', 'ERR_NAME_NOT_RESOLVED'],
        advice: '无法解析 WebDAV 服务器地址。请检查 URL 中的主机名是否正确，以及当前网络的 DNS 是否可用。',
      },
      {
        tokens: ['ECONNREFUSED', 'ERR_CONNECTION_REFUSED'],
        advice: '服务器拒绝了连接。请确认 WebDAV 服务已启动且端口正确；如果是局域网地址，请确认本机与服务器在同一网络内。',
      },
      {
        tokens: ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT', 'ERR_CERT_AUTHORITY_INVALID'],
        advice: '服务器证书未被信任（常见于自签名证书）。请为 WebDAV 服务器配置受信任的证书；局域网服务可改用 http:// 地址。',
      },
      {
        tokens: ['CERT_HAS_EXPIRED', 'ERR_CERT_DATE_INVALID'],
        advice: '服务器证书已过期。请更新 WebDAV 服务器的证书；局域网服务可改用 http:// 地址。',
      },
      {
        tokens: ['ERR_PROXY_CONNECTION_FAILED', 'ERR_TUNNEL_CONNECTION_FAILED', 'ERR_PROXY_AUTH_UNSUPPORTED', 'ERR_MANDATORY_PROXY_CONFIGURATION_FAILED'],
        advice: '经由代理连接失败。请检查“设置 → 网络设置”中的代理配置是否可用；也可以暂时关闭应用内代理、改用系统代理后重试。',
      },
      {
        tokens: ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'ERR_TIMED_OUT'],
        advice: '连接超时。请检查本机网络；如果需要通过代理/VPN 访问该服务器，请在“设置 → 网络设置”中配置代理后重试。',
      },
      {
        tokens: ['ENETUNREACH', 'EHOSTUNREACH', 'ERR_ADDRESS_UNREACHABLE', 'ERR_NETWORK_UNREACHABLE'],
        advice: '网络不可达。请检查本机网络连接；如果是局域网地址，请确认本机与服务器在同一网络内。',
      },
      {
        tokens: ['ECONNRESET', 'ERR_CONNECTION_RESET'],
        advice: '连接被重置。服务器或中间网络设备中断了连接，请稍后重试或检查服务器配置。',
      },
      {
        tokens: ['EPROTO', 'ERR_SSL', 'SSLV3_ALERT', 'TLSV1_ALERT', 'ERR_SSL_PROTOCOL_ERROR'],
        advice: 'TLS 握手失败。请确认 URL 的协议与服务器匹配（http/https 不要填错），并检查服务器的 TLS 配置。',
      },
    ];

    const codeUpper = (err.causeCode ?? '').toUpperCase();
    const text = `${codeUpper} ${err.message ?? ''}`.toUpperCase();
    // 结构化 code 优先（避免消息里多栈明细文本抢错分类），全文匹配兜底
    let advice: string | null = null;
    if (codeUpper) {
      advice = ADVICE_BY_TOKENS.find((b) => b.tokens.some((t) => codeUpper === t))?.advice ?? null;
    }
    if (!advice) {
      advice = ADVICE_BY_TOKENS.find((b) => b.tokens.some((t) => text.includes(t)))?.advice ?? null;
    }

    if (advice) {
      return `WebDAV ${operation} 失败：${advice}\n\n技术详情: ${err.message}`;
    }
    return `WebDAV ${operation} 失败: ${err.message || '未知错误'}\n\n提示：桌面版的 WebDAV 请求由主进程代发。若服务器需要代理/VPN 才能访问，请在“设置 → 网络设置”中配置代理；若服务器使用自签名证书，请改用受信任的证书或 http:// 地址。`;
  }

  async testConnection(): Promise<boolean> {
    try {
      // 验证URL格式
      if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
        throw new Error('WebDAV URL必须以 http:// 或 https:// 开头');
      }

      // 测试配置中的 path（交由 davFetch 决定走后端代理还是浏览器直连）

      // 先用 PROPFIND（Depth: 0）探测：这是 WebDAV 规范（RFC 4918）定义的标准方法，
      // 成功返回 200 或 207 Multi-Status。HEAD 并非 WebDAV 规范的必备方法，部分
      // 服务器（如坚果云 dav.jianguoyun.com）对集合路径的 HEAD 直接返回 403，
      // 若以 HEAD 首发会让每次测试连接都多付一次 403 往返与一条警告日志。
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

      try {
        let propfindResponse: Response;
        try {
          propfindResponse = await this.davFetch('PROPFIND', this.config.path, {
            headers: {
              'Authorization': this.getAuthHeader(),
              'Depth': '0',
            },
            signal: controller.signal,
            timeoutMs: 10000,
          });
        } catch (propfindError: unknown) {
          // 浏览器直连时，PROPFIND 可能被 CORS 预检直接拒绝而抛网络错误
          //（HEAD 是 CORS 安全方法、无预检问题）：非超时错误时降级 HEAD 再试，
          // 不能把可用的连接误报为失败。超时错误仍按连接超时处理。
          if ((propfindError as Error).name === 'AbortError') throw propfindError;
          const headAfterError = await this.davFetch('HEAD', this.config.path, {
            headers: {
              'Authorization': this.getAuthHeader(),
            },
            signal: controller.signal,
            timeoutMs: 10000,
          });
          clearTimeout(timeoutId);
          return headAfterError.ok;
        }

        clearTimeout(timeoutId);

        if (propfindResponse.ok || propfindResponse.status === 207) return true;

        // PROPFIND 不可用时，降级尝试 HEAD（兼容仅放行普通 HTTP 方法的网关/服务器）。
        // 回退请求共用同一 AbortController，让 10 秒超时覆盖整个探测过程。
        const headResponse = await this.davFetch('HEAD', this.config.path, {
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
          timeoutMs: 10000,
        });

        clearTimeout(timeoutId);
        return headResponse.ok;
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);

        if ((fetchError as Error).name === 'AbortError') {
          throw new Error('连接超时。请检查WebDAV服务器是否可访问。');
        }

        throw fetchError;
      }
    } catch (error: unknown) {
      return this.handleNetworkError(error, '连接测试');
    }
  }

  async uploadFile(filename: string, content: string): Promise<boolean> {
    try {
      // 验证URL格式
      if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
        throw new Error('WebDAV URL必须以 http:// 或 https:// 开头');
      }

      // 分析文件大小并压缩数据
      const fileAnalysis = this.analyzeFileSize(content);
      const compressedContent = this.compressData(content);

      if (fileAnalysis.isLarge) {
        logger.warn('webdav', '大文件备份', { sizeKB: fileAnalysis.sizeKB, suggestions: fileAnalysis.suggestions });
      }

      logger.info('webdav', '文件大小', { sizeKB: fileAnalysis.sizeKB, compressedKB: Math.round(compressedContent.length / 1024) });

      // 确保目录存在
      await this.ensureDirectoryExists();

      // 动态计算超时时间：基于压缩后文件大小，最小60秒，最大300秒
      const finalSizeKB = Math.round(compressedContent.length / 1024);
      const dynamicTimeout = Math.max(60000, Math.min(300000, finalSizeKB * 100)); // 每KB 100ms
      logger.info('webdav', '设置超时时间', { dynamicTimeout });

      const uploadOperation = async (): Promise<boolean> => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), dynamicTimeout);
        const sanitizedPath = this.getFullPath(filename).replace(/^https?:\/\/[^/]+/, '');
        const startTime = Date.now();

        try {
          const response = await this.davFetch('PUT', this.getRelativePath(filename), {
            headers: {
              'Authorization': this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: compressedContent,
            signal: controller.signal,
            timeoutMs: dynamicTimeout,
          });

          clearTimeout(timeoutId);

          if (logger.isDebugMode()) {
            logger.debug('webdav', 'WebDAV request', { method: 'PUT', path: sanitizedPath, status: response.status, durationMs: Date.now() - startTime });
          }

          if (!response.ok) {
            if (response.status === 401) {
              throw new Error('身份验证失败。请检查用户名和密码。');
            }
            if (response.status === 403) {
              throw new Error('访问被拒绝。请检查指定路径的权限。');
            }
            if (response.status === 404) {
              throw new Error('路径未找到。请验证WebDAV URL和路径是否正确。');
            }
            if (response.status === 507) {
              throw new Error('服务器存储空间不足。');
            }
            throw new Error(`上传失败，HTTP状态码 ${response.status}: ${response.statusText}`);
          }

          return true;
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);

          if ((fetchError as Error).name === 'AbortError') {
            throw new Error(`上传超时 (${finalSizeKB}KB文件，${dynamicTimeout/1000}秒限制)。建议检查网络连接或联系管理员优化服务器配置。`);
          }

          throw fetchError;
        }
      };

      return await this.retryUpload(uploadOperation);
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes('身份验证失败') || 
          err.message.includes('访问被拒绝') || 
          err.message.includes('路径未找到') ||
          err.message.includes('存储空间不足') ||
          err.message.includes('上传失败，HTTP状态码') ||
          err.message.includes('上传超时') ||
          err.message.includes('WebDAV URL必须')) {
        throw error;
      }
      return this.handleNetworkError(error, '上传');
    }
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      if (!this.config.path || this.config.path === '/') {
        return; // 根目录总是存在
      }

      // 逐级创建目录，避免服务器因中间目录不存在而返回 409/403
      const cleanedPath = this.config.path.replace(/\/+$/, ''); // 去掉末尾斜杠
      const segments = cleanedPath.split('/').filter(Boolean); // 去掉空段
      let currentPath = '';

      for (const seg of segments) {
        currentPath += `/${seg}`;
        try {
          const res = await this.davFetch('MKCOL', currentPath, {
            headers: { 'Authorization': this.getAuthHeader() },
            timeoutMs: 15000,
          });

          // 201 Created（新建）或 405 Method Not Allowed（已存在）都视为成功
          if (!res.ok && res.status !== 405) {
            // 某些服务器对已存在目录返回 409 Conflict
            if (res.status !== 409) {
              logger.warn('webdav', '无法创建目录', { currentPath, status: res.status });
              break; // 不再继续往下建
            }
          }
        } catch (e) {
          logger.warn('webdav', '创建目录发生异常', { currentPath, error: e });
          break;
        }
      }
    } catch (error) {
      logger.warn('webdav', '目录创建检查失败', error);
      // 不在这里抛出错误，因为目录可能已经存在
    }
  }

  async downloadFile(filename: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时
      const sanitizedPath = this.getFullPath(filename).replace(/^https?:\/\/[^/]+/, '');
      const startTime = Date.now();

      try {
        const response = await this.davFetch('GET', this.getRelativePath(filename), {
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
          timeoutMs: 30000,
        });

        clearTimeout(timeoutId);

        if (logger.isDebugMode()) {
          logger.debug('webdav', 'WebDAV request', { method: 'GET', path: sanitizedPath, status: response.status, durationMs: Date.now() - startTime });
        }

        if (response.ok) {
          return await response.text();
        }

        if (response.status === 404) {
          return null; // 文件未找到是预期行为
        }

        if (response.status === 401) {
          throw new Error('身份验证失败。请检查用户名和密码。');
        }

        throw new Error(`下载失败，HTTP状态码 ${response.status}: ${response.statusText}`);
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);

        if ((fetchError as Error).name === 'AbortError') {
          throw new Error('下载超时。请检查网络连接。');
        }

        throw fetchError;
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes('身份验证失败') ||
          err.message.includes('下载超时')) {
        throw error;
      }
      if (err.message.includes('HTTP 404')) {
        return null;
      }
      return this.handleNetworkError(error, '下载');
    }
  }

  async fileExists(filename: string): Promise<boolean> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    try {
      const response = await this.davFetch('HEAD', this.getRelativePath(filename), {
        headers: {
          'Authorization': this.getAuthHeader(),
        },
        signal: controller.signal,
        timeoutMs: 10000,
      });

      // HEAD 并非 WebDAV 规范必备方法：部分服务器（如坚果云）对 HEAD 返回 403，
      // 不能据此断定文件不存在。降级用 PROPFIND（Depth: 0）确认；若 403 出于真实
      // 权限原因，PROPFIND 同样会被拒并如实返回 false。回退请求共用同一
      // AbortController，让 10 秒超时覆盖整个检查过程。
      if (response.status === 403) {
        const propfindResponse = await this.davFetch('PROPFIND', this.getRelativePath(filename), {
          headers: {
            'Authorization': this.getAuthHeader(),
            'Depth': '0',
          },
          signal: controller.signal,
          timeoutMs: 10000,
        });
        clearTimeout(timeoutId);
        return propfindResponse.ok || propfindResponse.status === 207;
      }

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      clearTimeout(timeoutId);
      logger.error('webdav', 'WebDAV文件检查失败', error);
      return false;
    }
  }

  async listFiles(): Promise<string[]> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

      try {
        // 确保目录URL以斜杠结尾，避免部分服务器对集合路径的歧义
        const basePath = this.config.path.endsWith('/') ? this.config.path : `${this.config.path}/`;
        const collectionUrl = `${this.config.url}${basePath}`;

        const response = await this.davFetch('PROPFIND', basePath, {
          headers: {
            'Authorization': this.getAuthHeader(),
            'Depth': '1',
            'Content-Type': 'application/xml',
          },
          body: `<?xml version="1.0" encoding="utf-8" ?>
            <D:propfind xmlns:D="DAV:">
              <D:prop>
                <D:displayname/>
                <D:getlastmodified/>
                <D:getcontentlength/>
              </D:prop>
            </D:propfind>`,
          signal: controller.signal,
          timeoutMs: 15000,
        });

        clearTimeout(timeoutId);

        if (response.ok || response.status === 207) {
          const xmlText = await response.text();

          // 优先用 DOMParser 解析（更可靠，兼容 displayname 缺失的服务端）
          try {
            const parser = new DOMParser();
            const xml = parser.parseFromString(xmlText, 'application/xml');
            const responses = Array.from(xml.getElementsByTagNameNS('DAV:', 'response'));

            const results: string[] = [];

            for (const res of responses) {
              const hrefEl = res.getElementsByTagNameNS('DAV:', 'href')[0];
              if (!hrefEl || !hrefEl.textContent) continue;
              let href = hrefEl.textContent;

              // 过滤掉集合自身（目录本身）
              // 有的服务返回绝对URL，有的返回相对路径，统一去比较末尾路径
              const normalizedCollection = collectionUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '/');
              const normalizedHref = href.replace(/^https?:\/\//, '');
              if (normalizedHref.endsWith(normalizedCollection)) continue;

              // 提取文件名
              try {
                // 去掉末尾斜杠（目录）
                href = href.replace(/\/+$/, '');
                const parts = href.split('/').filter(Boolean);
                if (parts.length === 0) continue;
                const last = decodeURIComponent(parts[parts.length - 1]);
                if (last.toLowerCase().endsWith('.json')) {
                  results.push(last.trim());
                }
              } catch {
                // 忽略单个条目解析失败
              }
            }

            if (results.length > 0) return results;
          } catch {
            // DOMParser 失败时降级为正则提取 href/displayname
            const namesFromDisplay = (xmlText.match(/<D:displayname>([^<]+)<\/D:displayname>/gi) || [])
              .map(m => m.replace(/<\/?D:displayname>/gi, ''))
              .map(s => s.trim())
              .filter(name => name.toLowerCase().endsWith('.json'));

            if (namesFromDisplay.length > 0) return namesFromDisplay;

            const namesFromHref = (xmlText.match(/<D:href>([^<]+)<\/D:href>/gi) || [])
              .map(m => m.replace(/<\/?D:href>/gi, ''))
              .map(s => s.replace(/\/+$/, ''))
              .map(s => decodeURIComponent(s.split('/').filter(Boolean).pop() || ''))
              .map(s => s.trim())
              .filter(name => name.toLowerCase().endsWith('.json'));

            if (namesFromHref.length > 0) return namesFromHref;
          }
        } else if (response.status === 401) {
          throw new Error('身份验证失败。请检查用户名和密码。');
        } else {
          throw new Error(`列出文件失败，HTTP状态码 ${response.status}: ${response.statusText}`);
        }
        return [];
      } catch (fetchError: unknown) {
        clearTimeout(timeoutId);
        
        if ((fetchError as Error).name === 'AbortError') {
          throw new Error('列出文件超时。请检查网络连接。');
        }
        
        throw fetchError;
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message.includes('身份验证失败') || 
          err.message.includes('列出文件超时')) {
        throw error;
      }
      return this.handleNetworkError(error, '列出文件');
    }
  }

  // 新增：验证配置的静态方法
  static validateConfig(config: Partial<WebDAVConfig>): string[] {
    const errors: string[] = [];

    if (!config.url) {
      errors.push('WebDAV URL是必需的');
    } else if (!config.url.startsWith('http://') && !config.url.startsWith('https://')) {
      errors.push('WebDAV URL必须以 http:// 或 https:// 开头');
    }

    if (!config.username) {
      errors.push('用户名是必需的');
    }

    if (!config.password) {
      errors.push('密码是必需的');
    }

    if (!config.path) {
      errors.push('路径是必需的');
    } else if (!config.path.startsWith('/')) {
      errors.push('路径必须以 / 开头');
    }

    return errors;
  }

  // 新增：获取服务器信息
  async getServerInfo(): Promise<{ server?: string; davLevel?: string }> {
    try {
      const response = await this.davFetch('OPTIONS', '', {
        headers: {
          'Authorization': this.getAuthHeader(),
        },
        timeoutMs: 10000,
      });

      if (response.ok) {
        return {
          server: response.headers.get('Server') || undefined,
          davLevel: response.headers.get('DAV') || undefined,
        };
      }
    } catch (error) {
      logger.warn('webdav', '无法获取服务器信息', error);
    }
    
    return {};
  }
}
