import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useState } from 'react';
import { Cookie, KeyRound, PlugZap, Plus, Trash2, Users, X } from 'lucide-react';
import type { XTweetFollow } from '../types';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { useDialog } from '../hooks/useDialog';
import { useXTweetProbe } from '../features/discovery/hooks/useXTweetProbe';
import { normalizeXTweetHandleInput } from '../utils/xTweetFollows';

interface XTweetSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * X 推文频道的配置弹窗：关注博主列表（可增删）、可选登录鉴权 Cookie
 * 与真实"测试连接"。数据由应用内置抓取器直连 x.com 获取（桌面版走主进程、
 * 网页端走服务端），无需用户配置任何第三方实例。
 */
export const XTweetSettingsModal: React.FC<XTweetSettingsModalProps> = ({ isOpen, onClose }) => {
  const language = useAppStore(state => state.language);
  const xTweetFollows = useAppStore(state => state.xTweetFollows);
  const xTweetAuth = useAppStore(state => state.xTweetAuth);
  const addXTweetFollow = useAppStore(state => state.addXTweetFollow);
  const removeXTweetFollow = useAppStore(state => state.removeXTweetFollow);
  const setXTweetAuth = useAppStore(state => state.setXTweetAuth);
  const clearXTweetAuth = useAppStore(state => state.clearXTweetAuth);
  const { toast } = useDialog();
  const { probe, isProbing, message, probeOk } = useXTweetProbe();

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;
  const [input, setInput] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [ct0Input, setCt0Input] = useState('');

  const handleKeys = new Set(xTweetFollows.map(follow => follow.handle.toLowerCase()));

  const handleAdd = () => {
    const handle = normalizeXTweetHandleInput(input);
    if (!handle) {
      toast(t('请输入有效的 X 用户名，例如 @geekbb 或主页链接。', 'Enter a valid X handle, e.g. @geekbb or a profile URL.'), 'error');
      return;
    }
    if (handleKeys.has(handle.toLowerCase())) {
      toast(t('该博主已在关注列表中。', 'This account is already in the list.'), 'info');
      return;
    }
    addXTweetFollow(handle);
    setInput('');
    toast(t('已添加关注博主。', 'Account added to the follow list.'), 'success');
  };

  const handleRemove = (follow: XTweetFollow) => {
    removeXTweetFollow(follow.handle);
    toast(t(`已取消关注 @${follow.handle}。`, `Unfollowed @${follow.handle}.`), 'info');
  };

  const handleSaveAuth = () => {
    const authToken = authTokenInput.trim();
    const ct0 = ct0Input.trim();
    if (!authToken || !ct0) {
      toast(t('auth_token 与 ct0 都需要填写。', 'Both auth_token and ct0 are required.'), 'error');
      return;
    }
    setXTweetAuth({ authToken, ct0 });
    setAuthTokenInput('');
    setCt0Input('');
    toast(t('已保存鉴权 Cookie，刷新后按 GraphQL 模式抓取。', 'Auth cookies saved; refreshes now use the GraphQL mode.'), 'success');
  };

  const handleClearAuth = () => {
    clearXTweetAuth();
    setAuthTokenInput('');
    setCt0Input('');
    toast(t('已清除鉴权 Cookie，回到未登录抓取模式。', 'Auth cookies cleared; back to the signed-out mode.'), 'info');
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('X 推文频道设置', 'X Tweets Channel Settings')} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground dark:text-muted-foreground">
          {t(
            '刷新时会增量拉取关注博主的最新推文，推文中包含 GitHub 仓库链接的条目会展示为列表项。数据由应用直连 x.com 抓取，需要桌面版或服务端模式（纯浏览器模式受跨域限制）。可选填写登录鉴权 Cookie 以启用更多推文与历史翻页。',
            'Refreshing incrementally pulls the latest tweets of followed accounts; tweets containing GitHub repository links are listed. The app fetches x.com directly and requires the desktop or server build (browsers are CORS-restricted). Optional auth cookies unlock more tweets and history paging.',
          )}
        </div>

        <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
          <div className="mb-3 flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{t('关注列表', 'Follow list')}</h4>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                {t(
                  '支持 @用户名、用户名或 x.com 主页链接。刷新时逐位博主抓取最新推文。',
                  'Accepts @handle, handle, or an x.com profile URL. Timelines are fetched account by account on refresh.',
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const normalizedInput = normalizeXTweetHandleInput(input);
                if (input.trim() && !normalizedInput) {
                  toast(t('请输入有效的 X 用户名。', 'Enter a valid X handle.'), 'error');
                  return;
                }
                const handle = normalizedInput || xTweetFollows[0]?.handle;
                if (!handle) {
                  toast(t('请先填写或添加一位博主用于测试。', 'Fill in or add an account to test first.'), 'error');
                  return;
                }
                void probe(handle);
              }}
              disabled={isProbing || (!input.trim() && xTweetFollows.length === 0)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t('真实抓取一次主页验证抓取通道', 'Fetch a profile once to verify the pipeline')}
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
              aria-label={t('X 用户名', 'X handle')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
              }}
              placeholder="@geekbb / geekbb / https://x.com/geekbb"
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
            {xTweetFollows.length === 0 ? (
              <p className="rounded-lg bg-card dark:bg-card/[0.03] px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
                {t('暂无关注博主。', 'No followed accounts yet.')}
              </p>
            ) : xTweetFollows.map((follow) => (
              <div
                key={follow.handle.toLowerCase()}
                className="flex items-center justify-between gap-3 rounded-lg bg-card dark:bg-muted/40 px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground dark:text-foreground">@{follow.handle}</div>
                  <a
                    href={`https://x.com/${follow.handle}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="truncate text-xs text-muted-foreground dark:text-muted-foreground hover:text-foreground transition-colors"
                  >
                    https://x.com/{follow.handle}
                  </a>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleRemove(follow)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                  title={t('取消关注', 'Unfollow')}
                  aria-label={t(`取消关注 @${follow.handle}`, `Unfollow @${follow.handle}`)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
          <div className="mb-3 flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground dark:text-foreground">
                {t('鉴权 Cookie（可选）', 'Auth Cookies (optional)')}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                {t(
                  '填写后改走登录态 GraphQL 接口：每位博主每页约 20 条推文，"加载更多"按页回溯历史。留空使用未登录抓取（每位博主每次仅最新一小批）。浏览器登录 x.com 后在 DevTools → Application → Cookies 中复制 auth_token 与 ct0，仅保存在本机应用数据中。',
                  'Once set, fetching switches to the signed-in GraphQL API: ~20 tweets per account per page and "Load more" pages back through history. Leave empty for signed-out fetching (a small latest batch per account). Copy auth_token and ct0 from DevTools → Application → Cookies after signing in to x.com; they are stored locally only.',
                )}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              type="password"
              aria-label={t('auth_token', 'auth_token')}
              value={authTokenInput}
              onChange={(event) => setAuthTokenInput(event.target.value)}
              placeholder={xTweetAuth ? t('已保存（输入可覆盖）', 'Saved (type to replace)') : 'auth_token'}
              autoComplete="off"
              className="min-w-0 rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 px-3 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
            <Input
              type="password"
              aria-label={t('ct0', 'ct0')}
              value={ct0Input}
              onChange={(event) => setCt0Input(event.target.value)}
              placeholder={xTweetAuth ? t('已保存（输入可覆盖）', 'Saved (type to replace)') : 'ct0'}
              autoComplete="off"
              className="min-w-0 rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 px-3 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring"
            />
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground dark:text-muted-foreground">
              <Cookie className="h-3.5 w-3.5 flex-shrink-0" />
              {xTweetAuth
                ? t('当前已启用鉴权抓取', 'Authenticated fetching is on')
                : t('当前为未登录抓取模式', 'Signed-out fetching mode')}
            </span>
            <div className="flex flex-shrink-0 items-center gap-2">
              {xTweetAuth && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearAuth}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                  {t('清除', 'Clear')}
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSaveAuth}
                disabled={!authTokenInput.trim() || !ct0Input.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlugZap className="h-4 w-4" />
                {xTweetAuth ? t('更新鉴权', 'Update Auth') : t('保存鉴权', 'Save Auth')}
              </Button>
            </div>
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
