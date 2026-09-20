import { beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';
import type { LinkedApplication } from '../../types/linkedApplication';
import type { AppActions, AppStoreGet, AppStoreSet } from '../types';
import { createLinkedApplicationSlice } from './linkedApplicationSlice';

vi.mock('../../services/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), errorFromError: vi.fn() },
}));

type LinkedApplicationActions = Pick<
  AppActions,
  'addLinkedApplication' | 'updateLinkedApplication' | 'removeLinkedApplication' | 'markLinkedApplicationChecked'
>;

type TestState = { linkedApplications: LinkedApplication[] } & LinkedApplicationActions;

const createTestStore = () => create<TestState>()((set, get) => ({
  linkedApplications: [],
  ...createLinkedApplicationSlice(set as unknown as AppStoreSet, get as unknown as AppStoreGet),
}));

const makeApplication = (overrides: Partial<LinkedApplication> = {}): LinkedApplication => ({
  id: 'app-1',
  repositoryFullName: 'owner/tool',
  displayName: 'Tool',
  installedVersion: '1.0.0',
  platform: 'windows',
  linkSource: 'manual',
  includePrereleases: false,
  repositorySourceUrl: 'https://github.com/owner/tool',
  linkedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('linkedApplicationSlice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('appends a linked application and keeps the rest of the state untouched', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication());

    expect(store.getState().linkedApplications).toEqual([makeApplication()]);
  });

  it('refuses a second record for the same repository, comparing names case-insensitively', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication({ id: 'first', repositoryFullName: 'Owner/Tool' }));
    store.getState().addLinkedApplication(makeApplication({ id: 'second', repositoryFullName: 'owner/tool ' }));

    expect(store.getState().linkedApplications.map((app) => app.id)).toEqual(['first']);
  });

  it('refuses a record without a repository name', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication({ repositoryFullName: '   ' }));

    expect(store.getState().linkedApplications).toEqual([]);
  });

  it('normalizes unsafe source URLs at the store boundary', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication({ repositorySourceUrl: 'javascript:alert(1)' }));

    expect(store.getState().linkedApplications[0]?.repositorySourceUrl)
      .toBe('https://github.com/owner/tool');
  });

  it('patches editable fields while protecting identity fields', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication());

    store.getState().updateLinkedApplication('app-1', {
      displayName: 'My editor',
      installedVersion: '2.0.0',
      includePrereleases: true,
      platform: 'linux',
    });

    expect(store.getState().linkedApplications[0]).toMatchObject({
      id: 'app-1',
      repositoryFullName: 'owner/tool',
      displayName: 'My editor',
      installedVersion: '2.0.0',
      includePrereleases: true,
      platform: 'linux',
    });

    // 身份字段不能被 patch 覆盖（防止误改仓库归属）
    store.getState().updateLinkedApplication('app-1', {
      id: 'hacked',
      repositoryFullName: 'attacker/other',
    } as Partial<LinkedApplication>);

    expect(store.getState().linkedApplications[0]).toMatchObject({
      id: 'app-1',
      repositoryFullName: 'owner/tool',
    });
  });

  it('ignores patches for unknown ids', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication());
    const before = store.getState().linkedApplications;

    store.getState().updateLinkedApplication('missing', { displayName: 'nope' });

    expect(store.getState().linkedApplications).toBe(before);
  });

  it('unlinks by removing only that record and leaving everything else in place', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication({ id: 'keep', repositoryFullName: 'owner/keep' }));
    store.getState().addLinkedApplication(makeApplication({ id: 'drop', repositoryFullName: 'owner/drop' }));

    store.getState().removeLinkedApplication('drop');

    expect(store.getState().linkedApplications).toEqual([
      expect.objectContaining({ id: 'keep', repositoryFullName: 'owner/keep' }),
    ]);
  });

  it('records the last checked timestamp per record only', () => {
    const store = createTestStore();
    store.getState().addLinkedApplication(makeApplication({ id: 'a', repositoryFullName: 'owner/a' }));
    store.getState().addLinkedApplication(makeApplication({ id: 'b', repositoryFullName: 'owner/b' }));

    store.getState().markLinkedApplicationChecked('a', '2026-04-01T00:00:00.000Z');

    const [first, second] = store.getState().linkedApplications;
    expect(first.lastCheckedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(second.lastCheckedAt).toBeUndefined();

    store.getState().markLinkedApplicationChecked('a', 'not-a-date');
    expect(store.getState().linkedApplications[0]?.lastCheckedAt).toBe('2026-04-01T00:00:00.000Z');
  });
});
