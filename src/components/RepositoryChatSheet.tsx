import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquareText, Settings2, Undo2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useT } from '../i18n/useT';
import type { Repository } from '../types';
import type { RepositoryChatMessage, RepositoryChatSession, ToolEvidence } from '../types/repositoryChat';
import { useAppStore } from '../store/useAppStore';
import { useDialog } from '../hooks/useDialog';
import { safeWriteText } from '../utils/clipboardUtils';
import { useRepositoryChatSessions } from '../features/repository-chat/hooks/useRepositoryChatSessions';
import { useRepositoryChat } from '../features/repository-chat/hooks/useRepositoryChat';
import { useTurnStatusAnnouncement } from '../features/repository-chat/hooks/useTurnStatusAnnouncement';
import { ChatHeader } from '../features/repository-chat/components/ChatHeader';
import { Composer } from '../features/repository-chat/components/Composer';
import { EmptyState, MessageList } from '../features/repository-chat/components/MessageList';
import { formatAnswerForCopy, stripCitationsForCopy } from '../features/repository-chat/utils/citationUtils';
import { RepositoryChatHistoryPanel } from './RepositoryChatHistoryPanel';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from './ui/sheet';

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

const markdownForSession = (
  repository: Repository,
  session: RepositoryChatSession,
  messages: RepositoryChatMessage[],
  evidenceById: Record<string, ToolEvidence>,
  sourcesHeading: string,
): string => {
  const header = `# ${repository.full_name}\n\n- Source: \`${session.sourceRefSha}\`\n- Exported: ${new Date().toISOString()}\n`;
  const body = messages.map((message) => {
    if (message.role === 'user') return `## User\n\n${message.content}`;
    if (message.role !== 'assistant') return '';
    const evidences = message.evidenceIds.map((id) => evidenceById[id]).filter(Boolean);
    return `## Assistant\n\n${formatAnswerForCopy(message.content, evidences, sourcesHeading)}`;
  }).filter(Boolean).join('\n\n');
  return `${header}\n${body}\n`;
};

const downloadMarkdown = (filename: string, content: string): void => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

