// Polyfills for older browsers

// Promise.allSettled polyfill
if (!Promise.allSettled) {
  Promise.allSettled = function<T>(
    promises: Array<Promise<T>>
  ): Promise<Array<PromiseSettledResult<T>>> {
    return Promise.all(
      promises.map((promise) =>
        promise
          .then((value) => ({ status: 'fulfilled' as const, value }))
          .catch((reason) => ({ status: 'rejected' as const, reason }))
      )
    );
  };
}

// Object.values polyfill
if (!Object.values) {
  Object.values = function<T>(obj: Record<string, T>): T[] {
    return Object.keys(obj).map((key) => obj[key]);
  };
}

// Object.entries polyfill
if (!Object.entries) {
  Object.entries = function<T>(obj: Record<string, T>): [string, T][] {
    return Object.keys(obj).map((key) => [key, obj[key]]);
  };
}

// Array.from polyfill for NodeList and other array-like objects
if (!Array.from) {
  Array.from = function<T>(arrayLike: ArrayLike<T> | Iterable<T>): T[] {
    const result: T[] = [];
    // Check if it's array-like (has length property)
    if ('length' in (arrayLike as ArrayLike<T>)) {
      const arr = arrayLike as ArrayLike<T>;
      for (let i = 0; i < arr.length; i++) {
        result.push(arr[i]);
      }
    } else {
      // It's an iterable
      const iterator = (arrayLike as Iterable<T>)[Symbol.iterator]();
      let item = iterator.next();
      while (!item.done) {
        result.push(item.value);
        item = iterator.next();
      }
    }
    return result;
  };
}

// CustomEvent polyfill for IE
if (typeof window !== 'undefined' && !window.CustomEvent) {
  window.CustomEvent = class CustomEvent<T> extends Event {
    detail: T;
    constructor(type: string, eventInitDict?: { detail?: T; bubbles?: boolean; cancelable?: boolean }) {
      super(type, eventInitDict);
      this.detail = eventInitDict?.detail as T;
    }
  } as typeof window.CustomEvent;
}

console.log('[polyfills] Polyfills loaded');
