



import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useState } from 'react';
import { PlugZap, Plus, Trash2, Users } from 'lucide-react';
import type { TelegramFollow } from '../types';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { useDialog } from '../hooks/useDialog';
import { useTelegramProbe } from '../features/discovery/hooks/useTelegramProbe';
import { normalizeTelegramChannelInput } from '../utils/telegramFollows';

interface TelegramSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * Telegram 频道的配置弹窗：关注频道列表（可增删）与真实"测试连接"。
 * 数据由应用内置抓取器直连 t.me 公开预览获取（桌面版走主进程、网页端走
 * 服务端），无需用户配置任何第三方实例。
 */
export const TelegramSettingsModal: React.FC<TelegramSettingsModalProps> = ({ isOpen, onClose }) => {
  const telegramFollows = useAppStore(state => state.telegramFollows);
  const addTelegramFollow = useAppStore(state => state.addTelegramFollow);
  const removeTelegramFollow = useAppStore(state => state.removeTelegramFollow);
  const { toast } = useDialog();
  const { probe, isProbing, message, probeOk } = useTelegramProbe();

  const t = useT('plugins');
  const [input, setInput] = useState('');

  const handleKeys = new Set(telegramFollows.map(follow => follow.channel.toLowerCase()));

  const handleAdd = () => {
    const channel = normalizeTelegramChannelInput(input);
    if (!channel) {
      toast(t('telegramSettingsModal.enter-a-valid-channel-name-e-g-https-t-me-geekhu'), 'error');
      return;
    }
    if (handleKeys.has(channel.toLowerCase())) {
      toast(t('telegramSettingsModal.this-channel-is-already-in-the-list'), 'info');
      return;
    }
    addTelegramFollow(channel);
    setInput('');
    toast(t('telegramSettingsModal.channel-added-to-the-follow-list'), 'success');
  };

  const handleRemove = (follow: TelegramFollow) => {
    removeTelegramFollow(follow.channel);
    toast(t('telegramSettingsModal.unfollowed-v1', { v1: follow.channel }), 'info');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('telegramSettingsModal.telegram-channels-settings')} maxWidth="max-w-2xl">
      <div className="space-y-4">
        <div className="rounded-md border border-subtle bg-sunken px-3.5 py-2.5 text-label text-secondary">
          {t('telegramSettingsModal.refreshing-incrementally-pulls-the-latest-messag')}
        </div>

        <div className="rounded-lg bg-raised p-4 shadow-elev-1">
          <div className="mb-3 flex items-start gap-2.5">
            <Users className="mt-0.5 size-4 shrink-0 text-tertiary" />
            <div className="flex-1">
              <h4 className="text-label font-semibold text-foreground">{t('telegramSettingsModal.follow-list')}</h4>
              <p className="mt-0.5 text-label-sm text-secondary">
                {t('telegramSettingsModal.accepts-a-t-me-channel-url-name-or-a-bare-channe')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const normalizedInput = normalizeTelegramChannelInput(input);
                if (input.trim() && !normalizedInput) {
                  toast(t('telegramSettingsModal.enter-a-valid-channel-name'), 'error');
                  return;
                }
                const channel = normalizedInput || telegramFollows[0]?.channel;
                if (!channel) {
                  toast(t('telegramSettingsModal.fill-in-or-add-a-channel-to-test-first'), 'error');
                  return;
                }
                void probe(channel);
              }}
              disabled={isProbing || (!input.trim() && telegramFollows.length === 0)}
              className="shrink-0 gap-1.5"
              title={t('telegramSettingsModal.fetch-a-channel-preview-once-to-verify-the-pipel')}
            >
              <PlugZap className={`size-3.5 ${isProbing ? 'animate-pulse' : ''}`} />
              {isProbing ? t('telegramSettingsModal.testing') : t('telegramSettingsModal.test-connection')}
            </Button>
          </div>
          {message && (
            <p
              className={`mb-3 rounded-md px-3 py-2 text-label-sm break-all ${
                probeOk
                  ? 'bg-success-tint text-status-green'
                  : 'bg-destructive-tint text-destructive'
              }`}
              role="status"
            >
              {message}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Input
              type="text"
              aria-label={t('telegramSettingsModal.channel-name')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
              }}
              placeholder="https://t.me/geekhub23 / @geekhub23 / geekhub23"
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleAdd}
              className="gap-1.5"
            >
              <Plus className="size-4" />
              {t('telegramSettingsModal.add')}
            </Button>
          </div>

          <div className="mt-3">
            {telegramFollows.length === 0 ? (
              <p className="rounded-md border border-subtle bg-sunken px-3 py-2.5 text-label-sm text-tertiary">
                {t('telegramSettingsModal.no-followed-channels-yet')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-subtle bg-sunken divide-y divide-subtle">
                {telegramFollows.map((follow) => (
                  <div
                    key={follow.channel.toLowerCase()}
                    className="flex items-center justify-between gap-3 px-3 py-2 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-label font-medium text-foreground">@{follow.channel}</div>
                      <a
                        href={`https://t.me/${follow.channel}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="truncate text-label-sm text-tertiary font-mono hover:text-foreground transition-colors"
                      >
                        https://t.me/{follow.channel}
                      </a>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemove(follow)}
                      className="text-tertiary hover:bg-destructive-tint hover:text-destructive"
                      title={t('telegramSettingsModal.unfollow')}
                      aria-label={t('telegramSettingsModal.unfollow-v1', { v1: follow.channel })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end border-t border-subtle pt-3">
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
          >
            {t('telegramSettingsModal.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
