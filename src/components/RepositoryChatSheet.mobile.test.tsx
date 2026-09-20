import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import RepositoryChatSheet from './RepositoryChatSheet';
import type { Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: object) => unknown) => selector({
    language: 'en',
    setCurrentView: vi.fn(),
    repositoryChatSettings: { taskDepth: 'default' },
    setRepositoryChatSettings: vi.fn(),
  }),
}));
vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: vi.fn() }) }));
vi.mock('../features/repository-chat/hooks/useRepositoryChatSessions', () => ({
  useRepositoryChatSessions: () => ({ sessions: [], activeSession: undefined, messages: [], isLoading: false, error: null, createSession: vi.fn(), selectSession: vi.fn(), deleteSession: vi.fn(), updateSession: vi.fn(), setMessages: vi.fn() }),
}));
vi.mock('../features/repository-chat/hooks/useRepositoryChat', () => ({
  useRepositoryChat: () => ({ canChat: true, unavailableReason: null, isSending: false, error: null, toolEvents: [], evidenceById: {}, send: vi.fn(), stop: vi.fn(), retry: vi.fn(), regenerate: vi.fn() }),
}));
vi.mock('../features/repository-chat/hooks/useTurnStatusAnnouncement', () => ({ useTurnStatusAnnouncement: () => '' }));

const repository = {
  id: 1,
  full_name: 'owner/a-very-long-repository-name-that-must-not-overflow-the-sheet',
  owner: { avatar_url: 'https://example.com/avatar.png' },
} as Repository;

describe('RepositoryChatSheet mobile layout', () => {
  it('keeps chat controls and composer contained on mobile', () => {
    render(<RepositoryChatSheet isOpen onClose={() => {}} repository={repository} onBack={() => {}} />);

    expect(screen.getByRole('dialog')).toHaveClass('w-[min(100dvw_-_1rem,48rem)]', 'max-w-full');
    expect(screen.getByRole('button', { name: 'Back to history' })).toHaveClass('h-11', 'sm:h-7');
    expect(screen.getByRole('button', { name: 'New chat' })).toHaveClass('h-11', 'sm:h-8');
    expect(screen.getByRole('button', { name: 'History' })).toHaveClass('h-11', 'sm:h-8');
    expect(screen.getByLabelText('Question')).toHaveClass('text-base', 'sm:text-sm');
    expect(screen.getByRole('button', { name: /Task depth/ })).toHaveClass('h-11', 'sm:h-7');
  });
});
