import { Settings2 } from 'lucide-react';
import type { AppLanguage } from '../i18n/languages';
import { discoveryChannelName } from '../i18n/discoveryNames';
import { useT } from '../i18n/useT';
import type { DiscoveryChannel, DiscoveryChannelId } from '../types';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

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

  return (
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
      <DropdownMenuContent align="end" className="max-h-[70vh] min-w-48 overflow-y-auto">
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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
