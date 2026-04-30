import queryString from 'query-string';

interface TranslateResult {
  translatedText: string;
  detectedLanguage: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
let tokenPromise: Promise<string> | null = null;

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;
const TRANSLATE_API_URL = 'https://api-edge.cognitive.microsofttranslator.com/translate';
const AUTH_URL = 'https://edge.microsoft.com/translate/auth';

const parseJwtExpiration = (token: string): number => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return 0;
    
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64));
    if (payload.exp) {
      return payload.exp * 1000;
    }
    return 0;
  } catch {
    return 0;
  }
};

const isTokenValid = (cached: CachedToken | null): boolean => {
  if (!cached) return false;
  return Date.now() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS;
};

const getStoredToken = (): CachedToken | null => {
  try {
    const stored = localStorage.getItem('ms_translate_token');
    if (!stored) return null;
    
    const parsed = JSON.parse(stored) as CachedToken;
    if (isTokenValid(parsed)) {
      return parsed;
    }
    localStorage.removeItem('ms_translate_token');
    return null;
  } catch {
    return null;
  }
};

const storeToken = (token: string): void => {
  try {
    const expiresAt = parseJwtExpiration(token);
    if (expiresAt > 0) {
      cachedToken = { token, expiresAt };
      localStorage.setItem('ms_translate_token', JSON.stringify(cachedToken));
    }
  } catch {
    // ignore storage errors
  }
};

export const apiMsAuth = async (signal?: AbortSignal): Promise<string> => {
  const storedToken = getStoredToken();
  if (storedToken) {
    cachedToken = storedToken;
    return storedToken.token;
  }

  if (isTokenValid(cachedToken)) {
    return cachedToken.token;
  }

  if (tokenPromise) {
    return tokenPromise;
  }

  tokenPromise = (async () => {
    try {
      const response = await fetch(AUTH_URL, {
        method: 'GET',
        credentials: 'omit',
        signal,
      });

      if (!response.ok) {
        throw new Error(`Auth failed: ${response.status}`);
      }

      const token = await response.text();
      storeToken(token);
      return token;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      throw err;
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
};

export interface TranslateOptions {
  from?: string;
  to: string;
  text: string;
  signal?: AbortSignal;
}

export const translateText = async (options: TranslateOptions): Promise<TranslateResult> => {
  const { from, to, text, signal } = options;

  if (!text || text.trim() === '') {
    return { translatedText: text, detectedLanguage: '' };
  }

  const token = await apiMsAuth(signal);

  const params = queryString.stringify({
    ...(from && { from }),
    to,
    'api-version': '3.0',
  });

  const url = `${TRANSLATE_API_URL}?${params}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify([{ Text: text }]),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      localStorage.removeItem('ms_translate_token');
    }
    throw new Error(`Translation failed: ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Invalid translation response');
  }

  const result = data[0];
  const translatedText = result.translations?.[0]?.text || text;
  const detectedLanguage = result.detectedLanguage?.language || '';

  return {
    translatedText,
    detectedLanguage,
  };
};

export const translateBatch = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal
): Promise<TranslateResult[]> => {
  if (texts.length === 0) return [];
  
  if (texts.length === 1) {
    const result = await translateText({ text: texts[0], to, from, signal });
    return [result];
  }

  const results: TranslateResult[] = [];
  const batchSize = 100;
  const maxChars = 50000;

  for (let i = 0; i < texts.length; i += batchSize) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const batch = texts.slice(i, i + batchSize);
    let currentBatch: string[] = [];
    let currentLength = 0;

    for (const text of batch) {
      if (currentLength + text.length > maxChars && currentBatch.length > 0) {
        const batchResults = await translateBatchInternal(currentBatch, to, from, signal);
        results.push(...batchResults);
        currentBatch = [];
        currentLength = 0;
      }
      currentBatch.push(text);
      currentLength += text.length;
    }

    if (currentBatch.length > 0) {
      const batchResults = await translateBatchInternal(currentBatch, to, from, signal);
      results.push(...batchResults);
    }
  }

  return results;
};

const translateBatchInternal = async (
  texts: string[],
  to: string,
  from?: string,
  signal?: AbortSignal
): Promise<TranslateResult[]> => {
  const token = await apiMsAuth(signal);

  const params = queryString.stringify({
    ...(from && { from }),
    to,
    'api-version': '3.0',
  });

  const url = `${TRANSLATE_API_URL}?${params}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(texts.map(t => ({ Text: t }))),
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      localStorage.removeItem('ms_translate_token');
    }
    throw new Error(`Translation failed: ${response.status}`);
  }

  const data = await response.json();

  if (!Array.isArray(data) || data.length !== texts.length) {
    throw new Error('Invalid translation response');
  }

  return data.map((result, index) => ({
    translatedText: result.translations?.[0]?.text || texts[index],
    detectedLanguage: result.detectedLanguage?.language || '',
  }));
};

export const clearTranslateCache = (): void => {
  cachedToken = null;
  localStorage.removeItem('ms_translate_token');
};
