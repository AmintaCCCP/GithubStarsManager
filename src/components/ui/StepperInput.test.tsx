import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepperInput } from './StepperInput';

describe('StepperInput', () => {
  it('supports native keyboard activation for increment and decrement', async () => {
    const user = userEvent.setup();
    const decrementOnChange = vi.fn();
    const incrementOnChange = vi.fn();
    const { rerender } = render(<StepperInput value={2} onChange={decrementOnChange} min={0} max={5} />);

    const decrement = screen.getByRole('button', { name: 'Decrease' });
    decrement.focus();
    await user.keyboard('{Enter}');
    expect(decrementOnChange).toHaveBeenCalledWith(1);

    rerender(<StepperInput value={2} onChange={incrementOnChange} min={0} max={5} />);
    const increment = screen.getByRole('button', { name: 'Increase' });
    increment.focus();
    await user.keyboard('{Enter}');
    expect(incrementOnChange).toHaveBeenCalledWith(3);
  });
});
