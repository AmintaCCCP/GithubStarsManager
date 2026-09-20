import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (name: string) => readFileSync(`src/components/${name}`, 'utf8');

describe('mobile social settings modals', () => {
  it('keeps X controls readable and touch-safe at mobile widths', () => {
    const x = source('XTweetSettingsModal.tsx');

    expect(x).toContain('flex flex-col gap-2 sm:flex-row sm:items-start');
    expect(x).toContain('w-full');
    expect(x).toContain('sm:w-auto');
    expect(x).toContain('text-base');
    expect(x).toContain('sm:text-sm');
    expect(x).toContain('pr-12');
    expect(x).toContain('sm:pr-9');
    expect(x).toContain('h-11 w-11');
    expect(x).toContain('sm:h-8 sm:w-8');
    expect(x).toContain('aria-label={showAuthToken ?');
    expect(x).toContain('aria-label={showCt0 ?');
    expect(x).toContain('flex flex-col gap-2 sm:flex-row');
    expect(x).toContain('flex flex-col gap-3 pt-4 sm:flex-row sm:justify-end');
    expect(x).toContain('aria-label={t(`取消关注 @${follow.handle}`');
    expect(x).toContain('min-w-0 truncate');
  });

  it('keeps Telegram controls readable and touch-safe at mobile widths', () => {
    const telegram = source('TelegramSettingsModal.tsx');

    expect(telegram).toContain('flex flex-col gap-2 sm:flex-row sm:items-start');
    expect(telegram).toContain('w-full');
    expect(telegram).toContain('sm:w-auto');
    expect(telegram).toContain('text-base');
    expect(telegram).toContain('sm:text-sm');
    expect(telegram).toContain('h-11 w-11');
    expect(telegram).toContain('sm:h-8 sm:w-8');
    expect(telegram).toContain('aria-label={t(`取消关注 @${follow.channel}`');
    expect(telegram).toContain('min-w-0 truncate');
    expect(telegram).toContain('flex flex-col gap-3 pt-4 sm:flex-row sm:justify-end');
  });
});
