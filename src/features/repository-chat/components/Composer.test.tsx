import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

const renderComposer = (overrides: Partial<React.ComponentProps<typeof Composer>> = {}) => render(
  <Composer
    value=""
    onChange={vi.fn()}
    onSend={vi.fn()}
    onStop={vi.fn()}
    onEditLast={vi.fn()}
    onCancelEdit={vi.fn()}
    editing={false}
    isSending={false}
    canChat
    taskDepth="default"
    onDepthChange={vi.fn()}
    language="zh"
    {...overrides}
  />,
);

describe('Composer', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps focus styling on the rounded shell instead of the textarea', () => {
    const { container } = renderComposer();
    const textarea = screen.getByLabelText('问题');
    const shell = container.querySelector('[data-slot="composer-shell"]');

    expect(textarea).toHaveClass('focus-visible:outline-none', 'focus-visible:ring-0');
    expect(shell).toHaveClass('focus-within:border-foreground/20', 'focus-within:ring-2', 'focus-within:ring-foreground/10');
  });

  it('leaves comfortable space below the composer', () => {
    const { container } = renderComposer();

    expect(container.querySelector('[data-slot="composer"]')).toHaveClass('pb-3');
  });

  it('stops generation on Escape from the textarea', () => {
    const onStop = vi.fn();
    renderComposer({ isSending: true, onStop });

    fireEvent.keyDown(screen.getByLabelText('问题'), { key: 'Escape' });

    expect(onStop).toHaveBeenCalledOnce();
  });

  it('does not send from the Enter key that confirms an IME candidate', () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    renderComposer({ value: '测试消息', onSend });
    const textarea = screen.getByLabelText('问题');

    fireEvent.compositionStart(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();

    fireEvent.compositionEnd(textarea);
    const confirmEvent = createEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 });
    fireEvent(textarea, confirmEvent);
    expect(confirmEvent.defaultPrevented).toBe(true);
    expect(onSend).not.toHaveBeenCalled();

    vi.advanceTimersByTime(51);
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 13 });
    expect(onSend).toHaveBeenCalledOnce();
  });
});
