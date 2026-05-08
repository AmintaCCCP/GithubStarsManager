import { WebDAVConfig } from '../types';
import { backend } from './backendAdapter';

export class WebDAVService {
  private config: WebDAVConfig;

  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  private get useProxy(): boolean {
    return backend.isAvailable;
  }

  private get basePath(): string {
    return this.config.path.endsWith('/') ? this.config.path : `${this.config.path}/`;
  }

  // 通过后端代理发送请求，避免浏览器 CORS 限制
  private async proxyFetch(
    method: string,
    fullPath: string,
    body?: string,
    headers?: Record<string, string>,
  ): Promise<Response> {
    return backend.proxyWebDAV(this.config.id, method, fullPath, body, headers);
  }

  // 压缩JSON数据，减少传输大小
  private compressData(content: string): string {
    try {
      const data = JSON.parse(content);
      return JSON.stringify(data);
    } catch (e) {
      console.warn('JSON压缩失败，使用原始内容:', e);
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
        const shouldRetry =
          errMsg.includes('超时') ||
          errMsg.includes('timeout') ||
          errMsg.includes('NetworkError') ||
          errMsg.includes('fetch');

        if (!shouldRetry) {
          throw lastError;
        }

        console.warn(`上传失败，第${attempt}次重试 (${delay}ms后):`, errMsg);
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
    return `${this.config.url}${this.basePath}${filename}`;
  }

  private getRelativePath(filename: string): string {
    return `${this.basePath}${filename}`;
  }

  private handleNetworkError(error: unknown, operation: string): never {
    console.error(`WebDAV ${operation} failed:`, error);

    const err = error as Error;
    const isCorsError = (
      (err.name === 'TypeError' && err.message.includes('Failed to fetch')) ||
      (err.message && err.message.includes('NetworkError when attempting to fetch resource')) ||
      (err.name === 'NetworkError') ||
      (err.message && err.message.includes('NetworkError'))
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

  async testConnection(): Promise<boolean> {
    try {
      // 验证URL格式
      if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
        throw new Error('WebDAV URL必须以 http:// 或 https:// 开头');
      }

      // 优先走后端代理，避免 CORS
      if (this.useProxy) {
        try {
          // HEAD 请求检测可达性
          const headResponse = await this.proxyFetch('HEAD', this.config.path);
          if (headResponse.ok) return true;

          // 回退 PROPFIND
          const propfindResponse = await this.proxyFetch('PROPFIND', this.config.path, undefined, { Depth: '0' });
          return propfindResponse.ok || propfindResponse.status === 207;
        } catch (proxyErr) {
          console.warn('代理连接测试失败，回退到直连:', proxyErr);
          // 回退到浏览器直连
        }
      }

      // 浏览器直连（回退方案）
      const dirUrl = `${this.config.url}${this.config.path}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const headResponse = await fetch(dirUrl, {
          method: 'HEAD',
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (headResponse.ok) return true;

        const propfindResponse = await fetch(dirUrl, {
          method: 'PROPFIND',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Depth': '0',
          },
        });

        return propfindResponse.ok || propfindResponse.status === 207;
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
        console.warn(`大文件备份 (${fileAnalysis.sizeKB}KB):`, fileAnalysis.suggestions.join(', '));
      }

      console.log(`文件大小: ${fileAnalysis.sizeKB}KB，压缩后: ${Math.round(compressedContent.length / 1024)}KB`);

      // 确保目录存在
      await this.ensureDirectoryExists();

      const uploadOperation = async (): Promise<boolean> => {
        if (this.useProxy) {
          const response = await this.proxyFetch(
            'PUT',
            this.getRelativePath(filename),
            compressedContent,
            { 'Content-Type': 'application/json' },
          );

          if (!response.ok) {
            if (response.status === 401) throw new Error('身份验证失败。请检查用户名和密码。');
            if (response.status === 403) throw new Error('访问被拒绝。请检查指定路径的权限。');
            if (response.status === 404) throw new Error('路径未找到。请验证WebDAV URL和路径是否正确。');
            if (response.status === 507) throw new Error('服务器存储空间不足。');
            throw new Error(`上传失败，HTTP状态码 ${response.status}`);
          }

          return true;
        }

        // 浏览器直连（回退方案）
        const finalSizeKB = Math.round(compressedContent.length / 1024);
        const dynamicTimeout = Math.max(60000, Math.min(300000, finalSizeKB * 100));

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), dynamicTimeout);

        try {
          const response = await fetch(this.getFullPath(filename), {
            method: 'PUT',
            headers: {
              'Authorization': this.getAuthHeader(),
              'Content-Type': 'application/json',
            },
            body: compressedContent,
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            if (response.status === 401) throw new Error('身份验证失败。请检查用户名和密码。');
            if (response.status === 403) throw new Error('访问被拒绝。请检查指定路径的权限。');
            if (response.status === 404) throw new Error('路径未找到。请验证WebDAV URL和路径是否正确。');
            if (response.status === 507) throw new Error('服务器存储空间不足。');
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
        return;
      }

      const cleanedPath = this.config.path.replace(/\/+$/, '');
      const segments = cleanedPath.split('/').filter(Boolean);
      let currentPath = '';

      for (const seg of segments) {
        currentPath += `/${seg}`;

        if (this.useProxy) {
          try {
            const res = await this.proxyFetch('MKCOL', currentPath);
            if (!res.ok && res.status !== 405 && res.status !== 409) {
              console.warn(`无法创建目录 ${currentPath}，状态码: ${res.status}`);
              break;
            }
          } catch (e) {
            console.warn(`创建目录 ${currentPath} 发生异常:`, e);
            break;
          }
        } else {
          const full = `${this.config.url}${currentPath}`;
          try {
            const res = await fetch(full, {
              method: 'MKCOL',
              headers: { 'Authorization': this.getAuthHeader() },
            });

            if (!res.ok && res.status !== 405) {
              if (res.status !== 409) {
                console.warn(`无法创建目录 ${currentPath}，状态码: ${res.status}`);
                break;
              }
            }
          } catch (e) {
            console.warn(`创建目录 ${currentPath} 发生异常:`, e);
            break;
          }
        }
      }
    } catch (error) {
      console.warn('目录创建检查失败:', error);
    }
  }

  async downloadFile(filename: string): Promise<string | null> {
    try {
      if (this.useProxy) {
        const response = await this.proxyFetch('GET', this.getRelativePath(filename));

        if (response.ok) {
          const data: unknown = await response.json();
          // 后端代理返回的是 JSON 包装的数据，可能是已解析的对象或字符串
          if (typeof data === 'string') return data;
          return JSON.stringify(data);
        }

        if (response.status === 404) return null;
        if (response.status === 401) throw new Error('身份验证失败。请检查用户名和密码。');
        throw new Error(`下载失败，HTTP状态码 ${response.status}`);
      }

      // 浏览器直连（回退方案）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(this.getFullPath(filename), {
          method: 'GET',
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          return await response.text();
        }

        if (response.status === 404) {
          return null;
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
    try {
      if (this.useProxy) {
        const response = await this.proxyFetch('HEAD', this.getRelativePath(filename));
        return response.ok;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(this.getFullPath(filename), {
        method: 'HEAD',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      console.error('WebDAV文件检查失败:', error);
      return false;
    }
  }

  async listFiles(): Promise<string[]> {
    try {
      if (this.useProxy) {
        const response = await this.proxyFetch(
          'PROPFIND',
          this.config.path,
          `<?xml version="1.0" encoding="utf-8" ?>
            <D:propfind xmlns:D="DAV:">
              <D:prop>
                <D:displayname/>
                <D:getlastmodified/>
                <D:getcontentlength/>
              </D:prop>
            </D:propfind>`,
          { Depth: '1', 'Content-Type': 'application/xml' },
        );

        if (response.ok || response.status === 207) {
          const data: unknown = await response.json();
          const xmlText = typeof data === 'string' ? data : JSON.stringify(data);
          return this.parsePropfindXml(xmlText);
        }
        if (response.status === 401) throw new Error('身份验证失败。请检查用户名和密码。');
        throw new Error(`列出文件失败，HTTP状态码 ${response.status}`);
      }

      // 浏览器直连（回退方案）
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      try {
        const collectionUrl = `${this.config.url}${this.basePath}`;

        const response = await fetch(collectionUrl, {
          method: 'PROPFIND',
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
        });

        clearTimeout(timeoutId);

        if (response.ok || response.status === 207) {
          const xmlText = await response.text();
          return this.parsePropfindXml(xmlText);
        }
        if (response.status === 401) {
          throw new Error('身份验证失败。请检查用户名和密码。');
        }
        throw new Error(`列出文件失败，HTTP状态码 ${response.status}: ${response.statusText}`);
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

  private parsePropfindXml(xmlText: string): string[] {
    const collectionUrl = `${this.config.url}${this.basePath}`;

    // 优先用 DOMParser 解析
    try {
      const parser = new DOMParser();
      const xml = parser.parseFromString(xmlText, 'application/xml');
      const responses = Array.from(xml.getElementsByTagNameNS('DAV:', 'response'));

      const results: string[] = [];

      for (const res of responses) {
        const hrefEl = res.getElementsByTagNameNS('DAV:', 'href')[0];
        if (!hrefEl || !hrefEl.textContent) continue;
        let href = hrefEl.textContent;

        const normalizedCollection = collectionUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '/');
        const normalizedHref = href.replace(/^https?:\/\//, '');
        if (normalizedHref.endsWith(normalizedCollection)) continue;

        try {
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
      // DOMParser 失败时降级为正则提取
    }

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

    return [];
  }

  // 验证配置的静态方法
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

  // 获取服务器信息
  async getServerInfo(): Promise<{ server?: string; davLevel?: string }> {
    try {
      const response = await fetch(this.config.url, {
        method: 'OPTIONS',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });

      if (response.ok) {
        return {
          server: response.headers.get('Server') || undefined,
          davLevel: response.headers.get('DAV') || undefined,
        };
      }
    } catch (error) {
      console.warn('无法获取服务器信息:', error);
    }

    return {};
  }
}
