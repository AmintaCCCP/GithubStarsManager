import React, { useEffect, useRef, useState } from 'react';
import { Copy, ExternalLink, History, Loader2, MessageSquareText, Plus, RotateCcw, Send, Square } from 'lucide-react';
import type { Repository } from '../types';
import type { RepositoryChatToolEvent } from '../types/repositoryChat';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { safeWriteText } from '../utils/clipboardUtils';
import { useShallow } from 'zustand/react/shallow';
import { useRepositoryChatSessions } from '../features/repository-chat/hooks/useRepositoryChatSessions';
import { useRepositoryChat } from '../features/repository-chat/hooks/useRepositoryChat';
import { RepositoryChatHistoryPanel } from './RepositoryChatHistoryPanel';
import MarkdownRenderer from './MarkdownRenderer';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from './ui/sheet';
import { Textarea } from './ui/textarea';

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
  if (stage === 'context') return zh ? '固定版本上下文' : 'Pinned source context';
  if (stage === 'planning') return zh ? '取证计划' : 'Evidence plan';
  if (stage === 'retrieval') return zh ? '文件取证' : 'File retrieval';
  if (stage === 'verification') return zh ? '证据核验' : 'Evidence verification';
  if (stage === 'answer') return zh ? '结论收敛' : 'Conclusion synthesis';
  return zh ? '工具调用' : 'Tool call';
};

const ExecutionTimeline: React.FC<{ events: RepositoryChatToolEvent[]; language: 'zh' | 'en'; isRunning: boolean }> = ({ events, language, isRunning }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const stageOrder: Array<RepositoryChatToolEvent['stage']> = ['context', 'planning', 'retrieval', 'verification', 'answer'];
  const completed = events.filter((event) => event.status === 'success').length;
  const failed = events.filter((event) => event.status === 'error').length;
  const latest = events[events.length - 1];
  const grouped = stageOrder.map((stage) => ({ stage, events: events.filter((event) => event.stage === stage) })).filter((group) => group.events.length > 0);

  return (
    <details className="mt-3 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs" open={isRunning}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-medium text-foreground">
        <span>{t('Agent 执行记录', 'Agent execution record')}</span>
        <span className="text-[11px] font-normal text-muted-foreground">
          {latest ? `${stageLabels(latest.stage, language)} · ${completed}/${events.length}` : `${events.length}`}{failed > 0 ? ` · ${t(`${failed} 项需注意`, `${failed} attention`)}` : ''}
        </span>
      </summary>
      <p className="mt-1 text-muted-foreground">{t('默认显示本轮摘要；展开阶段可查看任务目标、允许的只读工具、文件选择、取证与来源收敛。不会展示隐藏推理、请求报文或密钥。', 'The summary is shown first. Expand a stage for its task goal, allowed read-only tools, file selection, evidence retrieval, and source convergence. Hidden reasoning, request payloads, and secrets are never shown.')}</p>
      <div className="mt-3 space-y-2">
        {grouped.map((group) => {
          const stageHasRunning = group.events.some((event) => event.status === 'running');
          const stageErrors = group.events.filter((event) => event.status === 'error').length;
          return (
            <details key={group.stage ?? 'other'} className="rounded border border-border/70 bg-background/60 px-2.5 py-2" open={isRunning && stageHasRunning}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
                <span className="font-medium">{stageLabels(group.stage, language)}</span>
                <span className={`text-[11px] ${stageErrors > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>{group.events.length} {t('步', 'step(s)')}{stageErrors > 0 ? ` · ${stageErrors} ${t('项失败', 'failed')}` : ''}</span>
              </summary>
              <ol className="mt-2 space-y-2 border-l border-border pl-3">
                {group.events.map((event) => {
                  const statusLabel = event.status === 'success'
                    ? t('完成', 'Done')
                    : event.status === 'running'
                      ? t('进行中', 'Running')
                      : event.status === 'error'
                        ? t('失败', 'Failed')
                        : t('准备中', 'Queued');
                  const duration = formatToolDuration(event.durationMs);
                  return (
                    <li key={event.id} className="relative grid gap-1 pb-1 before:absolute before:-left-[1.1rem] before:top-1 before:h-2 before:w-2 before:rounded-full before:border before:border-border before:bg-background">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium text-foreground">{event.round ? `${t('第', 'Round ')}${event.round}${t('轮 · ', ' · ')}` : ''}{event.paramSummary}</span>
                        <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{event.toolName}</code>
                        <span className={`ml-auto text-[11px] ${event.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>{statusLabel}{duration ? ` · ${duration}` : ''}</span>
                      </div>
                      <p className="break-words text-muted-foreground">{event.detail}</p>
                    </li>
                  );
                })}
              </ol>
            </details>
          );
        })}
      </div>
    </details>
  );
};

