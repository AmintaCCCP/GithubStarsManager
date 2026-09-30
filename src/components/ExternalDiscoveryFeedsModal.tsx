import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DiscoveryChannel } from '../types';
import { useT } from '../i18n/useT';
import { useExternalDiscoveryFeeds } from '../features/discovery/hooks/useExternalDiscoveryFeeds';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Modal } from './Modal';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  channels: DiscoveryChannel[];
}

export function ExternalDiscoveryFeedsModal({ isOpen, onClose, channels }: Props) {
  const t = useT('discovery');
  const { add, remove, isChecking, error, clearError } = useExternalDiscoveryFeeds();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const feeds = channels.filter(channel => channel.sourceUrl);

  const handleAdd = async () => {
    if (await add(name, url)) {
      setName('');
      setUrl('');
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('externalFeeds.manage')} maxWidth="max-w-lg">
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{t('externalFeeds.format')}</p>
        <p className="text-xs text-muted-foreground">{t('externalFeeds.cors-note')}</p>
        <div className="space-y-2">
          <Input aria-label={t('externalFeeds.name')} value={name} onChange={event => { setName(event.target.value); clearError(); }} placeholder={t('externalFeeds.name')} maxLength={60} />
          <Input aria-label={t('externalFeeds.url')} value={url} onChange={event => { setUrl(event.target.value); clearError(); }} placeholder="https://example.com/github-repos.json" type="url" />
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
