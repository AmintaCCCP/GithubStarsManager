import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchStarImportDialog } from './BatchStarImportDialog';

const mocks = vi.hoisted(() => ({
  rows: [{ candidate: { repositoryFullName: 'owner/repo', originalValue: 'https://github.com/owner/repo', confidence: 'high' },
    detail: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', description: 'Example repository', language: 'TypeScript', stargazers_count: 10 },
    status: 'ready', selected: true }],
  duplicateCount: 0, inputError: '', isResolving: false, isStarring: false, syncError: '',
  preview: vi.fn(), toggleRow: vi.fn(), clearPreview: vi.fn(), starSelected: vi.fn(),
}));
vi.mock('../features/repositories/hooks/useBatchStarImport', () => ({ useBatchStarImport: () => mocks }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => `${key}${params?.name ? ` ${params.name}` : ''}` }));

describe('BatchStarImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isResolving = false;
    mocks.isStarring = false;
  });

  it('previews pasted text without starring until the user confirms', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'owner/repo' })).toHaveAttribute('href', 'https://github.com/owner/repo');
    await user.type(screen.getByRole('textbox', { name: 'batchStar.input-label' }), 'https://github.com/owner/repo');
    await user.click(screen.getByRole('button', { name: 'batchStar.preview' }));
    expect(mocks.preview).toHaveBeenCalledWith('https://github.com/owner/repo');
    expect(mocks.clearPreview).toHaveBeenCalled();
    expect(mocks.starSelected).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'batchStar.star-selected' }));
    expect(mocks.starSelected).toHaveBeenCalledTimes(1);
  });

  it('allows editing the repository selection', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' }));
    expect(mocks.toggleRow).toHaveBeenCalledWith(0);
  });

  it('disables editing and closing while a Star batch is running', () => {
    mocks.isStarring = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'batchStar.close' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'batchStar.starring' })).toBeDisabled();
  });
});
