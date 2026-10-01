import { useEffect, useMemo, useRef, useState } from 'react';
import hljs from 'highlight.js';
import { Check, Copy, Trash2 } from 'lucide-react';
import type { DiscoveryChannel, ExternalFeedKind } from '../types';
import { useT } from '../i18n/useT';
import { useExternalDiscoveryFeeds } from '../features/discovery/hooks/useExternalDiscoveryFeeds';
import { safeWriteText } from '../utils/clipboardUtils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Modal } from './Modal';

const FEED_EXAMPLE_JSON = '{\n  "repositories": [\n    "https://github.com/owner/repo"\n  ]\n}';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  channels: DiscoveryChannel[];
  mode: ExternalFeedKind;
}

export function ExternalDiscoveryFeedsModal({ isOpen, onClose, channels, mode }: Props) {
  const t = useT('discovery');
  const { add, remove, isChecking, error, clearError } = useExternalDiscoveryFeeds();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const feeds = channels.filter(channel => channel.sourceUrl && (channel.sourceKind ?? 'json') === mode);
  const highlightedExample = useMemo(
    () => hljs.highlight(FEED_EXAMPLE_JSON, { language: 'json' }).value,
    [],
  );

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const handleAdd = async () => {
    if (await add(name, url, mode)) {
      setName('');
      setUrl('');
    }
  };

  const handleCopyExample = async () => {
    const result = await safeWriteText(FEED_EXAMPLE_JSON);
    if (!result.success) return;
    setCopied(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={mode === 'rss' ? t('externalFeeds.manageRss') : t('externalFeeds.manage')} maxWidth="max-w-lg">
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{mode === 'rss' ? t('externalFeeds.rssFormat') : t('externalFeeds.format')}</p>
          {mode === 'json' && (
            <div className="relative rounded-md border border-border bg-muted/40 dark:bg-muted/20">
              <pre className="overflow-x-auto p-3 pr-11 text-xs leading-relaxed text-foreground dark:text-foreground"><code dangerouslySetInnerHTML={{ __html: highlightedExample }} /></pre>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1.5 h-7 w-7"
                aria-label={t('externalFeeds.copy')}
                title={t('externalFeeds.copy')}
                onClick={() => { void handleCopyExample(); }}
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">{t('externalFeeds.cors-note')}</p>
        </div>
        <div className="space-y-2">
          <Input aria-label={t('externalFeeds.name')} value={name} onChange={event => { setName(event.target.value); clearError(); }} placeholder={t('externalFeeds.name')} maxLength={60} />
          <Input aria-label={t('externalFeeds.url')} value={url} onChange={event => { setUrl(event.target.value); clearError(); }} placeholder={mode === 'rss' ? 'https://example.com/feed.xml' : 'https://example.com/github-repos.json'} type="url" />
          <Button type="button" onClick={() => { void handleAdd(); }} disabled={isChecking || !name.trim() || !url.trim()}>
            {isChecking ? t('externalFeeds.checking') : t('externalFeeds.add')}
          </Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        {feeds.length > 0 && <ul className="space-y-2 border-t border-border pt-3">
          {feeds.map(feed => <li key={feed.id} className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-sm"><p className="truncate font-medium">{feed.name}</p><p className="truncate text-xs text-muted-foreground">{feed.sourceUrl}</p></div>
            <Button type="button" variant="ghost" size="icon" aria-label={t('externalFeeds.remove', { name: feed.name })} onClick={() => remove(feed.id)}><Trash2 className="h-4 w-4" /></Button>
          </li>)}
        </ul>}
      </div>
    </Modal>
  );
}
