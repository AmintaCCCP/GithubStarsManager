import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MessageList } from './MessageList';
import type { Repository } from '../../../types';
import type { RepositoryChatMessage } from '../../../types/repositoryChat';

const repository = {
  full_name: 'owner/repo',
  html_url: 'https://github.com/owner/repo',
} as Repository;

const answer = (content = 'Answer'): RepositoryChatMessage => ({
  id: 'answer-1',
  sessionId: 'session-1',
  role: 'assistant',
  content,
  status: 'complete',
  evidenceIds: [],
  createdAt: '2026-11-01T00:00:00.000Z',
});

const renderMessages = (isAnswerCopyable: (message: RepositoryChatMessage) => boolean) => render(
  <MessageList
    repository={repository}
    messages={[answer()]}
    toolEvents={[]}
    evidenceById={{}}
    feedbackById={{}}
    language="zh"
    isSending={false}
    canRegenerate={false}
    errorMessage={null}
    isAnswerCopyable={isAnswerCopyable}
    onCopy={vi.fn()}
    onEdit={vi.fn()}
    onRegenerate={vi.fn()}
    onRetry={vi.fn()}
    onFeedback={vi.fn()}
  />,
);

describe('MessageList', () => {
  it('hides copy for answers rejected by the copyability rule', () => {
    renderMessages(() => false);

    expect(screen.queryByLabelText('复制回答')).not.toBeInTheDocument();
  });

  it('shows copy for copyable answers', () => {
    renderMessages(() => true);

    expect(screen.getByLabelText('复制回答')).toBeInTheDocument();
  });
});
