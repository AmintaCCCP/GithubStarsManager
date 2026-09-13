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
  const language = useAppStore(state => state.language);
  const telegramFollows = useAppStore(state => state.telegramFollows);
  const addTelegramFollow = useAppStore(state => state.addTelegramFollow);
  const removeTelegramFollow = useAppStore(state => state.removeTelegramFollow);
  const { toast } = useDialog();
  const { probe, isProbing, message, probeOk } = useTelegramProbe();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [input, setInput] = useState('');

  const handleKeys = new Set(telegramFollows.map(follow => follow.channel.toLowerCase()));

  const handleAdd = () => {
    const channel = normalizeTelegramChannelInput(input);
    if (!channel) {
      toast(t('请输入有效的频道名，例如 https://t.me/geekhub23 或 @geekhub23。', 'Enter a valid channel name, e.g. https://t.me/geekhub23 or @geekhub23.'), 'error');
      return;
    }
    if (handleKeys.has(channel.toLowerCase())) {
      toast(t('该频道已在关注列表中。', 'This channel is already in the list.'), 'info');
      return;
    }
    addTelegramFollow(channel);
    setInput('');
    toast(t('已添加关注频道。', 'Channel added to the follow list.'), 'success');
  };

  const handleRemove = (follow: TelegramFollow) => {
    removeTelegramFollow(follow.channel);
    toast(t(`已取消关注 @${follow.channel}。`, `Unfollowed @${follow.channel}.`), 'info');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('Telegram 频道设置', 'Telegram Channels Settings')} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground dark:text-muted-foreground">
          {t(
            '刷新时增量拉取关注频道的最新消息，消息中包含 GitHub 仓库链接的条目会展示为列表项；"加载更多"按页抓取更早的历史消息。数据由应用直连 t.me 公开预览抓取，需要桌面版或服务端模式（纯浏览器模式受跨域限制）；私有频道无法抓取。',
            'Refreshing incrementally pulls the latest messages of followed channels; messages containing GitHub repository links are listed, and "Load more" pages back through history. The app fetches the t.me public preview directly and requires the desktop or server build (browsers are CORS-restricted). Private channels cannot be fetched.',
          )}
        </div>

        <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
          <div className="mb-3 flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{t('关注列表', 'Follow list')}</h4>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                {t(
                  '支持 t.me 频道链接、@频道名或裸频道名。刷新时逐个频道抓取最新消息。',
                  'Accepts a t.me channel URL, @name, or a bare channel name. Channels are fetched one by one on refresh.',
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const normalizedInput = normalizeTelegramChannelInput(input);
                if (input.trim() && !normalizedInput) {
                  toast(t('请输入有效的频道名。', 'Enter a valid channel name.'), 'error');
                  return;
                }
                const channel = normalizedInput || telegramFollows[0]?.channel;
                if (!channel) {
                  toast(t('请先填写或添加一个频道用于测试。', 'Fill in or add a channel to test first.'), 'error');
                  return;
                }
                void probe(channel);
              }}
              disabled={isProbing || (!input.trim() && telegramFollows.length === 0)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t('真实抓取一次频道公开预览验证抓取通道', 'Fetch a channel preview once to verify the pipeline')}
            >
              <PlugZap className={`h-4 w-4 ${isProbing ? 'animate-pulse' : ''}`} />
              {isProbing ? t('测试中…', 'Testing…') : t('测试连接', 'Test Connection')}
            </Button>
          </div>
          {message && (
            <p
              className={`mb-3 rounded-lg px-3 py-2 text-xs break-all ${
                probeOk
                  ? 'bg-primary/10 text-primary dark:text-primary'
                  : 'bg-destructive/10 text-destructive'
              }`}
              role="status"
            >
              {message}
            </p>
          )}

          <div className="flex gap-2">
            <Input
              type="text"
              aria-label={t('频道名', 'Channel name')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
              }}
              placeholder="https://t.me/geekhub23 / @geekhub23 / geekhub23"
              className="min-w-0 flex-1 rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 px-3 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
            <Button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              {t('添加', 'Add')}
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {telegramFollows.length === 0 ? (
              <p className="rounded-lg bg-card dark:bg-card/[0.03] px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
                {t('暂无关注频道。', 'No followed channels yet.')}
              </p>
            ) : telegramFollows.map((follow) => (
              <div
                key={follow.channel.toLowerCase()}
                className="flex items-center justify-between gap-3 rounded-lg bg-card dark:bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground dark:text-foreground">@{follow.channel}</div>
                  <a
                    href={`https://t.me/${follow.channel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="truncate text-xs text-muted-foreground dark:text-muted-foreground hover:text-foreground transition-colors"
                  >
                    https://t.me/{follow.channel}
                  </a>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemove(follow)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  title={t('取消关注', 'Unfollow')}
                  aria-label={t(`取消关注 @${follow.channel}`, `Unfollow @${follow.channel}`)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {t('完成', 'Done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
