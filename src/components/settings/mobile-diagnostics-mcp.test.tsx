import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/components/settings/${name}`, 'utf8');

describe('diagnostic and MCP mobile settings', () => {
  it('contains the log dialog and controls within a mobile viewport', () => {
    const panel = source('DiagnosticLogsPanel.tsx');

    expect(panel).toContain('max-h-[calc(100dvh-2rem)] overflow-hidden p-0 sm:max-h-[80vh]');
    expect(panel).toContain('px-4 py-3 sm:px-5 sm:py-4');
    expect(panel).toContain('h-11 w-11 shrink-0 sm:h-8 sm:w-8');
    expect(panel).toContain('overflow-x-auto border-b border-border px-4 sm:px-5');
    expect(panel).toContain('p-4 sm:p-5');
    expect(panel).toContain('text-base text-foreground dark:text-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:text-sm');
    expect(panel).toContain('flex flex-wrap items-center gap-2');
    expect(panel).toContain('flex flex-wrap items-center gap-3');
    expect(panel).toContain('ml-0 flex flex-wrap items-center gap-2 sm:ml-auto');
    expect(panel).toContain('h-11 gap-1 rounded-md px-3 text-sm sm:h-8');
    expect(panel).toContain('h-11 gap-1 px-3 text-sm font-medium sm:h-9');
  });

  it('makes MCP cards, long content, and actions responsive', () => {
    const panel = source('McpSettingsPanel.tsx');

    expect(panel).toContain('p-4 sm:p-6');
    expect(panel).toContain('flex flex-wrap items-center justify-between gap-4');
    expect(panel).toContain('grid grid-cols-1 gap-3 max-w-md sm:grid-cols-2');
    expect(panel).toContain('flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center');
    expect(panel).toContain('min-w-0 flex-1 truncate');
    expect(panel).toContain('flex flex-col gap-2 mb-2 sm:flex-row sm:items-center sm:justify-between');
    expect(panel).toContain('h-11 w-11 p-2 rounded-lg hover:bg-accent dark:hover:bg-accent sm:h-8 sm:w-8');
    expect(panel).toContain('text-base sm:text-sm');
    expect(panel).toContain('overflow-x-auto');
    expect(panel).toContain("aria-label={showToken ? t('隐藏', 'Hide') : t('显示', 'Show')}");
    expect(panel).toContain("aria-label={t('复制 Token', 'Copy token')}");
    expect(panel).toContain("aria-label={t('复制 Streamable HTTP 地址', 'Copy Streamable HTTP URL')}");
    expect(panel).toContain("aria-label={t('复制 SSE 地址', 'Copy SSE URL')}");
  });
});
