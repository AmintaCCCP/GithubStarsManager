import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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

describe('RepositoryHealthPanel', () => {
  it('renders the four fixed fact groups', () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="en" />);

    for (const label of ['Activity', 'Maintenance', 'Community', 'Maturity']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('states that facts carry no overall health score', () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="en" />);

    expect(
      screen.getByText(/objective facts with no overall score/i),
    ).toBeInTheDocument();
  });

  it('shows conservative signals as neutral observations', () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ archived: true, pushed_at: '2020-01-01T00:00:00.000Z' })}
        releases={[release]}
        language="en"
      />,
    );

    // 「已归档」会同时出现在顶部观测徽章与 Maintenance 事实行中
    expect(screen.getAllByText('Archived').length).toBeGreaterThanOrEqual(2);
    // 「最近无提交」是中性观测，不是「不健康」判定
    expect(screen.getByText('No pushes in 12 months')).toBeInTheDocument();
    expect(screen.queryByText(/unhealthy/i)).not.toBeInTheDocument();
  });

  it('renders unknown facts as Unknown instead of guessing', () => {
    render(<RepositoryHealthPanel repository={makeRepo()} releases={[release]} language="en" />);

    // contributors 属于 enrichment 事实，本地没有数据
    const contributorsRow = screen.getByText('Contributors').closest('div');
    expect(contributorsRow).not.toBeNull();
    expect(within(contributorsRow as HTMLElement).getByText('Unknown')).toBeInTheDocument();
  });

  it('does not report "No releases" while release data is unavailable', () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ has_fetched_releases: true })}
        releases={undefined}
        language="en"
      />,
    );

    expect(screen.queryByText('No releases')).not.toBeInTheDocument();
    // 但归档等与 Release 无关的事实仍然展示
    expect(screen.getByText('Stars')).toBeInTheDocument();
  });

  it('reports release facts once release data is supplied', () => {
    render(
      <RepositoryHealthPanel
        repository={makeRepo({ has_fetched_releases: true })}
        releases={[]}
        language="en"
      />,
    );

    expect(screen.getByText('No releases')).toBeInTheDocument();
  });
});
