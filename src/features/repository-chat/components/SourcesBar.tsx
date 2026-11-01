import React from 'react';
import { ExternalLink } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import type { CitationSource } from '../utils/citationUtils';
import { citationAnchorUrl } from '../utils/citationUtils';

const sourceLabel = (source: CitationSource): string => (
  `${source.path.split('/').pop() || source.path}:L${source.lineStart}${source.lineEnd > source.lineStart ? `-L${source.lineEnd}` : ''}`
);

export const SourcesBar: React.FC<{ sources: CitationSource[] }> = ({ sources }) => {
  const t = useT('chat');
  if (sources.length === 0) return null;
  const visible = sources.slice(0, 3);
  return (
    <details className="group/sources mt-3 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 overflow-hidden">
        {visible.map((source) => (
          <a
            key={source.key}
            href={citationAnchorUrl(source.evidence, source.lineStart, source.lineEnd)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1 rounded-full border border-border/70 bg-muted/40 px-2 py-1 text-muted-foreground no-underline hover:text-foreground"
            title={`/${source.path}:L${source.lineStart}-L${source.lineEnd}`}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="font-medium text-foreground">{source.number}</span>
            <span className="max-w-36 truncate">{sourceLabel(source)}</span>
          </a>
        ))}
        {sources.length > visible.length ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-1 text-muted-foreground">+{sources.length - visible.length}</span>
        ) : null}
      </summary>
      <div className="mt-2 grid gap-1.5 rounded-xl border border-border/70 bg-muted/20 p-2">
        <p className="px-1 text-[11px] font-medium text-muted-foreground">{t('repositoryChatSheet.sources')}</p>
        {sources.map((source) => (
          <a
            key={source.key}
            href={citationAnchorUrl(source.evidence, source.lineStart, source.lineEnd)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-muted-foreground hover:bg-background/70 hover:text-foreground"
          >
            <span className="w-4 shrink-0 text-center font-medium text-foreground">{source.number}</span>
            <span className="min-w-0 flex-1 truncate">{source.path}:L{source.lineStart}-L{source.lineEnd}</span>
            {source.evidence.refSha ? <code className="shrink-0 text-[10px]">{source.evidence.refSha.slice(0, 7)}</code> : null}
            <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </a>
        ))}
      </div>
    </details>
  );
};
