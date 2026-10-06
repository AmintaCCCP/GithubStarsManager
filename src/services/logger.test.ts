import { beforeEach, describe, expect, it } from 'vitest';
import { logger } from './logger';
import type { LogEntry } from './logger';

function lastEntry(): LogEntry {
  const entries = logger.getEntries();
  expect(entries.length).toBeGreaterThan(0);
  return entries[entries.length - 1];
}

describe('logger', () => {
  beforeEach(() => {
    logger.clear();
    logger.setLevel('info');
  });

  describe('Error data serialization (Error.message/.stack are non-enumerable)', () => {
    it('records a bare Error as { name, message, stack } instead of {}', () => {
      const token = `ghp_${'a'.repeat(36)}`;
      const error = new Error(`boom with ${token}`);
      logger.warn('githubApi', 'Failed to fetch releases for owner/repo', error);

      const entry = lastEntry();
      expect(entry.level).toBe('warn');
      const data = entry.data as { name?: string; message?: string; stack?: string };
      expect(data.name).toBe('Error');
      expect(data.message).toContain('boom');
      expect(typeof data.stack).toBe('string');
      // Message and stack are inline-redacted: the raw token never survives.
      expect(data.message).not.toContain(token);
      expect(data.message).toContain('***');
      expect(data.stack).not.toContain(token);
      expect(data.stack).toContain('***');
    });

    it('replaces Error values inside plain objects with sanitized records', () => {
      const fetchError = new TypeError('Failed to fetch');
      logger.warn('xTweet', 'GraphQL batch enrichment failed, falling back to REST', {
        endpoint: '/graphql',
        attempt: 2,
        error: fetchError,
      });

      const data = lastEntry().data as Record<string, unknown>;
      expect(data.endpoint).toBe('/graphql');
      expect(data.attempt).toBe(2);
      const serialized = data.error as { name?: string; message?: string; stack?: string };
      expect(serialized.name).toBe('TypeError');
      expect(serialized.message).toBe('Failed to fetch');
      expect(typeof serialized.stack).toBe('string');
    });

    it('replaces Errors nested at any depth inside objects and arrays', () => {
      const timeoutError = new Error('timeout');
      logger.warn('webdav', 'probe failed', {
        request: { path: '/dav', error: timeoutError },
        attempts: [new TypeError('Failed to fetch'), 'aborted'],
      });

      const data = lastEntry().data as {
        request?: { path?: string; error?: { name?: string; message?: string } };
        attempts?: Array<{ name?: string; message?: string } | string>;
      };
      expect(data.request?.path).toBe('/dav');
      expect(data.request?.error?.name).toBe('Error');
      expect(data.request?.error?.message).toBe('timeout');
      expect(typeof (data.request?.error as { stack?: string }).stack).toBe('string');
      const firstAttempt = data.attempts?.[0] as { name?: string; message?: string };
      expect(firstAttempt.name).toBe('TypeError');
      expect(firstAttempt.message).toBe('Failed to fetch');
      expect(data.attempts?.[1]).toBe('aborted');
    });

    it('does not loop forever on circular references containing no Errors', () => {
      const circular: Record<string, unknown> = { name: 'root' };
      circular.self = circular;
      logger.info('app', 'circular data', circular);
      const data = lastEntry().data as Record<string, unknown>;
      expect(data.name).toBe('root');
      // The circular walk is handled by sanitizeForLog; the entry still records.
    });

    it('serializes a DOMException with independent name and message fields', () => {
      // DOMException 在部分运行时不继承 Error，序列化仍须保留 name
      logger.warn('net', 'request aborted', new DOMException('signal is aborted without reason', 'AbortError'));
      const data = lastEntry().data as { name?: string; message?: string };
      expect(data.name).toBe('AbortError');
      expect(data.message).toBe('signal is aborted without reason');
    });

    it('inline-redacts and caps custom error names', () => {
      const error = new Error('boom');
      error.name = `TokenLeak ghp_${'a'.repeat(36)}`;
      logger.warn('app', 'custom name error', error);
      const data = lastEntry().data as { name?: string; message?: string };
      expect(data.name).not.toContain('a'.repeat(36));
      expect(data.name).toContain('***');
      expect((data.name as string).length).toBeLessThanOrEqual(120);
    });

    it('keeps object data without Error values structurally unchanged', () => {
      logger.info('app', 'plain data', { a: 1, nested: { b: 'x' } });
      expect(lastEntry().data).toEqual({ a: 1, nested: { b: 'x' } });
    });

    it('keeps the existing field-name masking for non-Error data', () => {
      logger.info('app', 'sensitive', { token: 'value-token-123456', nested: { apiKey: 'key-abcdef123456' } });
      const data = lastEntry().data as { token?: string; nested?: { apiKey?: string } };
      expect(data.token).toBe('***3456');
      expect(data.nested?.apiKey).toBe('***3456');
    });

    it('records non-Error data (string) through the plain sanitizer', () => {
      logger.error('app', 'thrown string', 'plain failure text');
      expect(lastEntry().data).toBe('plain failure text');
    });

    it('records an Error whose message itself looks like a URL with secrets redacted', () => {
      const error = new Error('request to https://api.example.com/v1/data?token=supersecret99 failed');
      logger.warn('net', 'request failed', error);
      const data = lastEntry().data as { message?: string };
      expect(data.message).toContain('token=***');
      expect(data.message).not.toContain('supersecret99');
    });
  });
});
