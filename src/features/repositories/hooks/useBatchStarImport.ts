import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import {
  getAccountSessionGeneration,
  isCurrentAccount,
  isCurrentAccountSession,
  peekCurrentAccountId,
} from '../../../store/helpers/accountWorkspace';
import { forceSyncToBackend, markPendingAccountSync, withAccountSwitchGuardSync } from '../../../services/autoSync';
import { backend } from '../../../services/backendAdapter';
import { translateBatch } from '../../../services/translateService';
import { GitHubTokenPermissionError, type GitHubRepoDetailRead } from '../../../services/githubApi';
import { makeT } from '../../../i18n/useT';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import type { Repository } from '../../../types';
import type { ImportedRepositoryCandidate } from '../../../types/repositoryImport';
import { extractRepositoryCandidates } from '../../../utils/repositoryImport';
import { isLikelySameLanguage } from '../../../utils/textLanguage';

const MAX_CANDIDATES = 50;
const RESOLVE_BATCH_SIZE = 5;

/**
 * 审计修复：星标请求已在 GitHub 成功（不可撤销）而会话恰好切换时，该星标
 * 必须记录到发起账号的工作区——发起账号已重新激活（A→B→A，切号簿记已把
 * 归档换入实时）则写入实时列表；仍停放则更新其归档快照（快照不存在时绝不
 * 创建/覆盖）。与 useRepositoryCardActions.unstar 的 C29 模式一致：切回后
 * 由待同步标记驱动的补推/拉取把远端已接受的星标收敛进该账号的同步状态。
 */
const recordStarToOwnerSession = (ownerAccountId: string | null, repository: Repository): void => {
  if (!ownerAccountId || typeof useAppStore.setState !== 'function') return;
  if (isCurrentAccount(ownerAccountId)) {
    withAccountSwitchGuardSync(() => {
      useAppStore.getState().addRepository(repository);
    });
    return;
  }
  withAccountSwitchGuardSync(() => {
    useAppStore.setState((state) => {
      const parked = state.accountWorkspaces?.[ownerAccountId];
      if (!parked) return state;
      if (parked.repositories.some((repo) => repo.id === repository.id)) return state;
      return {
        accountWorkspaces: {
          ...state.accountWorkspaces,
          [ownerAccountId]: { ...parked, repositories: [...parked.repositories, repository] },
        },
      };
    });
  });
};

export interface BatchStarRow {
  candidate: ImportedRepositoryCandidate;
  detail?: GitHubRepoDetailRead;
  status: 'ready' | 'already-starred' | 'unavailable' | 'failed' | 'starred';
  selected: boolean;
  error?: string;
}

