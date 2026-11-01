import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';

const renderComposer = () => render(
  <Composer
    value=""
    onChange={vi.fn()}
    onSend={vi.fn()}
    onStop={vi.fn()}
    onEditLast={vi.fn()}
    onCancelEdit={vi.fn()}
    editing={false}
    isSending={false}
    canChat
    taskDepth="default"
    onDepthChange={vi.fn()}
    language="zh"
  />,
);

describe('Composer', () => {
  it('keeps focus styling on the rounded shell instead of the textarea', () => {
    const { container } = renderComposer();
    const textarea = screen.getByLabelText('问题');
    const shell = container.querySelector('[data-slot="composer-shell"]');

    expect(textarea).toHaveClass('focus-visible:outline-none', 'focus-visible:ring-0');
    expect(shell).toHaveClass('focus-within:border-foreground/20', 'focus-within:ring-2', 'focus-within:ring-foreground/10');
  });

  it('leaves comfortable space below the composer', () => {
    const { container } = renderComposer();

    expect(container.querySelector('[data-slot="composer"]')).toHaveClass('pb-3');
  });
});
