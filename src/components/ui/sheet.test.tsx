import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sheet, SheetContent } from './sheet';

const SheetHarness = ({ onContainerClick }: { onContainerClick: () => void }) => {
  const [open, setOpen] = useState(true);

  return (
    <div onClick={onContainerClick}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right">
          <div>Sheet empty area</div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

describe('Sheet portal event boundaries', () => {
  it('does not bubble an overlay click to the React parent', () => {
    const onContainerClick = vi.fn();
    render(<SheetHarness onContainerClick={onContainerClick} />);

    const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
    expect(overlay).not.toBeNull();
    fireEvent.click(overlay!);

    expect(onContainerClick).not.toHaveBeenCalled();
    expect(screen.getByText('Sheet empty area')).toBeInTheDocument();
  });

  it('does not bubble a click on Sheet blank content to the React parent', () => {
    const onContainerClick = vi.fn();
    render(<SheetHarness onContainerClick={onContainerClick} />);

    fireEvent.click(screen.getByText('Sheet empty area'));

    expect(onContainerClick).not.toHaveBeenCalled();
  });
});
