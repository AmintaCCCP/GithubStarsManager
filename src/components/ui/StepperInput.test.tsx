import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepperInput } from './StepperInput';

describe('StepperInput', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops long-press repeat at both bounds', async () => {
    vi.useFakeTimers();
    const decrementOnChange = vi.fn();
    const { unmount } = render(<StepperInput value={1} onChange={decrementOnChange} min={0} max={1} />);
    const decrement = screen.getByRole('button', { name: 'Decrease' });
    act(() => {
      const event = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(event, 'button', { value: 0 });
      decrement.dispatchEvent(event);
    });
    expect(decrementOnChange).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(400);
      vi.advanceTimersByTime(120);
      vi.advanceTimersByTime(1000);
    });
    expect(decrementOnChange).toHaveBeenCalledTimes(1);

    unmount();
    const incrementOnChange = vi.fn();
    render(<StepperInput value={0} onChange={incrementOnChange} min={0} max={1} />);
    const increment = screen.getByRole('button', { name: 'Increase' });
    act(() => {
      const event = new Event('pointerdown', { bubbles: true });
      Object.defineProperty(event, 'button', { value: 0 });
      increment.dispatchEvent(event);
    });
    expect(incrementOnChange).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(400);
      vi.advanceTimersByTime(120);
      vi.advanceTimersByTime(1000);
    });
    expect(incrementOnChange).toHaveBeenCalledTimes(1);
  });

  it('supports native keyboard activation for increment and decrement', async () => {
    const user = userEvent.setup();
    const decrementOnChange = vi.fn();
    const incrementOnChange = vi.fn();
    const { unmount } = render(<StepperInput value={2} onChange={decrementOnChange} min={0} max={5} />);

    const decrement = screen.getByRole('button', { name: 'Decrease' });
    decrement.focus();
    await user.keyboard('{Enter}');
    expect(decrementOnChange).toHaveBeenCalledWith(1);

    unmount();
    render(<StepperInput value={2} onChange={incrementOnChange} min={0} max={5} />);
    const increment = screen.getByRole('button', { name: 'Increase' });
    increment.focus();
    await user.keyboard('{Enter}');
    expect(incrementOnChange).toHaveBeenCalledWith(3);
  });
});