const RepositoryChatSheet: React.FC<RepositoryChatSheetProps> = ({
  isOpen,
  onClose,
  onCloseAutoFocus,
  repository,
  initialSessionId,
  onBack,
}) => {
  const {
    language,
    setCurrentView,
    repositoryChatSettings,
    setRepositoryChatSettings,
  } = useAppStore(useShallow((state) => ({
    language: state.language,
    setCurrentView: state.setCurrentView,
    repositoryChatSettings: state.repositoryChatSettings,
    setRepositoryChatSettings: state.setRepositoryChatSettings,
  })));
  const t = useT('chat');
  const { toast } = useDialog();
  const [draft, setDraft] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [pendingUndo, setPendingUndo] = useState<RepositoryChatSession[]>([]);
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true);
  const messageRegionRef = useRef<HTMLDivElement>(null);
  const shouldAnchorToUserRef = useRef(false);
  const undoTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const previousActiveSessionIdRef = useRef<string | null>(null);

  const {
    sessions,
    activeSession,
    messages,
    isLoading,
    error,
    refresh,
    createSession,
    selectSession,
    deleteSession,
    restoreSession,
    renameSession,
    startDraft,
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
    feedbackById,
    loadEvidence,
    send,
    stop,
    retry,
    regenerate,
    editAndResend,
    submitFeedback,
  } = useRepositoryChat({
    repository,
    session: activeSession,
    messages,
    onMessagesChange: setMessages,
    onSessionChange: updateSession,
  });

  const fullscreen = repositoryChatSettings.layout === 'fullscreen';
  const lastMessage = messages[messages.length - 1];
  const statusAnnouncement = useTurnStatusAnnouncement(lastMessage?.role === 'assistant' ? lastMessage.status : '', language);

  useEffect(() => {
    if (!isOpen) {
      setShowHistory(false);
      setEditingMessageId(null);
      previousActiveSessionIdRef.current = null;
      return;
    }
    setShowHistory(window.matchMedia?.('(min-width: 900px)').matches ?? false);
    try {
      const pending = JSON.parse(sessionStorage.getItem('gsm:repository-chat-return') || 'null') as { repoId?: unknown; draft?: unknown } | null;
      if (pending?.repoId === repository.id && typeof pending.draft === 'string') {
        setDraft(pending.draft);
        sessionStorage.removeItem('gsm:repository-chat-return');
      }
    } catch {
      sessionStorage.removeItem('gsm:repository-chat-return');
    }
  }, [isOpen, repository.id]);

  useEffect(() => () => {
    undoTimersRef.current.forEach((timer) => clearTimeout(timer));
    undoTimersRef.current.clear();
  }, []);

  // A newly sent user turn becomes the visual anchor; later stream chunks only
  // follow the bottom while the user remains there.
  useEffect(() => {
    const element = messageRegionRef.current;
    if (!element) return;
    if (shouldAnchorToUserRef.current) {
      shouldAnchorToUserRef.current = false;
      requestAnimationFrame(() => {
        const nodes = element.querySelectorAll<HTMLElement>('[data-message-role="user"]');
        const node = nodes[nodes.length - 1];
        if (node) element.scrollTo({ top: Math.max(0, node.offsetTop - 20), behavior: 'smooth' });
      });
      return;
    }
    if (isPinnedToBottom) element.scrollTo({ top: element.scrollHeight });
  }, [messages, toolEvents, isPinnedToBottom]);

  const handleRegionScroll = useCallback(() => {
    const element = messageRegionRef.current;
    if (!element) return;
    setIsPinnedToBottom(element.scrollHeight - element.scrollTop - element.clientHeight < 80);
  }, []);

  const scrollToBottom = useCallback(() => {
    const element = messageRegionRef.current;
    if (!element) return;
    setIsPinnedToBottom(true);
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  }, []);

  const initialSessionAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    initialSessionAppliedRef.current = null;
  }, [repository.id]);
  useEffect(() => {
    if (!isOpen) initialSessionAppliedRef.current = null;
  }, [isOpen]);
  useEffect(() => {
    const nextSessionId = activeSession?.id ?? null;
    const previousSessionId = previousActiveSessionIdRef.current;
    previousActiveSessionIdRef.current = nextSessionId;
    if (!previousSessionId || !nextSessionId || previousSessionId === nextSessionId) return;
    setEditingMessageId(null);
    setDraft('');
  }, [activeSession?.id]);
  useEffect(() => {
    if (!isOpen || !initialSessionId || initialSessionAppliedRef.current === initialSessionId || isLoading) return;
    if (!sessions.some((session) => session.id === initialSessionId)) return;
    if (activeSession?.id === initialSessionId && !error) {
      initialSessionAppliedRef.current = initialSessionId;
      return;
    }
    if (error) return;
    void selectSession(initialSessionId).then((selected) => {
      if (selected) initialSessionAppliedRef.current = initialSessionId;
    });
  }, [activeSession?.id, error, initialSessionId, isOpen, isLoading, selectSession, sessions]);

  const submit = useCallback(async (question: string) => {
    const normalized = question.trim();
    if (!normalized || !canChat || isSending) return;
    setIsPinnedToBottom(true);
    if (editingMessageId) {
      shouldAnchorToUserRef.current = true;
      if (await editAndResend(editingMessageId, normalized)) {
        setEditingMessageId(null);
        setDraft('');
      }
      return;
    }
    if (!activeSession) {
      const created = await createSession();
      if (!created) {
        shouldAnchorToUserRef.current = false;
        return;
      }
      shouldAnchorToUserRef.current = true;
      setDraft('');
      await send(normalized, [], false, created);
      return;
    }
    shouldAnchorToUserRef.current = true;
    setDraft('');
    await send(normalized);
  }, [activeSession, canChat, createSession, editAndResend, editingMessageId, isSending, send]);

  const startNewConversation = useCallback(() => {
    if (isSending || isLoading) return;
    setDraft('');
    setEditingMessageId(null);
    startDraft();
    setShowHistory(false);
  }, [isLoading, isSending, startDraft]);

  const handleDelete = useCallback(async (sessionId = activeSession?.id) => {
    if (!sessionId || isSending) return;
    const deleted = sessions.find((session) => session.id === sessionId) ?? null;
    const succeeded = await deleteSession(sessionId);
    if (!succeeded) return;
    if (deleted) {
      setPendingUndo((previous) => [...previous.filter((item) => item.id !== deleted.id), deleted]);
      const existingTimer = undoTimersRef.current.get(deleted.id);
      if (existingTimer) clearTimeout(existingTimer);
      undoTimersRef.current.set(deleted.id, setTimeout(() => {
        undoTimersRef.current.delete(deleted.id);
        setPendingUndo((previous) => previous.filter((item) => item.id !== deleted.id));
      }, 5000));
      toast(t('repositoryChatSheet.conversation-deleted'), 'success');
    }
  }, [activeSession?.id, deleteSession, isSending, sessions, t, toast]);

  const undoDelete = useCallback(async (deleted: RepositoryChatSession) => {
    const restored = await restoreSession(deleted);
    if (!restored) return;
    const timer = undoTimersRef.current.get(deleted.id);
    if (timer) clearTimeout(timer);
    undoTimersRef.current.delete(deleted.id);
    setPendingUndo((current) => current.filter((item) => item.id !== deleted.id));
  }, [restoreSession]);

  const navigateToAiSettings = () => {
    sessionStorage.setItem('gsm:repository-chat-return', JSON.stringify({ repoId: repository.id, draft }));
    sessionStorage.setItem('gsm:pending-settings-tab', 'ai');
    setCurrentView('settings');
    window.dispatchEvent(new CustomEvent('gsm:navigate-to-settings-tab', { detail: { tab: 'ai' } }));
  };

  const handleCopyAnswer = async (message: RepositoryChatMessage) => {
    const loadedEvidence = await loadEvidence(message.evidenceIds).catch(() => null);
    const evidences = loadedEvidence ? message.evidenceIds.map((id) => loadedEvidence[id]).filter(Boolean) : [];
    const content = message.role === 'user'
      ? message.content
      : loadedEvidence
        ? formatAnswerForCopy(message.content, evidences, t('repositoryChatSheet.sources'))
        : stripCitationsForCopy(message.content);
    const result = await safeWriteText(content);
    toast(
      result.success ? t('repositoryChatSheet.answer-copied') : (result.error || t('repositoryChatSheet.copy-failed')),
      result.success ? 'success' : 'error',
    );
  };

  const handleEdit = (message: RepositoryChatMessage) => {
    if (isSending) return;
    setDraft(message.content);
    setEditingMessageId(message.id);
  };

  const editLast = () => {
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUser) handleEdit(lastUser);
  };

  const exportCurrent = async () => {
    if (!activeSession) return;
    try {
      const evidenceIds = Array.from(new Set(messages.flatMap((message) => message.evidenceIds)));
      const exportEvidence = await loadEvidence(evidenceIds);
      downloadMarkdown(
        `${repository.full_name.replace('/', '-')}-${activeSession.id}.md`,
        markdownForSession(repository, activeSession, messages, exportEvidence, t('repositoryChatSheet.sources')),
      );
    } catch {
      toast(t('repositoryChatSheet.export-failed'), 'error');
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      if (command && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        startNewConversation();
      } else if (command && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setShowHistory((previous) => !previous);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, startNewConversation]);

  const isCopyable = useMemo(() => (message: RepositoryChatMessage): boolean => (
    message.role === 'assistant'
    && message.status !== 'streaming'
    && message.status !== 'error'
    && message.status !== 'aborted'
    && message.content.length > 0
    && !/未能生成可与精确来源核验的总结性结果|无法完成可验证的判断|did not produce a source-verifiable summary|a verifiable determination cannot be made/i.test(message.content)
  ), []);

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className={`gap-0 p-0 ${fullscreen ? 'inset-0 left-0 right-0 w-screen max-w-none sm:max-w-none' : 'w-[min(100vw-1rem,56rem)] sm:max-w-none'}`}
        closeLabel={t('repositoryChatSheet.close-repository-chat')}
        onPointerDownOutside={(event) => {
          event.preventDefault();
          window.setTimeout(onClose, 0);
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onCloseAutoFocus?.();
        }}
        onEscapeKeyDown={(event) => {
          if (isSending) {
            event.preventDefault();
            stop();
          }
        }}
      >
        <SheetTitle className="sr-only">{repository.full_name}</SheetTitle>
        <SheetDescription className="sr-only">{t('repositoryChatSheet.ask-this-repository')}</SheetDescription>
        <div className="px-3 pr-12">
          <ChatHeader
            repository={repository}
            session={activeSession}
            fullscreen={fullscreen}
            historyOpen={showHistory}
            onBack={onBack}
            onNew={startNewConversation}
            onToggleHistory={() => setShowHistory((previous) => !previous)}
            onToggleFullscreen={() => setRepositoryChatSettings({ layout: fullscreen ? 'sheet' : 'fullscreen' })}
            onOpenGithub={() => window.open(repository.html_url, '_blank', 'noopener,noreferrer')}
            onExport={() => void exportCurrent()}
            onSettings={navigateToAiSettings}
            onDelete={() => void handleDelete()}
          />
        </div>

        <div className="relative flex min-h-0 flex-1 flex-row overflow-hidden">
          {showHistory ? (
            <>
              <button type="button" className="absolute inset-0 z-10 bg-black/20 md:hidden" onClick={() => setShowHistory(false)} aria-label={t('repositoryChatSheet.close-history')} />
              <aside className="absolute inset-y-0 left-0 z-20 w-64 shrink-0 border-r border-border bg-card p-3 shadow-xl md:static md:z-auto md:shadow-none">
                <RepositoryChatHistoryPanel
                  sessions={sessions}
                  activeSessionId={activeSession?.id}
                  language={language}
                  disabled={isLoading || isSending}
                  onSelect={(sessionId) => {
                    void selectSession(sessionId);
                    if (!window.matchMedia?.('(min-width: 768px)').matches) setShowHistory(false);
                  }}
                  onDelete={(sessionId) => void handleDelete(sessionId)}
                  onRename={(sessionId, title) => void renameSession(sessionId, title)}
                />
              </aside>
            </>
          ) : null}
          <div className="relative min-h-0 min-w-0 flex-1">
            <div ref={messageRegionRef} onScroll={handleRegionScroll} className="h-full overflow-y-auto px-4 sm:px-6">
              {error ? (
                <div className="mx-auto mt-16 max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 px-5 py-4 text-center text-sm text-destructive">
                  <p>{error}</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={() => {
                      if (activeSession) void selectSession(activeSession.id);
                      else void refresh();
                    }}
                  >
                    {t('repositoryChatSheet.retry')}
                  </Button>
                </div>
              ) : isLoading ? (
                <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 pt-8" role="status" aria-label={t('repositoryChatSheet.restoring-conversation')}>
                  <div className="ml-auto h-12 w-2/3 animate-pulse rounded-3xl bg-muted" />
                  <div className="h-28 w-full animate-pulse rounded-2xl bg-muted/60" />
                  <div className="h-20 w-4/5 animate-pulse rounded-2xl bg-muted/40" />
                </div>
              ) : !canChat ? (
                <div className="mx-auto mt-20 flex max-w-md flex-col items-center gap-4 rounded-3xl border border-dashed border-border px-6 py-8 text-center">
                  <MessageSquareText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t('repositoryChatSheet.repository-chat-is-not-ready')}</p>
                    <p className="text-xs text-muted-foreground">{unavailableReason}</p>
                  </div>
                  <Button type="button" onClick={navigateToAiSettings}>
                    <Settings2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {t('repositoryChatSheet.configure-ai-service')}
                  </Button>
                </div>
              ) : messages.length === 0 ? (
                <EmptyState repository={repository} onAsk={(question) => void submit(question)} />
              ) : (
                <MessageList
                  repository={repository}
                  messages={messages}
                  toolEvents={toolEvents}
                  evidenceById={evidenceById}
                  feedbackById={feedbackById}
                  language={language}
                  isSending={isSending}
                  canRegenerate={Boolean(lastMessage && lastMessage.role === 'assistant' && lastMessage === messages[messages.length - 1])}
                  errorMessage={chatError}
                  isAnswerCopyable={isCopyable}
                  onCopy={(message) => {
                    void handleCopyAnswer(message);
                  }}
                  onEdit={handleEdit}
                  onRegenerate={() => void regenerate()}
                  onRetry={() => void retry()}
                  onFeedback={(messageId, rating) => void submitFeedback(messageId, rating)}
                />
              )}
            </div>
            {!isPinnedToBottom && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="absolute bottom-4 right-4 h-8 w-8 rounded-full bg-background shadow-md"
                onClick={scrollToBottom}
                aria-label={t('repositoryChatSheet.scroll-to-latest')}
              >
                <span aria-hidden="true">↓</span>
              </Button>
            )}
          </div>
        </div>

        <div className="px-4 sm:px-6">
          {pendingUndo.length > 0 ? (
            <div className="mx-auto -mb-1 w-full max-w-3xl space-y-1">
              {pendingUndo.map((deleted) => (
                <div key={deleted.id} className="flex items-center justify-between rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
                  <span className="truncate">{t('repositoryChatSheet.conversation-deleted')}</span>
                  <Button type="button" variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => void undoDelete(deleted)}>
                    <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    {t('repositoryChatSheet.undo')}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
          <p role="status" className="sr-only">{statusAnnouncement}</p>
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={() => void submit(draft)}
            onStop={stop}
            onEditLast={editLast}
            onCancelEdit={() => {
              setEditingMessageId(null);
              setDraft('');
            }}
            editing={Boolean(editingMessageId)}
            isSending={isSending}
            canChat={canChat && !isLoading && !error}
            taskDepth={repositoryChatSettings.taskDepth}
            onDepthChange={(taskDepth) => setRepositoryChatSettings({ taskDepth })}
            language={language}
            sourceSha={activeSession?.sourceRefSha}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default RepositoryChatSheet;
