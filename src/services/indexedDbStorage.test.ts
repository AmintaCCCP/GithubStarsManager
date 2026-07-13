import { beforeEach, describe, expect, it } from 'vitest';
import { indexedDBStorage } from './indexedDbStorage';

const NAME = 'github-stars-manager';

// In-memory localStorage mock: the test node environment does not provision
// jsdom's localStorage, and safeLocalStorage* swallows the resulting errors.
const mem = new Map<string, string>();
const mockLocalStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => {
    mem.clear();
  },
};

const nonEmpty = JSON.stringify({
  state: { user: { login: 'me' }, repositories: [{ id: 1 }], gists: [], starredGists: [] },
  version: 9,
});

const empty = JSON.stringify({
  state: { user: null, repositories: [], gists: [], starredGists: [] },
  version: 9,
});

const readState = async (): Promise<{ repositories: unknown[] } | null> => {
  const raw = await indexedDBStorage.getItem(NAME);
  return raw ? (JSON.parse(raw).state as { repositories: unknown[] }) : null;
};

describe('indexedDBStorage empty-write guard', () => {
  beforeEach(() => {
    // Force the localStorage-only path so we can test without fake-indexeddb.
    (window as unknown as { indexedDB?: unknown }).indexedDB = undefined;
    (window as unknown as { localStorage?: unknown }).localStorage = mockLocalStorage;
    mem.clear();
  });

  it('refuses to overwrite a non-empty snapshot with an empty one', async () => {
    await indexedDBStorage.setItem(NAME, nonEmpty);
    await indexedDBStorage.setItem(NAME, empty);
    const after = await readState();
    expect(after).not.toBeNull();
    expect(after!.repositories.length).toBeGreaterThan(0);
  });

  it('allows the first write even when it is empty (no existing data)', async () => {
    await indexedDBStorage.setItem(NAME, empty);
    expect(await readState()).not.toBeNull();
  });

  it('allows overwriting non-empty with a richer non-empty snapshot', async () => {
    await indexedDBStorage.setItem(NAME, nonEmpty);
    const richer = JSON.stringify({
      state: { user: { login: 'me' }, repositories: [1, 2, 3].map((id) => ({ id })), gists: [], starredGists: [] },
      version: 9,
    });
    await indexedDBStorage.setItem(NAME, richer);
    expect((await readState())!.repositories.length).toBe(3);
  });
});
