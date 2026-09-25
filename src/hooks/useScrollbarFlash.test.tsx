import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useScrollbarFlash } from './useScrollbarFlash';

describe('useScrollbarFlash', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts idle and flashes while scrolling, then settles', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useScrollbarFlash(true));
    expect(result.current.isScrolling).toBe(false);

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(699);
    });
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it('keeps the thumb visible across continuous scrolling (no stacked timers)', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useScrollbarFlash(true));

    act(() => {
      result.current.handleScroll();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    act(() => {
      result.current.handleScroll();
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    // 距最后一次滚动仅 500ms，若定时器叠加此处已提前回落。
    expect(result.current.isScrolling).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.isScrolling).toBe(false);
  });

  it('resets the pending timer and state when the view deactivates', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ active }) => useScrollbarFlash(active), {
      initialProps: { active: true },
    });

    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.isScrolling).toBe(true);

    rerender({ active: false });
    expect(result.current.isScrolling).toBe(false);

    act(() => {
      vi.advanceTimersByTime(700);
    });
    // 挂起的定时器已被清除，不会在关闭后再次置位。
    expect(result.current.isScrolling).toBe(false);

    rerender({ active: true });
    act(() => {
      result.current.handleScroll();
    });
    expect(result.current.isScrolling).toBe(true);
  });

  it('clears the pending timer on unmount', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useScrollbarFlash(true));

    act(() => {
      result.current.handleScroll();
    });
    unmount();

    expect(() => {
      act(() => {
        vi.advanceTimersByTime(700);
      });
    }).not.toThrow();
  });
});
