import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ListsPushIndicator } from './ListsPushIndicator';

const mocks = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  return {
    state,
    toast: vi.fn(),
    useAppStore: (selector?: (s: Record<string, unknown>) => unknown) => (selector ? selector(state) : state),
  };
});

vi.mock('../store/useAppStore', () => ({
  useAppStore: mocks.useAppStore,
}));

vi.mock('../hooks/useDialog', () => ({
  useDialog: () => ({ toast: mocks.toast }),
}));

vi.mock('../i18n/useT', () => ({
  useT: () => (key: string) => key,
}));

type PushState = { isRunning: boolean; error: string | null; message?: string; total: number; done: number };

const setPush = (patch: Partial<PushState>) => {
  mocks.state.listsPush = { isRunning: false, error: null, total: 0, done: 0, ...patch };
  mocks.state.resetListsPush ??= vi.fn();
};

describe('ListsPushIndicator 错误提示', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setPush({});
  });

  it('未运行时出现的错误（如启动前校验失败）只 toast 一次', () => {
    const { rerender } = render(<ListsPushIndicator />);
    expect(mocks.toast).not.toHaveBeenCalled();

    setPush({ error: '未配置 token' });
    rerender(<ListsPushIndicator />);
    rerender(<ListsPushIndicator />);

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('未配置 token', 'error');
  });

  it('运行结束且带错误时只 toast 一次，不重复', () => {
    setPush({ isRunning: true, total: 2, done: 1 });
    const { rerender } = render(<ListsPushIndicator />);

    setPush({ isRunning: false, error: '推送失败' });
    rerender(<ListsPushIndicator />);
    rerender(<ListsPushIndicator />);

    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith('推送失败', 'error');
  });

  it('未运行时相同文案的错误连续写入两次，每次都 toast', () => {
    const { rerender } = render(<ListsPushIndicator />);

    setPush({ error: '网络不可用' });
    rerender(<ListsPushIndicator />);
    setPush({ error: '网络不可用' });
    rerender(<ListsPushIndicator />);

    expect(mocks.toast).toHaveBeenCalledTimes(2);
    expect(mocks.toast).toHaveBeenNthCalledWith(2, '网络不可用', 'error');
  });

  it('挂载时已存在的错误不 toast', () => {
    setPush({ error: '旧错误' });
    const { rerender } = render(<ListsPushIndicator />);
    rerender(<ListsPushIndicator />);

    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it('上一轮的 reset 定时器不会清空 4 秒内开始的新一轮推送', () => {
    vi.useFakeTimers();
    try {
      setPush({ isRunning: true, total: 1, done: 0 });
      const { rerender } = render(<ListsPushIndicator />);
      setPush({ isRunning: false, message: '完成' });
      rerender(<ListsPushIndicator />);
      setPush({ isRunning: true, total: 1, done: 0 });
      rerender(<ListsPushIndicator />);

      vi.advanceTimersByTime(5000);

      expect(mocks.state.resetListsPush).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
