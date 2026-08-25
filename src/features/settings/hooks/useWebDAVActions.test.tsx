import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWebDAVActions } from './useWebDAVActions';
import { useAppStore } from '../../../store/useAppStore';

const mocks = vi.hoisted(() => ({
  useAppStore: vi.fn(),
  toast: vi.fn(),
  validateConfig: vi.fn(),
}));

vi.mock('../../../store/useAppStore', () => ({ useAppStore: mocks.useAppStore }));
vi.mock('../../../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));
vi.mock('../../../services/webdavService', () => ({
  WebDAVService: class {
    static validateConfig = mocks.validateConfig;
  },
}));

const storeState = {
  webdavConfigs: [],
  addWebDAVConfig: vi.fn(),
  updateWebDAVConfig: vi.fn(),
};
const mockUseAppStore = vi.mocked(useAppStore);

describe('useWebDAVActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAppStore.mockImplementation(((selector?: (state: typeof storeState) => unknown) => (
      selector ? selector(storeState) : storeState
    )) as typeof useAppStore);
  });

  it('keeps the WebDAV URL validation message fully localized in Chinese', () => {
    mocks.validateConfig.mockReturnValue(['WebDAV URL必须以 http:// 或 https:// 开头']);
    const { result } = renderHook(() => useWebDAVActions({ t: (zh) => zh }));

    let saved!: boolean;
    act(() => {
      saved = result.current.save({ name: 'Test', url: 'ftp://invalid', username: 'user', password: 'pass', path: '/' }, null);
    });

    expect(saved).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith('WebDAV URL必须以 http:// 或 https:// 开头', 'error');
    expect(storeState.addWebDAVConfig).not.toHaveBeenCalled();
  });
});
