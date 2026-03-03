export interface ProxyRequestOptions {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | object;
  timeout?: number;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  data: unknown;
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of ['key', 'api_key', 'apikey', 'token', 'access_token', 'secret', 'client_secret', 'password', 'auth']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, '***');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const BLOCKED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254']);
const PRIVATE_IP_PATTERNS = [/^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./];

function validateUrl(rawUrl: string): void {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Blocked proxy request: unsupported protocol '${parsed.protocol}'`);
  }
  const hostname = parsed.hostname;
  if (BLOCKED_HOSTS.has(hostname)) {
    throw new Error(`Blocked proxy request: hostname '${hostname}' is not allowed`);
  }
  if (PRIVATE_IP_PATTERNS.some(p => p.test(hostname))) {
    throw new Error(`Blocked proxy request: private IP '${hostname}' is not allowed`);
  }
}

export async function proxyRequest(options: ProxyRequestOptions): Promise<ProxyResponse> {
  const { url, method, headers = {}, body, timeout = 30000 } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    validateUrl(url);
    console.log(`[Proxy] ${method} ${redactUrl(url)}`);

    const fetchOptions: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    };

    if (body && method !== 'GET' && method !== 'HEAD') {
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      const hasContentType = Object.keys(headers).some(
        k => k.toLowerCase() === 'content-type'
      );
      if (!hasContentType) {
        (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(url, fetchOptions);

    console.log(`[Proxy] ${method} ${redactUrl(url)} -> ${response.status}`);

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    let data: unknown;
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    if (contentType.includes('application/json') && text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    } else {
      data = text;
    }

    return { status: response.status, headers: responseHeaders, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { status: 504, headers: {}, data: { error: 'Gateway Timeout', code: 'GATEWAY_TIMEOUT' } };
    }
    console.error(`[Proxy] Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { status: 502, headers: {}, data: { error: 'Bad Gateway', code: 'BAD_GATEWAY', details: error instanceof Error ? error.message : 'Unknown error' } };
  } finally {
    clearTimeout(timeoutId);
  }
}
