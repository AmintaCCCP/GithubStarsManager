import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ForkCard from './ForkCard';
import type { ForkRepo } from '../types';

const fork: ForkRepo = {
  id: 1, name: 'fork', fork: true, full_name: 'owner/fork', description: null, language: 'TypeScript', html_url: 'https://github.com/owner/fork',
  stargazers_count: 0, forks_count: 0, forks: 0, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', pushed_at: '2026-01-02T00:00:00Z', default_branch: 'main',
  owner: { login: 'owner', avatar_url: '' }, source: { id: 2, name: 'a-very-long-source-repository-name', full_name: 'upstream/a-very-long-source-repository-name', description: null, html_url: 'https://github.com/upstream/a-very-long-source-repository-name', stargazers_count: 0, forks_count: 0, updated_at: '2026-01-02T00:00:00Z', owner: { login: 'upstream', avatar_url: '' } },
};

describe('ForkCard mobile layout', () => {
  it('stacks its header and gives actions 44px mobile targets', () => {
    const { container } = render(<ForkCard fork={fork} isUnread isWorkflowsExpanded onToggleWorkflows={vi.fn()} onSyncUpstream={vi.fn()} onMarkAsRead={vi.fn()} onRunWorkflow={vi.fn()} workflows={[{ id: 1, name: 'a-very-long-workflow-name', path: '.github/workflows/a-very-long-workflow-path.yml', state: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', url: '', html_url: '', badge_url: '' }]} isLoadingWorkflows={false} isSyncing={false} isRunningWorkflow={false} needsSync language="en" />);

    expect(container.querySelector('.p-3 > .flex')).toHaveClass('flex-col', 'md:flex-row');
    expect(screen.getByTestId('fork-card-actions')).toHaveClass('w-full', 'flex-wrap', 'md:w-auto');
    expect(screen.getByRole('button', { name: 'Hide Workflows' })).toHaveClass('h-11', 'sm:h-8');
    expect(screen.getByRole('button', { name: 'Update branch' })).toHaveClass('h-11', 'w-11', 'sm:h-7', 'sm:w-7');
    expect(screen.getByRole('link', { name: 'View on GitHub' })).toHaveClass('inline-flex', 'h-11', 'w-11', 'sm:h-7', 'sm:w-7');
    expect(screen.getByRole('button', { name: 'Run workflow: a-very-long-workflow-name' })).toHaveClass('h-11', 'w-11', 'sm:h-8', 'sm:w-8');
    expect(screen.getByText('upstream/a-very-long-source-repository-name').closest('a')).toHaveClass('inline-flex', 'min-h-11', 'min-w-0', 'items-center', 'truncate', 'sm:min-h-0');
  });
});
