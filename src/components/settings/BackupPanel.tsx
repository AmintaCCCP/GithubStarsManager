
import { TranslateFn } from '../../i18n/useT';
import { Button } from '../ui/button';
import React, { useEffect, useState } from 'react';
import { Download, Upload, RefreshCw, Cloud, AlertCircle } from 'lucide-react';
import type { WebDAVConfig } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { accountIdKey, getAccountSessionGeneration } from '../../store/helpers/accountWorkspace';
import { IncludeKeysToggle } from './IncludeKeysToggle';
import { useBackupActions } from '../../features/settings/hooks/useBackupActions';
import { useDialog } from '../../hooks/useDialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { ScrollArea } from '../ui/scroll-area';

interface BackupPanelProps {
  t: TranslateFn;
}

/**
 * WebDAV 备份/恢复面板。
 * 审计修复（C46）：恢复不再始终下载排序后最新的备份——点击恢复先列出
 * WebDAV 上可恢复的备份供用户选择（预选包含当前账号工作区的最新备份，
 * 标 ★），选中后才进入恢复确认与下载流程。
 */
const getCurrentActiveWebDAVConfig = (): WebDAVConfig | null => {
  const store = useAppStore.getState();
  return store.webdavConfigs.find((config) => config.id === store.activeWebDAVConfig) ?? null;
};

const getWebDAVConfigFingerprint = (config: WebDAVConfig | null | undefined): string => (
  config
    ? JSON.stringify([
        config.id,
        config.url,
        config.path,
        config.username,
        config.password,
        config.isActive,
        // 审计修复：customUserAgent 影响实际请求头——仅修改该字段也必须使旧
        // 备份列表失效并要求重新列举，否则确认恢复仍会以旧配置下载。
        config.customUserAgent,
      ])
    : ''
);

