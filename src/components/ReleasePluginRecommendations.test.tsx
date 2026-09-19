import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReleasePluginRecommendations } from './ReleasePluginRecommendations';

const storeState: Record<string, unknown> = { language: 'en' };

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn((selector?: (state: unknown) => unknown) =>
    selector ? selector(storeState) : storeState),
}));

const mocks = vi.hoisted(() => ({
  runProcessor: vi.fn(),
  download: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../plugins/hooks/useReleaseProcessors', () => ({
  useReleaseProcessors: () => ({
    processors: [{
      pluginId: 'com.example.release', pluginName: 'Recommender', id: 'recommend',
      title: 'Recommend', canDownload: true,
    }],
    runProcessor: mocks.runProcessor,
    download: mocks.download,
  }),
}));

vi.mock('../hooks/useDialog', () => ({ useDialog: () => ({ toast: mocks.toast }) }));

const release = {
  id: 2, tag_name: 'v1', name: null, body: null, published_at: '2026-01-01',
  html_url: 'https://github.com/o/p/releases/tag/v1', repository: { id: 1, full_name: 'o/p', name: 'p' },
  assets: [{ id: 3, name: 'p-x64.exe', size: 10, download_count: 0,
    browser_download_url: 'https://github.com/o/p/releases/download/v1/p-x64.exe',
    content_type: 'application/octet-stream', created_at: '2026-01-01', updated_at: '2026-01-01' }],
};

describe('ReleasePluginRecommendations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders a validated recommendation and delegates download to the Host', async () => {
    mocks.runProcessor.mockResolvedValue({
      success: true,
      result: { recommendedAssetId: 3, confidence: 0.9, reason: 'Windows x64 installer' },
    });
    mocks.download.mockResolvedValue({ success: true, fileName: 'p-x64.exe', bytes: 10 });
    render(<ReleasePluginRecommendations release={release} language="en" />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    expect(await screen.findByText('p-x64.exe')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 90%')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Host download' }));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith(
      expect.objectContaining({ pluginId: 'com.example.release' }), 2, 3
    ));
  });

  it('does not bubble analyze or download clicks to the release card', async () => {
    const onClick = vi.fn();
    mocks.runProcessor.mockResolvedValue({
      success: true,
      result: { recommendedAssetId: 3, confidence: 0.9, reason: 'Windows x64 installer' },
    });
    mocks.download.mockResolvedValue({ success: true, fileName: 'p-x64.exe', bytes: 10 });
    render(<div onClick={onClick}><ReleasePluginRecommendations release={release} language="en" /></div>);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    await screen.findByText('p-x64.exe');
    fireEvent.click(screen.getByRole('button', { name: 'Host download' }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
