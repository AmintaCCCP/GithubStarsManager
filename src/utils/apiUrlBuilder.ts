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
    return baseUrl.replace(/\/$/, '');
  }

  const pathWithVersion = apiType === 'openai-responses' ? 'v1/responses' : 'v1/chat/completions';
  return buildApiUrl(baseUrl, pathWithVersion);
}
