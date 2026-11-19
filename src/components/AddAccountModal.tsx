import { useT } from '../i18n/useT';
import React, { useEffect, useState } from 'react';
import { AlertCircle, Key, Link, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { useAccountSwitchActions } from '../features/lifecycle/hooks/useAccountSwitchActions';
import type { SavedAccount } from '../types';

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 需要补全 Token 的已保存账号（从下拉菜单「切换」进入时预填提示） */
  reauthAccount?: SavedAccount | null;
}

const BACKEND_ERROR_KEYS: Record<string, string> = {
  'backend-unavailable': 'loginScreen.unable-to-connect-to-this-backend-url',
  unauthorized: 'loginScreen.invalid-api-key-please-check-it-and-try-again',
  'restore-failed': 'loginScreen.failed-to-read-login-data-from-the-backend',
  'github-token-required': 'loginScreen.no-token-is-configured-on-this-backend-complete',
  'restored-token-invalid': 'loginScreen.the-github-token-stored-on-the-backend-is-not-wo',
};

/**
 * 在线添加新 GitHub 账号（Issue #611，模块 2.2）。
 *
 * 使用独立弹窗而非跳回 LoginScreen：取消弹窗时当前账号的登录态、
 * 工作区与会话毫发无损（不触发 logout）。
 *
 * - PAT 模式（默认）：校验并切换到新账号，或为脱敏导入的账号补全 Token；
 * - 后端恢复模式：连接后端并恢复其活跃账号（已登录时先安全归档当前账号）。
 */
export const AddAccountModal: React.FC<AddAccountModalProps> = ({ isOpen, onClose, reauthAccount = null }) => {
  const t = useT('app');
  const tLogin = useT('login');
  const { addAccountWithToken, addAccountFromBackend, isSwitching } = useAccountSwitchActions();
  const [mode, setMode] = useState<'token' | 'backend'>('token');
  const [token, setToken] = useState('');
  const [backendUrl, setBackendUrl] = useState('');
  const [backendSecret, setBackendSecret] = useState('');
  const [error, setError] = useState('');

  // 打开时重置；reauth 账号默认停在补全 Token 模式
  useEffect(() => {
    if (isOpen) {
      setMode('token');
      setToken('');
      setError('');
    }
  }, [isOpen, reauthAccount]);

  const busy = isSwitching;

  const handleCancel = () => {
    if (busy) return;
    // 取消：当前账号工作区与会话不受任何影响
    setError('');
    setToken('');
    setBackendSecret('');
    onClose();
  };

  const describeError = (code: string | undefined): string => {
    if (!code) return tLogin('loginScreen.sign-in-failed-please-try-again');
    if (code === 'account-mismatch') {
      return tLogin('app:accountModal.account-mismatch', { login: reauthAccount?.user.login ?? '' });
    }
    // 自审计补充：账号切换锁与后端凭据写入失败给出可读提示，不暴露原始错误码。
    if (code === 'switch-in-progress') return t('app:header.switch-in-progress');
    if (code === 'backend-credential-sync-failed') {
      return t('app:accountModal.backend-credential-sync-failed');
    }
    if (code === 'invalid-github-user') return tLogin('loginScreen.sign-in-failed-please-try-again');
    const mapped = BACKEND_ERROR_KEYS[code];
    return mapped ? tLogin(mapped) : code;
  };

  const handleConfirmToken = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError(tLogin('loginScreen.please-enter-a-valid-github-token'));
      return;
    }
    setError('');
    const result = await addAccountWithToken(trimmed, reauthAccount?.accountId);
    if (!result.ok) {
      setError(describeError(result.error));
      return;
    }
    handleCancel();
  };

  const handleConfirmBackend = async () => {
    if (!backendUrl.trim() || !backendSecret.trim()) {
      setError(tLogin('loginScreen.please-enter-the-backend-url-and-api-key'));
      return;
    }
    setError('');
    // 补授权入口把目标账号固定住：候选后端的活跃账号不匹配时不得切换会话。
    const result = await addAccountFromBackend(backendUrl.trim(), backendSecret.trim(), reauthAccount?.accountId);
    if (!result.ok) {
      setError(describeError(result.error));
      return;
    }
    handleCancel();
  };

  const hintForReauth = !!reauthAccount && mode === 'token';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={t('app:accountModal.title')}
      maxWidth="max-w-md"
      // Modal 只在 scrollable=true 时渲染 footer（默认分支会丢弃 footer）：
      // 不启用则确认/取消按钮根本不会出现，用户填写凭据后无法提交（审计修复）
      scrollable
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={handleCancel} disabled={busy}>
            {t('app:accountModal.cancel')}
          </Button>
          <Button
            type="button"
            onClick={() => void (mode === 'token' ? handleConfirmToken() : handleConfirmBackend())}
            disabled={busy || (mode === 'token' ? !token.trim() : (!backendUrl.trim() || !backendSecret.trim()))}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('app:accountModal.confirm')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {hintForReauth
            ? t('app:accountModal.reauth-hint', { login: reauthAccount?.user.login ?? '' })
            : t('app:accountModal.description')}
        </p>

        <div className="flex items-center gap-1 rounded-md border border-border p-1 text-sm">
          <button
            type="button"
            onClick={() => { setMode('token'); setError(''); }}
            disabled={busy}
            className={`flex-1 rounded px-2 py-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${mode === 'token' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={mode === 'token'}
          >
            {t('app:accountModal.token-label')}
          </button>
          <button
            type="button"
            onClick={() => { setMode('backend'); setError(''); }}
            disabled={busy}
            className={`flex-1 rounded px-2 py-1.5 transition-colors disabled:opacity-50 disabled:pointer-events-none ${mode === 'backend' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-pressed={mode === 'backend'}
          >
            {tLogin('loginScreen.connect-to-your-backend')}
          </button>
        </div>

        {mode === 'token' ? (
          <div className="space-y-2">
            <Label htmlFor="add-account-token">{t('app:accountModal.token-label')}</Label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="add-account-token"
                type="password"
                autoComplete="current-password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={(event) => { setToken(event.target.value); setError(''); }}
                disabled={busy}
                className="pl-10"
              />
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="add-account-backend-url">{tLogin('loginScreen.backend-url')}</Label>
            <div className="relative">
              <Link className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="add-account-backend-url"
                type="url"
                autoComplete="url"
                placeholder="https://example.com"
                value={backendUrl}
                onChange={(event) => {
                  // URL 变更后旧密钥不再对应目标后端：必须重新输入。
                  if (event.target.value !== backendUrl) setBackendSecret('');
                  setBackendUrl(event.target.value);
                  setError('');
                }}
                disabled={busy}
                className="pl-10"
              />
            </div>
            <Label htmlFor="add-account-backend-secret">API Key</Label>
            <div className="relative">
              <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="add-account-backend-secret"
                type="password"
                autoComplete="current-password"
                value={backendSecret}
                onChange={(event) => { setBackendSecret(event.target.value); setError(''); }}
                disabled={busy}
                className="pl-10"
              />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <p className="text-sm">{error}</p>
          </div>
        )}
      </div>
    </Modal>
  );
};
