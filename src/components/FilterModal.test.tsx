import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FilterModal } from './FilterModal';
import { TooltipProvider } from './ui/tooltip';
import { useAppStore } from '../store/useAppStore';
import { defaultReleaseSourceSettings } from '../types';
import type { AssetFilter, Repository } from '../types';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn(),
}));

const repository: Repository = {
  id: 7,
  name: 'repo',
  full_name: 'owner/repo',
  description: null,
  html_url: 'https://github.com/owner/repo',
  stargazers_count: 1,
  forks_count: 0,
  forks: 0,
  language: 'TypeScript',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
  pushed_at: '2026-08-01T00:00:00.000Z',
  topics: [],
  owner: { login: 'owner', avatar_url: 'https://github.com/owner.png' },
};

const storeState = {
  repositories: [repository],
  releaseSubscriptions: new Set<number>([repository.id]),
  releaseSourceSettings: defaultReleaseSourceSettings,
  language: 'zh' as const,
};

const mockUseAppStore = vi.mocked(useAppStore);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAppStore.mockImplementation(((selector?: (s: typeof storeState) => unknown) =>
    selector ? selector(storeState) : storeState) as unknown as typeof useAppStore);
});

const renderModal = (props: Partial<Parameters<typeof FilterModal>[0]> = {}) => {
  const onClose = vi.fn();
  const onSave = vi.fn();
  render(
    <TooltipProvider>
      <FilterModal
        isOpen
        onClose={onClose}
        onSave={onSave}
        {...props}
      />
    </TooltipProvider>,
  );
  return { onClose, onSave };
};

describe('FilterModal tabs', () => {
  it('defaults to the assets tab with rule counts for new and edited filters', async () => {
    const { onSave } = renderModal();
    expect(screen.getByRole('tab', { name: '资产过滤 · 0' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '仓库过滤 · 0' })).toHaveAttribute('aria-selected', 'false');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('shows per-kind rule counts when editing an existing filter', () => {
    const filter: AssetFilter = {
      id: 'f1',
      name: 'Portable',
      keywords: ['portable', 'zip'],
      excludeKeywords: ['setup'],
      includeRepos: ['owner/beta'],
      alwaysExcludeRepos: ['owner/noise'],
    };
    renderModal({ filter });

    expect(screen.getByRole('tab', { name: '资产过滤 · 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '仓库过滤 · 2' })).toBeInTheDocument();
  });

  it('keeps the assets tab draft when switching to repositories and back', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('包含关键词（可选）'), 'mac');
    // 资产标签内包含/排除两个添加按钮同文案，取第一个（包含关键词区块在前）
    await user.click(screen.getAllByRole('button', { name: '添加' })[0]);
    expect(screen.getByText('mac')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));
    await user.click(screen.getByRole('tab', { name: '资产过滤 · 1' }));

    expect(screen.getByText('mac')).toBeInTheDocument();
  });

  it('reopens on the assets tab and restores saved values, including cleared arrays', async () => {
    const user = userEvent.setup();
    const filter: AssetFilter = {
      id: 'f1',
      name: 'Portable',
      keywords: [],
      excludeKeywords: ['setup'],
      includeRepos: [],
      alwaysExcludeRepos: [],
    };
    const { rerender } = render(
      <TooltipProvider>
        <FilterModal isOpen onClose={vi.fn()} onSave={vi.fn()} filter={filter} />
      </TooltipProvider>,
    );

    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));

    // 编辑对象变化时重置：总是回到「资产过滤」并回显当前值
    rerender(
      <TooltipProvider>
        <FilterModal isOpen onClose={vi.fn()} onSave={vi.fn()} filter={{ ...filter, name: 'Renamed' }} />
      </TooltipProvider>,
    );

    expect(screen.getByRole('tab', { name: '资产过滤 · 1' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('过滤器名称')).toHaveValue('Renamed');
    expect(screen.getByText('setup')).toBeInTheDocument();
  });
});

describe('FilterModal save rules', () => {
  it('disables saving with a hint when only the name is configured', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'My filter');

    expect(screen.getByRole('button', { name: '创建' })).toBeDisabled();
    expect(
      screen.getByText('请至少配置一项规则（资产关键词或仓库规则），否则无法保存。'),
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves a repository-only filter with all four arrays written', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'Beta only');
    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));
    await user.click(screen.getByRole('button', { name: '添加始终包含的仓库' }));
    await user.click(screen.getByRole('option', { name: 'owner/repo' }));
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Beta only',
        keywords: [],
        excludeKeywords: [],
        includeRepos: ['owner/repo'],
        alwaysExcludeRepos: [],
      }));
    });
  });

  it('saves an exclude-keywords-only filter with empty include keywords', async () => {
    const user = userEvent.setup();
    const { onSave } = renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'No setup');
    await user.type(screen.getByLabelText('排除关键词（可选）'), 'setup');
    // 排除关键词区块的添加按钮（第二个“添加”）
    await user.click(screen.getAllByRole('button', { name: '添加' })[1]);
    await user.click(screen.getByRole('button', { name: '创建' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        keywords: [],
        excludeKeywords: ['setup'],
        includeRepos: [],
        alwaysExcludeRepos: [],
      }));
    });
  });

  it('keeps the filter id when saving an edited filter', async () => {
    const user = userEvent.setup();
    const filter: AssetFilter = { id: 'f1', name: 'Old', keywords: ['old'], alwaysExcludeRepos: [] };
    const { onSave } = renderModal({ filter });

    await user.type(screen.getByLabelText('包含关键词（可选）'), 'new');
    await user.click(screen.getAllByRole('button', { name: '添加' })[0]);
    await user.click(screen.getByRole('button', { name: '保存' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
        id: 'f1',
        keywords: ['old', 'new'],
        alwaysExcludeRepos: [],
      }));
    });
  });
});

