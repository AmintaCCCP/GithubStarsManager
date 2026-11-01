import React, { useMemo } from 'react';
import { Check, ChevronRight, CircleDashed, Search, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import type { RepositoryChatToolEvent, RepositoryChatTurnMetrics } from '../../../types/repositoryChat';

const formatDuration = (durationMs: number): string => (
  durationMs >= 10_000 ? `${(durationMs / 1000).toFixed(0)}s` : `${(durationMs / 1000).toFixed(1)}s`
);

const parseTurnMetrics = (detail: string | undefined): RepositoryChatTurnMetrics | null => {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const metrics = parsed as Record<string, unknown>;
    if (typeof metrics.llmCalls !== 'number' || typeof metrics.toolCalls !== 'number' || typeof metrics.totalMs !== 'number') return null;
    return parsed as RepositoryChatTurnMetrics;
  } catch {
    return null;
  }
};

export const AgentActivity: React.FC<{
  events: RepositoryChatToolEvent[];
  isRunning: boolean;
  failed?: boolean;
}> = ({ events, isRunning, failed = false }) => {
  const t = useT('chat');
  const timelineEvents = events.filter((event) => event.toolName !== 'turn_metrics');
  const metrics = parseTurnMetrics(events.filter((event) => event.toolName === 'turn_metrics').at(-1)?.detail);
  const runningEvent = [...timelineEvents].reverse().find((event) => event.status === 'running' || event.status === 'pending');
  const fileCount = new Set(timelineEvents
    .filter((event) => event.toolName === 'read_repo_file' && event.status === 'success')
    .map((event) => event.paramSummary.split(' · ')[0])).size;
  const thoughtCount = timelineEvents.filter((event) => (
    event.stage === 'planning' || event.stage === 'replanning' || event.stage === 'verification'
  )).length;
  const firstCreatedAt = timelineEvents[0]?.createdAt;
  const lastCreatedAt = timelineEvents.at(-1)?.createdAt;
  const wallClockMs = firstCreatedAt && lastCreatedAt
    ? Math.max(0, Date.parse(lastCreatedAt) - Date.parse(firstCreatedAt))
    : 0;
  const durationMs = metrics?.totalMs ?? wallClockMs;
  const groups = useMemo(() => {
    const map = new Map<string, { events: RepositoryChatToolEvent[]; label: string }>();
    timelineEvents.forEach((event) => {
      const key = event.toolName === 'evidence_gate'
        ? 'evidence_gate'
        : event.toolName === 'plan_research' || event.toolName === 'replan_research'
          ? 'planning'
          : `${event.toolName}:${event.paramSummary}`;
      const existing = map.get(key);
      if (existing) existing.events.push(event);
      else map.set(key, { events: [event], label: event.paramSummary });
    });
    return [...map.values()];
  }, [timelineEvents]);

  const runningLabel = runningEvent
    ? `${runningEvent.paramSummary}${runningEvent.detail ? ` · ${runningEvent.detail}` : ''}`
    : t('repositoryChatSheet.activity-thinking');

  return (
    <details className="group/activity mb-3 text-xs" aria-label={t('repositoryChatSheet.agent-execution-summary')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-1 text-muted-foreground transition-colors hover:text-foreground">
        {isRunning ? (
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <span className="absolute h-2 w-2 animate-ping rounded-full bg-primary/50" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
        ) : failed ? (
          <X className="h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
        ) : (
          <Check className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate">
          {isRunning
            ? runningLabel
            : t('repositoryChatSheet.activity-finished', {
                files: fileCount,
                thoughts: thoughtCount,
                duration: formatDuration(durationMs),
              })}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform group-open/activity:rotate-90" aria-hidden="true" />
      </summary>
      <div className="ml-2 mt-1 space-y-1 border-l border-border/70 pl-3">
        {groups.map((group, index) => {
          const latest = group.events.at(-1)!;
          const failed = latest.status === 'error';
          const running = latest.status === 'running' || latest.status === 'pending';
          const count = group.events.length > 1 ? ` ×${group.events.length}` : '';
          return (
            <div key={`${latest.id}-${index}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-muted-foreground">
              {running ? (
                <CircleDashed className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
              ) : failed ? (
                <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Search className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1 truncate">{group.label}{count}</span>
              {latest.durationMs ? <span className="shrink-0 tabular-nums">{formatDuration(latest.durationMs)}</span> : null}
            </div>
          );
        })}
        {import.meta.env.DEV && metrics ? (
          <p className="pt-1 font-mono text-[11px] text-muted-foreground" data-testid="turn-metrics">
            {`llm:${metrics.llmCalls} tools:${metrics.toolCalls} rounds:${metrics.rounds}${metrics.ttftMs !== undefined ? ` ttft:${metrics.ttftMs}ms` : ''} total:${metrics.totalMs}ms ${metrics.endReason}`}
          </p>
        ) : null}
      </div>
    </details>
  );
};
