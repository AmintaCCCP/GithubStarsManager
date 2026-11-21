
import { useT } from '../../../i18n/useT';
import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Category } from '../../../types';
import { useAppStore } from '../../../store/useAppStore';
import {
  accountIdKey,
  getAccountSessionGeneration,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { useDialog } from '../../../hooks/useDialog';
import { backend } from '../../../services/backendAdapter';
import { normalizeBackendUrl } from '../../../utils/backendUrl';
import {
  forceSyncToBackend,
  syncLocalGitHubTokenToBackend,
  tryRestoreAuthFromBackend,
  withAccountSwitchFrozen,
} from '../../../services/autoSync';

type BackendStatus = 'connected' | 'disconnected' | 'checking';

type ConnectionProbeOutcome = {
  status: 'connected' | 'disconnected';
  health: { version: string; timestamp: string } | null;
};

// R13 审计修复：完整连接探测的共享互斥——探测窗口（健康检查 + verifyAuth +
// 认证失败回滚）内不得启动第二次探测。模块级标记在多个 hook 实例之间共享。
let _connectionProbeInFlight = false;
let _connectionProbePromise: Promise<ConnectionProbeOutcome> | null = null;

export interface BackendSettingsActions {
  status: BackendStatus;
  health: { version: string; timestamp: string } | null;
  urlInput: string;
  secretInput: string;
  backendAvailable: boolean;
  isSyncingToBackend: boolean;
  isSyncingFromBackend: boolean;
  setUrlInput: (value: string) => void;
  setSecretInput: (value: string) => void;
  testConnection: () => Promise<void>;
  syncToBackend: () => Promise<void>;
  syncFromBackend: () => Promise<void>;
}

/**
 * Encapsulates manual settings-panel backend operations. Application-start auth
 * lifecycle remains outside this hook for the later lifecycle extraction work.
 */
export const useBackendSettingsActions = (): BackendSettingsActions => {
  const t = useT('settings');
  const state = useAppStore(useShallow((store) => ({
    repositories: store.repositories,
    releases: store.releases,
    aiConfigs: store.aiConfigs,
    webdavConfigs: store.webdavConfigs,
    activeAIConfig: store.activeAIConfig,
    activeWebDAVConfig: store.activeWebDAVConfig,
    hiddenDefaultCategoryIds: store.hiddenDefaultCategoryIds,
    categoryOrder: store.categoryOrder,
    customCategories: store.customCategories,
    assetFilters: store.assetFilters,
    defaultCategoryOverrides: store.defaultCategoryOverrides,
    collapsedSidebarCategoryCount: store.collapsedSidebarCategoryCount,
    backendApiSecret: store.backendApiSecret,
    setBackendApiSecret: store.setBackendApiSecret,
    setRepositories: store.setRepositories,
    setReleases: store.setReleases,
    setAIConfigs: store.setAIConfigs,
    setWebDAVConfigs: store.setWebDAVConfigs,
    showDefaultCategory: store.showDefaultCategory,
    hideDefaultCategory: store.hideDefaultCategory,
  })));
  const { toast, confirm } = useDialog();
  const [status, setStatus] = useState<BackendStatus>('disconnected');
  const [health, setHealth] = useState<{ version: string; timestamp: string } | null>(null);
  const [isSyncingToBackend, setIsSyncingToBackend] = useState(false);
  const [isSyncingFromBackend, setIsSyncingFromBackend] = useState(false);
  const [urlInput, setUrlInput] = useState(() => backend.configuredUrl?.replace(/\/api$/, '') || '');
  const [secretInput, setSecretInput] = useState(state.backendApiSecret || '');

  const checkConnection = useCallback(async (
    syncToken: boolean,
    preferredUrl?: string,
    // R13 审计修复：deferConnectedStatus 供完整探测使用——健康检查通过但
    // verifyAuth 尚未完成时不置 connected（按钮保持忙碌禁用），由调用方在
    // 认证通过后自行提交状态。
    options?: { deferConnectedStatus?: boolean },
  ) => {
    setStatus('checking');
    try {
      await backend.init(preferredUrl);
      const urlBeforeHealth = backend.backendUrl;
      const generationBeforeHealth = backend.connectionGeneration;
      const healthData = await backend.checkHealth();
      if (
        healthData
        && backend.backendUrl === urlBeforeHealth
        && backend.connectionGeneration === generationBeforeHealth
      ) {
        if (options?.deferConnectedStatus !== true) {
          setStatus('connected');
          setHealth({ version: healthData.version, timestamp: healthData.timestamp });
        }
        if (syncToken) void syncLocalGitHubTokenToBackend();
        return healthData;
      }
    } catch {
      // A disconnected backend must leave the settings screen usable.
    }
    setStatus('disconnected');
    setHealth(null);
    return null;
  }, []);

  useEffect(() => {
    let cancelled = false;
    // R14 finding 26：挂载探测不得在手动探测进行中改变后端目标——手动探测已
    // 固定目标并独占探测代次，挂载 init(undefined) 会取代其 init（探测代次
    // 失效）或提交另一地址，导致界面显示与实际后端错位。若设置面板在手动探测
    // 期间重新打开，等待在途探测结束并同步已确定的连接状态（不启动另一次 init）。
    if (_connectionProbeInFlight) {
      const pendingProbe = _connectionProbePromise;
      setStatus('checking');
      if (pendingProbe) {
        void pendingProbe.then(async (outcome) => {
          if (cancelled) return;
          if (outcome.status === 'connected') {
            setStatus('connected');
            setHealth(outcome.health);
            return;
          }
          if (!backend.isAvailable && !backend.backendUrl) {
            setStatus('disconnected');
            setHealth(null);
            return;
          }
          try {
            const urlBeforeHealth = backend.backendUrl;
            const generationBeforeHealth = backend.connectionGeneration;
            const healthData = await backend.checkHealth();
            if (cancelled) return;
            if (
              healthData
              && backend.backendUrl === urlBeforeHealth
              && backend.connectionGeneration === generationBeforeHealth
            ) {
              setStatus('connected');
              setHealth({ version: healthData.version, timestamp: healthData.timestamp });
              return;
            }
          } catch {
            // Keep disconnected fallback below
          }
          if (!cancelled) {
            setStatus('disconnected');
            setHealth(null);
          }
        });
      }
      return () => {
        cancelled = true;
      };
    }
    void checkConnection(true);
    return () => {
      cancelled = true;
    };
  }, [checkConnection]);

  const testConnection = useCallback(async () => {
    // R13 审计修复：完整探测窗口（健康检查 + verifyAuth + 认证失败回滚）串行
    // 执行——非空密钥时健康检查通过即置 connected 会让测试按钮提前恢复可点，
    // 第二次探测与第一次的冻结窗口并发，窗口退出顺序错乱会留下错误的全局
    // 冻结标志。这里以模块级互斥拒绝并发探测；状态在整个窗口保持 checking
    // 忙碌态（认证与回滚完成前按钮不可用），成功/失败/回滚路径均释放互斥。
    if (_connectionProbeInFlight) return;
    const trimmedUrl = urlInput.trim();
    if (trimmedUrl && !normalizeBackendUrl(trimmedUrl)) {
      toast(t('useBackendSettingsActions.invalid-backend-url-remote-backends-must-use-htt'), 'error');
      return;
    }
    const previousUrl = backend.backendUrl;
    // R15 finding 13（CodeRabbit）：探测失败回滚（init(previousUrl)）必须先校验
    // 连接所有权——连接代次在探测窗口内被其他流程推进（含 X→Z→X）时不得覆盖。
    const previousConnectionGeneration = backend.connectionGeneration;
    const previousProbeGeneration = backend.probeGeneration;
    // R14 finding 25：探测会把输入框密钥写入全局 store——失败的探测必须先恢复
    // 原密钥再回滚连接，否则之后发往原后端的请求会携带错误密钥（401）。
    const previousSecret = typeof useAppStore.getState === 'function'
      ? useAppStore.getState().backendApiSecret
      : state.backendApiSecret;
    const stagedSecret = secretInput || null;
    // R14 finding 26：手动探测固定目标地址——非空输入时 X = 规整化后的输入
    // 地址；留空时沿用自动探测（无固定预期地址，按实际提交地址继续）。
    const expectedUrl = trimmedUrl ? normalizeBackendUrl(trimmedUrl) : null;
    state.setBackendApiSecret(stagedSecret);
    _connectionProbeInFlight = true;
    let resolveProbe!: (outcome: ConnectionProbeOutcome) => void;
    _connectionProbePromise = new Promise<ConnectionProbeOutcome>((resolve) => {
      resolveProbe = resolve;
    });
    let settledOutcome: ConnectionProbeOutcome = { status: 'disconnected', health: null };
    // 探测失败/被丢弃时恢复原密钥；仅当全局密钥仍是本次暂存值（无并发流程
    // 改写）时才回写，避免覆盖并发流程已写入的密钥。
    const restoreStagedSecret = () => {
      if (typeof useAppStore.getState !== 'function'
        || useAppStore.getState().backendApiSecret === stagedSecret) {
        state.setBackendApiSecret(previousSecret);
      }
    };
    try {
      // 探测与失败回滚全程冻结自动推送，防止探测期间启动的新推送在两步之间切换后端把旧快照写入新后端
      const probeSucceeded = await withAccountSwitchFrozen(async () => {
        // With an address entered, probe exactly that URL; empty keeps the
        // previous auto-detect behavior (remembered URL, else same-origin).
        const healthData = await checkConnection(false, trimmedUrl || undefined, { deferConnectedStatus: true });
        if (!healthData) {
          restoreStagedSecret();
          // R15 finding 13（CodeRabbit）：回滚前校验连接所有权——探测自身的
          // init 至多提交一次落点（非空输入固定为候选地址；失败落 null；被
          // 更新的探测取代则不提交）。落点地址与连接代次必须与「从 previousUrl
          // 出发的一次提交」一致；等待期间被其他流程接管（提交了其他地址或
          // 代次推进，含 X→Z→X）时丢弃本次结果，不重新初始化连接。
          const landedUrl = backend.backendUrl;
          const landedGeneration = backend.connectionGeneration;
          const rollbackCandidates: Array<string | null> = expectedUrl !== null
            ? [expectedUrl, null]
            : [previousUrl, null, backend.persistedUrl];
          const probeGenerationOwned = typeof previousProbeGeneration !== 'number'
            || typeof backend.probeGeneration !== 'number'
            || backend.probeGeneration === previousProbeGeneration + 1;
          const probeOwnsConnection = probeGenerationOwned && rollbackCandidates.some((candidateUrl) => (
            landedUrl === candidateUrl
            && landedGeneration === previousConnectionGeneration + (candidateUrl === previousUrl ? 0 : 1)
          ));
          if (probeOwnsConnection) {
            await backend.init(previousUrl ?? undefined);
          } else {
            console.warn('Connection probe rollback discarded: backend connection was taken over during probe', {
              landed: landedUrl,
              previous: previousUrl,
            });
          }
          setStatus('disconnected');
          setHealth(null);
          if (probeOwnsConnection) {
            toast(t('useBackendSettingsActions.backend-connection-failed-please-check-the-serve'), 'error');
          }
          return false;
        }
        // R14 finding 26：健康检查必须命中固定目标——init(X) 被其他探测取代
        //（探测代次失效）时 checkHealth 读到的是另一地址，丢弃本次结果。
        const probedUrl = backend.backendUrl;
        // R15 finding 13：认证失败回滚与提交前的复核同时校验连接代次
        //（X→Z→X 地址复原但代次推进，仅比地址识别不出）。
        const probedConnectionGeneration = backend.connectionGeneration;
        if (probedUrl === null || (expectedUrl !== null && probedUrl !== expectedUrl)) {
          restoreStagedSecret();
          setStatus('disconnected');
          setHealth(null);
          console.warn('Connection probe discarded: backend target drifted during probe', { expected: expectedUrl, actual: probedUrl });
          return false;
        }
        try {
          const authOk = secretInput ? await backend.verifyAuth() : true;
          if (!authOk) throw new Error('Authentication failed');
          // R14 finding 26：提交成功结果前确认当前后端仍为探测命中的地址；
          // R15 finding 13：连接代次一并校验（X→Z→X 仅比地址识别不出）。
          // 已变化则丢弃结果——不写存储、不提示成功、不触发 token 恢复/同步。
          if (backend.backendUrl !== probedUrl || backend.connectionGeneration !== probedConnectionGeneration) {
            restoreStagedSecret();
            setStatus('disconnected');
            setHealth(null);
            console.warn('Connection probe discarded: backend target changed during verifyAuth', { probed: probedUrl, actual: backend.backendUrl });
            return false;
          }
          // Health and auth both passed — remember the address (shared with the
          // login screen prefill).
          backend.rememberActiveUrl();
          const connectedHealth = { version: healthData.version, timestamp: healthData.timestamp };
          settledOutcome = { status: 'connected', health: connectedHealth };
          setStatus('connected');
          setHealth(connectedHealth);
          toast(t('useBackendSettingsActions.backend-connection-successful'), 'success');
          return true;
        } catch {
          restoreStagedSecret();
          // R15 finding 13（CodeRabbit）：认证失败/异常的回滚同样先校验连接
          // 所有权——当前地址与连接代次仍等于探测落点（探测仍持有连接）时才
          // 恢复 previousUrl；已被其他流程接管时丢弃旧探测结果，不重新初始化
          // 连接，也不显示本次探测的失败提示。
          const probeOwnsConnection = backend.backendUrl === probedUrl
            && backend.connectionGeneration === probedConnectionGeneration;
          if (probeOwnsConnection) {
            await backend.init(previousUrl ?? undefined);
          } else {
            console.warn('Connection probe rollback discarded: backend connection was taken over during verifyAuth', {
              landed: backend.backendUrl,
              probed: probedUrl,
            });
          }
          setStatus('disconnected');
          setHealth(null);
          if (probeOwnsConnection) {
            toast(t('useBackendSettingsActions.backend-connection-failed-please-check-the-serve'), 'error');
          }
          return false;
        }
      });
      if (probeSucceeded) {
        // These are deliberate manual settings actions; app-start restoration is not moved here.
        void tryRestoreAuthFromBackend();
        void syncLocalGitHubTokenToBackend();
      }
    } finally {
      _connectionProbeInFlight = false;
      _connectionProbePromise = null;
      resolveProbe(settledOutcome);
    }
  }, [checkConnection, secretInput, state, t, toast, urlInput]);

  const syncToBackend = useCallback(async () => {
    if (!backend.isAvailable) {
      toast(t('useBackendSettingsActions.backend-not-available'), 'error');
      return;
    }
    // 审计修复（C45）：手动推送绑定发起会话（账号 ID + 会话代次）——推送等待
    // 期间切号后，旧会话的推送结果与提示不得应用到新会话（autoSync 的推送
    // 内部按发起时刻的账号与后端构造请求，这里复核结果归属）。
    const startedAccountId = accountIdKey(useAppStore.getState().user);
    const startedGeneration = getAccountSessionGeneration();
    setIsSyncingToBackend(true);
    try {
      // 复用 autoSync 的安全推送路径：先做非破坏性对账，且拒绝在分区未对齐
      // 时推送空仓库快照（手动同步绝不能绕过这两道防线）。forceVerify 确保
      // 不会因本地哈希未变或设置分片被跳过而误报成功。
      const pushed = await forceSyncToBackend({ reportFailures: true, forceVerify: true });
      // 推送等待期间切号：旧会话的结果绝不提交给新会话
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
      // 推送被安全防线推迟（未对账/空快照等）时不能提示成功。
      if (!pushed) {
        toast(t('useBackendSettingsActions.sync-failed'), 'error');
        return;
      }
      toast(t('useBackendSettingsActions.synced-to-backend-repos-v1-releases-v2-ai-config', { v1: state.repositories.length, v2: state.releases.length, v3: state.aiConfigs.length, v4: state.webdavConfigs.length }), 'success');
    } catch (error) {
      console.error('Sync to backend failed:', error);
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
      toast(`${t('useBackendSettingsActions.sync-failed')}: ${(error as Error).message}`, 'error');
    } finally {
      setIsSyncingToBackend(false);
    }
  }, [state, t, toast]);

  const syncFromBackend = useCallback(async () => {
    if (!backend.isAvailable) {
      toast(t('useBackendSettingsActions.backend-not-available'), 'error');
      return;
    }
    // 账号代次与后端目标校验（Issue #611 / C44）：确认弹窗打开前同时固定账号会话与后端目标，
    // 弹窗或拉取期间切号、换址或断开重连（含 X→Y→X）均中止拉取/应用。
    const startedAccountId = peekCurrentAccountId();
    const startedGeneration = getAccountSessionGeneration();
    const startedBackendUrl = backend.backendUrl ?? '';
    const startedConnectionGen = backend.connectionGeneration ?? 0;
    const confirmed = await confirm(
      t('useBackendSettingsActions.sync-from-backend'),
      t('useBackendSettingsActions.syncing-from-backend-will-overwrite-local-data-c'),
      { type: 'warning' },
    );
    if (!confirmed) return;
    if (!isCurrentAccountSession(startedAccountId, startedGeneration)) return;
    if ((backend.backendUrl ?? '') !== startedBackendUrl || (backend.connectionGeneration ?? 0) !== startedConnectionGen) {
      console.warn('Sync from backend aborted: backend target changed during confirmation');
      toast(t('useBackendSettingsActions.sync-failed'), 'error');
      return;
    }
    setIsSyncingFromBackend(true);
    try {
      const [repoData, releaseData, aiConfigData, webdavConfigData, settingsData] = await Promise.all([
        // R13 finding 107：无参调用依赖新契约的「Store 当前用户」分区固定——
        // 设置面板仅在已认证会话下渲染（App 层 !isAuthenticated 直接渲染
        // LoginScreen），且确认弹窗等待期间切号/登出会推进代次，被上方
        // isCurrentAccountSession 复核拦截（fetch 开始前返回），故 fetch 开始时
        // Store 必有当前用户，无需显式账号参数。
        backend.fetchRepositories(),
        backend.fetchReleases(),
        backend.fetchAIConfigs(),
        backend.fetchWebDAVConfigs(),
        backend.fetchSettings(),
      ]);
      // 仅比较账号 ID 无法识别 A→B→A：旧响应会把重新激活的工作区整段替换。
      if (!isCurrentAccountSession(startedAccountId, startedGeneration)) {
        return;
      }
      // 审计修复（C44）：后端地址或连接代次在拉取等待期间变化时丢弃响应并提示用户。
      if ((backend.backendUrl ?? '') !== startedBackendUrl || (backend.connectionGeneration ?? 0) !== startedConnectionGen) {
        console.warn('Sync from backend discarded: backend target changed during fetch');
        toast(t('useBackendSettingsActions.sync-failed'), 'error');
        return;
      }
      // 账号与分类状态必须同一快照（Issue #611 审计修复）：hook 渲染期捕获的
      // state 可能仍属于确认框之前的前一个账号；确认并拉取后重读当前完整状态，
      // 保证隐藏分类恢复的检查与写入基于同一账号快照。
      // 测试桩兼容：store 被整体 mock 且无 getState 时回退渲染期快照。
      const liveState = typeof useAppStore.getState === 'function'
        ? useAppStore.getState()
        : state;
      state.setRepositories(repoData.repositories, { allowEmpty: true });
      state.setReleases(releaseData.releases, { allowEmpty: true });
      state.setAIConfigs(aiConfigData);
      state.setWebDAVConfigs(webdavConfigData);
      const serverHidden = Array.isArray(settingsData.hiddenDefaultCategoryIds) ? settingsData.hiddenDefaultCategoryIds : [];
      for (const categoryId of serverHidden) if (typeof categoryId === 'string') state.hideDefaultCategory(categoryId);
      for (const categoryId of liveState.hiddenDefaultCategoryIds) {
        if (typeof categoryId === 'string' && !serverHidden.includes(categoryId)) state.showDefaultCategory(categoryId);
      }
      if (
        settingsData.defaultCategoryOverrides !== null
        && typeof settingsData.defaultCategoryOverrides === 'object'
        && !Array.isArray(settingsData.defaultCategoryOverrides)
      ) {
        useAppStore.setState({
          defaultCategoryOverrides: settingsData.defaultCategoryOverrides as Record<string, Partial<Category>>,
        });
      }
      toast(t('useBackendSettingsActions.synced-from-backend-repos-v1-releases-v2-ai-conf', { v1: repoData.repositories.length, v2: releaseData.releases.length, v3: aiConfigData.length, v4: webdavConfigData.length }), 'success');
    } catch (error) {
      console.error('Sync from backend failed:', error);
      if (isCurrentAccountSession(startedAccountId, startedGeneration)) {
        toast(`${t('useBackendSettingsActions.sync-failed')}: ${(error as Error).message}`, 'error');
      }
    } finally {
      setIsSyncingFromBackend(false);
    }
  }, [confirm, state, t, toast]);

  return {
    status,
    health,
    urlInput,
    secretInput,
    backendAvailable: backend.isAvailable,
    isSyncingToBackend,
    isSyncingFromBackend,
    setUrlInput,
    setSecretInput,
    testConnection,
    syncToBackend,
    syncFromBackend,
  };
};
