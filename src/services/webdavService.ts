import { WebDAVConfig } from '../types';

export class WebDAVService {
  private config: WebDAVConfig;

  constructor(config: WebDAVConfig) {
    this.config = config;
  }

  private getAuthHeader(): string {
    const credentials = btoa(`${this.config.username}:${this.config.password}`);
    return `Basic ${credentials}`;
  }

  private getFullPath(filename: string): string {
    const basePath = this.config.path.endsWith('/') ? this.config.path : `${this.config.path}/`;
    return `${this.config.url}${basePath}${filename}`;
  }

  private handleNetworkError(error: any, operation: string): never {
    console.error(`WebDAV ${operation} failed:`, error);
    
    // Check for CORS-related errors (most common issue)
    const isCorsError = (
      (error.name === 'TypeError' && error.message.includes('Failed to fetch')) ||
      (error.message && error.message.includes('NetworkError when attempting to fetch resource')) ||
      (error.name === 'NetworkError') ||
      (error.message && error.message.includes('NetworkError'))
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

技术详情: ${error.message}`);
    }
    
    throw new Error(`WebDAV ${operation} 失败: ${error.message || '未知错误'}`);
  }

  async testConnection(): Promise<boolean> {
    try {
      // 验证URL格式
      if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
        throw new Error('WebDAV URL必须以 http:// 或 https:// 开头');
      }

      // 首先尝试OPTIONS请求检查CORS
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

      try {
        const optionsResponse = await fetch(this.config.url, {
          method: 'OPTIONS',
          headers: {
            'Authorization': this.getAuthHeader(),
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // 如果OPTIONS成功，说明CORS配置正确
        if (optionsResponse.ok) {
          return true;
        }

        // 如果OPTIONS失败，尝试PROPFIND（某些服务器不支持OPTIONS）
        const propfindResponse = await fetch(this.config.url, {
          method: 'PROPFIND',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Depth': '0',
          },
        });

        return propfindResponse.ok || propfindResponse.status === 207;
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('连接超时。请检查WebDAV服务器是否可访问。');
        }
        
        throw fetchError;
      }
    } catch (error) {
      this.handleNetworkError(error, '连接测试');
    }
  }

  async uploadFile(filename: string, content: string): Promise<boolean> {
    try {
      // 验证URL格式
      if (!this.config.url.startsWith('http://') && !this.config.url.startsWith('https://')) {
        throw new Error('WebDAV URL必须以 http:// 或 https:// 开头');
      }

      // 确保目录存在
      await this.ensureDirectoryExists();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

      try {
        const response = await fetch(this.getFullPath(filename), {
          method: 'PUT',
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json',
          },
          body: content,
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

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
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('上传超时。文件可能太大或网络连接缓慢。');
        }
        
        throw fetchError;
      }
    } catch (error) {
      if (error.message.includes('身份验证失败') || 
          error.message.includes('访问被拒绝') || 
          error.message.includes('路径未找到') ||
          error.message.includes('存储空间不足') ||
          error.message.includes('上传失败，HTTP状态码') ||
          error.message.includes('上传超时') ||
          error.message.includes('WebDAV URL必须')) {
        throw error; // 重新抛出特定错误
      }
      this.handleNetworkError(error, '上传');
    }
  }

  private async ensureDirectoryExists(): Promise<void> {
    try {
      if (!this.config.path || this.config.path === '/') {
        return; // 根目录总是存在
      }

      const dirPath = this.config.url + this.config.path;
      const response = await fetch(dirPath, {
        method: 'MKCOL',
        headers: {
          'Authorization': this.getAuthHeader(),
        },
      });
      
      // 201 = 已创建, 405 = 已存在, 都是正常的
      if (!response.ok && response.status !== 405) {
        console.warn('无法创建目录，可能已存在或权限不足');
      }
    } catch (error) {
      console.warn('目录创建检查失败:', error);
      // 不在这里抛出错误，因为目录可能已经存在
    }
  }

  async downloadFile(filename: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

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
          return null; // 文件未找到是预期行为
        }
        
        if (response.status === 401) {
          throw new Error('身份验证失败。请检查用户名和密码。');
        }
        
        throw new Error(`下载失败，HTTP状态码 ${response.status}: ${response.statusText}`);
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('下载超时。请检查网络连接。');
        }
        
        throw fetchError;
      }
    } catch (error) {
      if (error.message.includes('身份验证失败') || 
          error.message.includes('下载超时')) {
        throw error;
      }
      if (error.message.includes('HTTP 404')) {
        return null;
      }
      this.handleNetworkError(error, '下载');
    }
  }

  async fileExists(filename: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

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
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000); // 15秒超时

      try {
        const response = await fetch(this.config.url + this.config.path, {
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
          // 简单的XML解析提取文件名
          const fileMatches = xmlText.match(/<D:displayname>([^<]+)<\/D:displayname>/g);
          if (fileMatches) {
            return fileMatches
              .map(match => match.replace(/<\/?D:displayname>/g, ''))
              .filter(name => name.endsWith('.json'));
          }
        } else if (response.status === 401) {
          throw new Error('身份验证失败。请检查用户名和密码。');
        } else {
          throw new Error(`列出文件失败，HTTP状态码 ${response.status}: ${response.statusText}`);
        }
        return [];
      } catch (fetchError) {
        clearTimeout(timeoutId);
        
        if (fetchError.name === 'AbortError') {
          throw new Error('列出文件超时。请检查网络连接。');
        }
        
        throw fetchError;
      }
    } catch (error) {
      if (error.message.includes('身份验证失败') || 
          error.message.includes('列出文件超时')) {
        throw error;
      }
      this.handleNetworkError(error, '列出文件');
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