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

  const save = (entries: BatchStarHistoryEntry[]) => {
    const writingAccountId = accountRef.current;
    if (writingAccountId == null) return false;
    const next = normalizeBatchStarHistory(entries);
    try {
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
    return save([
      { text, generatedAt: Date.now() },
      ...history.filter(entry => entry.text !== text && entry.text !== previousText),
    ]);
  };

  const edit = (previousText: string, text: string) => {
    if (!text.trim()) return false;
    return save(history.map(entry => entry.text === previousText ? { ...entry, text } : entry));
  };

  return { history, historyError, record, edit };
}
