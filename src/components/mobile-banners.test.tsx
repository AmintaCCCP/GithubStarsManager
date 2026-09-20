import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from './ui/tooltip';

const mocks = vi.hoisted(() => ({
  dismissUpdateNotification: vi.fn(),
  openDownloadUrl: vi.fn(),
  state: {
    language: 'en' as const,
    updateNotification: {
      version: '2026.01.very-long-version-name',
      releaseDate: '2026-01-02',
      changelog: ['A long change note that should wrap safely', 'Another change'],
      downloadUrl: 'https://example.test/download',
      dismissed: false,
    },
  },
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mocks.state & { dismissUpdateNotification: typeof mocks.dismissUpdateNotification }) => unknown) => selector({
    ...mocks.state,
    dismissUpdateNotification: mocks.dismissUpdateNotification,
  }),
}));
vi.mock('../features/settings/hooks/useUpdateActions', () => ({
  useUpdateActions: () => ({ openDownloadUrl: mocks.openDownloadUrl }),
}));

import { UpdateNotificationBanner } from './UpdateNotificationBanner';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('mobile banners', () => {
  it('reflows update details and keeps download and dismiss touch-safe', () => {
    render(<TooltipProvider><UpdateNotificationBanner /></TooltipProvider>);

    expect(screen.getByText(/New Version Available/)).toHaveClass('min-w-0', 'break-words');
    expect(screen.getByText(/A long change note/)).toHaveClass('line-clamp-2', 'break-words');
    expect(screen.getByRole('button', { name: 'Download' })).toHaveClass('h-11', 'min-h-11', 'sm:h-8', 'sm:min-h-0');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('size-11', 'sm:size-8');

    screen.getByRole('button', { name: 'Download' }).click();
    expect(mocks.openDownloadUrl).toHaveBeenCalledWith(mocks.state.updateNotification.downloadUrl);
    expect(mocks.dismissUpdateNotification).toHaveBeenCalledOnce();

    screen.getByRole('button', { name: 'Close' }).click();
    expect(mocks.dismissUpdateNotification).toHaveBeenCalledTimes(2);
  });
});
