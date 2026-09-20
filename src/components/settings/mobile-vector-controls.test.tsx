import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync('src/components/settings/VectorSearchSettings.tsx', 'utf8');

describe('Vector Search mobile controls', () => {
  it('keeps inputs, controls, and action groups mobile-safe', () => {
    expect(panel).toContain('text-base sm:text-sm');
    expect(panel).toContain('h-11 w-11');
    expect(panel).toContain('sm:h-8 sm:w-8');
    expect(panel).toContain('flex flex-col gap-2 sm:flex-row');
    expect(panel).toContain('w-full sm:w-auto');
    expect(panel).toContain('min-w-0');
    expect(panel).toContain('overflow-x-auto');
  });
});
