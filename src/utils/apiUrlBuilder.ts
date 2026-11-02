import { AIApiType } from '../types';

export function buildApiUrl(baseUrl: string, pathWithVersion: string): string {
  const baseUrlWithSlash = baseUrl.endsWith('/')
    ? baseUrl
    : `${baseUrl}/`;

  const versionPrefix = pathWithVersion.split('/')[0] || '';

  try {
    const base = new URL(baseUrlWithSlash);
    const basePath = base.pathname.replace(/\/$/, '');

    const anyVersionPattern = /\/v\d+(?:beta|alpha)?$/;
    const hasVersionInBase = anyVersionPattern.test(basePath);

    if (hasVersionInBase) {
      const endpointPath = pathWithVersion.includes('/')
        ? pathWithVersion.split('/').slice(1).join('/')
        : pathWithVersion;
      return new URL(endpointPath, baseUrlWithSlash).toString();
    }

    if (versionPrefix) {
      const versionRe = new RegExp(`/${versionPrefix}$`);
      if (versionRe.test(basePath) && pathWithVersion.startsWith(`${versionPrefix}/`)) {
        const rest = pathWithVersion.slice(versionPrefix.length + 1);
        return new URL(rest, baseUrlWithSlash).toString();
      }
    }

    return new URL(pathWithVersion, baseUrlWithSlash).toString();
  } catch {
    return `${baseUrlWithSlash}${pathWithVersion}`;
  }
}

export function buildFinalApiUrl(baseUrl: string, apiType: AIApiType): string {
  if (apiType === 'openai-compatible') {
    const trimmed = baseUrl.replace(/\/+$/, '');
    // 兼容用户直接粘贴 `https://host/v1` 的常见写法：只补全到版本号的根地址，
    // 已给出完整端点（.../chat/completions、自定义路径）时保持原样。
    try {
      const url = new URL(trimmed);
      const pathname = url.pathname.replace(/\/$/, '');
      if (/\/v\d+(?:beta|alpha)?$/i.test(pathname)) {
        // 用 URL 拼接而不是字符串相加，避免 `?api-version=...` 之类的查询串
        // 被追加到路径后面。
        url.pathname = `${pathname}/chat/completions`;
        return url.toString();
      }
    } catch {
      // 非 URL 形式保持原有拼接结果，由请求阶段报错。
    }
    return trimmed;
  }

  if (apiType === 'gemini') {
    return buildApiUrl(baseUrl, 'v1beta/models/{model}:generateContent');
  }

  // deepseek uses the same Chat Completions endpoint as openai
  const pathWithVersion = apiType === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions';
  return buildApiUrl(baseUrl, pathWithVersion);
}
