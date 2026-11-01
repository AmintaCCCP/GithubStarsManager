import React, { useCallback, useMemo } from 'react';
import { Check, Copy, Edit3, Loader2, RefreshCw, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import type { Repository } from '../../../types';
import type { RepositoryChatMessage, RepositoryChatToolEvent, ToolEvidence } from '../../../types/repositoryChat';
import MarkdownRenderer from '../../../components/MarkdownRenderer';
import { postprocessCitationLayout } from '../../../utils/citationPostprocess';
import { CitationBadge } from './CitationBadge';
import { AgentActivity } from './AgentActivity';
import { SourcesBar } from './SourcesBar';
import {
  citationSourceKey,
  collectCitationSources,
  resolveCitation,
} from '../utils/citationUtils';
import { remendStreamingMarkdown } from '../utils/streamingMarkdown';
import { Button } from '../../../components/ui/button';

interface AssistantBodyProps {
  content: string;
  evidenceIds: string[];
  evidenceById: Record<string, ToolEvidence>;
  language: AppLanguage;
  baseUrl: string;
  streaming: boolean;
}

const AssistantBody: React.FC<AssistantBodyProps> = ({
  content,
  evidenceIds,
  evidenceById,
  language,
  baseUrl,
  streaming,
}) => {
  const evidences = useMemo(
    () => evidenceIds.map((id) => evidenceById[id]).filter((evidence): evidence is ToolEvidence => Boolean(evidence)),
    [evidenceById, evidenceIds],
  );
  const processed = useMemo(() => postprocessCitationLayout(content), [content]);
  const sources = useMemo(() => collectCitationSources(processed, evidences), [evidences, processed]);
  const numberByKey = useMemo(() => new Map(sources.map((source) => [source.key, source.number])), [sources]);
  const renderInlineCode = useCallback((text: string) => {
    const resolved = resolveCitation(text, evidences);
    if (!resolved) return null;
    const sourceNumber = numberByKey.get(citationSourceKey(resolved));
    return sourceNumber ? <CitationBadge target={resolved} language={language} index={sourceNumber} /> : null;
  }, [evidences, language, numberByKey]);
  const rendered = streaming ? remendStreamingMarkdown(processed) : processed;
  return (
    <>
      <MarkdownRenderer
        content={rendered}
        shouldRender
        breaks
        fontSize="small"
        className="repository-chat-markdown"
        renderInlineCode={renderInlineCode}
        baseUrl={baseUrl}
      />
      {!streaming ? <SourcesBar sources={sources} /> : null}
    </>
  );
};

export const EmptyState: React.FC<{
  repository: Repository;
  onAsk: (question: string) => void;
}> = ({ repository, onAsk }) => {
  const t = useT('chat');
  const suggestions = useMemo(() => {
    const values = [
      t('repositoryChatSheet.what-does-this-repository-do'),
      t('repositoryChatSheet.how-do-i-install-and-get-started-with-this-proje'),
      repository.language
        ? t('repositoryChatSheet.suggest-architecture', { language: repository.language })
        : t('repositoryChatSheet.suggest-known-issues'),
      repository.topics.some((topic) => /docker|container|self-host/i.test(topic))
        ? t('repositoryChatSheet.suggest-docker')
        : t('repositoryChatSheet.suggest-recent-changes'),
    ];
    return [...new Set(values)].slice(0, 4);
  }, [repository.language, repository.topics, t]);
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-12 text-center">
      <img src={repository.owner.avatar_url} alt="" className="h-14 w-14 rounded-2xl border border-border shadow-sm" />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">{repository.full_name}</h2>
      <p className="mt-1.5 max-w-md text-sm leading-6 text-muted-foreground">
        {repository.description || t('repositoryChatSheet.empty-description')}
      </p>
      <div className="mt-7 grid w-full max-w-2xl gap-2 sm:grid-cols-2">
        {suggestions.map((question, index) => (
          <button
            key={question}
            type="button"
            className="group flex min-h-16 items-start gap-3 rounded-2xl border border-border/70 bg-background/50 p-3.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onAsk(question)}
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:text-foreground">
              {index === 0 ? <Sparkles className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span className="leading-5">{question}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

interface MessageListProps {
  repository: Repository;
  messages: RepositoryChatMessage[];
  toolEvents: RepositoryChatToolEvent[];
  evidenceById: Record<string, ToolEvidence>;
  feedbackById: Record<string, 'up' | 'down'>;
  language: AppLanguage;
  isSending: boolean;
  canRegenerate: boolean;
  errorMessage: string | null;
  isAnswerCopyable: (message: RepositoryChatMessage) => boolean;
  onCopy: (message: RepositoryChatMessage) => void;
  onEdit: (message: RepositoryChatMessage) => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onFeedback: (messageId: string, rating: 'up' | 'down') => void;
}

export const MessageList: React.FC<MessageListProps> = ({
  repository,
  messages,
  toolEvents,
  evidenceById,
  feedbackById,
  language,
  isSending,
  canRegenerate,
  errorMessage,
  isAnswerCopyable,
  onCopy,
  onEdit,
  onRegenerate,
  onRetry,
  onFeedback,
}) => {
  const t = useT('chat');
  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 pb-8 pt-5">
      {messages.map((message) => {
        const messageEvents = toolEvents.filter((event) => event.messageId === message.id);
        if (message.role === 'user') {
          return (
            <article key={message.id} data-message-role="user" className="group/message flex justify-end">
              <div className="relative max-w-[82%] rounded-3xl bg-muted px-4 py-2.5 text-sm leading-6 text-foreground">
                <p className="whitespace-pre-wrap">{message.content}</p>
                <div className="absolute -left-16 top-1/2 flex -translate-y-1/2 gap-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onCopy(message)}
                    aria-label={t('repositoryChatSheet.copy-question')}
                  >
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => onEdit(message)}
                    aria-label={t('repositoryChatSheet.edit-question')}
                    title={t('repositoryChatSheet.edit-question')}
                  >
                    <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </article>
          );
        }
        const isLastAssistant = message.id === lastAssistantId;
        const failed = message.status === 'error' || message.status === 'aborted';
        const selectedFeedback = feedbackById[message.id];
        return (
          <article key={message.id} data-message-role="assistant" className="group/message min-w-0">
            {messageEvents.length > 0 && (message.status !== 'streaming' || !message.content) ? (
              <AgentActivity events={messageEvents} isRunning={message.status === 'streaming'} failed={failed} />
            ) : null}
            {failed ? (
              <div className="flex items-start gap-2 rounded-2xl border border-destructive/25 bg-destructive/5 px-3.5 py-3 text-sm text-destructive">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                <p className="min-w-0 flex-1 leading-6">{isLastAssistant && errorMessage ? errorMessage : message.content}</p>
                {isLastAssistant ? (
                  <Button type="button" variant="ghost" size="sm" className="-my-1 h-7 shrink-0 px-2 text-xs" onClick={onRetry} disabled={isSending}>
                    {t('repositoryChatSheet.retry')}
                  </Button>
                ) : null}
              </div>
            ) : message.content ? (
              <AssistantBody
                content={message.content}
                evidenceIds={message.evidenceIds}
                evidenceById={evidenceById}
                language={language}
                baseUrl={repository.html_url}
                streaming={message.status === 'streaming'}
              />
            ) : (
              <div className="flex items-center gap-2 py-1 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t('repositoryChatSheet.generating')}
              </div>
            )}
            {message.status !== 'streaming' && !failed && message.content ? (
              <div className={`mt-1 flex items-center gap-0.5 transition-opacity ${isLastAssistant ? 'opacity-100' : 'opacity-0 group-hover/message:opacity-100 focus-within:opacity-100'}`}>
                {isAnswerCopyable(message) ? (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={() => onCopy(message)} aria-label={t('repositoryChatSheet.copy-answer')} title={t('repositoryChatSheet.copy-answer-with-sources')}>
                    <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                {isLastAssistant ? (
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" disabled={!canRegenerate || isSending} onClick={onRegenerate} aria-label={t('repositoryChatSheet.regenerate')} title={t('repositoryChatSheet.regenerate-this-answer')}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="icon" className={`h-7 w-7 ${selectedFeedback === 'up' ? 'text-emerald-500' : 'text-muted-foreground'}`} onClick={() => onFeedback(message.id, 'up')} aria-label={t('repositoryChatSheet.helpful')}>
                  {selectedFeedback === 'up' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />}
                </Button>
                <Button type="button" variant="ghost" size="icon" className={`h-7 w-7 ${selectedFeedback === 'down' ? 'text-destructive' : 'text-muted-foreground'}`} onClick={() => onFeedback(message.id, 'down')} aria-label={t('repositoryChatSheet.not-helpful')}>
                  <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
};
