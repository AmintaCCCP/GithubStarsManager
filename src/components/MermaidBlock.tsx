import React, { memo, useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';

type MermaidModule = (typeof import('mermaid'))['default'];

let mermaidPromise: Promise<MermaidModule> | null = null;

/** Lazily import the ~1MB mermaid package once and reuse the module promise. */
const loadMermaid = (): Promise<MermaidModule> => {
  mermaidPromise ||= import('mermaid').then((m) => m.default);
  return mermaidPromise;
};

let initializedTheme: 'light' | 'dark' | null = null;
let renderCounter = 0;

/**
 * Renders a ```mermaid fenced block as an SVG diagram.
 *
 * The ~1MB mermaid package is loaded lazily on the first diagram; the SVG is
 * produced by mermaid.render() with securityLevel 'strict' (mermaid sanitizes
 * its own output), so injecting it via dangerouslySetInnerHTML is safe.
 */
const MermaidBlock: React.FC<{ code: string }> = ({ code }) => {
  const theme = useAppStore((state) => state.theme);
  const uiLanguage = useAppStore((state) => state.language);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMermaid()
      .then(async (mermaid) => {
        if (initializedTheme !== theme) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            theme: theme === 'dark' ? 'dark' : 'default',
          });
          initializedTheme = theme;
        }
        await mermaid.parse(code); // throws ParseError on invalid syntax
        renderCounter += 1;
        const { svg: rendered } = await mermaid.render(`mermaid-svg-${renderCounter}`, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setSvg(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div
        data-translate="false"
        role="alert"
        className="my-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        <p className="font-semibold">
          {uiLanguage === 'zh' ? 'Mermaid 图表渲染失败' : 'Failed to render Mermaid diagram'}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-xs">{error}</pre>
      </div>
    );
  }

  if (!svg) {
    return <div data-translate="false" className="my-3 h-16 animate-pulse rounded-md bg-muted dark:bg-muted/40" />;
  }

  return (
    <div
      data-translate="false"
      className="mermaid my-3 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

MermaidBlock.displayName = 'MermaidBlock';

export default memo(MermaidBlock);
