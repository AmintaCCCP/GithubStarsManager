import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useTurnStatusAnnouncement } from './useTurnStatusAnnouncement';

type HookProps = { status: Parameters<typeof useTurnStatusAnnouncement>[0] };

describe('useTurnStatusAnnouncement', () => {
  it('announces completion only after a streaming state and stays silent while streaming', () => {
    const { result, rerender } = renderHook(
      (props: HookProps) => useTurnStatusAnnouncement(props.status, 'zh'),
      { initialProps: { status: '' } },
    );

    // 用户消息阶段 / 空状态：无通报
    expect(result.current).toBe('');

    // 第一轮流式开始：清空通报
    rerender({ status: 'streaming' });
    expect(result.current).toBe('');

    // 第一轮完成：通报一次
    rerender({ status: 'complete' });
    expect(result.current).toBe('回答已完成。');

    // 第二轮流式开始：先清空旧通报，保证同一文案能再次播报
    rerender({ status: 'streaming' });
    expect(result.current).toBe('');

    // 第二轮完成：再次通报（即使是同样的文本）
    rerender({ status: 'complete' });
    expect(result.current).toBe('回答已完成。');
  });

  it('announces failure and stop, and does not announce for non-streaming transitions', () => {
    const { result, rerender } = renderHook(
      (props: HookProps) => useTurnStatusAnnouncement(props.status, 'en'),
      { initialProps: { status: 'error' } },
    );

    // 初始即 error（页面恢复场景），未经历 streaming：不通报
    expect(result.current).toBe('');

    rerender({ status: 'streaming' });
    rerender({ status: 'aborted' });
    expect(result.current).toBe('Generation stopped.');

    rerender({ status: 'complete' });
    // aborted → complete 未经过 streaming：不重复通报
    expect(result.current).toBe('Generation stopped.');
  });
});