describe('FilterModal repository pickers', () => {
  it('expands one picker at a time inside the repositories tab', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'Repos');
    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加始终包含的仓库' }));
    expect(screen.getByText('选择要始终包含的仓库')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '添加始终排除的仓库' }));
    expect(screen.queryByText('选择要始终包含的仓库')).not.toBeInTheDocument();
    expect(screen.getByText('选择要始终排除的仓库')).toBeInTheDocument();
  });

  it('supports search and removal in both pickers', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'Repos');
    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));

    // 排除仓库：搜索 + 多选 + 移除
    await user.click(screen.getByRole('button', { name: '添加始终排除的仓库' }));
    await user.type(screen.getByPlaceholderText('搜索仓库名'), 'owner');
    await user.click(screen.getByRole('option', { name: 'owner/repo' }));
    await user.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.getByText('owner/repo')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '仓库过滤 · 1' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '移除始终排除的仓库 owner/repo' }));
    expect(screen.queryByText('owner/repo')).not.toBeInTheDocument();
    expect(screen.getByText('暂无始终排除的仓库')).toBeInTheDocument();
  });

  it('flags a repository present in both lists without removing the user\u2019s picks', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.type(screen.getByLabelText('过滤器名称'), 'Conflict');
    await user.click(screen.getByRole('tab', { name: '仓库过滤 · 0' }));

    await user.click(screen.getByRole('button', { name: '添加始终包含的仓库' }));
    await user.click(screen.getByRole('option', { name: 'owner/repo' }));
    await user.click(screen.getByRole('button', { name: '添加始终排除的仓库' }));
    await user.click(screen.getByRole('option', { name: 'owner/repo' }));
    await user.click(screen.getByRole('button', { name: '完成' }));

    // 不静默清理：两组各自保留选择，并展示“排除优先”冲突提示
    expect(screen.getAllByText('owner/repo')).toHaveLength(2);
    expect(screen.getAllByText('该仓库同时存在于两组中，排除规则优先').length).toBeGreaterThan(0);
  });
});