/** Resolves pasted repository links, then applies only the user's selected stars. */
export function useBatchStarImport() {
  const githubToken = useAppStore(state => state.githubToken);
  const language = useAppStore(state => state.language);
  const addRepository = useAppStore(state => state.addRepository);
  const [rows, setRows] = useState<BatchStarRow[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [inputError, setInputError] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isStarring, setIsStarring] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationsVisible, setTranslationsVisible] = useState(false);
  const busyRef = useRef(false);

  /** Clears the translation cache, failure message and visible-translation flag. */
  const resetTranslations = useCallback(() => {
    setTranslations({});
    setTranslationError('');
    setTranslationsVisible(false);
  }, []);

  /** Parses pasted text into candidate repositories and resolves their live
   *  details and star status without touching the GitHub account. */
  const preview = useCallback(async (text: string) => {
    if (busyRef.current) return;
    setInputError('');
    setSyncError('');
    setRows([]);
    resetTranslations();
    if (!githubToken) {
      setInputError('sign-in');
      return;
    }

    const extracted = extractRepositoryCandidates(text);
    if (extracted.inputErrors.length > 0) {
      setInputError(extracted.inputErrors[0].code);
      return;
    }
    const candidates = extracted.candidates.filter(candidate => candidate.status !== 'duplicate');
    setDuplicateCount(extracted.stats.duplicates);
    if (candidates.length === 0) {
      setInputError('no-repositories');
      return;
    }
    if (candidates.length > MAX_CANDIDATES) {
      setInputError('too-many-repositories');
      return;
    }

    busyRef.current = true;
    setIsResolving(true);
    try {
      const api = createGitHubApiService(githubToken);
      const resolved: BatchStarRow[] = [];
      const canonicalNames = new Set<string>();
      let canonicalDuplicates = 0;
      for (let start = 0; start < candidates.length; start += RESOLVE_BATCH_SIZE) {
        const batch = candidates.slice(start, start + RESOLVE_BATCH_SIZE);
        const batchRows = await Promise.all(batch.map(async (candidate): Promise<BatchStarRow> => {
          if (candidate.status === 'invalid') {
            return { candidate, status: 'unavailable', selected: false };
          }
          const [owner, repo] = candidate.repositoryFullName.split('/');
          try {
            const detail = await api.getRepositoryDetails(owner, repo);
            const alreadyStarred = await api.isRepositoryStarred(detail.owner.login, detail.name);
            const renamed = detail.full_name.toLowerCase() !== candidate.repositoryFullName.toLowerCase();
            return {
              candidate,
              detail,
              status: alreadyStarred ? 'already-starred' : 'ready',
              selected: !alreadyStarred && candidate.confidence === 'high' && !renamed,
            };
          } catch (error) {
            return {
              candidate,
              status: 'unavailable',
              selected: false,
              error: error instanceof GitHubTokenPermissionError
                ? makeT(language, 'repositories')('batchStar.token-permission-error')
                : error instanceof Error ? error.message : String(error),
            };
          }
        }));
        for (const row of batchRows) {
          const canonicalName = row.detail?.full_name.toLowerCase();
          if (canonicalName && canonicalNames.has(canonicalName)) {
            canonicalDuplicates += 1;
            continue;
          }
          if (canonicalName) canonicalNames.add(canonicalName);
          resolved.push(row);
        }
        setDuplicateCount(extracted.stats.duplicates + canonicalDuplicates);
        setRows([...resolved]);
      }
    } finally {
      busyRef.current = false;
      setIsResolving(false);
    }
  }, [githubToken, language, resetTranslations]);

  /** Flips the selection of a starable row; other statuses cannot be toggled. */
  const toggleRow = useCallback((index: number) => {
    if (busyRef.current) return;
    setRows(current => current.map((row, rowIndex) =>
      rowIndex === index && row.status === 'ready'
        ? { ...row, selected: !row.selected }
        : row
    ));
  }, []);

  /** Selects every starable row, leaving starred and unavailable rows untouched. */
  const selectAll = useCallback(() => {
    if (busyRef.current) return;
    setRows(current => current.map(row =>
      row.status === 'ready' ? { ...row, selected: true } : row
    ));
  }, []);

  /** Inverts the selection of every starable row. */
  const invertSelection = useCallback(() => {
    if (busyRef.current) return;
    setRows(current => current.map(row =>
      row.status === 'ready' ? { ...row, selected: !row.selected } : row
    ));
  }, []);

  /** Drops the preview results together with every transient error and
   *  translation state. */
  const clearPreview = useCallback(() => {
    if (busyRef.current) return;
    setRows([]);
    setInputError('');
    setSyncError('');
    setDuplicateCount(0);
    resetTranslations();
  }, [resetTranslations]);

  /**
   * 在原文与译文之间切换。切回原文（回退）只翻转展示开关，译文缓存保留，
   * 再次切换立即可见；首次翻译时只请求与界面语言不同且尚未翻译过的描述，
   * 同语言或译文为空的描述保持原文。
   */
  const toggleTranslations = useCallback(async () => {
    if (busyRef.current) return;
    if (translationsVisible) {
      setTranslationsVisible(false);
      return;
    }

    const targets: Array<{ fullName: string; description: string }> = [];
    rows.forEach(row => {
      const detail = row.detail;
      if (!detail?.description) return;
      if (isLikelySameLanguage(detail.description, language)) return;
      if (detail.full_name in translations) return;
      targets.push({ fullName: detail.full_name, description: detail.description });
    });
    if (targets.length > 0) {
      busyRef.current = true;
      setIsTranslating(true);
      setTranslationError('');
      try {
        const results = await translateBatch(
          targets.map(target => target.description),
          language,
          undefined,
          undefined,
          'plain',
        );
        setTranslations(current => {
          const next = { ...current };
          results.forEach((result, index) => {
            const target = targets[index];
            if (result.translatedText?.trim() && result.translatedText !== target.description) {
              next[target.fullName] = result.translatedText;
            }
          });
          return next;
        });
      } catch (error) {
        setTranslationError(error instanceof Error ? error.message : String(error));
        return;
      } finally {
        busyRef.current = false;
        setIsTranslating(false);
      }
    }
    setTranslationsVisible(true);
  }, [language, rows, translations, translationsVisible]);

  /** Stars the selected repositories one by one, records each result
   *  independently, then syncs the store to the backend when at least one
   *  star succeeded. */
  const starSelected = useCallback(async () => {
    if (busyRef.current || !githubToken) return;
    const selected = rows.map((row, index) => ({ row, index }))
      .filter(({ row }) => row.status === 'ready' && row.selected && row.detail);
    if (selected.length === 0) return;

    busyRef.current = true;
    setIsStarring(true);
    setSyncError('');
    const api = createGitHubApiService(githubToken);
    let starredCount = 0;
    // 辅助防线（Issue #611）：批量导入可达分钟级；切号后中止队列并停止写入
    const jobAccountId = peekCurrentAccountId();
    const jobGeneration = getAccountSessionGeneration();
    // 审计修复（C29 同款）：发起时保存目标后端地址，供切号后登记 (账号, 后端)
    // 待同步标记——切号流程可能更换后端连接，调用时读取会拿到新地址。
    const startedBackendUrl = backend.backendUrl ?? '';
    try {
      for (const { row, index } of selected) {
        const detail = row.detail!;
        // A→B→A 后账号 ID 与开始时相同，必须同时比较会话代次。
        if (!isCurrentAccountSession(jobAccountId, jobGeneration)) {
          setSyncError('');
          break;
        }
        try {
          await api.starRepository(detail.owner.login, detail.name);
          if (!isCurrentAccountSession(jobAccountId, jobGeneration)) {
            // 审计修复：星标已按发起账号在 GitHub 完成（不可撤销）——会话切换
            // 后仍必须记录到发起账号的工作区（实时或归档），并登记待同步标记，
            // 切回 A 后由补推/拉取收敛；绝不静默丢失已成功的远端星标。
            recordStarToOwnerSession(jobAccountId, { ...detail, starred_at: new Date().toISOString() } as Repository);
            if (jobAccountId) markPendingAccountSync(jobAccountId, startedBackendUrl);
            break;
          }
          addRepository({ ...detail, starred_at: new Date().toISOString() } as Repository);
          starredCount += 1;
          setRows(current => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'starred', selected: false } : item
          ));
        } catch (error) {
          if (!isCurrentAccountSession(jobAccountId, jobGeneration)) break;
          setRows(current => current.map((item, itemIndex) => itemIndex === index
            ? { ...item, status: 'failed', selected: false, error: error instanceof GitHubTokenPermissionError
              ? makeT(language, 'repositories')('batchStar.token-permission-error')
              : error instanceof Error ? error.message : String(error) }
            : item
          ));
        }
      }
      // 审计修复（C28）：会话不匹配时直接退出整个导入任务——尾部同步绝不能
      // 在切号后执行：forceSyncToBackend 会清除共享防抖计时器/待推标志，并以
      // 新账号请求头推送新账号工作区。已完成的星标由上方分支逐条记录进发起
      // 账号的工作区与待同步状态（切回后先补推再拉取收敛）；剩余候选不再尝试，
      // 只能在 A 的同步上下文中重新发起。
      if (!isCurrentAccountSession(jobAccountId, jobGeneration)) {
        return;
      }
      if (starredCount > 0) {
        try {
          await forceSyncToBackend({ reportFailures: true });
        } catch (error) {
          if (isCurrentAccountSession(jobAccountId, jobGeneration)) {
            setSyncError(error instanceof Error ? error.message : String(error));
          }
        }
      }
    } finally {
      busyRef.current = false;
      setIsStarring(false);
    }
  }, [addRepository, githubToken, language, rows]);

  return {
    rows, duplicateCount, inputError, isResolving, isStarring, syncError,
    translations, isTranslating, translationError, translationsVisible,
    preview, toggleRow, selectAll, invertSelection, clearPreview, starSelected, toggleTranslations,
  };
}
