import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import MarkdownRenderer, { MATH_PATTERN } from '../components/MarkdownRenderer';

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

    it('should trim leading and trailing blank lines from code blocks', () => {
      // 模型输出的围栏块常带首尾空行；不裁剪时代码块内部会出现大段空白。
      const { container } = render(
        <MarkdownRenderer content={'```\n\nconst a = 1;\n\n\n```'} />
      );
      const code = container.querySelector('pre code');
      expect(code).not.toBeNull();
      expect(code!.textContent).toBe('const a = 1;');
    });

    it('should keep interior blank lines inside code blocks', () => {
      const { container } = render(
        <MarkdownRenderer content={'```\nconst a = 1;\n\nconst b = 2;\n```'} />
      );
      const code = container.querySelector('pre code');
      expect(code!.textContent).toBe('const a = 1;\n\nconst b = 2;');
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

    it('should resolve root-relative links inside the repo, not the github.com host root', () => {
      const { container } = render(
        <MarkdownRenderer
          content="[Contributing](/docs/CONTRIBUTING.md)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe(
        'https://github.com/user/repo/blob/HEAD/docs/CONTRIBUTING.md'
      );
    });

    it('should pin protocol-relative links to https instead of inheriting file://', () => {
      const { container } = render(
        <MarkdownRenderer
          content="[CDN Link](//cdn.example.com/docs/guide.md)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const link = container.querySelector('a');
      expect(link?.getAttribute('href')).toBe('https://cdn.example.com/docs/guide.md');
    });

    it('should not throw when the anchor fragment has malformed percent-escapes', () => {
      const headingIds = new Map<string, string>([['100%-coverage', 'heading-0']]);

      const { container } = render(
        <MarkdownRenderer content="[Coverage](#100%-coverage)" headingIds={headingIds} />
      );
      const link = container.querySelector('a');
      // The markdown pipeline %-encodes the literal `%`; what reaches the
      // handler is `#100%25-coverage` → decoded back to `100%-coverage`.
      expect(link).toHaveAttribute('href', '#100%25-coverage');
      // `decodeURIComponent('100%-coverage')` raises URIError; the handler must
      // survive it instead of aborting TOC navigation.
      expect(() => fireEvent.click(link as Element)).not.toThrow();
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

    it('should normalize an issue-page baseUrl to the repo root', () => {
      // WeeklyIssueModal hands over `issue.html_url`; resolving against it
      // produced `…/issues/123/raw/HEAD/…` 404s, so it must reduce to the
      // repository root first.
      const { container } = render(
        <MarkdownRenderer
          content="![Image](docs/images/hero.svg)"
          baseUrl="https://github.com/user/repo/issues/123"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe(
        'https://github.com/user/repo/raw/HEAD/docs/images/hero.svg'
      );
    });

    it('should resolve root-relative image URLs inside the repo, not the github.com host root', () => {
      const { container } = render(
        <MarkdownRenderer
          content="![Image](/docs/images/hero-dark.svg)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe(
        'https://github.com/user/repo/raw/HEAD/docs/images/hero-dark.svg'
      );
    });

    it('should keep relative image URLs untouched for a non-GitHub baseUrl', () => {
      // Tweet / Telegram page URLs have no derivable repo root; rewriting
      // against them would only produce a different 404, so the URL is left
      // as authored.
      const { container } = render(
        <MarkdownRenderer
          content="![Image](docs/images/hero.svg)"
          baseUrl="https://x.com/someone/status/123"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('docs/images/hero.svg');
    });

    it('should resolve relative <picture> source srcset URLs with baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source media="(prefers-color-scheme: dark)" srcset="docs/images/readme/hero-dark.svg 1x, docs/images/readme/hero-dark@2x.svg 2x">'
            + '<img src="docs/images/readme/hero.svg" alt="hero">'
            + '</picture>'
          }
        />
      );

      const source = container.querySelector('source');
      const srcSet = source?.getAttribute('srcset') ?? '';
      expect(srcSet).toContain('https://github.com/user/repo/raw/HEAD/docs/images/readme/hero-dark.svg 1x');
      expect(srcSet).toContain('https://github.com/user/repo/raw/HEAD/docs/images/readme/hero-dark@2x.svg 2x');
      // The dark-mode candidate must not stay relative — Electron serves the UI
      // from file://, so a relative srcset 404s as file:///.../dist/<asset>.
      expect(srcSet).not.toContain('srcset="docs/');
    });

    it('should pin protocol-relative image URLs to https under baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer
          content="![CDN](//cdn.example.com/images/logo.png)"
          baseUrl="https://github.com/user/repo"
        />
      );
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBe('https://cdn.example.com/images/logo.png');
    });

    it('should drop unsafe srcset schemes instead of forwarding them to the DOM', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source srcset="javascript:alert(1) 1x, docs/images/hero.svg 1x">'
            + '<img src="docs/images/hero.svg" alt="hero">'
            + '</picture>'
          }
        />
      );

      const srcSet = container.querySelector('source')?.getAttribute('srcset') ?? '';
      expect(srcSet).not.toContain('javascript:');
      expect(srcSet).toContain('https://github.com/user/repo/raw/HEAD/docs/images/hero.svg 1x');
    });

    it('should preserve the theme MIME hint on sanitized picture sources', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source type="image/avif" srcset="docs/images/hero.avif">'
            + '<img src="docs/images/hero.png" alt="hero">'
            + '</picture>'
          }
        />
      );

      expect(container.querySelector('source')).toHaveAttribute('type', 'image/avif');
    });

    it('should keep <img> a direct child of <picture> with the image tools outside', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source media="(prefers-color-scheme: dark)" srcset="docs/images/hero-dark.svg">'
            + '<img src="docs/images/hero.svg" alt="hero">'
            + '</picture>'
          }
        />
      );

      // Browsers only read <source> when <img> is its direct child, so no
      // wrapper (skeleton, ring, captions…) may sit between them.
      expect(container.querySelector('picture > source')).toBeInTheDocument();
      expect(container.querySelector('picture > img')).toBeInTheDocument();
      expect(container.querySelector('picture > span')).toBeNull();
      // The image tools themselves are hoisted outside the <picture>.
      const picture = container.querySelector('picture');
      expect(picture?.parentElement).not.toBeNull();
      expect(picture?.parentElement?.querySelector('span')).toBeInTheDocument();
    });

    it('should not split srcset candidates on commas inside URLs', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source srcset="https://cdn.example.com/w_800,q_auto/hero.jpg 1x, docs/images/hero@2x.jpg 2x">'
            + '<img src="docs/images/hero.jpg" alt="hero">'
            + '</picture>'
          }
        />
      );

      const srcSet = container.querySelector('source')?.getAttribute('srcset') ?? '';
      // The CDN URL keeps its own commas; only the relative candidate is rewritten.
      expect(srcSet).toBe(
        'https://cdn.example.com/w_800,q_auto/hero.jpg 1x, '
        + 'https://github.com/user/repo/raw/HEAD/docs/images/hero@2x.jpg 2x'
      );
    });

    it('should filter srcset schemes even without a baseUrl', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          content={
            '<picture>'
            + '<source srcset="//cdn.example.com/hero.webp 1x, data:image/png;base64,AAAA 1x, docs/images/hero.png 2x">'
            + '<img src="hero.png" alt="hero">'
            + '</picture>'
          }
        />
      );

      const srcSet = container.querySelector('source')?.getAttribute('srcset') ?? '';
      // Protocol-relative candidates become https, unsafe schemes are dropped,
      // and unresolvable relative candidates stay as authored (like img[src]).
      expect(srcSet).toBe('https://cdn.example.com/hero.webp 1x, docs/images/hero.png 2x');
    });

    it('should zoom and download the source the browser actually selected', async () => {
      const selectedSrc = 'https://cdn.example.com/hero-dark.svg';
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + `<source srcset="${selectedSrc}">`
            + '<img src="docs/images/hero.svg" alt="hero">'
            + '</picture>'
          }
        />
      );

      const img = container.querySelector('img') as HTMLImageElement;
      // jsdom never runs <picture> selection: emulate the browser picking the
      // dark <source> instead of the relative <img> fallback.
      Object.defineProperty(img, 'currentSrc', { configurable: true, value: selectedSrc });
      fireEvent.load(img);

      fireEvent.click(img);
      const overlay = document.querySelector('[class*="z-[99999]"]');
      expect(overlay).not.toBeNull();
      // The zoom preview must show what the user is looking at, not the fallback.
      expect(overlay?.querySelector('img')).toHaveAttribute('src', selectedSrc);

      const fetchMock = vi.fn().mockResolvedValue({ blob: async () => new Blob(['x']) });
      vi.stubGlobal('fetch', fetchMock);
      // jsdom has neither URL.createObjectURL nor hyperlink navigation: swallow
      // the anchor click so only the fetched URL matters here.
      const anchorClick = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      try {
        const downloadButton = overlay?.querySelector('button[title="下载图片"]') as HTMLButtonElement;
        expect(downloadButton).toBeInTheDocument();

        fireEvent.click(downloadButton);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(selectedSrc));
      } finally {
        anchorClick.mockRestore();
        vi.unstubAllGlobals();
      }
    });

    it('should fall back to the authored image URL when no source was selected', () => {
      const { container } = render(
        <MarkdownRenderer
          enableHtml
          baseUrl="https://github.com/user/repo"
          content={
            '<picture>'
            + '<source srcset="https://cdn.example.com/hero-dark.svg">'
            + '<img src="docs/images/hero.svg" alt="hero">'
            + '</picture>'
          }
        />
      );

      // jsdom reports an empty currentSrc, so the load keeps the fallback URL.
      const img = container.querySelector('img') as HTMLImageElement;
      fireEvent.load(img);

      fireEvent.click(img);
      const overlay = document.querySelector('[class*="z-[99999]"]');
      expect(overlay?.querySelector('img')).toHaveAttribute(
        'src',
        'https://github.com/user/repo/raw/HEAD/docs/images/hero.svg'
      );
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

    it('should not nest the CodeBlock pre inside the outer markdown pre', () => {
      // react-markdown v10 下 pre 收到的子元素 type 是覆写后的 code 组件；
      // 握手失效时外层裸 <pre> 会包住 CodeBlock 自己的 <pre>（双份背景/内边距）。
      const { container } = render(
        <MarkdownRenderer content={'```javascript\nconst a = 1;\n```'} />
      );
      expect(container.querySelector('pre pre')).toBeNull();
    });

    it('should route language-less fenced blocks through CodeBlock (copy button + trim)', () => {
      const { container } = render(
        <MarkdownRenderer content={'```\n\nplain fenced text\n\n```'} />
      );
      expect(container.querySelector('pre pre')).toBeNull();
      expect(container.querySelector('button[aria-label="复制代码"]')).toBeInTheDocument();
      expect(container.querySelector('pre code')!.textContent).toBe('plain fenced text');
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
      // 老 Safari 不支持 lookbehind：直接断言导出正则的 source，
      // 避免对整个文件做文本扫描，也去掉对 cwd 的依赖。
      expect(MATH_PATTERN.source).not.toContain('?<!');
      // 防止为绕过检查而破坏检测能力：四种数学语法仍必须命中
      expect(MATH_PATTERN.test('$$E=mc^2$$')).toBe(true);
      expect(MATH_PATTERN.test('\\[display\\]')).toBe(true);
      expect(MATH_PATTERN.test('\\(inline\\)')).toBe(true);
      expect(MATH_PATTERN.test('$x^2$')).toBe(true);
    });

    it('should lazily load KaTeX and render display math', async () => {
      const { container } = render(<MarkdownRenderer content="$$E=mc^2$$" />);
      await waitFor(() => {
        expect(container.querySelector('.katex')).toBeInTheDocument();
      }, { timeout: 5000 });
    }, 10000);

    it('should not load math support for plain documents', () => {
      // KaTeX 是否加载完全由 MATH_PATTERN.test(content) 门控（与 effect 一致），
      // 直接断言门控为 false，不依赖真实定时器长度的竞态。
      expect(MATH_PATTERN.test('Just $5 and text')).toBe(false);
    });
  });
});
