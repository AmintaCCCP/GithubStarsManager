import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAppStore: {
    getState: () => ({ setSystemTheme: mocks.setSystemTheme }),
  },
  setSystemTheme: vi.fn(),
}));

vi.mock('../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));

import { useSystemThemeSync } from './useSystemThemeSync';

type MediaQueryStub = {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const stubMatchMedia = (stub: MediaQueryStub) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn(() => stub),
  });
};

describe('useSystemThemeSync', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('applies the current system theme and follows change events while in system mode', () => {
    const stub: MediaQueryStub = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    stubMatchMedia(stub);

    const { unmount } = renderHook(() => useSystemThemeSync('system'));
    expect(mocks.setSystemTheme).toHaveBeenCalledWith('dark');
    expect(stub.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));

    stub.matches = false;
    act(() => {
      stub.addEventListener.mock.calls[0][1]();
    });
    expect(mocks.setSystemTheme).toHaveBeenLastCalledWith('light');

    unmount();
    expect(stub.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('does not subscribe when the mode is explicit', () => {
    const stub: MediaQueryStub = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    stubMatchMedia(stub);

    renderHook(() => useSystemThemeSync('light'));
    expect(stub.addEventListener).not.toHaveBeenCalled();
    expect(mocks.setSystemTheme).not.toHaveBeenCalled();
  });

  it('falls back to addListener/removeListener on legacy MediaQueryList', () => {
    const stub = {
      matches: true,
      addListener: vi.fn(),
      removeListener: vi.fn(),
    };
    stubMatchMedia(stub as unknown as MediaQueryStub);

    const { unmount } = renderHook(() => useSystemThemeSync('system'));
    expect(mocks.setSystemTheme).toHaveBeenCalledWith('dark');
    expect(stub.addListener).toHaveBeenCalledWith(expect.any(Function));

    stub.matches = false;
    act(() => {
      stub.addListener.mock.calls[0][0]();
    });
    expect(mocks.setSystemTheme).toHaveBeenLastCalledWith('light');

    unmount();
    expect(stub.removeListener).toHaveBeenCalledWith(stub.addListener.mock.calls[0][0]);
  });
});
