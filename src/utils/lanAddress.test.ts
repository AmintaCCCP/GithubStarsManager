import { describe, it, expect } from 'vitest';
import { isLocalOrLanHost } from './lanAddress';

describe('isLocalOrLanHost', () => {
  describe('loopback and local aliases', () => {
    it('accepts localhost and subdomains of localhost', () => {
      expect(isLocalOrLanHost('localhost')).toBe(true);
      expect(isLocalOrLanHost('localhost.')).toBe(true);
      expect(isLocalOrLanHost('app.localhost')).toBe(true);
      expect(isLocalOrLanHost('http://localhost:11434')).toBe(true);
      expect(isLocalOrLanHost('https://localhost:11434')).toBe(true);
    });

    it('accepts 0.0.0.0 and IPv6 loopback / unspecified', () => {
      expect(isLocalOrLanHost('0.0.0.0')).toBe(true);
      expect(isLocalOrLanHost('::1')).toBe(true);
      expect(isLocalOrLanHost('[::1]')).toBe(true);
      expect(isLocalOrLanHost('[::1]:11434')).toBe(true);
      expect(isLocalOrLanHost('::')).toBe(true);
    });

    it('accepts entire 127.0.0.0/8 loopback block', () => {
      expect(isLocalOrLanHost('127.0.0.1')).toBe(true);
      expect(isLocalOrLanHost('127.0.0.2')).toBe(true);
      expect(isLocalOrLanHost('127.1.2.3')).toBe(true);
      expect(isLocalOrLanHost('127.255.255.255')).toBe(true);
      expect(isLocalOrLanHost('127.0.0.1:8080')).toBe(true);
      expect(isLocalOrLanHost('http://127.0.0.1:8080/v1')).toBe(true);
    });
  });

  describe('RFC 1918 private IPv4 ranges', () => {
    it('accepts 10.0.0.0/8 range', () => {
      expect(isLocalOrLanHost('10.0.0.1')).toBe(true);
      expect(isLocalOrLanHost('10.10.16.13')).toBe(true);
      expect(isLocalOrLanHost('10.255.255.255')).toBe(true);
      expect(isLocalOrLanHost('http://10.0.0.1:11434/v1')).toBe(true);
    });

    it('accepts 172.16.0.0/12 range', () => {
      expect(isLocalOrLanHost('172.16.0.1')).toBe(true);
      expect(isLocalOrLanHost('172.20.1.1')).toBe(true);
      expect(isLocalOrLanHost('172.31.255.255')).toBe(true);
      expect(isLocalOrLanHost('http://172.16.0.5:8000')).toBe(true);

      // Boundaries outside 172.16 - 172.31
      expect(isLocalOrLanHost('172.15.255.255')).toBe(false);
      expect(isLocalOrLanHost('172.32.0.1')).toBe(false);
    });

    it('accepts 192.168.0.0/16 range', () => {
      expect(isLocalOrLanHost('192.168.0.1')).toBe(true);
      expect(isLocalOrLanHost('192.168.1.100')).toBe(true);
      expect(isLocalOrLanHost('192.168.31.25')).toBe(true);
      expect(isLocalOrLanHost('192.168.255.255')).toBe(true);
      expect(isLocalOrLanHost('http://192.168.1.10:11434/v1/chat/completions')).toBe(true);

      // Outside 192.168
      expect(isLocalOrLanHost('192.169.1.1')).toBe(false);
    });
  });

  describe('CGNAT and link-local ranges', () => {
    it('accepts 100.64.0.0/10 (Tailscale / CGNAT)', () => {
      expect(isLocalOrLanHost('100.64.0.1')).toBe(true);
      expect(isLocalOrLanHost('100.100.50.2')).toBe(true);
      expect(isLocalOrLanHost('100.127.255.255')).toBe(true);

      // Outside 100.64 - 100.127
      expect(isLocalOrLanHost('100.63.255.255')).toBe(false);
      expect(isLocalOrLanHost('100.128.0.1')).toBe(false);
    });

    it('accepts 169.254.0.0/16 (IPv4 link-local)', () => {
      expect(isLocalOrLanHost('169.254.1.1')).toBe(true);
      expect(isLocalOrLanHost('169.254.169.254')).toBe(true);
      expect(isLocalOrLanHost('169.255.0.1')).toBe(false);
    });
  });

  describe('IPv6 local and private ranges', () => {
    it('accepts ULA (fc00::/7)', () => {
      expect(isLocalOrLanHost('fc00::1')).toBe(true);
      expect(isLocalOrLanHost('fd00::1')).toBe(true);
      expect(isLocalOrLanHost('fd12:3456::7890')).toBe(true);
      expect(isLocalOrLanHost('[fd00::1]:8080')).toBe(true);
    });

    it('accepts link-local (fe80::/10)', () => {
      expect(isLocalOrLanHost('fe80::1')).toBe(true);
      expect(isLocalOrLanHost('fe90::1')).toBe(true);
      expect(isLocalOrLanHost('fea0::1')).toBe(true);
      expect(isLocalOrLanHost('feb0::1')).toBe(true);
      expect(isLocalOrLanHost('[fe80::1]:11434')).toBe(true);
    });

    it('accepts IPv4-mapped IPv6 for private ranges', () => {
      expect(isLocalOrLanHost('[::ffff:127.0.0.1]')).toBe(true);
      expect(isLocalOrLanHost('[::ffff:192.168.1.10]')).toBe(true);
      expect(isLocalOrLanHost('::ffff:10.0.0.1')).toBe(true);
      expect(isLocalOrLanHost('::ffff:7f00:0001')).toBe(true); // 127.0.0.1
    });

    it('rejects public IPv6 including dotted-decimal forms', () => {
      expect(isLocalOrLanHost('2001:db8::1')).toBe(false);
      expect(isLocalOrLanHost('2606:4700:4700::1111')).toBe(false);
      expect(isLocalOrLanHost('2001:4860:4860::8.8.8.8')).toBe(false);
      expect(isLocalOrLanHost('[2001:4860:4860::8.8.8.8]:8080')).toBe(false);
    });
  });

  describe('LAN hostnames and mDNS', () => {
    it('accepts *.local, *.lan, *.home, *.internal, *.corp, *.home.arpa', () => {
      expect(isLocalOrLanHost('ollama.local')).toBe(true);
      expect(isLocalOrLanHost('my-pc.lan')).toBe(true);
      expect(isLocalOrLanHost('nas.home')).toBe(true);
      expect(isLocalOrLanHost('ai-server.internal')).toBe(true);
      expect(isLocalOrLanHost('workstation.corp')).toBe(true);
      expect(isLocalOrLanHost('router.home.arpa')).toBe(true);
      expect(isLocalOrLanHost('http://ollama.local:11434')).toBe(true);
    });

    it('accepts single-label local hostnames', () => {
      expect(isLocalOrLanHost('ollama')).toBe(true);
      expect(isLocalOrLanHost('nas')).toBe(true);
      expect(isLocalOrLanHost('ubuntu-desktop')).toBe(true);
      expect(isLocalOrLanHost('my_server')).toBe(true);
      expect(isLocalOrLanHost('http://ollama:11434/v1')).toBe(true);
    });
  });

  describe('public internet hosts and invalid input', () => {
    it('rejects public internet domains and IPs', () => {
      expect(isLocalOrLanHost('api.openai.com')).toBe(false);
      expect(isLocalOrLanHost('api.deepseek.com')).toBe(false);
      expect(isLocalOrLanHost('example.com')).toBe(false);
      expect(isLocalOrLanHost('8.8.8.8')).toBe(false);
      expect(isLocalOrLanHost('1.1.1.1')).toBe(false);
      expect(isLocalOrLanHost('http://api.openai.com/v1')).toBe(false);
    });

    it('rejects empty and malformed inputs', () => {
      expect(isLocalOrLanHost('')).toBe(false);
      expect(isLocalOrLanHost('   ')).toBe(false);
      expect(isLocalOrLanHost(null as unknown as string)).toBe(false);
      expect(isLocalOrLanHost(undefined as unknown as string)).toBe(false);
      expect(isLocalOrLanHost('999.999.999.999')).toBe(false);
    });
  });
});
