import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Repository } from '../../../types';
import { LinkApplicationDialog } from './LinkApplicationDialog';

vi.mock('../hooks/useLinkedApplicationLabels', () => ({
  useLinkedApplicationLabels: () => ({
    platform: { windows: 'Windows', macos: 'macOS', linux: 'Linux', android: 'Android', unknown: 'Unknown' },
    architecture: { x64: 'x64', arm64: 'arm64', x86: 'x86', universal: 'Universal' },
  }),
}));

const longRepository: Repository = {
  id: 1,
  name: 'repository-with-a-long-name',
  full_name: 'owner/repository-with-a-long-name-that-must-not-expand-the-dialog',
  description: 'A long repository description that should stay inside the scrolling list instead of widening the dialog.',
  html_url: 'https://github.com/owner/repository-with-a-long-name-that-must-not-expand-the-dialog',
  stargazers_count: 0,
  forks_count: 0,
  forks: 0,
  language: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner', avatar_url: '' },
  topics: [],
};

describe('LinkApplicationDialog', () => {
  it('keeps long repository rows contained and the footer outside the scrolling form', () => {
    render(
      <LinkApplicationDialog
        open
        onOpenChange={vi.fn()}
        repositories={[longRepository]}
        defaultPlatform="windows"
        onSubmit={vi.fn(() => 'linked' as const)}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveClass('overflow-hidden');
    expect(screen.getByText(longRepository.full_name).closest('button')).toHaveClass('min-w-0', 'overflow-hidden');

    const linkButton = screen.getByRole('button', { name: '关联' });
    expect(linkButton.parentElement).toHaveClass('shrink-0', 'border-t');
  });
});
