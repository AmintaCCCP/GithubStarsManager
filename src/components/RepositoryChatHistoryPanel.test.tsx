import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RepositoryChatHistoryPanel } from './RepositoryChatHistoryPanel';
import type { RepositoryChatSession } from '../types/repositoryChat';

const session: RepositoryChatSession = {
  id: 'session-1',
  repoId: 1,
  accountId: '42',
  repoFullName: 'owner/repo',
  sourceRefSha: 'abcdef1234567890',
  title: 'Original title',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

describe('RepositoryChatHistoryPanel', () => {
  it('does not submit a rename while an IME composition is active', () => {
    const onRename = vi.fn();
    render(
      <RepositoryChatHistoryPanel
        sessions={[session]}
        language="en"
        onSelect={() => {}}
        onDelete={() => {}}
        onRename={onRename}
      />,
    );

    fireEvent.doubleClick(screen.getByRole('button', { name: 'Original title' }));
    const input = screen.getByDisplayValue('Original title');
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(session.id, 'Original title');
  });

  it('keeps the rename gesture available while selection is disabled', () => {
    render(
      <RepositoryChatHistoryPanel
        sessions={[session]}
        language="en"
        disabled
        onSelect={() => {}}
        onDelete={() => {}}
        onRename={() => {}}
      />,
    );

    const row = screen.getByRole('button', { name: 'Original title' });
    fireEvent.doubleClick(row);

    expect(screen.getByDisplayValue('Original title')).toBeInTheDocument();
  });
});
