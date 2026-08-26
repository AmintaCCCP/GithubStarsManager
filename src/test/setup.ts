import '@testing-library/jest-dom';
import { vi } from 'vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

Object.defineProperty(window, 'scrollTo', {
  writable: true,
  value: vi.fn(),
});

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: ResizeObserverMock,
});

window.fetch = vi.fn();

// jsdom does not implement scrollIntoView. Keep this no-op test-only.
if (!Element.prototype.scrollIntoView) {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
}

// Radix pointer interactions call the Pointer Capture API, which jsdom does not
// implement. Keep these no-op methods test-only so user-event can exercise the
// same trigger path as the browser without changing production behavior.
if (!Element.prototype.hasPointerCapture) {
  Object.defineProperty(Element.prototype, 'hasPointerCapture', {
    configurable: true,
    value: () => false,
  });
}
if (!Element.prototype.setPointerCapture) {
  Object.defineProperty(Element.prototype, 'setPointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}
if (!Element.prototype.releasePointerCapture) {
  Object.defineProperty(Element.prototype, 'releasePointerCapture', {
    configurable: true,
    value: () => undefined,
  });
}

// Node >=22 exposes an experimental global `localStorage` (undefined unless
// `--localstorage-file` is passed), which vitest copies in and shadows jsdom's
// real Storage even once a non-opaque test origin is configured. Provide a
// minimal in-memory Storage fallback only when none is available so persistence
// paths (e.g. the auth mirror in useAppStore) stay testable.
const storageShim = (): Storage => {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      store = {};
    },
    getItem: (key: string) => (key in store ? store[key] : null),
    key: (index: number) => Object.keys(store)[index] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
  };
};

if (!window.localStorage) {
  Object.defineProperty(window, 'localStorage', { writable: true, value: storageShim() });
}
if (!window.sessionStorage) {
  Object.defineProperty(window, 'sessionStorage', { writable: true, value: storageShim() });
}

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      language: 'zh',
      githubToken: null,
      setReadmeModalOpen: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));
