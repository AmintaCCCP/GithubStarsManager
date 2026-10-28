import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ContextSidebarBody } from './ContextSidebarBody';

describe('ContextSidebarBody', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reveals its thin scrollbar only while scrolling', () => {
    render(
      <ContextSidebarBody data-testid="sidebar-body">
        <div>content</div>
      </ContextSidebarBody>,
    );

    const body = screen.getByTestId('sidebar-body');
    expect(body).toHaveClass('scrollbar-on-scroll');
    expect(body).not.toHaveClass('scrolling');

    fireEvent.scroll(body);
    expect(body).toHaveClass('scrolling');

    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(body).not.toHaveClass('scrolling');
  });
});
