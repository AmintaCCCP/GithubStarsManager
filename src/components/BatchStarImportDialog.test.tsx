import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BatchStarImportDialog } from './BatchStarImportDialog';

const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  duplicateCount: 0, inputError: '', isResolving: false, isStarring: false, syncError: '',
  isTranslating: false, translationError: '', translationsVisible: false, translations: {} as Record<string, string>,
  preview: vi.fn(), toggleRow: vi.fn(), selectAll: vi.fn(), invertSelection: vi.fn(),
  clearPreview: vi.fn(), starSelected: vi.fn(), toggleTranslations: vi.fn(),
}));
vi.mock('../features/repositories/hooks/useBatchStarImport', () => ({ useBatchStarImport: () => mocks }));
vi.mock('../i18n/useT', () => ({ useT: () => (key: string, params?: Record<string, unknown>) => `${key}${params?.name ? ` ${params.name}` : ''}` }));

const row = (overrides: Record<string, unknown> = {}) => ({
  candidate: { repositoryFullName: 'owner/repo', originalValue: 'https://github.com/owner/repo', confidence: 'high' },
  detail: { full_name: 'owner/repo', html_url: 'https://github.com/owner/repo', description: 'Example repository', language: 'TypeScript', stargazers_count: 10 },
  status: 'ready', selected: true,
  ...overrides,
});

describe('BatchStarImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isResolving = false;
    mocks.isStarring = false;
    mocks.isTranslating = false;
    mocks.translationError = '';
    mocks.translationsVisible = false;
    mocks.translations = {};
    mocks.rows = [row()];
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

  it('shows already-starred repositories as checked and disabled checkboxes', () => {
    mocks.rows = [
      row({ status: 'already-starred', selected: false }),
      row({
        candidate: { repositoryFullName: 'other/repo', originalValue: 'https://github.com/other/repo', confidence: 'high' },
        detail: { full_name: 'other/repo', html_url: 'https://github.com/other/repo', description: 'Other', language: 'Go', stargazers_count: 1 },
      }),
    ];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository other/repo' })).toBeEnabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository other/repo' })).toBeChecked();
  });

  it('shows repositories starred in this batch as checked and disabled too', () => {
    mocks.rows = [row({ status: 'starred', selected: false })];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'batchStar.select-repository owner/repo' })).toBeChecked();
  });

  it('selects all and inverts the parsed repositories', async () => {
    const user = userEvent.setup();
    mocks.rows = [row({ status: 'already-starred', selected: false }), row()];
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'batchStar.select-all' }));
    expect(mocks.selectAll).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'batchStar.invert-selection' }));
    expect(mocks.invertSelection).toHaveBeenCalledTimes(1);
  });

  it('offers translation of the parsed descriptions', async () => {
    const user = userEvent.setup();
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'batchStar.translate-descriptions' }));
    expect(mocks.toggleTranslations).toHaveBeenCalledTimes(1);
  });

  it('shows translated descriptions while the translation view is on', () => {
    mocks.translationsVisible = true;
    mocks.translations = { 'owner/repo': '示例仓库' };
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText('示例仓库')).toBeInTheDocument();
    expect(screen.queryByText('Example repository')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'batchStar.show-original' })).toBeEnabled();
  });

  it('falls back to the original description when no translation exists', () => {
    mocks.translationsVisible = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByText('Example repository')).toBeInTheDocument();
  });

  it('shows the translating state and disables actions while translating', () => {
    mocks.isTranslating = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'batchStar.translating' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'batchStar.select-all' })).toBeDisabled();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('keeps the dialog closable while a translation is running', () => {
    mocks.isTranslating = true;
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'batchStar.close' })).toBeEnabled();
  });

  it('reports a translation failure separately from star results', () => {
    mocks.translationError = 'Translation failed: 429';
    render(<BatchStarImportDialog isOpen onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('batchStar.translation-failed: Translation failed: 429');
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
