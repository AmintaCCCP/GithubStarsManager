import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrendingHistoryPanel } from './TrendingHistoryPanel';
import type { TrendingSnapshot } from '../../../types/trendingSnapshot';

const mocks = vi.hoisted(() => ({
  snapshots: [] as TrendingSnapshot[],
}));

vi.mock('../../../store/useAppStore', () => ({
  useAppStore: (selector: (state: unknown) => unknown) => selector({
    trendingSnapshots: mocks.snapshots,
    language: 'zh',
  }),
}));

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-21T04:00:00.000Z');
const at = (offset: number) => new Date(NOW + offset * DAY).toISOString();

const snapshot = (capturedAt: string, entries: TrendingSnapshot['entries']): TrendingSnapshot => ({
  period: 'daily',
  language: 'All',
  capturedAt,
  entries,
});

const twoDays = (): TrendingSnapshot[] => [
  snapshot(at(-1), [
    { repositoryFullName: 'owner/up', rank: 10, stars: 1000 },
    { repositoryFullName: 'owner/down', rank: 2, stars: 2000 },
  ]),
  snapshot(at(0), [
    { repositoryFullName: 'owner/up', rank: 4, stars: 1200 },
    { repositoryFullName: 'owner/down', rank: 9, stars: 2100 },
    { repositoryFullName: 'owner/new', rank: 1, stars: 50 },
  ]),
];

describe('TrendingHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.snapshots = [];
  });

  it('renders nothing until there is something to compare with', () => {
    mocks.snapshots = [snapshot(at(0), [{ repositoryFullName: 'owner/up', rank: 1, stars: 1 }])];
    const { container } = render(<TrendingHistoryPanel period="daily" language="All" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a different period or language', () => {
    mocks.snapshots = twoDays();
    const { container } = render(<TrendingHistoryPanel period="monthly" language="All" />);

    expect(container).toBeEmptyDOMElement();
  });

  it('surfaces risers, fallers and new entries with their rank change', () => {
    mocks.snapshots = twoDays();
    render(<TrendingHistoryPanel period="daily" language="All" />);

    expect(screen.getByTestId('trending-history')).toBeInTheDocument();
    expect(screen.getByTestId('trending-highlight-rising')).toHaveTextContent('owner/up');
    // 10 → 4 是上升 6 名
    expect(screen.getByTestId('trending-highlight-rising')).toHaveTextContent('6');
    expect(screen.getByTestId('trending-highlight-falling')).toHaveTextContent('owner/down');
    expect(screen.getByTestId('trending-highlight-new-entry')).toHaveTextContent('owner/new');
  });

  it('labels the history as local and derived from our own records', () => {
    mocks.snapshots = twoDays();
    render(<TrendingHistoryPanel period="daily" language="All" />);

    expect(screen.getByTestId('trending-history')).toHaveTextContent('与上一天的本地记录相比');
    // "新增 stars" 明确写成"自首次记录"，不是 GitHub 本周新增
    expect(screen.getByTestId('trending-history')).toHaveTextContent('自首次记录新增');
    expect(screen.getByTestId('trending-history')).toHaveTextContent('连续 2 天');
  });
});
