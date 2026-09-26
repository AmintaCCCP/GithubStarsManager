import { useCallback, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { forceSyncToBackend } from '../../../services/autoSync';
import type { GitHubRepoDetailRead } from '../../../services/githubApi';
import { createGitHubApiService } from '../../../services/githubApiFactory';
import type { Repository } from '../../../types';
import type { ImportedRepositoryCandidate } from '../../../types/repositoryImport';
import { extractRepositoryCandidates } from '../../../utils/repositoryImport';

const MAX_CANDIDATES = 50;
const RESOLVE_BATCH_SIZE = 5;

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
  const addRepository = useAppStore(state => state.addRepository);
  const [rows, setRows] = useState<BatchStarRow[]>([]);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [inputError, setInputError] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [isStarring, setIsStarring] = useState(false);
  const [syncError, setSyncError] = useState('');
  const busyRef = useRef(false);

  const preview = useCallback(async (text: string) => {
    if (busyRef.current) return;
    setInputError('');
    setSyncError('');
    setRows([]);
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
              error: error instanceof Error ? error.message : String(error),
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
  }, [githubToken]);

  const toggleRow = useCallback((index: number) => {
    if (busyRef.current) return;
    setRows(current => current.map((row, rowIndex) =>
      rowIndex === index && row.status === 'ready'
        ? { ...row, selected: !row.selected }
        : row
    ));
  }, []);

  const clearPreview = useCallback(() => {
    if (busyRef.current) return;
    setRows([]);
    setInputError('');
    setSyncError('');
    setDuplicateCount(0);
  }, []);

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
    try {
      for (const { row, index } of selected) {
        const detail = row.detail!;
        try {
          await api.starRepository(detail.owner.login, detail.name);
          addRepository({ ...detail, starred_at: new Date().toISOString() } as Repository);
          starredCount += 1;
          setRows(current => current.map((item, itemIndex) =>
            itemIndex === index ? { ...item, status: 'starred', selected: false } : item
          ));
        } catch (error) {
          setRows(current => current.map((item, itemIndex) => itemIndex === index
            ? { ...item, status: 'failed', selected: false, error: error instanceof Error ? error.message : String(error) }
            : item
          ));
        }
      }
      if (starredCount > 0) {
        try {
          await forceSyncToBackend();
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : String(error));
        }
      }
    } finally {
      busyRef.current = false;
      setIsStarring(false);
    }
  }, [addRepository, githubToken, rows]);

  return { rows, duplicateCount, inputError, isResolving, isStarring, syncError, preview, toggleRow, clearPreview, starSelected };
}
