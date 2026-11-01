import React, { useEffect, useRef } from 'react';
import { ArrowUp, ChevronDown, Gauge, Square, X } from 'lucide-react';
import { useT } from '../../../i18n/useT';
import type { AppLanguage } from '../../../i18n/languages';
import type { RepositoryChatTaskDepth } from '../../../types/repositoryChat';
import { Button } from '../../../components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../../components/ui/dropdown-menu';

const DEPTHS: Array<{ value: RepositoryChatTaskDepth; key: string }> = [
  { value: 'quick', key: 'depth-quick' },
  { value: 'default', key: 'depth-default' },
  { value: 'deep', key: 'depth-deep' },
];

export const Composer: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onEditLast: () => void;
  onCancelEdit: () => void;
  editing: boolean;
  isSending: boolean;
  canChat: boolean;
  taskDepth: RepositoryChatTaskDepth;
  onDepthChange: (depth: RepositoryChatTaskDepth) => void;
  language: AppLanguage;
  sourceSha?: string;
}> = ({
  value,
  onChange,
  onSend,
  onStop,
  onEditLast,
  onCancelEdit,
  editing,
  isSending,
  canChat,
  taskDepth,
  onDepthChange,
  language,
  sourceSha,
}) => {
  const t = useT('chat');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(192, Math.max(48, textarea.scrollHeight))}px`;
  }, [value]);

  const depth = DEPTHS.find((item) => item.value === taskDepth)
    ?? (taskDepth === 'unlimited' ? { value: taskDepth, key: 'depth-unlimited' } : DEPTHS[1]!);
  return (
    <div data-slot="composer" className="sticky bottom-0 mx-auto w-full max-w-3xl bg-gradient-to-t from-card via-card pb-3 pt-4">
      {editing ? (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span>{t('repositoryChatSheet.editing-question')}</span>
          <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={onCancelEdit} aria-label={t('repositoryChatSheet.cancel-edit')}>
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <div
        data-slot="composer-shell"
        className="rounded-[24px] border border-border bg-background/90 p-2 shadow-[0_8px_30px_rgb(0_0_0/0.08)] backdrop-blur transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:ring-2 focus-within:ring-foreground/10"
      >
        <label className="sr-only" htmlFor="repository-chat-draft">{t('repositoryChatSheet.question')}</label>
        <textarea
          ref={textareaRef}
          id="repository-chat-draft"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
            compositionEndedAtRef.current = Date.now();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && isSending) {
              event.preventDefault();
              onStop();
              return;
            }
            if (event.key === 'ArrowUp' && !value && !isSending) {
              event.preventDefault();
              onEditLast();
              return;
            }
            // Safari can dispatch compositionend before the Enter keydown that
            // confirms an IME candidate. Suppress that immediate Enter too.
            const justEndedComposition = compositionEndedAtRef.current > 0
              && Date.now() - compositionEndedAtRef.current < 50;
            if (
              event.key === 'Enter'
              && !event.shiftKey
              && !event.nativeEvent.isComposing
              && !isComposingRef.current
              && event.keyCode !== 229
              && !justEndedComposition
            ) {
              event.preventDefault();
              if (canChat && value.trim() && !isSending) onSend();
            }
          }}
          placeholder={t('repositoryChatSheet.ask-follow-up')}
          className="block max-h-48 min-h-12 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50"
          rows={1}
          disabled={!canChat}
        />
        <div className="flex items-center gap-2 px-1 pb-0.5">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="h-8 rounded-full px-2.5 text-xs text-muted-foreground" disabled={isSending}>
                <Gauge className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {t(`repositoryChatSheet.${depth.key}`)}
                <ChevronDown className="ml-1 h-3 w-3" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-64">
              {DEPTHS.map((option) => (
                <DropdownMenuItem key={option.value} className="flex-col items-start gap-0.5 py-2" onSelect={() => onDepthChange(option.value)}>
                  <span className="flex w-full items-center justify-between text-sm font-medium">
                    {t(`repositoryChatSheet.${option.key}`)}
                    {taskDepth === option.value ? <span className="text-xs text-primary">✓</span> : null}
                  </span>
                  <span className="text-xs text-muted-foreground">{t(`repositoryChatSheet.${option.key}-desc`)}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {sourceSha
              ? t('repositoryChatSheet.snapshot-disclaimer', { sha: sourceSha.slice(0, 7) })
              : t('repositoryChatSheet.snapshot-on-send', { language })}
          </span>
          {isSending ? (
            <Button type="button" size="icon" className="h-8 w-8 rounded-full" variant="secondary" onClick={onStop} aria-label={t('repositoryChatSheet.stop-generating')}>
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            </Button>
          ) : (
            <Button type="button" size="icon" className="h-8 w-8 rounded-full" onClick={onSend} disabled={!canChat || !value.trim()} aria-label={t('repositoryChatSheet.send-question')}>
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};
