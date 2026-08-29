import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowDown, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Copy, ExternalLink, Gauge, History, Loader2, MessageSquareText, Plus, RotateCcw, Send, Square } from 'lucide-react';
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
}

const shortSha = (sha: string) => sha.slice(0, 7);

const formatToolDuration = (durationMs?: number): string | null => {
  if (!durationMs || durationMs < 1) return null;
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s` : `${durationMs}ms`;
};

const stageLabels = (stage: RepositoryChatToolEvent['stage'], language: 'zh' | 'en'): string => {
  const zh = language === 'zh';
  if (stage === 'understanding') return zh ? '理解问题' : 'Understand question';
  if (stage === 'context') return zh ? '查看项目结构' : 'Inspect repository structure';
  if (stage === 'planning') return zh ? '制定阅读计划' : 'Plan what to read';
  if (stage === 'retrieval') return zh ? '阅读相关资料' : 'Read relevant sources';
  if (stage === 'verification') return zh ? '评估问题是否已可回答' : 'Assess whether the question is answerable';
  if (stage === 'replanning') return zh ? '补充阅读计划' : 'Plan additional reading';
  if (stage === 'escalation') return zh ? '补充实现细节' : 'Inspect implementation details';
  if (stage === 'answer') return zh ? '整理最终回答' : 'Prepare final answer';
  return zh ? '工具调用' : 'Tool call';
};

const TASK_DEPTH_OPTIONS: Array<{ value: RepositoryChatTaskDepth; zh: string; en: string; descZh: string; descEn: string }> = [
  { value: 'default', zh: '默认', en: 'Default', descZh: '跟随设置中的高级参数', descEn: 'Follow the advanced settings' },
  { value: 'quick', zh: '快速', en: 'Quick', descZh: '少量文档取证，尽快出答', descEn: 'Read fewer documents, answer fast' },
  { value: 'deep', zh: '深入', en: 'Deep', descZh: '多轮取证并读代码，适合细节与对比', descEn: 'More rounds, reads code too; best for details' },
  { value: 'unlimited', zh: '不限', en: 'Unlimited', descZh: '放开所有限制，注意耗时与额度', descEn: 'No limits; expect longer runs and higher usage' },
];

const depthMeta = (depth: RepositoryChatTaskDepth, language: 'zh' | 'en'): { label: string; description: string } => {
  const option = TASK_DEPTH_OPTIONS.find((item) => item.value === depth) ?? TASK_DEPTH_OPTIONS[0];
  const budget = depth !== 'default' ? TASK_DEPTH_PRESETS[depth].budget : null;
  const label = budget
    ? `${language === 'zh' ? option.zh : option.en} · ${budget.maxTurns}${language === 'zh' ? '轮' : ' rounds'}/${Math.round(budget.maxDurationMs / 1000)}s`
    : (language === 'zh' ? option.zh : option.en);
  return { label, description: language === 'zh' ? option.descZh : option.descEn };
};

const ExecutionTimeline: React.FC<{ events: RepositoryChatToolEvent[]; language: 'zh' | 'en'; isRunning: boolean }> = ({ events, language, isRunning }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
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
    <details className="group/timeline mt-4 rounded-lg border border-border bg-muted/15 text-xs" aria-label={t('Agent 执行摘要', 'Agent execution summary')}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5">
        <HeaderIcon className={`h-4 w-4 shrink-0 ${isRunning ? 'animate-spin text-primary' : failed > 0 ? 'text-destructive' : 'text-emerald-500'}`} aria-hidden="true" />
        <span className="shrink-0 font-semibold text-foreground">{t('本轮任务执行', 'This turn’s work')}</span>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {completed}/{events.length}
          {!isRunning && totalDuration > 0 ? ` · ${formatToolDuration(totalDuration)}` : ''}
          {failed > 0 ? ` · ${t(`${failed} 项需注意`, `${failed} attention`)}` : ''}
        </span>
        <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground" title={isRunning && runningEvent ? runningEvent.paramSummary : undefined}>
          {isRunning && runningEvent ? runningEvent.paramSummary : ''}
        </span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/timeline:rotate-90" aria-hidden="true" />
      </summary>
      <div className="border-t border-border/70 px-3 py-2">
        <p className="mb-2 text-muted-foreground">{t('这里会展示为回答问题实际查阅的文档、章节和补充资料。', 'This shows the documents, sections, and supplementary sources actually read to answer your question.')}</p>
        <div className="divide-y divide-border/70">
          {grouped.map((group, groupIndex) => {
            const stageHasRunning = group.events.some((event) => event.status === 'running');
            const stageErrors = group.events.filter((event) => event.status === 'error').length;
            const duration = group.events.reduce((total, event) => total + (event.durationMs ?? 0), 0);
            const Icon = stageErrors > 0 ? AlertCircle : stageHasRunning ? CircleDot : CheckCircle2;
            const label = group.round && ['planning', 'retrieval', 'verification', 'replanning'].includes(group.stage ?? '')
              ? `${t('第', 'Round ')}${group.round}${t('轮 · ', ' · ')}${stageLabels(group.stage, language)}`
              : stageLabels(group.stage, language);
            return (
              <div key={`${group.stage ?? 'other'}-${group.round ?? 'global'}-${groupIndex}`} className="py-2">
                <div className="flex items-center gap-2">
                  <Icon className={`h-4 w-4 shrink-0 ${stageErrors > 0 ? 'text-destructive' : stageHasRunning ? 'animate-pulse text-primary' : 'text-emerald-500'}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1 font-medium text-foreground">{label}</span>
                  <span className={`text-[11px] ${stageErrors > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{stageErrors > 0 ? t('需注意', 'Needs attention') : stageHasRunning ? t('进行中', 'In progress') : t('已完成', 'Completed')}{duration > 0 ? ` · ${formatToolDuration(duration)}` : ''}</span>
                </div>
                <ol className="mt-2 ml-2 space-y-2 border-l border-border pl-3">
                  {group.events.map((event) => {
                    const statusLabel = event.status === 'success' ? t('完成', 'Done') : event.status === 'running' ? t('进行中', 'Running') : event.status === 'error' ? t('失败', 'Failed') : t('准备中', 'Queued');
                    const eventDuration = formatToolDuration(event.durationMs);
                    return (
                      <li key={event.id} className="grid gap-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-medium text-foreground">{event.paramSummary}</span>
                          <span className={`ml-auto text-[11px] ${event.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLabel}{eventDuration ? ` · ${eventDuration}` : ''}</span>
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
const AssistantMessageBody = React.memo<{ content: string; evidenceIds: string[]; evidenceById: Record<string, ToolEvidence>; language: 'zh' | 'en' }>(({ content, evidenceIds, evidenceById, language }) => {
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
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
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
      result.success ? t('回答已复制', 'Answer copied') : (result.error || t('复制失败', 'Copy failed')),
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
        closeLabel={t('关闭仓库问答', 'Close repository chat')}
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
                  <span>{t(`基于 ${shortSha(activeSession.sourceRefSha)}`, `Based on ${shortSha(activeSession.sourceRefSha)}`)}</span>
                ) : (
                  <span>{t('新会话将固定源码版本', 'A new session will pin its source version')}</span>
                )}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="flex items-center gap-2 border-b border-border pb-3">
          <Button type="button" variant="secondary" size="sm" onClick={handleCreateSession} disabled={isLoading || isSending}>
            {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t('新建会话', 'New chat')}
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
            {t('历史', 'History')}
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
                    {t('正在恢复会话…', 'Restoring conversation…')}
                  </div>
                ) : !canChat ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border px-6 text-center">
                    <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('仓库问答尚未就绪', 'Repository chat is not ready')}</p>
                      <p className="text-xs text-muted-foreground">{unavailableReason}</p>
                    </div>
                    <Button type="button" onClick={navigateToAiSettings}>{t('配置 AI 服务', 'Configure AI service')}</Button>
                  </div>
                ) : !activeSession ? (
                  <div className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-md border border-dashed border-border px-6 text-center">
                    <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{t('开始询问这个仓库', 'Ask this repository')}</p>
                      <p className="text-xs text-muted-foreground">{t('新会话会固定当前源码版本，并在回答中保留可点击的来源。', 'A new conversation pins the current source version and keeps clickable sources in answers.')}</p>
                    </div>
                    <Button type="button" onClick={handleCreateSession} disabled={isLoading || isSending}>
                      <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                      {t('新建会话', 'New conversation')}
                    </Button>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="space-y-3 rounded-md border border-border bg-muted/20 p-4">
                    <p className="text-sm font-medium">{t('你可以从这些问题开始：', 'You can start with:')}</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {[
                        t('这个仓库是做什么的？', 'What does this repository do?'),
                        t('如何安装并开始使用这个项目？', 'How do I install and get started with this project?'),
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
                        <Button type="button" variant="secondary" size="sm" onClick={() => void retry()}>{t('重试', 'Retry')}</Button>
                      </div>
                    )}
                    {messages.map((message) => {
                      const messageToolEvents = toolEvents.filter((event) => event.messageId === message.id);
                      const isLastAssistant = message === lastMessage && message.role === 'assistant';
                      const canRegenerate = isLastAssistant && message.status !== 'streaming' && !isSending;
                      return (
                      <article key={message.id} className={`group/message rounded-md border border-border p-3 text-sm ${message.role === 'user' ? 'bg-muted/30' : 'bg-card'}`}>
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-muted-foreground">{message.role === 'user' ? t('你', 'You') : t('仓库助手', 'Repository copilot')}</p>
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
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t('正在生成', 'Generating')} />
                          )}
                        </div>
                        {message.evidenceIds.length > 0 && (
                          <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
                            <summary className="cursor-pointer font-medium text-foreground">{t(`来源与证据 (${message.evidenceIds.length})`, `Sources and evidence (${message.evidenceIds.length})`)}</summary>
                            <p className="mt-1 text-muted-foreground">{t('展开后可查看本轮已读取文件的固定版本、行号与原始证据窗口。', 'Expand to inspect this turn’s pinned versions, line ranges, and retrieved evidence windows.')}</p>
                            <div className="mt-2 grid gap-2">
                              {message.evidenceIds.map((evidenceId) => {
                                const evidence = evidenceById[evidenceId];
                                if (!evidence) return null;
                                return (
                                  <a key={evidence.id} href={evidence.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-2 rounded-md border border-border bg-background/60 px-2.5 py-2 text-xs hover:bg-muted" aria-label={t(`查看来源：${evidence.path ?? evidence.repoFullName}`, `View source: ${evidence.path ?? evidence.repoFullName}`)}>
                                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <span className="min-w-0 flex-1 truncate">{evidence.repoFullName} · {evidence.path ? `${evidence.path}:L${evidence.lineStart ?? 1}-L${evidence.lineEnd ?? 1}` : t('仓库元数据', 'repository metadata')}</span>
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
                                aria-label={t('复制回答', 'Copy answer')}
                                title={t('复制回答（不包含引用标注）', 'Copy answer (without citation marks)')}
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
                                aria-label={t('重新生成', 'Regenerate')}
                                title={t('重新生成本条回答', 'Regenerate this answer')}
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
                  aria-label={t('回到底部', 'Scroll to latest')}
                  title={t('回到底部', 'Scroll to latest')}
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
          <label className="sr-only" htmlFor="repository-chat-draft">{t('问题', 'Question')}</label>
          <div className="flex items-end gap-2">
            <Textarea
              id="repository-chat-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('例如：这个仓库是做什么的？如何安装和使用？', 'For example: What does this repository do? How do I install and use it?')}
              className="min-h-20 resize-y text-sm"
              disabled={!activeSession || !canChat || isSending}
            />
            {isSending ? (
              <Button type="button" size="icon" variant="secondary" onClick={stop} aria-label={t('停止生成', 'Stop generating')} title={t('停止生成', 'Stop generating')}>
                <Square className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            ) : (
              <Button type="submit" size="icon" disabled={!activeSession || !canChat || !draft.trim()} aria-label={t('发送问题', 'Send question')} title={t('发送问题', 'Send question')}>
                <Send className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground" disabled={!activeSession || isSending} title={depth.description}>
                  <Gauge className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  {t('任务深度', 'Task depth')}：{depth.label}
                  <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-72">
                <DropdownMenuLabel className="text-xs text-muted-foreground">{t('任务深度决定取证轮数与读取范围', 'Task depth controls retrieval rounds and read scope')}</DropdownMenuLabel>
                {TASK_DEPTH_OPTIONS.map((option) => {
                  const budget = option.value !== 'default' ? TASK_DEPTH_PRESETS[option.value].budget : null;
                  const suffix = budget ? ` · ${t(`${budget.maxTurns} 轮`, `${budget.maxTurns} rounds`)} · ${Math.round(budget.maxDurationMs / 1000)}s` : '';
                  const active = repositoryChatSettings.taskDepth === option.value;
                  return (
                    <DropdownMenuItem
                      key={option.value}
                      className={`flex-col items-start gap-0.5 py-2 ${active ? 'bg-muted/60' : ''}`}
                      onSelect={() => setRepositoryChatSettings({ taskDepth: option.value })}
                    >
                      <span className="flex w-full items-center gap-2 text-sm font-medium">
                        {language === 'zh' ? option.zh : option.en}
                        <span className="text-[11px] font-normal text-muted-foreground">{suffix}</span>
                        {option.value === 'default' && <span className="text-[11px] font-normal text-muted-foreground">{t('（当前默认）', '(current default)')}</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">{language === 'zh' ? option.descZh : option.descEn}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            {!isSending && lastMessage?.role === 'assistant' && (lastMessage.status === 'error' || lastMessage.status === 'aborted') && <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void retry()}><RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('重试', 'Retry')}</Button>}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default RepositoryChatSheet;
