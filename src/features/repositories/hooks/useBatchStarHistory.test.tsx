import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBatchStarHistory } from './useBatchStarHistory';

const account = vi.hoisted(() => ({ id: 1 }));
vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({ user: { id: account.id } }),
}));

describe('batch Star paste history', () => {
  beforeEach(() => { localStorage.clear(); account.id = 1; vi.restoreAllMocks(); });

  /**
   * Depending on the runtime, `localStorage` is either a plain shim object
   * (own `setItem`) or jsdom's Storage (method on `Storage.prototype`), so
   * stub both paths and report whether either one actually received a write.
   */
  const spyOnWrites = (impl: (key: string, value: string) => void) => {
    const spies = [
      vi.spyOn(window.localStorage, 'setItem').mockImplementation(impl),
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(impl),
    ];
    return { called: () => spies.some(spy => spy.mock.calls.length > 0) };
  };

  it('keeps exact text once, moves regenerated text first, and persists ten entries', () => {
    const clock = vi.spyOn(Date, 'now');
    const { result, unmount } = renderHook(useBatchStarHistory);
    for (let index = 0; index < 12; index++) {
      clock.mockReturnValue(index + 1);
      act(() => result.current.record(`text ${index}`));
    }
    expect(result.current.history).toHaveLength(10);
    expect(result.current.history[0].text).toBe('text 11');
    clock.mockReturnValue(20);
    act(() => result.current.record('text 5'));
    expect(result.current.history[0]).toEqual({ text: 'text 5', generatedAt: 20 });
    expect(result.current.history.filter(entry => entry.text === 'text 5')).toHaveLength(1);
    unmount();
    expect(renderHook(useBatchStarHistory).result.current.history).toHaveLength(10);
  });

  it('preserves exact whitespace identity, edits without changing generation time, and merges duplicates', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(10);
    const { result } = renderHook(useBatchStarHistory);
    act(() => result.current.record('text'));
    clock.mockReturnValue(20);
    act(() => result.current.record('text '));
    expect(result.current.history).toHaveLength(2);
    act(() => result.current.edit('text ', 'edited'));
    expect(result.current.history[0]).toEqual({ text: 'edited', generatedAt: 20 });
    act(() => result.current.edit('edited', 'text'));
    expect(result.current.history).toEqual([{ text: 'text', generatedAt: 20 }]);
    clock.mockReturnValue(30);
    act(() => result.current.record('new text', 'text'));
    expect(result.current.history).toEqual([{ text: 'new text', generatedAt: 30 }]);
  });

  it('isolates accounts and reports storage failures without clearing saved data', () => {
    const { result, rerender } = renderHook(useBatchStarHistory);
    act(() => result.current.record('account one'));
    account.id = 2;
    rerender();
    expect(result.current.history).toEqual([]);
    act(() => result.current.record('account two'));
    account.id = 1;
    rerender();
    expect(result.current.history[0].text).toBe('account one');
    const writes = spyOnWrites(() => { throw new Error('quota'); });
    let recorded = true;
    act(() => { recorded = result.current.record('unsaved'); });
    expect(writes.called()).toBe(true);
    expect(recorded).toBe(false);
    expect(result.current.historyError).toBe(true);
    expect(result.current.history[0].text).toBe('account one');
  });

  it('keeps a failed write bound to the account that started it', () => {
    const { result, rerender } = renderHook(useBatchStarHistory);
    act(() => result.current.record('account one'));
    const writes = spyOnWrites((key) => {
      account.id = 2;
      rerender();
      throw new Error(`quota:${String(key)}`);
    });
    let recorded = true;
    act(() => { recorded = result.current.record('should stay with account one'); });
    expect(writes.called()).toBe(true);
    expect(recorded).toBe(false);
    expect(result.current.history).toEqual([]);
    expect(result.current.historyError).toBe(false);
    account.id = 1;
    rerender();
    expect(result.current.history[0].text).toBe('account one');
    expect(result.current.historyError).toBe(false);
  });
});
