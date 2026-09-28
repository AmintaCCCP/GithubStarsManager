import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { normalizeBatchStarHistory, readBatchStarHistory, writeBatchStarHistory, type BatchStarHistoryEntry } from '../../../services/batchStarHistoryStorage';

/** Keeps at most ten local inputs per GitHub account, newest generation first. */
export function useBatchStarHistory() {
  const accountId = useAppStore(state => state.user?.id);
  const accountRef = useRef(accountId);
  const [history, setHistory] = useState<BatchStarHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    accountRef.current = accountId;
    setHistoryError(false);
    try {
      setHistory(accountId == null ? [] : readBatchStarHistory(String(accountId)));
    } catch {
      setHistory([]);
      setHistoryError(true);
    }
  }, [accountId]);

  /** Applies an update to the list as stored right now, so a stale render cannot overwrite newer entries. */
  const save = (update: (entries: BatchStarHistoryEntry[]) => BatchStarHistoryEntry[]) => {
    const writingAccountId = accountRef.current;
    if (writingAccountId == null) return false;
    try {
      const next = normalizeBatchStarHistory(update(readBatchStarHistory(String(writingAccountId))));
      writeBatchStarHistory(String(writingAccountId), next);
      if (accountRef.current === writingAccountId) {
        setHistory(next);
        setHistoryError(false);
      }
      return true;
    } catch {
      if (accountRef.current === writingAccountId) setHistoryError(true);
      return false;
    }
  };

  const record = (text: string, previousText?: string) => {
    if (!text.trim()) return false;
    return save(entries => [
      { text, generatedAt: Date.now() },
      ...entries.filter(entry => entry.text !== text && entry.text !== previousText),
    ]);
  };

  const edit = (previousText: string, text: string) => {
    if (!text.trim()) return false;
    return save(entries => entries.map(entry => entry.text === previousText ? { ...entry, text } : entry));
  };

  return { history, historyError, record, edit };
}
