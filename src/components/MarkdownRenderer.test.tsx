import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import MarkdownRenderer from '../components/MarkdownRenderer';

vi.mock('../store/useAppStore', () => ({
  useAppStore: vi.fn((selector) => {
    const state = {
      language: 'zh',
      theme: 'dark',
      githubToken: null,
      setReadmeModalOpen: vi.fn(),
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    parse: vi.fn().mockResolvedValue(true),
    render: vi.fn().mockResolvedValue({ svg: '<svg>diagram</svg>' }),
  },
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Rendering', () => {
    it('should render plain text', () => {
      render(<MarkdownRenderer content="Hello World" />);
      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('should render headings with correct hierarchy', () => {
      const { container } = render(
        <MarkdownRenderer content="# Heading 1" />
      );
      expect(container.querySelector('h1')).toHaveTextContent('Heading 1');
    });

    it('should render h4-h6 headings', () => {
      const { container } = render(
        <MarkdownRenderer content="#### Heading 4" />
      );
      expect(container.querySelector('h4')).toHaveTextContent('Heading 4');
    });

    it('should render bold text', () => {
      const { container } = render(<MarkdownRenderer content="**bold text**" />);
      expect(container.querySelector('strong')).toHaveTextContent('bold text');
    });

    it('should render italic text', () => {
      const { container } = render(<MarkdownRenderer content="*italic text*" />);
      expect(container.querySelector('em')).toHaveTextContent('italic text');
    });

    it('should render inline code', () => {
      const { container } = render(<MarkdownRenderer content="`inline code`" />);
      const code = container.querySelector('code');
      expect(code).toHaveTextContent('inline code');
      expect(code).not.toHaveClass('language-');
    });

    it('should render code blocks with language', () => {
      const { container } = render(
        <MarkdownRenderer content={'```javascript\nconsole.log("hello");\n```'} />
      );
      expect(container.querySelector('.language-javascript')).toBeInTheDocument();
    });

    it('should render unordered lists', () => {
      const { container } = render(
        <MarkdownRenderer content="- Item 1" />
      );
      expect(container.querySelector('ul')).toBeInTheDocument();
      expect(container.querySelector('li')).toBeInTheDocument();
    });

    it('should render ordered lists', () => {
      const { container } = render(
        <MarkdownRenderer content="1. Item 1" />
      );
      expect(container.querySelector('ol')).toBeInTheDocument();
      expect(container.querySelector('li')).toBeInTheDocument();
    });

    it('should render blockquotes', () => {
      const { container } = render(<MarkdownRenderer content="> quoted text" />);
      expect(container.querySelector('blockquote')).toHaveTextContent('quoted text');
    });

    it('should render horizontal rule', () => {
      const { container } = render(<MarkdownRenderer content="---" />);
      expect(container.querySelector('hr')).toBeInTheDocument();
    });

    it('should render tables', () => {
      const content = `| Header 1 | Header 2 |
|----------|----------|
| Cell 1   | Cell 2   |`;
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('table')).toBeInTheDocument();
      expect(container.querySelector('thead')).toBeInTheDocument();
      expect(container.querySelector('tbody')).toBeInTheDocument();
    });
  });

  describe('Links', () => {
    it('should render external links with target _blank', () => {
      const { container } = render(
        <MarkdownRenderer content="[External Link](https://example.com)" />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', 'https://example.com');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('should render mailto links without target _blank', () => {
      const { container } = render(
        <MarkdownRenderer content="[Email](mailto:test@example.com)" />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', 'mailto:test@example.com');
      expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('should handle anchor links with headingIds', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('section-1', 'heading-0');
      
      const { container } = render(
        <MarkdownRenderer 
          content="[Jump to Section](#section-1)" 
          headingIds={headingIds}
        />
      );
      const link = container.querySelector('a');
      expect(link).toHaveAttribute('href', '#section-1');
      expect(link).not.toHaveAttribute('target', '_blank');
    });

    it('should resolve relative links with baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer 
          content="[Relative Link](./docs/guide.md)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toContain('github.com');
    });
  });

  describe('Images', () => {
    it('should render images', () => {
      const { container } = render(
        <MarkdownRenderer content="![Alt text](https://example.com/image.png)" />
      );
      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://example.com/image.png');
      expect(img).toHaveAttribute('alt', 'Alt text');
    });

    it('should resolve relative image URLs with baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer 
          content="![Image](./images/logo.png)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toContain('github.com');
    });
  });

  describe('Code Blocks', () => {
    it('should render GitHub-native code blocks without manual line numbers', () => {
      const content = '```javascript\nline1\nline2\nline3\nline4\n```';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('pre')).toBeInTheDocument();
      expect(container.querySelector('code.language-javascript')).toBeInTheDocument();
      // No synthetic line-number column
      const pre = container.querySelector('pre');
      expect(pre?.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(0);
    });

    it('should provide a hover copy button for code blocks', () => {
      const content = '```javascript\nconsole.log("hello");\n```';
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('button[aria-label="复制代码"]')).toBeInTheDocument();
    });

    it('should normalize language aliases', () => {
      const { container } = render(
        <MarkdownRenderer content={'```sh\necho "hello"\n```'} />
      );
      expect(container.querySelector('.language-bash')).toBeInTheDocument();
    });

    it('should render mermaid fences as diagrams', async () => {
      const { container } = render(
        <MarkdownRenderer content={'```mermaid\nflowchart TD\nA-->B\n```'} />
      );
      await waitFor(() => {
        expect(container.querySelector('.mermaid')).toBeInTheDocument();
      });
      expect(container.querySelector('.mermaid')).toHaveTextContent('diagram');
    });
  });

  describe('GitHub Flavored Markdown', () => {
    it('should render task lists', () => {
      const { container } = render(
        <MarkdownRenderer content="- [x] Task 1" />
      );
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes).toHaveLength(1);
      expect(checkboxes[0]).toHaveAttribute('checked');
    });

    it('should render strikethrough', () => {
      const { container } = render(<MarkdownRenderer content="~~strikethrough~~" />);
      expect(container.querySelector('del')).toHaveTextContent('strikethrough');
    });

    it('should render tables with alignment', () => {
      const content = `| Left | Center | Right |
|:-----|:------:|------:|
| L1   | C1     | R1    |`;
      const { container } = render(<MarkdownRenderer content={content} />);
      expect(container.querySelector('table')).toBeInTheDocument();
    });
  });

  describe('Performance Optimizations', () => {
    it('should not re-render when content is the same', () => {
      const { rerender } = render(<MarkdownRenderer content="Test content" />);
      const initialElement = screen.getByText('Test content');
      
      rerender(<MarkdownRenderer content="Test content" />);
      const afterElement = screen.getByText('Test content');
      
      expect(initialElement).toBe(afterElement);
    });

    it('should handle empty content gracefully', () => {
      const { container } = render(<MarkdownRenderer content="" />);
      expect(container.querySelector('.markdown-body')).toBeInTheDocument();
    });
  });

  describe('shouldRender prop', () => {
    it('should show loading state when shouldRender is false', () => {
      render(<MarkdownRenderer content="Test" shouldRender={false} />);
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
  });

  describe('enableHtml prop', () => {
    it('should render HTML when enableHtml is true', () => {
      const { container } = render(
        <MarkdownRenderer 
          content='<strong>HTML content</strong>' 
          enableHtml={true} 
        />
      );
      expect(container.querySelector('strong')).toBeInTheDocument();
    });
  });

  describe('Heading IDs', () => {
    it('should assign IDs to headings from headingIds map', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('Test Heading', 'custom-id-123');

      const { container } = render(
        <MarkdownRenderer
          content="# Test Heading"
          headingIds={headingIds}
        />
      );
      const h1 = container.querySelector('h1');
      expect(h1).toHaveAttribute('id', 'custom-id-123');
    });

    it('should generate unique IDs for headings not in map', () => {
      const { container } = render(
        <MarkdownRenderer content="# New Heading" />
      );
      const h1 = container.querySelector('h1');
      expect(h1?.getAttribute('id')).toMatch(/^heading-extra-\d+$/);
    });

    it('should disambiguate duplicate headings by occurrence count', () => {
      const headingIds = new Map<string, string>();
      headingIds.set('Setup', 'heading-0');
      headingIds.set('Setup__1', 'heading-1');

      const { container } = render(
        <MarkdownRenderer
          content={'# Setup\n\n# Setup'}
          headingIds={headingIds}
        />
      );
      const [first, second] = Array.from(container.querySelectorAll('h1'));
      expect(first).toHaveAttribute('id', 'heading-0');
      expect(second).toHaveAttribute('id', 'heading-1');
    });
  });

  describe('GitHub Alerts', () => {
    const alertContent = '> [!NOTE]\n> Useful information';

    it('should render GitHub alerts as markdown-alert blocks', () => {
      const { container } = render(<MarkdownRenderer content={alertContent} />);
      const alert = container.querySelector('.markdown-alert.markdown-alert-note');
      expect(alert).toBeInTheDocument();
      expect(alert?.querySelector('.markdown-alert-title')).toHaveTextContent('NOTE');
      expect(alert?.querySelector('svg.octicon')).toBeInTheDocument();
    });

    it('should keep alerts intact when HTML sanitization is enabled', () => {
      const { container } = render(
        <MarkdownRenderer content={alertContent} enableHtml={true} />
      );
      const alert = container.querySelector('.markdown-alert.markdown-alert-note');
      expect(alert).toBeInTheDocument();
      expect(alert?.querySelector('svg.octicon path')).toHaveAttribute('d');
    });

    it('should still render plain blockquotes untouched', () => {
      const { container } = render(<MarkdownRenderer content="> quoted text" />);
      expect(container.querySelector('blockquote')).toHaveTextContent('quoted text');
      expect(container.querySelector('.markdown-alert')).not.toBeInTheDocument();
    });
  });

  describe('Gemoji shortcodes', () => {
    it('should convert :smile: to its unicode emoji', () => {
      const { container } = render(<MarkdownRenderer content="Great job! :smile:" />);
      // :smile: → U+1F604 (😄); written as a codepoint so the assertion
      // can't silently pass for a visually similar emoji
      expect(container.querySelector('p')).toHaveTextContent('Great job! \u{1F604}');
    });
  });

  describe('breaks prop', () => {
    const twoLines = 'line one\nline two';

    it('should join single newlines into one paragraph by default (GitHub parity)', () => {
      const { container } = render(<MarkdownRenderer content={twoLines} />);
      expect(container.querySelectorAll('p')).toHaveLength(1);
      expect(container.querySelector('br')).toBeNull();
    });

    it('should convert single newlines to <br> when breaks is true', () => {
      const { container } = render(<MarkdownRenderer content={twoLines} breaks={true} />);
      expect(container.querySelector('br')).not.toBeNull();
    });
  });

  describe('Math (KaTeX)', () => {
    it('uses a Safari-compatible inline math detector', () => {
      const source = readFileSync('src/components/MarkdownRenderer.tsx', 'utf8');

      expect(source).not.toContain('(?<!');
    });

    it('should lazily load KaTeX and render display math', async () => {
      const { container } = render(<MarkdownRenderer content="$$E=mc^2$$" />);
      await waitFor(() => {
        expect(container.querySelector('.katex')).toBeInTheDocument();
      }, { timeout: 5000 });
    }, 10000);

    it('should not load math support for plain documents', async () => {
      const { container } = render(<MarkdownRenderer content="Just $5 and text" />);
      // Give the effect a tick; no katex nodes should ever appear
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(container.querySelector('.katex')).toBeNull();
    });
  });
});
