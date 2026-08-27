import { describe, expect, it } from 'vitest';
import { normalizeRepositoryChatSettings } from './schema';

describe('normalizeRepositoryChatSettings', () => {
  it('migrates legacy tool limits into the evidence-driven agent budget', () => {
    const settings = normalizeRepositoryChatSettings({ maxToolsPerTurn: 7 });

    expect(settings.maxToolsPerTurn).toBe(7);
    expect(settings.agentBudget).toMatchObject({
      maxTurns: 4,
      maxToolCalls: 7,
      maxReadFiles: 6,
      maxCodeReads: 3,
      maxDurationMs: 90_000,
    });
  });

  it('normalizes every agent budget boundary and keeps code reads within file reads', () => {
    const settings = normalizeRepositoryChatSettings({
      maxToolsPerTurn: 1,
      agentBudget: {
        maxTurns: 99,
        maxToolCalls: 99,
        maxReadFiles: 2,
        maxCodeReads: 12,
        maxDurationMs: 999_999,
      },
    });

    expect(settings.maxToolsPerTurn).toBe(24);
    expect(settings.agentBudget).toEqual({
      maxTurns: 8,
      maxToolCalls: 24,
      maxReadFiles: 2,
      maxCodeReads: 2,
      maxDurationMs: 300_000,
    });
  });
});
