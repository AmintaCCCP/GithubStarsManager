import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Release, Repository } from '../types';
import { RepositoryHealthPanel } from './RepositoryHealthPanel';

function makeRepo(overrides: Partial<Repository> = {}): Repository {
  return {
    id: 1,
    name: 'alpha',
    full_name: 'acme/alpha',
    description: 'A test repository',
    html_url: 'https://github.com/acme/alpha',
    stargazers_count: 1500,
    forks_count: 120,
    forks: 120,
    language: 'TypeScript',
    created_at: '2020-09-17T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    pushed_at: '2026-09-01T00:00:00.000Z',
    owner: { login: 'acme', avatar_url: '' },
    topics: [],
    license: 'MIT',
    ...overrides,
  };
}

const release: Release = {
  id: 1,
  tag_name: 'v1.2.0',
  name: 'v1.2.0',
  body: null,
  published_at: '2026-08-01T00:00:00.000Z',
  html_url: 'https://github.com/acme/alpha/releases/tag/v1.2.0',
  assets: [],
  repository: { id: 1, full_name: 'acme/alpha', name: 'alpha' },
};

async function expandPanel() {
  const trigger = screen.getByRole('button', { name: /仓库健康事实/ });
  if (trigger.getAttribute('aria-expanded') !== 'true') {
    await userEvent.click(trigger);
  }
}

// 文案经 useT 取词，测试环境默认语言为 zh（见 src/test/setup.ts），因此断言中文。
describe('RepositoryHealthPanel', () => {
  it('默认折叠，点击标题后展开事实', async () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="zh" />);

    const trigger = screen.getByRole('button', { name: /仓库健康事实/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('活跃度')).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('活跃度')).toBeVisible();
  });

  it('相对时间跟随 language 使用对应 date-fns locale', async () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ created_at: '2020-09-17T00:00:00.000Z' })}
        releases={[release]}
        language="ja"
      />,
    );

    await expandPanel();
    // language 只驱动 date-fns；ja locale 用「約N年前」，可与中文「约N年前」区分。
    expect(screen.getByText(/約\d+(\.\d+)?年前/)).toBeInTheDocument();
  });

  it('按固定四个分组展示事实', async () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="zh" />);
    await expandPanel();

    for (const label of ['活跃度', '维护', '社区', '成熟度']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('明确说明不含健康总分', async () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="zh" />);
    await expandPanel();

    expect(
      screen.getByText('以上为客观事实，不含健康总分。「未知」表示尚未获得该事实。'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/健康评分|健康分数/)).not.toBeInTheDocument();
  });

  it('把保守观测当中性信息展示', async () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ archived: true, pushed_at: '2020-01-01T00:00:00.000Z' })}
        releases={[release]}
        language="zh"
      />,
    );

    // 折叠态仍展示中性观测徽章
    expect(screen.getByText('近 12 个月无推送')).toBeInTheDocument();
    expect(screen.queryByText(/不健康|已废弃/)).not.toBeInTheDocument();

    await expandPanel();
    // 「已归档」同时出现在观测徽章与维护分组的事实行里
    expect(screen.getAllByText('已归档').length).toBeGreaterThanOrEqual(2);
  });

  it('未知事实显示为「未知」而不是猜测', async () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="zh" />);
    await expandPanel();

    // 贡献者属于需要联网补全的事实，本地没有数据
    const contributorsRow = screen.getByText('贡献者').closest('div');
    expect(contributorsRow).not.toBeNull();
    expect(within(contributorsRow as HTMLElement).getByText('未知')).toBeInTheDocument();
  });

  it('没有 Release 数据时不报「无 Release」', async () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ has_fetched_releases: true })}
        releases={undefined}
        language="zh"
      />,
    );
    await expandPanel();

    expect(screen.queryByText('无 Release')).not.toBeInTheDocument();
    // 与 Release 无关的事实仍然展示
    expect(screen.getByText('Stars')).toBeInTheDocument();
  });

  it('拿到 Release 数据后正常报告 Release 事实', async () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ has_fetched_releases: true })}
        releases={[]}
        language="zh"
      />,
    );
    await expandPanel();

    expect(screen.getByText('无 Release')).toBeInTheDocument();
  });
});
