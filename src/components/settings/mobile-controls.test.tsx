import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/components/settings/${name}`, 'utf8');

describe('settings mobile controls', () => {
  it('keeps AI configuration rows and icon actions touch-safe and compact on desktop', () => {
    const panel = source('AIConfigPanel.tsx');

    expect(panel).toContain('flex-col gap-3 sm:flex-row sm:items-center sm:justify-between');
    expect(panel).toContain('className="flex min-w-0 flex-1 items-start gap-2"');
    expect(panel).toContain('className="min-w-0 flex-1"');
    expect(panel).toContain('h-11 w-11');
    expect(panel).toContain('sm:h-9 sm:w-9');
    expect(panel).toContain('aria-label={t(\'测试连接\', \'Test Connection\')}');
    expect(panel).toContain('aria-label={t(\'编辑\', \'Edit\')}');
    expect(panel).toContain('aria-label={t(\'删除\', \'Delete\')}');
  });

  it('keeps category edit and reorder controls touch-safe and responsive', () => {
    const panel = source('CategoryPanel.tsx');

    expect(panel).toContain('flex-col gap-3 sm:flex-row sm:items-center sm:justify-between');
    expect(panel).toContain('className="flex min-w-0 flex-1 items-center gap-3"');
    expect(panel).toContain('className="min-w-0 flex-1 truncate text-sm font-medium text-foreground dark:text-foreground"');
    expect(panel).toContain('className="flex flex-wrap items-center justify-end gap-1"');
    expect(panel).toContain('text-base sm:text-sm text-foreground dark:text-foreground');
    expect(panel).toContain('h-11 w-11');
    expect(panel).toContain('sm:h-8 sm:w-8');
    expect(panel).toContain('aria-label={t(\'置顶\', \'Move to top\')}');
    expect(panel).toContain('aria-label={t(\'编辑\', \'Edit\')}');
    expect(panel).toContain('aria-label={t(\'删除\', \'Delete\')}');
  });

  it('keeps network rows stackable and inputs legible on mobile', () => {
    const panel = source('NetworkPanel.tsx');

    expect(panel).toContain('grid-cols-1 gap-3 sm:grid-cols-3');
    expect(panel).toContain('grid-cols-1 gap-3 sm:grid-cols-2');
    expect(panel).toContain('flex flex-wrap items-center gap-3 pt-2');
    expect(panel).toContain('text-base sm:text-sm');
    expect(panel).toContain('h-11 w-11');
    expect(panel).toContain('sm:h-8 sm:w-8');
  });
});