export const BackupPanel: React.FC<BackupPanelProps> = ({ t }) => {
  const lastBackup = useAppStore((state) => state.lastBackup);
  const { activeConfig, isBackingUp, isRestoring, backup, restore, listBackups } = useBackupActions();
  const { toast } = useDialog();
  const activeConfigFingerprint = getWebDAVConfigFingerprint(activeConfig);
  // 当前活跃账号标识（响应式）：列表打开期间账号切换时用于关闭列表
  const currentAccountId = useAppStore((state) => accountIdKey(state.user));
  // 审计修复（R12）：会话代次不是响应式状态——同账号更换凭据时（switchAccount
  // 同账号分支）代次递增但 currentAccountId 不变，仅订阅账号 ID 会漏掉这类
  // 变化，旧列表仍可操作（要等 restore 的最终校验拒绝）。每次代次递增都伴随
  // user 变化（切换/登出）或 githubToken / isAuthenticated 变化（同账号换凭据
  // 或修复破损会话），一并订阅这三个响应式会话标识，让代次变化时下方 effect
  // 必然重查。
  const sessionGithubToken = useAppStore((state) => state.githubToken);
  const sessionAuthenticated = useAppStore((state) => state.isAuthenticated);
  const [isListingBackups, setIsListingBackups] = useState(false);
  const [backupSelection, setBackupSelection] = useState<{
    open: boolean;
    files: string[];
    recommended: string | null;
    selected: string | null;
    listedConfig: WebDAVConfig | null;
    listedAccountId: string | null;
    listedGeneration: number | null;
  }>({
    open: false,
    files: [],
    recommended: null,
    selected: null,
    listedConfig: null,
    listedAccountId: null,
    listedGeneration: null,
  });
  // 审计修复（R13 finding 87）：列举错误绑定发生时的配置指纹与会话上下文——
  // 配置 A 列举失败后切到配置 B（或切换账号/会话代次变化），旧错误不得继续
  // 显示在面板上；仅当指纹与当前上下文匹配时才渲染。
  const [listError, setListError] = useState<{
    message: string;
    fingerprint: string;
    accountId: string | null;
    generation: number;
  } | null>(null);

  // WebDAV 活跃配置切换或 URL/路径/凭据变更时作废旧的备份列表选择，防止下载错位文件
  useEffect(() => {
    setBackupSelection((current) => (
      current.open
      && current.listedConfig
      && getWebDAVConfigFingerprint(current.listedConfig) !== activeConfigFingerprint
        ? { ...current, open: false, selected: null, listedConfig: null }
        : current
    ));
  }, [activeConfigFingerprint]);

  // 审计修复：备份列表打开后账号切换/会话代次变化时关闭列表——推荐文件可能
  // 按新会话计算，而恢复仍绑定旧会话（要等 restore 的最终校验拒绝）。会话
  // 代次不是响应式状态，但每次代次递增都伴随 user / githubToken /
  // isAuthenticated 变化（见上方订阅注释），这些标识变化触发本 effect 重查。
  useEffect(() => {
    setBackupSelection((current) => (
      current.open
      && (current.listedAccountId !== currentAccountId
        || getAccountSessionGeneration() !== current.listedGeneration)
        ? { ...current, open: false, selected: null }
        : current
    ));
  }, [currentAccountId, sessionGithubToken, sessionAuthenticated]);

  // 审计修复（R13 finding 87）：配置或会话变化后清除不匹配的旧列举错误（隐藏
  // 并清除），同时保留 handleRestoreClick 内对过期异步结果的既有检查。
  useEffect(() => {
    setListError((current) => (
      current
      && (current.fingerprint !== activeConfigFingerprint
        || current.accountId !== currentAccountId
        || getAccountSessionGeneration() !== current.generation)
        ? null
        : current
    ));
  }, [activeConfigFingerprint, currentAccountId, sessionGithubToken, sessionAuthenticated]);

  const handleRestoreClick = async () => {
    const listedConfig = activeConfig ?? null;
    const listedFingerprint = getWebDAVConfigFingerprint(listedConfig);
    const listedAccountId = accountIdKey(useAppStore.getState().user);
    const listedGeneration = getAccountSessionGeneration();
    setIsListingBackups(true);
    setListError(null);
    try {
      const { files, recommended } = await listBackups();
      // 列举期间活跃 WebDAV 配置被切换或修改（含 URL/路径编辑）：丢弃过期响应
      if (getWebDAVConfigFingerprint(getCurrentActiveWebDAVConfig()) !== listedFingerprint) {
        return;
      }
      // 审计修复：列举期间账号切换/会话代次变化——结果属于旧会话，丢弃，
      // 绝不打开列表或显示旧会话的列举错误
      if (accountIdKey(useAppStore.getState().user) !== listedAccountId
        || getAccountSessionGeneration() !== listedGeneration) {
        return;
      }
      if (files.length === 0) {
        // 无备份文件：直接给出无备份提示，不调用 restore，避免两次列举间新上传的文件未经用户核对就被自动恢复
        toast(t('useBackupActions.no-backup-files-found'), 'error');
        return;
      }
      setBackupSelection({
        open: true,
        files,
        recommended,
        selected: recommended ?? files[files.length - 1],
        listedConfig,
        listedAccountId,
        listedGeneration,
      });
    } catch (error) {
      if (getWebDAVConfigFingerprint(getCurrentActiveWebDAVConfig()) !== listedFingerprint) {
        return;
      }
      // 同上：会话已变化时丢弃列举错误，不显示给已切换后的新会话
      if (accountIdKey(useAppStore.getState().user) !== listedAccountId
        || getAccountSessionGeneration() !== listedGeneration) {
        return;
      }
      setListError({
        message: error instanceof Error ? error.message : String(error),
        fingerprint: listedFingerprint,
        accountId: listedAccountId,
        generation: listedGeneration,
      });
    } finally {
      setIsListingBackups(false);
    }
  };

  const confirmRestoreSelection = async () => {
    const { selected, listedConfig, listedAccountId, listedGeneration } = backupSelection;
    setBackupSelection((current) => ({ ...current, open: false }));
    if (
      !selected
      || getWebDAVConfigFingerprint(getCurrentActiveWebDAVConfig()) !== getWebDAVConfigFingerprint(listedConfig)
    ) {
      return;
    }
    await restore(selected, {
      expectedAccountId: listedAccountId,
      ...(listedGeneration !== null ? { expectedGeneration: listedGeneration } : {}),
      ...(listedConfig ? { config: listedConfig } : {}),
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Cloud className="w-6 h-6 text-muted-foreground dark:text-muted-foreground" />
        <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
          {t('backupPanel.backup-restore')}
        </h3>
      </div>

      {!activeConfig && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-5 h-5 text-muted-foreground dark:text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
                {t('backupPanel.please-configure-and-activate-webdav-service-fir')}
              </p>
              <p className="text-xs text-muted-foreground dark:text-muted-foreground mt-1">
                {t('backupPanel.backup-and-restore-features-require-webdav-servi')}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 审计修复（R13 finding 87）：仅显示与当前配置指纹/会话上下文匹配的列举错误 */}
      {listError
        && listError.fingerprint === activeConfigFingerprint
        && listError.accountId === currentAccountId
        && getAccountSessionGeneration() === listError.generation
        && (
          <div className="p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            {listError.message}
          </div>
        )}

      {lastBackup && (
        <div className="p-4 bg-muted dark:bg-muted/40 rounded-lg">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
            <span className="font-medium">{t('backupPanel.last-backup')}</span>{' '}
            {new Date(lastBackup).toLocaleString()}
          </p>
        </div>
      )}

      <IncludeKeysToggle t={t} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-3 mb-4">
            <Upload className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('backupPanel.backup-data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('backupPanel.backup-data-to-webdav')}
              </p>
            </div>
          </div>
          <Button
            onClick={backup}
            disabled={isBackingUp || !activeConfig}
            className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isBackingUp ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Upload className="w-5 h-5" />
            )}
            <span>{isBackingUp ? t('backupPanel.backing-up') : t('backupPanel.start-backup')}</span>
          </Button>
        </div>

        <div className="p-6 bg-background dark:bg-muted/40 rounded-lg border border-border dark:border-border">
          <div className="flex items-center space-x-3 mb-4">
            <Download className="w-8 h-8 text-muted-foreground dark:text-muted-foreground" />
            <div>
              <h4 className="font-medium text-foreground dark:text-foreground">
                {t('backupPanel.restore-data')}
              </h4>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('backupPanel.restore-data-from-webdav')}
              </p>
            </div>
          </div>
          <Button
            onClick={() => void handleRestoreClick()}
            disabled={isRestoring || isListingBackups || !activeConfig}
            className="h-auto w-full flex items-center justify-center space-x-2 px-4 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRestoring || isListingBackups ? (
              <RefreshCw className="w-5 h-5 animate-spin" />
            ) : (
              <Download className="w-5 h-5" />
            )}
            <span>{isRestoring ? t('backupPanel.restoring') : t('backupPanel.start-restore')}</span>
          </Button>
        </div>
      </div>

      <div className="p-4 bg-background dark:bg-muted/40 rounded-lg">
        <h4 className="font-medium text-foreground dark:text-foreground mb-2">
          {t('backupPanel.backup-includes')}
        </h4>
        <ul className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1">
          <li>• {t('backupPanel.github-stars-repository-list')}</li>
          <li>• {t('backupPanel.release-information')}</li>
          <li>• {t('backupPanel.custom-categories')}</li>
          <li>• {t('backupPanel.ai-service-configurations')}</li>
          <li>• {t('backupPanel.webdav-configurations')}</li>
          <li>• {t('backupPanel.release-subscriptions-sources-read-state')}</li>
        </ul>
      </div>

      <Dialog open={backupSelection.open} onOpenChange={(open) => setBackupSelection((current) => ({ ...current, open }))}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('backupPanel.restore-data')}</DialogTitle>
            <DialogDescription>
              {t('backupPanel.restore-data-from-webdav')}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-72 rounded-md border border-border">
            <div className="flex flex-col gap-1 p-2">
              {[...backupSelection.files].reverse().map((file) => (
                <button
                  key={file}
                  type="button"
                  aria-pressed={backupSelection.selected === file}
                  onClick={() => setBackupSelection((current) => ({ ...current, selected: file }))}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    backupSelection.selected === file
                      ? 'bg-accent text-accent-foreground'
                      : 'hover:bg-accent/60 text-foreground'
                  }`}
                >
                  <span className="block truncate">
                    {file === backupSelection.recommended ? '★ ' : ''}{file}
                  </span>
                </button>
              ))}
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setBackupSelection((current) => ({ ...current, open: false }))}
            >
              {t('useDialog.cancel')}
            </Button>
            <Button onClick={() => void confirmRestoreSelection()} disabled={!backupSelection.selected}>
              {t('backupPanel.start-restore')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
