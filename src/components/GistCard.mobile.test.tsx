import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GistCard } from './GistCard';
import { useAppStore } from '../store/useAppStore';
import { useGistActions } from '../features/gists/hooks/useGistActions';
import type { Gist } from '../types';

vi.mock('../store/useAppStore', () => ({ useAppStore: vi.fn() }));
vi.mock('../features/gists/hooks/useGistActions', () => ({ useGistActions: vi.fn() }));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: vi.fn() }) }));

const gist: Gist = {
  id: '1', description: 'A gist', public: true, html_url: 'https://gist.github.com/1',
  created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-02T00:00:00Z', comments: 0,
  owner: { login: 'me', avatar_url: '' }, files: { 'test.ts': { filename: 'test.ts', type: 'text/plain', language: 'TypeScript', size: 1 } }, starred: true,
};

beforeEach(() => {
  vi.mocked(useAppStore).mockImplementation(((selector: (state: { language: string }) => unknown) => selector({ language: 'en' })) as typeof useAppStore);
  vi.mocked(useGistActions).mockReturnValue({ analyzeOne: vi.fn(), unstarGist: vi.fn(), deleteGist: vi.fn(), isAnalyzingGist: () => false, isMutating: false } as unknown as ReturnType<typeof useGistActions>);
});

describe('GistCard mobile layout', () => {
  it('stacks card content and gives every icon action a named 44px target', () => {
    const { container } = render(<GistCard gist={gist} isMine onOpen={vi.fn()} onEdit={vi.fn()} onUnstarred={vi.fn()} />);

    expect(container.querySelector('article')?.firstElementChild).toHaveClass('flex-col', 'sm:flex-row');
    expect(container.querySelector('h3')?.parentElement).toHaveClass('w-full', 'min-w-0', 'sm:w-auto');
    expect(screen.getByTestId('gist-card-actions')).toHaveClass('max-w-full', 'flex-wrap');
    for (const name of ['AI analyze', 'Copy link', 'Open link', 'Unstar', 'Edit', 'Delete']) {
      expect(screen.getByRole(name === 'Open link' ? 'link' : 'button', { name })).toHaveAttribute('title', name);
      expect(screen.getByRole(name === 'Open link' ? 'link' : 'button', { name })).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    }
  });
});
