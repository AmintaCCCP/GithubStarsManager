import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RepositoryChatSheet from './RepositoryChatSheet';
import { DialogProvider } from '../hooks/useDialog';
import { useAppStore } from '../store/useAppStore';
import { useRepositoryChat } from '../features/repository-chat/hooks/useRepositoryChat';
import { useRepositoryChatSessions } from '../features/repository-chat/hooks/useRepositoryChatSessions';
import { noVerifiedSummaryResponse } from '../services/repositoryChatService';
import type { Repository } from '../types';
import type { RepositoryChatMessage, RepositoryChatSession } from '../types/repositoryChat';

vi.mock('../store/useAppStore', () => ({ useAppStore: vi.fn() }));
vi.mock('../features/repository-chat/hooks/useRepositoryChat', () => ({ useRepositoryChat: vi.fn() }));
vi.mock('../features/repository-chat/hooks/useRepositoryChatSessions', () => ({ useRepositoryChatSessions: vi.fn() }));

const repository = {
  id: 1,
  name: 'repo',
  full_name: 'owner/repo',
  html_url: 'https://github.com/owner/repo',
  owner: { login: 'owner', avatar_url: 'https://example.com/avatar.png' },
  topics: [],
} as unknown as Repository;

const session = (id: string): RepositoryChatSession => ({
  id,
  repoId: repository.id,
  accountId: '1',
  repoFullName: repository.full_name,
  sourceRefSha: 'abcdef1234567890',
  title: id,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});

const userMessage: RepositoryChatMessage = {
  id: 'message-1',
  sessionId: 'session-a',
  role: 'user',
  content: 'Original question',
  status: 'complete',
  evidenceIds: [],
  createdAt: '2026-11-01T00:00:00.000Z',
};

const answerMessage: RepositoryChatMessage = {
  ...userMessage,
  id: 'message-2',
  role: 'assistant',
  content: 'Answer `/src/a.ts - 12-34`',
};

let activeSession: RepositoryChatSession | null;
let sessionError: string | null;
let messages: RepositoryChatMessage[];
let isSending: boolean;
const stop = vi.fn();
const loadEvidence = vi.fn();

const mockHooks = () => {
  vi.mocked(useRepositoryChatSessions).mockReturnValue({
    sessions: [session('session-a'), session('session-b')],
    activeSession,
    messages,
    isLoading: false,
    error: sessionError,
    refresh: vi.fn(),
    createSession: vi.fn(),
    selectSession: vi.fn(),
    deleteSession: vi.fn(),
    restoreSession: vi.fn(),
    renameSession: vi.fn(),
    startDraft: vi.fn(),
    updateSession: vi.fn(),
    setMessages: vi.fn(),
  });
  vi.mocked(useRepositoryChat).mockReturnValue({
    canChat: true,
    unavailableReason: '',
    isSending,
    error: null,
    toolEvents: [],
    evidenceById: {},
    feedbackById: {},
    loadEvidence,
    send: vi.fn(),
    stop,
    retry: vi.fn(),
    regenerate: vi.fn(),
    editAndResend: vi.fn(),
    submitFeedback: vi.fn(),
  });
};

const renderSheet = () => render(
  <DialogProvider>
    <RepositoryChatSheet isOpen onClose={vi.fn()} repository={repository} />
  </DialogProvider>,
);

describe('RepositoryChatSheet', () => {
  beforeEach(() => {
    Object.defineProperty(Element.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
    sessionStorage.clear();
    activeSession = session('session-a');
    sessionError = null;
    messages = [userMessage];
    isSending = false;
    stop.mockReset();
    loadEvidence.mockReset();
    vi.mocked(useAppStore).mockImplementation(((selector: (state: {
      language: 'zh';
      setCurrentView: () => void;
      repositoryChatSettings: { layout: 'sheet'; taskDepth: 'default' };
      setRepositoryChatSettings: () => void;
    }) => unknown) => selector({
      language: 'zh',
      setCurrentView: vi.fn(),
      repositoryChatSettings: { layout: 'sheet', taskDepth: 'default' },
      setRepositoryChatSettings: vi.fn(),
    })) as typeof useAppStore);
  });

  it('clears an edited question when switching sessions', async () => {
    mockHooks();
    const view = renderSheet();

    fireEvent.click(screen.getByLabelText('编辑问题'));
    expect(screen.getByLabelText('问题')).toHaveValue('Original question');

    activeSession = session('session-b');
    mockHooks();
    view.rerender(
      <DialogProvider>
        <RepositoryChatSheet isOpen onClose={vi.fn()} repository={repository} />
      </DialogProvider>,
    );

    await waitFor(() => expect(screen.getByLabelText('问题')).toHaveValue(''));
  });

  it('clears editing state when deleting the last active session', async () => {
    mockHooks();
    const view = renderSheet();

    fireEvent.click(screen.getByLabelText('编辑问题'));
    expect(screen.getByLabelText('取消编辑')).toBeInTheDocument();

    activeSession = null;
    messages = [];
    mockHooks();
    view.rerender(
      <DialogProvider>
        <RepositoryChatSheet isOpen onClose={vi.fn()} repository={repository} />
      </DialogProvider>,
    );

    await waitFor(() => expect(screen.queryByLabelText('取消编辑')).not.toBeInTheDocument());
  });

  it('keeps a draft restored when returning from settings', async () => {
    sessionStorage.setItem('gsm:repository-chat-return', JSON.stringify({
      repoId: repository.id,
      draft: 'Restored draft',
    }));
    mockHooks();
    renderSheet();

    await waitFor(() => expect(screen.getByLabelText('问题')).toHaveValue('Restored draft'));
  });

  it('stops generation when Escape is pressed outside the textarea', async () => {
    isSending = true;
    mockHooks();
    renderSheet();

    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });

    await waitFor(() => expect(stop).toHaveBeenCalledOnce());
  });

  it('disables the composer when session loading failed', () => {
    sessionError = 'Unable to load sessions';
    messages = [];
    mockHooks();
    renderSheet();

    expect(screen.getByLabelText('问题')).toBeDisabled();
  });

  it('strips citations when evidence cannot be loaded for copy', async () => {
    messages = [answerMessage];
    loadEvidence.mockRejectedValue(new Error('evidence unavailable'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    mockHooks();
    renderSheet();

    fireEvent.click(screen.getByLabelText('复制回答'));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Answer'));
  });

  it('hides copy for the exact no-verified-summary fallback', () => {
    messages = [{ ...answerMessage, content: noVerifiedSummaryResponse('zh') }];
    mockHooks();
    renderSheet();

    expect(screen.queryByLabelText('复制回答')).not.toBeInTheDocument();
  });

  it('keeps copy when a valid answer mentions the fallback wording', () => {
    messages = [{
      ...answerMessage,
      content: `The fallback wording is: ${noVerifiedSummaryResponse('zh')}`,
    }];
    mockHooks();
    renderSheet();

    expect(screen.getByLabelText('复制回答')).toBeInTheDocument();
  });
});
