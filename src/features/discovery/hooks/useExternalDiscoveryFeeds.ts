import { useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { readExternalDiscoveryFeed, readExternalDiscoveryRssFeed } from '../../../services/externalDiscoveryFeed';
import { normalizeDiscoveryFeedUrl } from '../../../utils/discoveryFeeds';
import type { DiscoveryChannelId, ExternalFeedKind } from '../../../types';
import { useT } from '../../../i18n/useT';

export function useExternalDiscoveryFeeds() {
  const addChannel = useAppStore(state => state.addExternalDiscoveryChannel);
  const removeChannel = useAppStore(state => state.removeExternalDiscoveryChannel);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');
  const t = useT('discovery');

  const add = async (name: string, sourceInput: string, kind: ExternalFeedKind = 'json') => {
    const sourceUrl = normalizeDiscoveryFeedUrl(sourceInput);
    if (!sourceUrl || !name.trim() || name.trim().length > 60) {
      setError(t('externalFeeds.invalid'));
      return false;
    }
    setIsChecking(true);
    setError('');
    try {
      await (kind === 'rss' ? readExternalDiscoveryRssFeed(sourceUrl) : readExternalDiscoveryFeed(sourceUrl));
      if (!addChannel(name, sourceUrl, kind)) {
        setError(t('externalFeeds.duplicate'));
        return false;
      }
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(message.includes('CORS') ? t('externalFeeds.cors')
        : message.includes('Invalid feed format') || message.includes('invalid repository')
          ? t('externalFeeds.invalid-format')
          : message.includes('No GitHub repository links')
            ? t('externalFeeds.rss-invalid')
            : t('externalFeeds.unreadable'));
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  const remove = (id: DiscoveryChannelId) => removeChannel(id);
  return { add, remove, isChecking, error, clearError: () => setError('') };
}
