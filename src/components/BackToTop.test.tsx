import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  state: {
    readmeModalOpen: false,
    themeTokens: { animation: 'normal' as 'normal' | 'reduced' },
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

import { BackToTop } from './BackToTop';

describe('BackToTop', () => {
  beforeEach(() => {
    mocks.state.themeTokens.animation = 'normal';
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true });
    window.scrollTo = vi.fn();
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  });

  it('uses instant scrolling when reduced motion is enabled', () => {
    mocks.state.themeTokens.animation = 'reduced';
    render(<BackToTop />);

    fireEvent.click(screen.getByRole('button', { name: /back to top|返回顶部/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('keeps smooth scrolling for the normal motion setting', () => {
    render(<BackToTop />);

    fireEvent.click(screen.getByRole('button', { name: /back to top|返回顶部/i }));
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });

  it('uses instant scrolling when the system requests reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<BackToTop />);

    fireEvent.click(screen.getByRole('button', { name: /back to top|返回顶部/i }));
    expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });
});
