import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CategoryGlyph } from './CategoryGlyph';

describe('CategoryGlyph', () => {
  it('prefers a saved icon over the built-in category fallback', () => {
    const { container } = render(
      <CategoryGlyph icon="lucide:rocket" categoryId="all" />,
    );

    expect(container.querySelector('svg.lucide-rocket')).not.toBeNull();
  });

  it('renders an arbitrary custom emoji instead of replacing it', () => {
    const { getByText } = render(
      <CategoryGlyph icon="💡" name="Skills" categoryId="ai" />,
    );

    expect(getByText('💡')).toHaveClass('app-category-glyph-text');
  });

  it('does not treat the letters in another English word as an AI category', () => {
    const { container } = render(<CategoryGlyph name="Email tools" />);

    expect(container.querySelector('svg.lucide-brain-circuit')).toBeNull();
  });

  it('prefers the database rule over the broader data rule', () => {
    const { container } = render(<CategoryGlyph name="数据库" />);

    expect(container.querySelector('svg.lucide-database')).not.toBeNull();
  });
});
