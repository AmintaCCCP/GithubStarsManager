



import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import { Input } from './ui/input';
import React, { useState, useEffect } from 'react';
import { Cookie, Eye, EyeOff, KeyRound, PlugZap, Plus, Trash2, Users, X } from 'lucide-react';
import type { XTweetFollow } from '../types';
import { useAppStore } from '../store/useAppStore';
import { Modal } from './Modal';
import { useDialog } from '../hooks/useDialog';
import { useXTweetProbe } from '../features/discovery/hooks/useXTweetProbe';
import { normalizeXTweetAuth, normalizeXTweetHandleInput } from '../utils/xTweetFollows';
import { saveEncryptedXAuthViaDesktop, isElectron } from '../services/electronProxy';
import { logger } from '../services/logger';

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
  const xTweetFollows = useAppStore(state => state.xTweetFollows);
  const xTweetAuth = useAppStore(state => state.xTweetAuth);
  const addXTweetFollow = useAppStore(state => state.addXTweetFollow);
  const removeXTweetFollow = useAppStore(state => state.removeXTweetFollow);
  const setXTweetAuth = useAppStore(state => state.setXTweetAuth);
  const clearXTweetAuth = useAppStore(state => state.clearXTweetAuth);
  const { toast } = useDialog();
  const { probe, isProbing, message, probeOk } = useXTweetProbe();

  const t = useT('plugins');
  const [input, setInput] = useState('');
  const [authTokenInput, setAuthTokenInput] = useState('');
  const [ct0Input, setCt0Input] = useState('');
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [showCt0, setShowCt0] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setAuthTokenInput(xTweetAuth?.authToken || '');
      setCt0Input(xTweetAuth?.ct0 || '');
    }
  }, [isOpen, xTweetAuth]);

  const handleKeys = new Set(xTweetFollows.map(follow => follow.handle.toLowerCase()));

  const handleAdd = () => {
    const handle = normalizeXTweetHandleInput(input);
    if (!handle) {
      toast(t('xTweetSettingsModal.enter-a-valid-x-handle-e-g-geekbb-or-a-profile-u'), 'error');
      return;
    }
    if (handleKeys.has(handle.toLowerCase())) {
      toast(t('xTweetSettingsModal.this-account-is-already-in-the-list'), 'info');
      return;
    }
    addXTweetFollow(handle);
    setInput('');
    toast(t('xTweetSettingsModal.account-added-to-the-follow-list'), 'success');
  };

  const handleRemove = (follow: XTweetFollow) => {
    removeXTweetFollow(follow.handle);
    toast(t('xTweetSettingsModal.unfollowed-v1', { v1: follow.handle }), 'info');
  };

  const handleSaveAuth = async () => {
    const sanitized = normalizeXTweetAuth({ authToken: authTokenInput, ct0: ct0Input });
    if (!sanitized) {
      toast(t('xTweetSettingsModal.both-auth-token-and-ct0-must-contain-valid-value'), 'error');
      return;
    }
    // Eagerly update in-memory state so UI reacts immediately
    setXTweetAuth(sanitized);
    setAuthTokenInput(sanitized.authToken);
    setCt0Input(sanitized.ct0);

    // Verify the disk write actually succeeded (desktop only)
    if (isElectron()) {
      try {
        await saveEncryptedXAuthViaDesktop(sanitized);
        toast(t('xTweetSettingsModal.auth-cookies-saved-refreshes-now-use-the-graphql'), 'success');
      } catch (err: unknown) {
        logger.errorFromError('xAuth', 'Disk persistence of X auth failed after setXTweetAuth', err);
        toast(
          t('xTweetSettingsModal.auth-cookies-applied-but-failed-to-persist-to-di'),
          'warning',
        );
      }
    } else {
      toast(t('xTweetSettingsModal.auth-cookies-saved-current-session-only'), 'success');
    }
  };

  const handleClearAuth = () => {
    clearXTweetAuth();
    setAuthTokenInput('');
    setCt0Input('');
    toast(t('xTweetSettingsModal.auth-cookies-cleared-back-to-the-signed-out-mode'), 'info');
  };

  const isAuthDirty =
    authTokenInput.trim() !== (xTweetAuth?.authToken || '') ||
    ct0Input.trim() !== (xTweetAuth?.ct0 || '');

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('xTweetSettingsModal.x-tweets-channel-settings')} maxWidth="max-w-2xl">
      <div className="space-y-5">
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm text-muted-foreground dark:text-muted-foreground">
          {t('xTweetSettingsModal.refreshing-incrementally-pulls-the-latest-tweets')}
        </div>

        <div className="rounded-lg border border-border dark:border-border bg-muted/50 dark:bg-muted/20 p-4">
          <div className="mb-3 flex items-start gap-2">
            <Users className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <h4 className="text-sm font-semibold text-foreground dark:text-foreground">{t('xTweetSettingsModal.follow-list')}</h4>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                {t('xTweetSettingsModal.accepts-handle-handle-or-an-x-com-profile-url-ti')}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                const normalizedInput = normalizeXTweetHandleInput(input);
                if (input.trim() && !normalizedInput) {
                  toast(t('xTweetSettingsModal.enter-a-valid-x-handle'), 'error');
                  return;
                }
                const handle = normalizedInput || xTweetFollows[0]?.handle;
                if (!handle) {
                  toast(t('xTweetSettingsModal.fill-in-or-add-an-account-to-test-first'), 'error');
                  return;
                }
                void probe(handle);
              }}
              disabled={isProbing || (!input.trim() && xTweetFollows.length === 0)}
              className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
              title={t('xTweetSettingsModal.fetch-a-profile-once-to-verify-the-pipeline')}
            >
              <PlugZap className={`h-4 w-4 ${isProbing ? 'animate-pulse' : ''}`} />
              {isProbing ? t('xTweetSettingsModal.testing') : t('xTweetSettingsModal.test-connection')}
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
              aria-label={t('xTweetSettingsModal.x-handle')}
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
              {t('xTweetSettingsModal.add')}
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            {xTweetFollows.length === 0 ? (
              <p className="rounded-lg bg-card dark:bg-card/[0.03] px-3 py-2 text-xs text-muted-foreground dark:text-muted-foreground">
                {t('xTweetSettingsModal.no-followed-accounts-yet')}
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
                  title={t('xTweetSettingsModal.unfollow')}
                  aria-label={t('xTweetSettingsModal.unfollow-v1', { v1: follow.handle })}
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
                {t('xTweetSettingsModal.auth-cookies-optional')}
              </h4>
              <p className="mt-1 text-xs text-muted-foreground dark:text-muted-foreground">
                {t('xTweetSettingsModal.once-set-fetching-switches-to-the-signed-in-grap')}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="relative">
              <Input
                type={showAuthToken ? 'text' : 'password'}
                aria-label={t('xTweetSettingsModal.auth-token')}
                value={authTokenInput}
                onChange={(event) => setAuthTokenInput(event.target.value)}
                placeholder="auth_token"
                autoComplete="off"
                className="w-full rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 pl-3 pr-9 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAuthToken((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                aria-label={showAuthToken ? t('xTweetSettingsModal.hide-auth-token') : t('xTweetSettingsModal.show-auth-token')}
              >
                {showAuthToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <div className="relative">
              <Input
                type={showCt0 ? 'text' : 'password'}
                aria-label={t('xTweetSettingsModal.ct0')}
                value={ct0Input}
                onChange={(event) => setCt0Input(event.target.value)}
                placeholder="ct0"
                autoComplete="off"
                className="w-full rounded-lg border border-border dark:border-border bg-card dark:bg-muted/40 pl-3 pr-9 py-2 text-sm text-foreground dark:text-foreground focus:border-transparent focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                type="button"
                onClick={() => setShowCt0((prev) => !prev)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground transition-colors rounded"
                aria-label={showCt0 ? t('xTweetSettingsModal.hide-ct0') : t('xTweetSettingsModal.show-ct0')}
              >
                {showCt0 ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground dark:text-muted-foreground">
              <Cookie className="h-3.5 w-3.5 flex-shrink-0" />
              {xTweetAuth
                ? t('xTweetSettingsModal.authenticated-fetching-is-on')
                : t('xTweetSettingsModal.signed-out-fetching-mode')}
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
                  {t('xTweetSettingsModal.clear')}
                </Button>
              )}
              <Button
                type="button"
                onClick={handleSaveAuth}
                disabled={!authTokenInput.trim() || !ct0Input.trim() || (xTweetAuth !== null && !isAuthDirty)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlugZap className="h-4 w-4" />
                {xTweetAuth ? (isAuthDirty ? t('xTweetSettingsModal.update-auth') : t('xTweetSettingsModal.saved')) : t('xTweetSettingsModal.save-auth')}
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
            {t('xTweetSettingsModal.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
