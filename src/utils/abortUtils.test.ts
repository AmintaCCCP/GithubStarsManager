import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCombinedAbortController } from './abortUtils';

describe('createCombinedAbortController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts immediately when the parent signal is already aborted', () => {
    const parent = new AbortController();
    parent.abort();

    const controller = createCombinedAbortController(parent.signal, 5_000);

    expect(controller.signal.aborted).toBe(true);
  });

  it('aborts when the parent signal aborts later', () => {
    const parent = new AbortController();
    const controller = createCombinedAbortController(parent.signal, 5_000);

    expect(controller.signal.aborted).toBe(false);
    parent.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  it('aborts after the timeout elapses', () => {
    const controller = createCombinedAbortController(undefined, 5_000);

    expect(controller.signal.aborted).toBe(false);
    vi.advanceTimersByTime(5_000);
    expect(controller.signal.aborted).toBe(true);
  });

  it('does not start a timer when timeoutMs is 0', () => {
    const controller = createCombinedAbortController(undefined, 0);

    vi.advanceTimersByTime(60_000);
    expect(controller.signal.aborted).toBe(false);
  });

  it('clears the timeout once the controller aborts (no stray timer)', () => {
    const controller = createCombinedAbortController(undefined, 5_000);
    controller.abort();

    // 定时器已被清理：继续推进时间不应再触发任何 abort 副作用
    vi.advanceTimersByTime(10_000);
    expect(controller.signal.aborted).toBe(true);
  });

  it('removes the parent abort listener after the controller aborts (no leak)', () => {
    const parent = new AbortController();
    const removeSpy = vi.spyOn(parent.signal, 'removeEventListener');
    const controller = createCombinedAbortController(parent.signal, 5_000);

    controller.abort();

    expect(removeSpy).toHaveBeenCalled();
    removeSpy.mockRestore();
  });
});
