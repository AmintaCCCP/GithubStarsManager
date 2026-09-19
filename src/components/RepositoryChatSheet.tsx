import { makeT, useT } from "../i18n/useT";
import type { AppLanguage } from '../i18n/languages';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Copy, ExternalLink, Gauge, History, Loader2, MessageSquareText, Plus, RotateCcw, Send, Square } from 'lucide-react';
import type { Repository } from '../types';
import type { RepositoryChatMessage, RepositoryChatTaskDepth, RepositoryChatToolEvent, ToolEvidence } from '../types/repositoryChat';
import { TASK_DEPTH_PRESETS } from '../types/repositoryChat';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { safeWriteText } from '../utils/clipboardUtils';
import { useShallow } from 'zustand/react/shallow';
import { useRepositoryChatSessions } from '../features/repository-chat/hooks/useRepositoryChatSessions';
import { useRepositoryChat } from '../features/repository-chat/hooks/useRepositoryChat';
import { useTurnStatusAnnouncement } from '../features/repository-chat/hooks/useTurnStatusAnnouncement';
import { RepositoryChatHistoryPanel } from './RepositoryChatHistoryPanel';
import MarkdownRenderer from './MarkdownRenderer';
import { CitationBadge } from '../features/repository-chat/components/CitationBadge';
import { resolveCitation, stripCitationsForCopy } from '../features/repository-chat/utils/citationUtils';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Textarea } from './ui/textarea';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from './ui/dropdown-menu';

interface RepositoryChatSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onCloseAutoFocus?: () => void;
  repository: Repository;
  /** 从全局问答历史进入时，直接选中该会话。 */
  initialSessionId?: string | null;
  /** 从全局问答历史进入时，返回历史列表。 */
  onBack?: () => void;
}

const shortSha = (sha: string) => sha.slice(0, 7);

