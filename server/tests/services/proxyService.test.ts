import { describe, it, expect } from 'vitest';
import { validateUrl, isPrivateOrLoopback } from '../../src/services/proxyService.js';

describe('validateUrl', () => {
  describe('protocol checks (both modes)', () => {
    it('accepts http and https', () => {
      expect(() => validateUrl('https://api.openai.com/v1/chat/completions')).not.toThrow();
      expect(() => validateUrl('http://example.com/api')).not.toThrow();
    });

    it('rejects non-http(s) protocols', () => {
      expect(() => validateUrl('file:///etc/passwd')).toThrow(/unsupported protocol/);
      expect(() => validateUrl('gopher://example.com')).toThrow(/unsupported protocol/);
      expect(() => validateUrl('ftp://example.com/x')).toThrow(/unsupported protocol/);
    });

    it('always rejects URLs with embedded credentials', () => {
      expect(() => validateUrl('https://user:pass@example.com/x')).toThrow(/credentials is not allowed/);
      // Even in lenient mode credentials must never pass through
      expect(() => validateUrl('http://user:pass@192.168.1.10:11434/x', { allowPrivate: true })).toThrow(/credentials is not allowed/);
    });
  });

  describe('strict mode (default) blocks loopback + private', () => {
    it('blocks localhost / loopback', () => {
      expect(() => validateUrl('http://localhost:11434/v1/chat/completions')).toThrow(/hostname 'localhost' is not allowed/);
      expect(() => validateUrl('http://127.0.0.1:11434/v1/chat/completions')).toThrow(/hostname '127.0.0.1' is not allowed/);
      expect(() => validateUrl('http://[::1]:11434/x')).toThrow(/hostname '::1' is not allowed/);
    });

    it('blocks private network ranges', () => {
      expect(() => validateUrl('http://10.10.16.13/v1/chat/completions')).toThrow(/private IP '10.10.16.13' is not allowed/);
      expect(() => validateUrl('http://172.16.0.5/x')).toThrow(/private IP/);
      expect(() => validateUrl('http://172.31.255.255/x')).toThrow(/private IP/);
      expect(() => validateUrl('http://192.168.1.10:11434/v1/chat/completions')).toThrow(/private IP '192.168.1.10' is not allowed/);
    });

    it('blocks the cloud metadata IMDS address', () => {
      expect(() => validateUrl('http://169.254.169.254/latest/meta-data/')).toThrow(/hostname '169.254.169.254' is not allowed/);
    });

    it('blocks IPv4-mapped IPv6 forms (e.g. [::ffff:169.254.169.254])', () => {
      expect(() => validateUrl('http://[::ffff:169.254.169.254]/x')).toThrow(/is not allowed/);
      expect(() => validateUrl('http://[::ffff:127.0.0.1]/x')).toThrow(/is not allowed/);
      expect(() => validateUrl('http://[::ffff:192.168.1.10]/x')).toThrow(/private IP/);
    });

    it('blocks trailing-dot SSRF bypasses', () => {
      expect(() => validateUrl('http://localhost./x')).toThrow(/hostname 'localhost' is not allowed/);
      expect(() => validateUrl('http://127.0.0.1./x')).toThrow(/hostname '127.0.0.1' is not allowed/);
      expect(() => validateUrl('http://169.254.169.254./x')).toThrow(/hostname '169.254.169.254' is not allowed/);
    });

    it('blocks IPv6 private/local ranges', () => {
      expect(() => validateUrl('http://[fd00::1]/x')).toThrow(/private IPv6 address/);
      expect(() => validateUrl('http://[fe80::1]/x')).toThrow(/private IPv6 address/);
      expect(() => validateUrl('http://[fc00::1]/x')).toThrow(/private IPv6 address/);
      expect(() => validateUrl('http://[ff02::1]/x')).toThrow(/private IPv6 address/);
    });

    it('still allows public IPv6 addresses in strict mode', () => {
      expect(() => validateUrl('http://[2001:db8::1]/x')).not.toThrow();
    });
  });

  describe('lenient mode (allowPrivate) for user-owned configs', () => {
    it('allows localhost / loopback', () => {
      expect(() => validateUrl('http://localhost:11434/v1/chat/completions', { allowPrivate: true })).not.toThrow();
      expect(() => validateUrl('http://127.0.0.1:11434/v1/chat/completions', { allowPrivate: true })).not.toThrow();
    });

    it('allows private network ranges (fixes #244 local AI / NAS)', () => {
      expect(() => validateUrl('http://10.10.16.13/v1/chat/completions', { allowPrivate: true })).not.toThrow();
      expect(() => validateUrl('http://192.168.1.10:11434/v1/chat/completions', { allowPrivate: true })).not.toThrow();
      expect(() => validateUrl('http://172.16.0.5/x', { allowPrivate: true })).not.toThrow();
    });

    it('STILL blocks the cloud metadata IMDS address even when lenient', () => {
      expect(() => validateUrl('http://169.254.169.254/latest/meta-data/', { allowPrivate: true })).toThrow(/IMDS address/);
    });

    it('STILL blocks IPv4-mapped IPv6 IMDS even when lenient', () => {
      expect(() => validateUrl('http://[::ffff:169.254.169.254]/x', { allowPrivate: true })).toThrow(/IMDS address/);
    });
  });

  describe('isPrivateOrLoopback', () => {
    it('detects loopback and private ranges', () => {
      expect(isPrivateOrLoopback('localhost')).toBe(true);
      expect(isPrivateOrLoopback('127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopback('::1')).toBe(true);
      expect(isPrivateOrLoopback('10.10.16.13')).toBe(true);
      expect(isPrivateOrLoopback('192.168.0.5')).toBe(true);
      expect(isPrivateOrLoopback('172.20.1.1')).toBe(true);
    });

    it('detects tailing-dot and IPv4-mapped bypass forms', () => {
      expect(isPrivateOrLoopback('localhost.')).toBe(true);
      expect(isPrivateOrLoopback('127.0.0.1.')).toBe(true);
      expect(isPrivateOrLoopback('[::ffff:127.0.0.1]')).toBe(true);
      expect(isPrivateOrLoopback('[::ffff:192.168.1.10]')).toBe(true);
    });

    it('detects IPv6 private/local ranges', () => {
      expect(isPrivateOrLoopback('fd00::1')).toBe(true);
      expect(isPrivateOrLoopback('fe80::1')).toBe(true);
      expect(isPrivateOrLoopback('fc00::1')).toBe(true);
      expect(isPrivateOrLoopback('ff02::1')).toBe(true);
    });

    it('returns false for public hosts', () => {
      expect(isPrivateOrLoopback('api.openai.com')).toBe(false);
      expect(isPrivateOrLoopback('8.8.8.8')).toBe(false);
      expect(isPrivateOrLoopback('2001:db8::1')).toBe(false);
    });
  });
});
