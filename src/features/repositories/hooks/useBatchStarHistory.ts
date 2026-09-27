import { useEffect, useState } from 'react';
import { useAppStore } from '../../../store/useAppStore';
import { normalizeBatchStarHistory, readBatchStarHistory, writeBatchStarHistory, type BatchStarHistoryEntry } from '../../../services/batchStarHistoryStorage';

/** Keeps at most ten local inputs per GitHub account, newest generation first. */
export function useBatchStarHistory() {
  const accountId = useAppStore(state => state.user?.id);
  const [history, setHistory] = useState<BatchStarHistoryEntry[]>([]);
  const [historyError, setHistoryError] = useState(false);

  useEffect(() => {
    setHistoryError(false);
    try {
      setHistory(accountId == null ? [] : readBatchStarHistory(String(accountId)));
    } catch {
      setHistory([]);
      setHistoryError(true);
    }
  }, [accountId]);

  const save = (entries: BatchStarHistoryEntry[]) => {
    if (accountId == null) return false;
    const next = normalizeBatchStarHistory(entries);
    try {
      writeBatchStarHistory(String(accountId), next);
      setHistory(next);
      setHistoryError(false);
      return true;
    } catch {
      setHistoryError(true);
      return false;
    }
  };

  const record = (text: string, previousText?: string) => {
    if (!text.trim()) return;
    save([
      { text, generatedAt: Date.now() },
      ...history.filter(entry => entry.text !== text && entry.text !== previousText),
    ]);
  };

  const edit = (previousText: string, text: string) => {
    if (!text.trim()) return;
    return save(history.map(entry => entry.text === previousText ? { ...entry, text } : entry));
  };

  return { history, historyError, record, edit };
}
