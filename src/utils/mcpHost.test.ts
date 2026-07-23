import { describe, it, expect } from 'vitest';
import { MCP_DEFAULT_HOST, normalizeMcpHost } from './mcpHost';

describe('normalizeMcpHost', () => {
  it('maps empty / wildcards / IPv6 any to 127.0.0.1', () => {
    expect(normalizeMcpHost(undefined)).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('  ')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('0.0.0.0')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('::')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('[::]')).toBe(MCP_DEFAULT_HOST);
  });

  it('normalizes localhost / IPv6 loopback aliases to 127.0.0.1', () => {
    expect(normalizeMcpHost('localhost')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('127.0.0.1')).toBe('127.0.0.1');
    expect(normalizeMcpHost('::1')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('[::1]')).toBe(MCP_DEFAULT_HOST);
  });

  it('forces non-loopback hosts to loopback', () => {
    expect(normalizeMcpHost('192.168.1.1')).toBe(MCP_DEFAULT_HOST);
    expect(normalizeMcpHost('example.com')).toBe(MCP_DEFAULT_HOST);
  });
});