const RepositoryChatSheet: React.FC<RepositoryChatSheetProps> = ({
  isOpen,
  onClose,
  onCloseAutoFocus,
  repository,
}) => {
  const { language, setCurrentView } = useAppStore(useShallow((state) => ({
    language: state.language,
    setCurrentView: state.setCurrentView,
  })));
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState('');
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
    messageRegionRef.current?.scrollTo({ top: messageRegionRef.current.scrollHeight });
  }, [isOpen, messages.length, repository]);

  const handleCreateSession = () => {
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
    void send(question);
  };

  const handleCopyAnswer = async (content: string) => {
    const result = await safeWriteText(content);
    toast(
      result.success ? t('回答已复制', 'Answer copied') : (result.error || t('复制失败', 'Copy failed')),
      result.success ? 'success' : 'error'
    );
  };

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
          <Button type="button" variant="secondary" size="sm" onClick={handleCreateSession} disabled={isLoading}>
            {isLoading ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
            {t('基于最新版本新建会话', 'New chat from latest')}
          </Button>
          <Button
            type="button"
            variant={showHistory ? 'secondary' : 'ghost'}
            size="sm"
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
            <div ref={messageRegionRef} className="min-h-0 flex-1 overflow-y-auto pr-1" aria-live="polite">
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
                  <Button type="button" onClick={handleCreateSession}>
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
                      t('这个项目怎样使用？', 'How do I use this project?'),
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
                    return (
                    <article key={message.id} className={`rounded-md border border-border p-3 text-sm ${message.role === 'user' ? 'bg-muted/30' : 'bg-card'}`}>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-muted-foreground">{message.role === 'user' ? t('你', 'You') : t('仓库助手', 'Repository copilot')}</p>
                        {message.role === 'assistant' && message.content && message.status === 'complete' && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => void handleCopyAnswer(message.content)}
                            aria-label={t('复制回答', 'Copy answer')}
                            title={t('复制回答', 'Copy answer')}
                          >
                            <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                            {t('复制', 'Copy')}
                          </Button>
                        )}
                      </div>
                      {message.content ? <MarkdownRenderer content={message.content} shouldRender breaks fontSize="small" /> : <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label={t('正在生成', 'Generating')} />}
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
                      {message.role === 'assistant' && messageToolEvents.length > 0 && (
                        <ExecutionTimeline events={messageToolEvents} language={language} isRunning={message.status === 'streaming'} />
                      )}
                    </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <form
          className="border-t border-border pt-3"
          onSubmit={handleSubmit}
        >
          <label className="sr-only" htmlFor="repository-chat-draft">{t('问题', 'Question')}</label>
          <div className="flex items-end gap-2">
            <Textarea
              id="repository-chat-draft"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('询问实现、部署、架构或创作内容…', 'Ask about implementation, deployment, architecture, or content…')}
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
            <p>{t('来源优先：实现事实会附带仓库来源；证据不足时会明确说明。', 'Source-first: implementation claims include repository sources; insufficient evidence is stated clearly.')}</p>
            {!isSending && messages.some((message) => message.status === 'error' || message.status === 'aborted') && <Button type="button" variant="ghost" size="sm" className="h-7 px-2" onClick={() => void retry()}><RotateCcw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />{t('重试', 'Retry')}</Button>}
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default RepositoryChatSheet;
