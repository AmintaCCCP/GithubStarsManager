import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PluginPageModal } from './PluginPageModal';
import type { Repository } from '../types';

// usePluginPageReadme 走仓库 hook，测试里无关紧要：固定返回即可。
vi.mock('../features/plugins/hooks/usePluginPageReadme', () => ({
  usePluginPageReadme: () => ({ readme: null }),
}));

// 被测对象是弹窗容器（全屏/非全屏形态），viewer 内部行为另有覆盖。
vi.mock('./PluginPageViewer', () => ({
  PluginPageViewer: ({ pageId }: { pageId: string }) => <div data-testid="plugin-page-viewer">{pageId}</div>,
}));

vi.mock('../store/useAppStore', () => ({
  useAppStore: () => 'zh',
  useShallow: (selector: (state: unknown) => unknown) => selector({}),
}));

vi.mock('../store/selectors', () => ({
  resolveTheme: () => 'dark',
}));

const repository = {
  id: 1,
  name: 'example-repository',
  full_name: 'owner/example-repository',
  description: null,
  html_url: 'https://github.com/owner/example-repository',
  stargazers_count: 1,
  forks_count: 0,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  pushed_at: '2026-01-01T00:00:00.000Z',
  owner: { login: 'owner' },
  topics: [],
} as unknown as Repository;

const t = ((key: string) => key) as never;

function renderModal(display?: 'fullscreen' | 'popup') {
  return render(
    <PluginPageModal
      pluginId="com.example.plugin"
      pluginName="Example"
      pageId="fields"
      pageTitle="Custom Fields"
      repository={repository}
      display={display}
      onClose={vi.fn()}
      t={t}
    />,
  );
}

describe('PluginPageModal display modes', () => {
  beforeEach(() => {
    // getPage 走 pluginClient；iframe 加载本身在 jsdom 里只是占位。
    vi.stubGlobal('crypto', { randomUUID: () => 'test-token' });
  });

  it('renders fullscreen by default, matching existing plugin behavior', () => {
    renderModal();
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('app-dialog-fullscreen');
  });

  it('renders a non-fullscreen compact modal when the action declares display:popup', () => {
    renderModal('popup');
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).not.toContain('app-dialog-fullscreen');
    expect(dialog.textContent).toContain('Example · Custom Fields');
    // 弹窗比默认 max-w-md 更宽；弹窗本身不滚动，滚动交给页面 iframe。
    expect(dialog.className).toContain('max-w-2xl');
    expect(dialog.className).toContain('overflow-hidden');
  });
});
