import { createRef } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BilingualMarkdownRenderer, { type BilingualMarkdownRendererHandle } from './BilingualMarkdownRenderer';
const { translateBatch } = vi.hoisted(() => ({ translateBatch: vi.fn() }));
vi.mock('../features/settings/hooks/useTranslationActions', () => ({ useTranslationActions: () => ({ translateBatch }) }));
vi.mock('./MarkdownRenderer', () => ({ default: ({ content }: { content: string }) => <p>{content}</p> }));
const source = 'This project provides useful tools for developers to manage their repositories and read documentation.';
describe('persistent README translation', () => {
  beforeEach(() => {
    localStorage.clear();
    translateBatch.mockReset().mockResolvedValue([{ translatedText: '这个项目提供有用的开发工具。' }]);
  });
  afterEach(cleanup);
  it('restores after remount without another request, and supports forced retranslation', async () => {
    const ref = createRef<BilingualMarkdownRendererHandle>();
    const first = render(<BilingualMarkdownRenderer ref={ref} markdown={source} language="zh" />);
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
    expect(translateBatch).not.toHaveBeenCalled();
    await act(async () => { await ref.current!.translate(); });
    expect(translateBatch).toHaveBeenCalledTimes(1);
    first.unmount();
    const next = render(<BilingualMarkdownRenderer ref={ref} markdown={source} language="zh" />);
    await waitFor(() => expect(next.getByText('这个项目提供有用的开发工具。')).toBeInTheDocument());
    expect(translateBatch).toHaveBeenCalledTimes(1);
    await act(async () => { await ref.current!.translate(true); });
    expect(translateBatch).toHaveBeenCalledTimes(2);
    next.rerender(<BilingualMarkdownRenderer ref={ref} markdown={source + ' Updated.'} language="zh" />);
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
    expect(next.queryByText('这个项目提供有用的开发工具。')).not.toBeInTheDocument();
    expect(translateBatch).toHaveBeenCalledTimes(2);
  });
});
