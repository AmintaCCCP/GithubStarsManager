import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StepperInput } from './StepperInput';

describe('StepperInput', () => {
  it('supports keyboard activation through click semantics for increment and decrement', () => {
    const onChange = vi.fn();
    render(<StepperInput value={2} onChange={onChange} min={0} max={5} />);

    const decrement = screen.getByRole('button', { name: 'Decrease' });
    const increment = screen.getByRole('button', { name: 'Increase' });

    fireEvent.click(decrement, { detail: 0 });
    expect(onChange).toHaveBeenCalledWith(1);

    fireEvent.click(increment, { detail: 0 });
    expect(onChange).toHaveBeenCalledWith(3);
  });
});
