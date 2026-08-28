import { FileCode2 } from 'lucide-react';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '../../../components/ui/hover-card';
import type { ToolEvidence } from '../../../types/repositoryChat';
import { citationAnchorUrl, citationBadgeLabel, citationExcerptPreview } from '../utils/citationUtils';

export interface CitationTarget {
  evidence: ToolEvidence;
  path: string;
  lineStart: number;
  lineEnd: number;
}

interface CitationBadgeProps {
  target: CitationTarget;
  language: 'zh' | 'en';
}

/**
 * 回答中 file:line 引用的 Badge：悬停浮出原文切片，点击跳转到固定 SHA 的
 * GitHub blob 对应行。非模态 HoverCard，不触发滚动锁。
 */
export const CitationBadge = ({ target, language }: CitationBadgeProps) => {
  const { evidence, path, lineStart, lineEnd } = target;
  const href = citationAnchorUrl(evidence);
  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => event.stopPropagation()}
          className="mx-0.5 inline-flex max-w-full items-center gap-1 translate-y-[1px] rounded border border-border bg-muted/50 px-1.5 py-0 align-baseline font-mono text-[0.78em] leading-5 text-muted-foreground no-underline transition-colors hover:border-primary/40 hover:bg-muted hover:text-foreground"
          aria-label={language === 'zh' ? `查看来源 ${path}:${lineStart}` : `Open source ${path}:${lineStart}`}
        >
          <FileCode2 className="h-3 w-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{citationBadgeLabel(path, lineStart, lineEnd)}</span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent>
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-mono text-foreground" title={`/${path}`}>/{path}</span>
          <span className="shrink-0 text-muted-foreground">
            L{lineStart}{lineEnd > lineStart ? `-L${lineEnd}` : ''}
          </span>
        </div>
        {evidence.refSha && <p className="mt-1 font-mono text-[0.7rem] text-muted-foreground">{evidence.refSha.slice(0, 12)}</p>}
        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-xs leading-5 text-foreground">{citationExcerptPreview(evidence.excerpt)}</pre>
        <p className="mt-2 text-[0.7rem] text-muted-foreground">
          {language === 'zh' ? '点击打开 GitHub 对应位置' : 'Click to open the source on GitHub'}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
};

export default CitationBadge;