const formatToolDuration = (durationMs?: number): string | null => {
  if (!durationMs || durationMs < 1) return null;
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s` : `${durationMs}ms`;
};

const stageLabels = (stage: RepositoryChatToolEvent['stage'], language: AppLanguage): string => {
  const t = makeT(language, 'chat');
  const known: Record<string, string> = {
    understanding: 'stage-understanding', context: 'stage-context', planning: 'stage-planning',
    retrieval: 'stage-retrieval', verification: 'stage-verification', replanning: 'stage-replanning',
    escalation: 'stage-escalation', answer: 'stage-answer',
  };
  return t(known[stage ?? ''] ?? 'stage-tool');
};

const TASK_DEPTH_OPTIONS: Array<{ value: RepositoryChatTaskDepth; key: string }> = [
  { value: 'default', key: 'depth-default' },
  { value: 'quick', key: 'depth-quick' },
  { value: 'deep', key: 'depth-deep' },
  { value: 'unlimited', key: 'depth-unlimited' },
];

const depthMeta = (depth: RepositoryChatTaskDepth, language: AppLanguage): { label: string; description: string } => {
  const t = makeT(language, 'chat');
  const option = TASK_DEPTH_OPTIONS.find((item) => item.value === depth) ?? TASK_DEPTH_OPTIONS[0]!;
  const budget = depth !== 'default' ? TASK_DEPTH_PRESETS[depth].budget : null;
  const optionLabel = t(`repositoryChatSheet.${option.key}`);
  const label = budget
    ? t('repositoryChatSheet.depth-with-budget', { label: optionLabel, turns: budget.maxTurns, seconds: Math.round(budget.maxDurationMs / 1000) })
    : optionLabel;
  return { label, description: t(`repositoryChatSheet.${option.key}-desc`) };
};

const ExecutionTimeline: React.FC<{ events: RepositoryChatToolEvent[]; language: AppLanguage; isRunning: boolean }> = ({ events, language, isRunning }) => {
  const t = useT('chat');
  const completed = events.filter((event) => event.status === 'success').length;
  const failed = events.filter((event) => event.status === 'error').length;
  const runningEvent = [...events].reverse().find((event) => event.status === 'running' || event.status === 'pending');
  const totalDuration = events.reduce((total, event) => total + (event.durationMs ?? 0), 0);
  const grouped = events.reduce<Array<{ stage: RepositoryChatToolEvent['stage']; round?: number; events: RepositoryChatToolEvent[] }>>((groups, event) => {
    const previous = groups[groups.length - 1];
    if (previous && previous.stage === event.stage && previous.round === event.round) {
      previous.events.push(event);
    } else {
      groups.push({ stage: event.stage, round: event.round, events: [event] });
    }
    return groups;
  }, []);
  const HeaderIcon = isRunning ? Loader2 : failed > 0 ? AlertCircle : CheckCircle2;

  return (
    <details className="group/timeline mt-4 rounded-lg border border-border bg-muted/15 text-xs" aria-label={t('repositoryChatSheet.agent-execution-summary')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <HeaderIcon className={`h-4 w-4 shrink-0 ${isRunning ? 'animate-spin text-primary' : failed > 0 ? 'text-destructive' : 'text-emerald-500'}`} aria-hidden="true" />
        <span className="shrink-0 font-semibold text-foreground">{t('repositoryChatSheet.this-turn-s-work')}</span>
        <span className="shrink-0 text-xs text-muted-foreground">
          {completed}/{events.length}
          {!isRunning && totalDuration > 0 ? ` · ${formatToolDuration(totalDuration)}` : ''}
          {failed > 0 ? ` · ${t('repositoryChatSheet.failed-attention', { failed: failed })}` : ''}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-muted-foreground" title={isRunning && runningEvent ? runningEvent.paramSummary : undefined}>
          {isRunning && runningEvent ? runningEvent.paramSummary : ''}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/timeline:rotate-90" aria-hidden="true" />
      </summary>
      <div className="border-t border-border/70 px-3 py-2">
        <p className="mb-2 text-muted-foreground">{t('repositoryChatSheet.this-shows-the-documents-sections-and-supplement')}</p>
        <div className="divide-y divide-border/70">
          {grouped.map((group, groupIndex) => {
            const stageHasRunning = group.events.some((event) => event.status === 'running');
            const stageErrors = group.events.filter((event) => event.status === 'error').length;
            const duration = group.events.reduce((total, event) => total + (event.durationMs ?? 0), 0);
            const Icon = stageErrors > 0 ? AlertCircle : stageHasRunning ? CircleDot : CheckCircle2;
            const label = group.round && ['planning', 'retrieval', 'verification', 'replanning'].includes(group.stage ?? '')
              ? `${t('repositoryChatSheet.round')}${group.round}${t('repositoryChatSheet.text')}${stageLabels(group.stage, language)}`
              : stageLabels(group.stage, language);
            return (
              <div key={`${group.stage ?? 'other'}-${group.round ?? 'global'}-${groupIndex}`} className="py-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${stageErrors > 0 ? 'text-destructive' : stageHasRunning ? 'animate-pulse text-primary' : 'text-emerald-500'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 font-medium text-foreground">{label}</span>
                  <span className={`text-xs ${stageErrors > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{stageErrors > 0 ? t('repositoryChatSheet.needs-attention') : stageHasRunning ? t('repositoryChatSheet.in-progress') : t('repositoryChatSheet.completed')}{duration > 0 ? ` · ${formatToolDuration(duration)}` : ''}</span>
                </div>
                <ol className="mt-2 ml-2 space-y-2 border-l border-border pl-3">
                  {group.events.map((event) => {
                    const statusLabel = event.status === 'success' ? t('repositoryChatSheet.done') : event.status === 'running' ? t('repositoryChatSheet.running') : event.status === 'error' ? t('repositoryChatSheet.failed') : t('repositoryChatSheet.queued');
                    const eventDuration = formatToolDuration(event.durationMs);
                    return (
                      <li key={event.id} className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-foreground">{event.paramSummary}</span>
                          <span className={`ml-auto text-xs ${event.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLabel}{eventDuration ? ` · ${eventDuration}` : ''}</span>
                        </div>
                        {event.detail && <p className="break-words text-muted-foreground">{event.detail}</p>}
                      </li>
                    );
                  })}
                </ol>
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
};

/** 助手消息正文：行内引用渲染为 CitationBadge；按内容 + 证据 + 语言做 memo，避免流式期间全量重渲。 */
const AssistantMessageBody = React.memo<{ content: string; evidenceIds: string[]; evidenceById: Record<string, ToolEvidence>; language: AppLanguage }>(({ content, evidenceIds, evidenceById, language }) => {
  const renderInlineCode = useCallback((text: string) => {
    const evidences = evidenceIds
      .map((id) => evidenceById[id])
      .filter((evidence): evidence is ToolEvidence => Boolean(evidence));
    if (evidences.length === 0) return null;
    const resolved = resolveCitation(text, evidences);
    if (!resolved) return null;
    return <CitationBadge target={resolved} language={language} />;
  }, [evidenceIds, evidenceById, language]);
  return <MarkdownRenderer content={content} shouldRender breaks fontSize="small" className="repository-chat-markdown" renderInlineCode={renderInlineCode} />;
});

const RepositoryChatSheet: React.FC<RepositoryChatSheetProps> = ({
  isOpen,
  onClose,
  onCloseAutoFocus,
  repository,
  initialSessionId,
  onBack,
}) => {
  const { language, setCurrentView, repositoryChatSettings, setRepositoryChatSettings } = useAppStore(useShallow((state) => ({
    language: state.language,
    setCurrentView: state.setCurrentView,
    repositoryChatSettings: state.repositoryChatSettings,
    setRepositoryChatSettings: state.setRepositoryChatSettings,
  })));
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState('');
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const { toast } = useDialog();
  const messageRegionRef = useRef<HTMLDivElement>(null);
  const t = useT('chat');
  const {
    sessions,
    activeSession,
    messages,
    isLoading,
    error,
    createSession,
    selectSession,
    deleteSession,
    updateSession,
    setMessages,
  } = useRepositoryChatSessions({ repository, language });
  const {
    canChat,
    unavailableReason,
    isSending,
    error: chatError,
    toolEvents,
    evidenceById,
    send,
    stop,
    retry,
    regenerate,
  } = useRepositoryChat({
    repository,
    session: activeSession,
    messages,
    onMessagesChange: setMessages,
    onSessionChange: updateSession,
  });

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
      return;
    }
    if (repository) {
      try {
        const pending = JSON.parse(sessionStorage.getItem('gsm:repository-chat-return') || 'null') as { repoId?: unknown; draft?: unknown } | null;
        if (pending?.repoId === repository.id && typeof pending.draft === 'string') {
          setDraft(pending.draft);
          sessionStorage.removeItem('gsm:repository-chat-return');
        }
      } catch {
        sessionStorage.removeItem('gsm:repository-chat-return');
      }
    }
  }, [isOpen, repository]);

  // 吸底滚动：流式输出期间自动跟随；用户向上滚动后暂停，可点按钮回到底部。
  useEffect(() => {
    const element = messageRegionRef.current;
    if (!element || !isPinnedToBottom) return;
    element.scrollTo({ top: element.scrollHeight });
  }, [messages, toolEvents, isLoading, isPinnedToBottom]);

  const handleRegionScroll = useCallback(() => {
    const element = messageRegionRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
    setIsPinnedToBottom(nearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = messageRegionRef.current;
    if (!element) return;
    setIsPinnedToBottom(true);
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, []);

  const handleCreateSession = () => {
    if (isLoading || isSending) return;
    void createSession();
    setShowHistory(false);
  };

  // 从全局问答历史进入：会话列表就绪后直接选中目标会话。
  const initialSessionAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    initialSessionAppliedRef.current = null;
  }, [repository.id]);
  useEffect(() => {
    if (!initialSessionId || initialSessionAppliedRef.current === initialSessionId || isLoading) return;
    if (!sessions.some((session) => session.id === initialSessionId)) return;
    if (activeSession?.id === initialSessionId) {
      initialSessionAppliedRef.current = initialSessionId;
      return;
    }
    initialSessionAppliedRef.current = initialSessionId;
    void selectSession(initialSessionId);
  }, [initialSessionId, sessions, isLoading, activeSession?.id, selectSession]);

  const navigateToAiSettings = () => {
    if (repository) {
      sessionStorage.setItem('gsm:repository-chat-return', JSON.stringify({ repoId: repository.id, draft }));
    }
    sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
    setCurrentView('settings');
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'ai' } }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const question = draft.trim();
    if (!question || !canChat || !activeSession || isSending) return;
    setDraft('');
    setIsPinnedToBottom(true);
    void send(question);
  };

  const handleCopyAnswer = async (message: RepositoryChatMessage) => {
    const result = await safeWriteText(stripCitationsForCopy(message.content));
    toast(
      result.success ? t('repositoryChatSheet.answer-copied') : (result.error || t('repositoryChatSheet.copy-failed')),
      result.success ? 'success' : 'error'
    );
  };

  const lastMessage = messages[messages.length - 1];

  // 仅在回答从流式进入终态时向屏幕阅读器通报一次，避免 aria-live 在流式期间反复朗读。
  const lastAssistantStatus = lastMessage?.role === 'assistant' ? lastMessage.status : '';
  const statusAnnouncement = useTurnStatusAnnouncement(lastAssistantStatus, language);

  const isCopyableMessage = (message: RepositoryChatMessage): boolean => (
    message.role === 'assistant'
    && message.content.length > 0
    && message.status !== 'streaming'
    && !/未能生成可与精确来源核验的总结性结果|无法完成可验证的判断|did not produce a source-verifiable summary|a verifiable determination cannot be made/i.test(message.content)
  );
  const depth = depthMeta(repositoryChatSettings.taskDepth, language);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(100vw-1rem,48rem)] sm:max-w-none"
        closeLabel={t('repositoryChatSheet.close-repository-chat')}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          window.setTimeout(onClose, 0);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
      >
        <SheetHeader>
          {onBack && (
            <div className="-mb-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={onBack}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t('repositoryChatSheet.back-to-history')}
              </Button>
            </div>
          )}
          <div className="flex min-w-0 items-start gap-3">
            <img src={repository.owner.avatar_url} alt="" className="h-9 w-9 shrink-0 rounded-md border border-border" />
            <div className="min-w-0 flex-1">
              <SheetTitle className="flex items-center gap-2 text-base">
                <MessageSquareText className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{repository.full_name}</span>
              </SheetTitle>
              <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                {repository.language && <span>{repository.language}</span>}
                {activeSession?.sourceRefSha ? (
                  <span>{t('repositoryChatSheet.based-on-v1', { v1: shortSha(activeSession.sourceRefSha) })}</span>
                ) : (
                  <span>{t('repositoryChatSheet.a-new-session-will-pin-its-source-version')}</span>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Button type="button" variant="secondary" size="sm" onClick={handleCreateSession} disabled={isLoading || isSending}>
            {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t('repositoryChatSheet.new-chat')}
          </Button>
          <Button
            type="button"
            variant={showHistory ? 'secondary' : 'ghost'}
            size="sm"
            className="ml-auto"
            onClick={() => setShowHistory((previous) => !previous)}
            aria-pressed={showHistory}
          >
            <History className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('repositoryChatSheet.history')}
          </Button>
        </div>

        <div className="min-h-0 flex flex-1 gap-4 overflow-hidden">
          {showHistory ? (
            <div className="min-h-0 w-full max-w-sm border-r border-border pr-3">
              <RepositoryChatHistoryPanel
                sessions={sessions}
                activeSessionId={activeSession?.id}
                language={language}
                disabled={isLoading || isSending}
                onSelect={(sessionId) => {
                  void selectSession(sessionId);
                  setShowHistory(false);
                }}
                onDelete={(sessionId) => void deleteSession(sessionId)}
              />
            </div>
          ) : (
            <div className="relative min-h-0 flex-1">
              <div ref={messageRegionRef} onScroll={handleRegionScroll} className="h-full overflow-y-auto pr-1">
                {error ? (
                  <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-destructive/40 bg-muted/20 px-5 text-center">
                    <p className="text-sm text-destructive">{error}</p>
                  </div>
                ) : isLoading ? (
                  <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    {t('repositoryChatSheet.restoring-conversation')}
                  </div>
                ) : !canChat ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border px-6 text-center">
                    <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('repositoryChatSheet.repository-chat-is-not-ready')}</p>
                      <p className="text-xs text-muted-foreground">{unavailableReason}</p>
                    </div>
                    <Button type="button" onClick={navigateToAiSettings}>{t('repositoryChatSheet.configure-ai-service')}</Button>
                  </div>
                ) : !activeSession ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border px-6 text-center">
                    <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('repositoryChatSheet.ask-this-repository')}</p>
                      <p className="text-xs text-muted-foreground">{t('repositoryChatSheet.a-new-conversation-pins-the-current-source-versi')}</p>
                    </div>
                    <Button type="button" onClick={handleCreateSession} disabled={isLoading || isSending}>
                      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t('repositoryChatSheet.new-conversation')}
                    </Button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
                    <p className="text-sm font-medium">{t('repositoryChatSheet.you-can-start-with')}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        t('repositoryChatSheet.what-does-this-repository-do'),
                        t('repositoryChatSheet.how-do-i-install-and-get-started-with-this-proje'),
                      ].map((prompt) => (
                        <Button key={prompt} type="button" variant="outline" className="h-auto justify-start whitespace-normal p-3 text-left text-xs" onClick={() => setDraft(prompt)}>
                          {prompt}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {chatError && (
                      <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-muted/20 px-3 py-2 text-sm text-destructive">
                        <span>{chatError}</span>
                        <Button type="button" variant="secondary" size="sm" onClick={() => void retry()}>{t('repositoryChatSheet.retry')}</Button>
                      </div>
                    )}
                    {messages.map((message) => {
                      const messageToolEvents = toolEvents.filter((event) => event.messageId === message.id);
                      const isLastAssistant = message === lastMessage && message.role === 'assistant';
                      const canRegenerate = isLastAssistant && message.status !== 'streaming' && !isSending;
                      return (
                      <article key={message.id} className={`group/message rounded-md border border-border p-3 text-sm ${message.role === 'user' ? 'bg-muted/30' : 'bg-card'}`}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">{message.role === 'user' ? t('repositoryChatSheet.you') : t('repositoryChatSheet.repository-copilot')}</p>
                        </div>
                        {message.role === 'assistant' && messageToolEvents.length > 0 && (
                          <ExecutionTimeline events={messageToolEvents} language={language} isRunning={message.status === 'streaming'} />
                        )}
                        <div className={message.role === 'assistant' && messageToolEvents.length > 0 ? 'mt-4' : ''}>
                          {message.content ? (
                            <AssistantMessageBody
                              content={message.content}
                              evidenceIds={message.evidenceIds}
                              evidenceById={evidenceById}
                              language={language}
                            />
                          ) : (
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t('repositoryChatSheet.generating')} />
                          )}
                        </div>
                        {message.evidenceIds.length > 0 && (
                          <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                            <summary className="cursor-pointer font-medium text-foreground">{t('repositoryChatSheet.sources-and-evidence-v1', { v1: message.evidenceIds.length })}</summary>
                            <p className="mt-1 text-muted-foreground">{t('repositoryChatSheet.expand-to-inspect-this-turn-s-pinned-versions-li')}</p>
                            <div className="mt-2 grid gap-2">
                              {message.evidenceIds.map((evidenceId) => {
                                const evidence = evidenceById[evidenceId];
                                if (!evidence) return null;
                                return (
                                  <a key={evidence.id} href={evidence.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-xs hover:bg-muted" aria-label={t('repositoryChatSheet.view-source-v1', { v1: evidence.path ?? evidence.repoFullName })}>
                                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate">{evidence.repoFullName} · {evidence.path ? `${evidence.path}:L${evidence.lineStart ?? 1}-L${evidence.lineEnd ?? 1}` : t('repositoryChatSheet.repository-metadata')}</span>
                                    {evidence.refSha && <code className="shrink-0 text-muted-foreground">{shortSha(evidence.refSha)}</code>}
                                  </a>
                                );
                              })}
                            </div>
                          </details>
                        )}
                        {message.role === 'assistant' && message.status !== 'streaming' && (isCopyableMessage(message) || canRegenerate) && (
                          <div className="mt-2 flex items-center justify-end gap-1 opacity-100 transition-opacity focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/message:opacity-100">
                            {isCopyableMessage(message) && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => void handleCopyAnswer(message)}
                                aria-label={t('repositoryChatSheet.copy-answer')}
                                title={t('repositoryChatSheet.copy-answer-without-citation-marks')}
                              >
                                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                            {canRegenerate && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => void regenerate()}
                                aria-label={t('repositoryChatSheet.regenerate')}
                                title={t('repositoryChatSheet.regenerate-this-answer')}
                              >
                                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            )}
                          </div>
                        )}
                      </article>
                      );
                    })}
                  </div>
                )}
              </div>
              {!isPinnedToBottom && (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-background shadow-md"
                  onClick={scrollToBottom}
                  aria-label={t('repositoryChatSheet.scroll-to-latest')}
                  title={t('repositoryChatSheet.scroll-to-latest')}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}
        </div>

        <form
          className="border-t border-border pt-3"
          onSubmit={handleSubmit}
        >
          <p role="status" className="sr-only">{statusAnnouncement}</p>
          <label className="sr-only" htmlFor="repository-chat-draft">{t('repositoryChatSheet.question')}</label>
          <div className="flex items-end gap-2">
            <Textarea
              id="repository-chat-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('repositoryChatSheet.for-example-what-does-this-repository-do-how-do')}
              className="min-h-20 resize-y text-sm"
              disabled={!activeSession || !canChat || isSending}
            />
            {isSending ? (
              <Button type="button" size="icon" variant="secondary" onClick={stop} aria-label={t('repositoryChatSheet.stop-generating')} title={t('repositoryChatSheet.stop-generating')}>
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!activeSession || !canChat || !draft.trim()} aria-label={t('repositoryChatSheet.send-question')} title={t('repositoryChatSheet.send-question')}>
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={!activeSession || isSending} title={depth.description}>
                  <Gauge className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('repositoryChatSheet.task-depth')}：{depth.label}
                  <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-72">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t('repositoryChatSheet.task-depth-controls-retrieval-rounds-and-read-sc')}</DropdownMenuLabel>
                {TASK_DEPTH_OPTIONS.map((option) => {
                  const budget = option.value !== 'default' ? TASK_DEPTH_PRESETS[option.value].budget : null;
                  const suffix = budget ? ` · ${t('repositoryChatSheet.v1-rounds', { v1: budget.maxTurns })} · ${Math.round(budget.maxDurationMs / 1000)}s` : '';
                  const active = repositoryChatSettings.taskDepth === option.value;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      className={`flex-col items-start gap-0.5 py-2 ${active ? 'bg-muted/60' : ''}`}
                      onSelect={() => setRepositoryChatSettings({ taskDepth: option.value })}
                    >
                      <span className="flex w-full items-center gap-2 text-sm font-medium">
                        {t(`repositoryChatSheet.${option.key}`)}
                        <span className="text-xs font-normal text-muted-foreground">{suffix}</span>
                        {option.value === 'default' && <span className="text-xs font-normal text-muted-foreground">{t('repositoryChatSheet.current-default')}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{t(`repositoryChatSheet.${option.key}-desc`)}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {!isSending && lastMessage?.role === 'assistant' && (lastMessage.status === 'error' || lastMessage.status === 'aborted') && <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void retry()}><RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('repositoryChatSheet.retry')}</Button>}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default RepositoryChatSheet;
