import { Plus, Rss, Settings2 } from 'lucide-react';
import { useState } from 'react';
import type { AppLanguage } from '../i18n/languages';
import { discoveryChannelName } from '../i18n/discoveryNames';
import { useT } from '../i18n/useT';
import type { DiscoveryChannel, DiscoveryChannelId, ExternalFeedKind } from '../types';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ExternalDiscoveryFeedsModal } from './ExternalDiscoveryFeedsModal';

interface DiscoveryChannelMenuProps {
  channels: DiscoveryChannel[];
  language: AppLanguage;
  onToggleChannel: (channelId: DiscoveryChannelId) => void;
  triggerClassName?: string;
}

export function DiscoveryChannelMenu({
  channels,
  language,
  onToggleChannel,
  triggerClassName,
}: DiscoveryChannelMenuProps) {
  const t = useT('discovery');
  const enabledCount = channels.filter(channel => channel.enabled).length;
  const label = t('discoverySidebar.manage-channels');
  const [externalFeedsMode, setExternalFeedsMode] = useState<ExternalFeedKind | null>(null);

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label={label}
          title={label}
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-[70vh] min-w-56 overflow-y-auto">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {channels.map(channel => (
          <DropdownMenuCheckboxItem
            key={channel.id}
            checked={channel.enabled}
            disabled={channel.enabled && enabledCount === 1}
            onCheckedChange={() => onToggleChannel(channel.id)}
            onSelect={event => event.preventDefault()}
          >
            {discoveryChannelName(channel, language)}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="whitespace-nowrap gap-2" onSelect={() => setExternalFeedsMode('json')}>
          <Plus className="h-4 w-4 shrink-0" />
          {t('externalFeeds.manage')}
        </DropdownMenuItem>
        <DropdownMenuItem className="whitespace-nowrap gap-2" onSelect={() => setExternalFeedsMode('rss')}>
          <Rss className="h-4 w-4 shrink-0" />
          {t('externalFeeds.manageRss')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <ExternalDiscoveryFeedsModal
      mode="json"
      isOpen={externalFeedsMode === 'json'}
      onClose={() => setExternalFeedsMode(null)}
      channels={channels}
    />
    <ExternalDiscoveryFeedsModal
      mode="rss"
      isOpen={externalFeedsMode === 'rss'}
      onClose={() => setExternalFeedsMode(null)}
      channels={channels}
    />
    </>
  );
}
