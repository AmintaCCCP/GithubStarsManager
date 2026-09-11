/**
 * 阮一峰周刊频道持久化层（独立 IndexedDB，仿 discoveryAnalysisStorage）。
 *
 * 发现频道的 discoveryRepos 是会话级数据不持久化，但周刊数据集的构建成本高
 * （首次全量同步要遍历 ruanyf/weekly 的上万个 issue 并批量补全仓库详情），
 * 所以落在这里跨会话复用，refreshChannel 只做增量同步。
 */

import type { GitHubRepoDetailRead } from './githubApi';

/** 命中"开源"标题且正文含仓库链接的投稿 issue（正文缓存供"查看原贴"离线渲染）。 */
export interface WeeklyStoredIssue {
  number: number;
  title: string;
  body: string | null;
  labels: string[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  /** 正文中提取到的仓库 full_name（小写键，对应 repos store） */
  repoFullNames: string[];
}

/**
 * 投稿涉及的 GitHub 仓库（按 full_name 小写去重，一仓库一条）。
 * detail 为 null 且 lastFetchedAt 非空表示仓库不可用（删除/私有），到期重试。
 */
export interface WeeklyStoredRepo {
  /** 展示用 full_name（来自投稿链接或 API 返回的 canonical 大小写） */
  fullName: string;
  detail: GitHubRepoDetailRead | null;
  lastFetchedAt: string;
  /** 原贴 = 投稿时间最新的 issue */
  sourceIssueNumber: number;
  issueLabels: string[];
  issueCreatedAt: string;
}

export interface WeeklySyncMeta {
  lastSyncedAt: string | null;
}

const DB_NAME = 'github-stars-weekly';
const DB_VERSION = 1;
const ISSUES_STORE = 'issues';
const REPOS_STORE = 'repos';
const META_STORE = 'meta';

const canUseIndexedDB = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ISSUES_STORE)) db.createObjectStore(ISSUES_STORE);
      if (!db.objectStoreNames.contains(REPOS_STORE)) db.createObjectStore(REPOS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('weeklyIssuesStorage timeout')), timeoutMs),
  );
  return Promise.race([promise, timeoutPromise]);
};

/**
 * 事务超时守卫：返回一次性 settle 函数。超时未结算时 abort 事务并 reject
 * （Promise.race 无法中止后台事务，必须显式 abort 释放锁）；
 * complete/error/abort 先到时清理定时器并只结算一次。
 */
const guardTx = (
  tx: IDBTransaction,
  timeoutMs: number,
  reject: (reason: Error) => void,
): (() => boolean) => {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    try {
      tx.abort();
    } catch {
      // 事务可能已自行结束
    }
    reject(new Error('weeklyIssuesStorage timeout'));
  }, timeoutMs);
  return () => {
    if (settled) return false;
    settled = true;
    clearTimeout(timer);
    return true;
  };
};

/** 写事务：execute 同步发起所有写请求，事务 complete 即成功。 */
const runWriteTx = async (
  storeName: string,
  timeoutMs: number,
  execute: (store: IDBObjectStore) => void,
): Promise<void> => {
  if (!canUseIndexedDB()) throw new Error('IndexedDB unavailable');
  const db = await withTimeout(openDb(), timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const settle = guardTx(tx, timeoutMs, reject);
      try {
        execute(tx.objectStore(storeName));
      } catch (e) {
        if (settle()) reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      tx.oncomplete = () => {
        if (settle()) resolve();
      };
      tx.onerror = () => {
        if (settle()) reject(tx.error ?? new Error('transaction error'));
      };
      tx.onabort = () => {
        if (settle()) reject(tx.error ?? new Error('transaction aborted'));
      };
    });
  } finally {
    db.close();
  }
};

/** 读事务：单个请求取值（记录不存在时 resolve undefined）。 */
const runGetTx = async <T>(
  storeName: string,
  timeoutMs: number,
  key: IDBValidKey,
): Promise<T | undefined> => {
  if (!canUseIndexedDB()) throw new Error('IndexedDB unavailable');
  const db = await withTimeout(openDb(), timeoutMs);
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const settle = guardTx(tx, timeoutMs, reject);
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => {
        if (settle()) resolve(req.result as T | undefined);
      };
      req.onerror = () => {
        if (settle()) reject(req.error ?? new Error('request error'));
      };
    });
  } finally {
    db.close();
  }
};

