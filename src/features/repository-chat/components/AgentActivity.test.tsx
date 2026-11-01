import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AgentActivity } from './AgentActivity';
import type { RepositoryChatToolEvent } from '../../../types/repositoryChat';

const event = (overrides: Partial<RepositoryChatToolEvent>): RepositoryChatToolEvent => ({
  id: overrides.id ?? 'event-1',
  sessionId: 'session-1',
  messageId: 'message-1',
  toolName: 'read_repo_file',
  status: 'success',
  paramSummary: 'README.md',
  durationMs: 3000,
  createdAt: '2026-08-26T00:00:00.000Z',
  ...overrides,
});

describe('AgentActivity', () => {
  it('uses wall-clock turn time instead of summing overlapping tool durations', () => {
    render(
      <AgentActivity
        isRunning={false}
        events={[
          event({ id: 'first', createdAt: '2026-08-26T00:00:00.000Z' }),
          event({ id: 'second', createdAt: '2026-08-26T00:00:05.000Z' }),
        ]}
      />,
    );

    expect(screen.getByText(/5\.0s/)).toBeInTheDocument();
  });

  it('shows a failed summary icon when the turn failed', () => {
    render(<AgentActivity isRunning={false} failed events={[event({})]} />);

    const summary = screen.getByText(/Finished|已完成/).closest('summary');
    expect(summary?.querySelector('.lucide-x')).toBeInTheDocument();
  });

  it('does not keep a retried tool spinning after its latest event succeeds', () => {
    const { container } = render(
      <AgentActivity
        isRunning={false}
        events={[
          event({ id: 'running', status: 'running' }),
          event({ id: 'success', status: 'success' }),
        ]}
      />,
    );

    expect(container.querySelector('.lucide-circle-dashed')).not.toBeInTheDocument();
  });
});
