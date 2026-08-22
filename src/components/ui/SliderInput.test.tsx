import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SliderInput } from './SliderInput';

function ControlledSlider() {
  const [value, setValue] = useState(1);
  return <SliderInput value={value} onChange={setValue} min={1} max={10} label="Concurrency" showMarks={false} />;
}

const sliderRootRect = {
  x: 0,
  y: 0,
  top: 0,
  right: 100,
  bottom: 20,
  left: 0,
  width: 100,
  height: 20,
  toJSON: () => ({}),
} as DOMRect;

describe('SliderInput', () => {
  it('changes aria-valuenow through pointer interaction', async () => {
    const user = userEvent.setup();
    render(<ControlledSlider />);
    const slider = screen.getByRole('slider', { name: 'Concurrency' });
    const sliderRoot = slider.parentElement?.parentElement as HTMLElement;
    expect(sliderRoot).toHaveAttribute('data-orientation', 'horizontal');
    expect(slider).toHaveAttribute('aria-valuenow', '1');

    const getBoundingClientRect = vi.spyOn(sliderRoot, 'getBoundingClientRect').mockReturnValue(sliderRootRect);
    try {
      await user.pointer({ target: sliderRoot, coords: { clientX: 60, clientY: 10 }, keys: '[MouseLeft]' });

      await waitFor(() => expect(slider).toHaveAttribute('aria-valuenow', '6'));
    } finally {
      getBoundingClientRect.mockRestore();
    }
  });

  it('changes aria-valuenow through keyboard interaction', async () => {
    const user = userEvent.setup();
    render(<ControlledSlider />);

    const slider = screen.getByRole('slider', { name: 'Concurrency' });
    expect(slider).toHaveAttribute('aria-valuenow', '1');

    slider.focus();
    await user.keyboard('{ArrowRight}');

    expect(slider).toHaveAttribute('aria-valuenow', '2');
  });
});