/** 游标遍历：visit 逐条消费（键值对），遍历完成即结束。 */
const runCursorTx = async (
  storeName: string,
  timeoutMs: number,
  visit: (value: unknown, key: IDBValidKey) => void,
): Promise<void> => {
  if (!canUseIndexedDB()) throw new Error('IndexedDB unavailable');
  const db = await withTimeout(openDb(), timeoutMs);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const settle = guardTx(tx, timeoutMs, reject);
      const req = tx.objectStore(storeName).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          if (settle()) resolve();
          return;
        }
        try {
          visit(cursor.value, cursor.key);
        } catch (e) {
          if (settle()) reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        cursor.continue();
      };
      req.onerror = () => {
        if (settle()) reject(req.error ?? new Error('request error'));
      };
    });
  } finally {
    db.close();
  }
};

export const weeklyIssuesStorage = {
  /** 批量 upsert issue（键为 issue number）。写失败不抛出（不影响同步流程）。 */
  async saveIssues(issues: WeeklyStoredIssue[]): Promise<void> {
    if (issues.length === 0) return;
    try {
      await runWriteTx(ISSUES_STORE, 15_000, (store) => {
        for (const issue of issues) store.put(issue, issue.number);
      });
    } catch (e) {
      console.warn('[weeklyIssuesStorage] saveIssues failed:', e);
    }
  },

  async getAllIssues(): Promise<Map<number, WeeklyStoredIssue>> {
    const result = new Map<number, WeeklyStoredIssue>();
    if (!canUseIndexedDB()) return result;
    try {
      await runCursorTx(ISSUES_STORE, 20_000, (value) => {
        const issue = value as WeeklyStoredIssue;
        if (issue && typeof issue.number === 'number') result.set(issue.number, issue);
      });
    } catch (e) {
      console.warn('[weeklyIssuesStorage] getAllIssues failed:', e);
    }
    return result;
  },

  async getIssue(issueNumber: number): Promise<WeeklyStoredIssue | null> {
    if (!canUseIndexedDB()) return null;
    try {
      const issue = await withTimeout(runGetTx<WeeklyStoredIssue>(ISSUES_STORE, 5000, issueNumber), 6000);
      return issue ?? null;
    } catch (e) {
      console.warn('[weeklyIssuesStorage] getIssue failed:', e);
      return null;
    }
  },

  /** 批量 upsert 仓库（键为 full_name 小写）。写失败不抛出（不影响同步流程）。 */
  async saveRepos(repos: WeeklyStoredRepo[]): Promise<void> {
    if (repos.length === 0) return;
    try {
      await runWriteTx(REPOS_STORE, 15_000, (store) => {
        for (const repo of repos) store.put(repo, repo.fullName.toLowerCase());
      });
    } catch (e) {
      console.warn('[weeklyIssuesStorage] saveRepos failed:', e);
    }
  },

  async getAllRepos(): Promise<Map<string, WeeklyStoredRepo>> {
    const result = new Map<string, WeeklyStoredRepo>();
    if (!canUseIndexedDB()) return result;
    try {
      await runCursorTx(REPOS_STORE, 15_000, (value, key) => {
        const repo = value as WeeklyStoredRepo;
        if (repo && typeof repo.fullName === 'string') result.set(String(key), repo);
      });
    } catch (e) {
      console.warn('[weeklyIssuesStorage] getAllRepos failed:', e);
    }
    return result;
  },

  async getSyncMeta(): Promise<WeeklySyncMeta> {
    if (!canUseIndexedDB()) return { lastSyncedAt: null };
    try {
      const meta = await withTimeout(runGetTx<WeeklySyncMeta>(META_STORE, 5000, 'sync'), 6000);
      return meta ?? { lastSyncedAt: null };
    } catch (e) {
      console.warn('[weeklyIssuesStorage] getSyncMeta failed:', e);
      return { lastSyncedAt: null };
    }
  },

  async saveSyncMeta(meta: WeeklySyncMeta): Promise<void> {
    try {
      await runWriteTx(META_STORE, 5000, (store) => {
        store.put(meta, 'sync');
      });
    } catch (e) {
      console.warn('[weeklyIssuesStorage] saveSyncMeta failed:', e);
    }
  },

  /**
   * 清空全部周刊数据（设置页"删除发现页缓存/删除全部数据"调用）。
   * 错误向上抛出（调用方据此决定是否提示成功）；先清 meta：即使后续
   * store 清理失败，同步水位已移除，下次同步退化为全量重扫可自愈。
   */
  async clearAll(): Promise<void> {
    if (!canUseIndexedDB()) return;
    await runWriteTx(META_STORE, 5000, (store) => store.clear());
    await runWriteTx(ISSUES_STORE, 15_000, (store) => store.clear());
    await runWriteTx(REPOS_STORE, 15_000, (store) => store.clear());
  },
};
