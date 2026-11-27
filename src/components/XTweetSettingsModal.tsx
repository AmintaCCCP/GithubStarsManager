



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
      <div className="space-y-4">
        <div className="rounded-md border border-subtle bg-sunken px-3.5 py-2.5 text-label text-secondary">
          {t('xTweetSettingsModal.refreshing-incrementally-pulls-the-latest-tweets')}
        </div>

        <div className="rounded-lg bg-raised p-4 shadow-elev-1">
          <div className="mb-3 flex items-start gap-2.5">
            <Users className="mt-0.5 size-4 shrink-0 text-tertiary" />
            <div className="flex-1">
              <h4 className="text-label font-semibold text-foreground">{t('xTweetSettingsModal.follow-list')}</h4>
              <p className="mt-0.5 text-label-sm text-secondary">
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
              className="shrink-0 gap-1.5"
              title={t('xTweetSettingsModal.fetch-a-profile-once-to-verify-the-pipeline')}
            >
              <PlugZap className={`size-3.5 ${isProbing ? 'animate-pulse' : ''}`} />
              {isProbing ? t('xTweetSettingsModal.testing') : t('xTweetSettingsModal.test-connection')}
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
              aria-label={t('xTweetSettingsModal.x-handle')}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAdd();
              }}
              placeholder="@geekbb / geekbb / https://x.com/geekbb"
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
              {t('xTweetSettingsModal.add')}
            </Button>
          </div>

          <div className="mt-3">
            {xTweetFollows.length === 0 ? (
              <p className="rounded-md border border-subtle bg-sunken px-3 py-2.5 text-label-sm text-tertiary">
                {t('xTweetSettingsModal.no-followed-accounts-yet')}
              </p>
            ) : (
              <div className="overflow-hidden rounded-md border border-subtle bg-sunken divide-y divide-subtle">
                {xTweetFollows.map((follow) => (
                  <div
                    key={follow.handle.toLowerCase()}
                    className="flex items-center justify-between gap-3 px-3 py-2 transition-[background-color] duration-micro ease-out-subtle hover:bg-fill-hover hover:duration-instant"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-label font-medium text-foreground">@{follow.handle}</div>
                      <a
                        href={`https://x.com/${follow.handle}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(event) => event.stopPropagation()}
                        className="truncate text-label-sm text-tertiary font-mono hover:text-foreground transition-colors"
                      >
                        https://x.com/{follow.handle}
                      </a>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => handleRemove(follow)}
                      className="text-tertiary hover:bg-destructive-tint hover:text-destructive"
                      title={t('xTweetSettingsModal.unfollow')}
                      aria-label={t('xTweetSettingsModal.unfollow-v1', { v1: follow.handle })}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-raised p-4 shadow-elev-1">
          <div className="mb-3 flex items-start gap-2.5">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-tertiary" />
            <div className="flex-1">
              <h4 className="text-label font-semibold text-foreground">
                {t('xTweetSettingsModal.auth-cookies-optional')}
              </h4>
              <p className="mt-0.5 text-label-sm text-secondary">
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
                className="w-full pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowAuthToken((prev) => !prev)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-grid size-control-sm place-items-center rounded-sm text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors"
                aria-label={showAuthToken ? t('xTweetSettingsModal.hide-auth-token') : t('xTweetSettingsModal.show-auth-token')}
              >
                {showAuthToken ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
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
                className="w-full pr-9 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowCt0((prev) => !prev)}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-grid size-control-sm place-items-center rounded-sm text-tertiary hover:bg-fill-hover hover:text-foreground transition-colors"
                aria-label={showCt0 ? t('xTweetSettingsModal.hide-ct0') : t('xTweetSettingsModal.show-ct0')}
              >
                {showCt0 ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </button>
            </div>
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-label-sm text-tertiary">
              <Cookie className="size-3.5 shrink-0" />
              {xTweetAuth
                ? t('xTweetSettingsModal.authenticated-fetching-is-on')
                : t('xTweetSettingsModal.signed-out-fetching-mode')}
            </span>
            <div className="flex shrink-0 items-center gap-2">
              {xTweetAuth && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleClearAuth}
                  className="gap-1.5 text-tertiary hover:bg-destructive-tint hover:text-destructive"
                >
                  <X className="size-3.5" />
                  {t('xTweetSettingsModal.clear')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={handleSaveAuth}
                disabled={!authTokenInput.trim() || !ct0Input.trim() || (xTweetAuth !== null && !isAuthDirty)}
                className="gap-1.5"
              >
                <PlugZap className="size-3.5" />
                {xTweetAuth ? (isAuthDirty ? t('xTweetSettingsModal.update-auth') : t('xTweetSettingsModal.saved')) : t('xTweetSettingsModal.save-auth')}
              </Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end border-t border-subtle pt-3">
          <Button
            type="button"
            variant="primary"
            onClick={onClose}
          >
            {t('xTweetSettingsModal.done')}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
