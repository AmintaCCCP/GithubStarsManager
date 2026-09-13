/**
 * Telegram 频道持久化层（独立 IndexedDB，仿 xTweetStorage）。
 *
 * 发现页 discoveryRepos 是会话级数据不持久化，但频道消息与仓库详情的获取
 * 成本高（每次抓取要走代抓通道翻 t.me 公开预览页并批量补全仓库详情），
 * 所以落在这里跨会话复用，refreshChannel 只做增量同步。
 */

import type { GitHubRepoDetailRead } from './githubApi';

/** 频道消息（正文缓存供"查看消息原文"离线渲染） */
export interface TelegramStoredMessage {
  /** 复合键 `<channel>/<messageId>`（跨频道唯一） */
  messageId: string;
  /** 频道名（不含 @） */
  channel: string;
  /** 频道显示名（来自页面 owner_name，抓取时快照） */
  displayName: string;
  /** 消息正文（t.me 公开预览输出的 HTML 片段） */
  content: string;
  /** 消息链接（https://t.me/<channel>/<id>） */
  htmlUrl: string;
  createdAt: string;
  /** 消息中提取到的仓库 full_name（小写键，对应 repos store） */
  repoFullNames: string[];
}

/**
 * 消息涉及的 GitHub 仓库（按 full_name 小写去重，一仓库一条）。
 * detail 为 null 且 lastFetchedAt 非空表示仓库不可用（删除/私有），到期重试。
 */
export interface TelegramStoredRepo {
  fullName: string;
  detail: GitHubRepoDetailRead | null;
  lastFetchedAt: string;
  /** 来源消息 = 发布时间最新的消息 */
  sourceMessageId: string;
  messageCreatedAt: string;
}

/** 单频道的分页游标：cursor 为下一页 ?before= 值（null = 尚未翻过页） */
export interface TelegramChannelPageState {
  cursor: string | null;
  /** 已翻到频道历史尽头（rel=prev 消失） */
  exhausted: boolean;
}

export interface TelegramSyncMeta {
  lastSyncedAt: string | null;
  /** 生成水位时的关注列表签名（规范化频道名排序拼接）；列表变化则水位失效 */
  followsSignature: string;
  /** 每个频道的翻页游标（跨会话保留，"加载更多"接着上次的位置继续拉） */
  pages: Record<string, TelegramChannelPageState>;
}

const DEFAULT_META: TelegramSyncMeta = {
  lastSyncedAt: null,
  followsSignature: '',
  pages: {},
};

const normalizeMeta = (meta: TelegramSyncMeta | null | undefined): TelegramSyncMeta => ({
  lastSyncedAt: meta?.lastSyncedAt ?? null,
  followsSignature: typeof meta?.followsSignature === 'string' ? meta.followsSignature : '',
  pages: meta?.pages && typeof meta.pages === 'object'
    ? Object.fromEntries(
        Object.entries(meta.pages)
          .filter(([, v]) => v && typeof v === 'object')
          .map(([k, v]) => [k, {
            cursor: typeof (v as TelegramChannelPageState).cursor === 'string'
              ? (v as TelegramChannelPageState).cursor : null,
            exhausted: Boolean((v as TelegramChannelPageState).exhausted),
          }]),
      )
    : {},
});

const DB_NAME = 'github-stars-telegram';
const DB_VERSION = 1;
const MESSAGES_STORE = 'messages';
const REPOS_STORE = 'repos';
const META_STORE = 'meta';

const canUseIndexedDB = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) db.createObjectStore(MESSAGES_STORE);
      if (!db.objectStoreNames.contains(REPOS_STORE)) db.createObjectStore(REPOS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('telegramStorage timeout')), timeoutMs),
  );
  return Promise.race([promise, timeoutPromise]);
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
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {
          // 事务可能已自行结束
        }
        reject(new Error('telegramStorage timeout'));
      }, timeoutMs);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      try {
        execute(tx.objectStore(storeName));
      } catch (e) {
        settle(() => reject(e instanceof Error ? e : new Error(String(e))));
        return;
      }
      tx.oncomplete = () => settle(resolve);
      tx.onerror = () => settle(() => reject(tx.error ?? new Error('transaction error')));
      tx.onabort = () => settle(() => reject(tx.error ?? new Error('transaction aborted')));
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
      const timer = setTimeout(() => reject(new Error('telegramStorage timeout')), timeoutMs);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => settle(() => resolve(req.result as T | undefined));
      req.onerror = () => settle(() => reject(req.error ?? new Error('request error')));
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
      const timer = setTimeout(() => {
        try {
          tx.abort();
        } catch {
          // 事务可能已自行结束
        }
        reject(new Error('telegramStorage timeout'));
      }, timeoutMs);
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const req = tx.objectStore(storeName).openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          settle(resolve);
          return;
        }
        try {
          visit(cursor.value, cursor.key);
        } catch (e) {
          settle(() => reject(e instanceof Error ? e : new Error(String(e))));
          return;
        }
        cursor.continue();
      };
      req.onerror = () => settle(() => reject(req.error ?? new Error('request error')));
    });
  } finally {
    db.close();
  }
};

export const telegramStorage = {
  /** 批量 upsert 消息（键为 `<channel>/<id>` 复合键）。写失败不抛出（不影响同步流程）。 */
  async saveMessages(messages: TelegramStoredMessage[]): Promise<void> {
    if (messages.length === 0) return;
    try {
      await runWriteTx(MESSAGES_STORE, 15_000, (store) => {
        for (const message of messages) store.put(message, message.messageId);
      });
    } catch (e) {
      console.warn('[telegramStorage] saveMessages failed:', e);
    }
  },

  /**
   * 读取失败向上抛出（不返回半量快照）：调用方会把它当作权威内存状态，
   * 缺失的键会让已知消息被当作新消息重建，进而用空详情覆盖已落盘数据。
   */
  async getAllMessages(): Promise<Map<string, TelegramStoredMessage>> {
    const result = new Map<string, TelegramStoredMessage>();
    if (!canUseIndexedDB()) return result;
    await runCursorTx(MESSAGES_STORE, 20_000, (value) => {
      const message = value as TelegramStoredMessage;
      if (message && typeof message.messageId === 'string') result.set(message.messageId, message);
    });
    return result;
  },

  /** 批量 upsert 仓库（键为 full_name 小写）。写失败不抛出（不影响同步流程）。 */
  async saveRepos(repos: TelegramStoredRepo[]): Promise<void> {
    if (repos.length === 0) return;
    try {
      await runWriteTx(REPOS_STORE, 15_000, (store) => {
        for (const repo of repos) store.put(repo, repo.fullName.toLowerCase());
      });
    } catch (e) {
      console.warn('[telegramStorage] saveRepos failed:', e);
    }
  },

  /** 读取失败向上抛出（同 getAllMessages：不返回半量快照）。 */
  async getAllRepos(): Promise<Map<string, TelegramStoredRepo>> {
    const result = new Map<string, TelegramStoredRepo>();
    if (!canUseIndexedDB()) return result;
    await runCursorTx(REPOS_STORE, 15_000, (value) => {
      const repo = value as TelegramStoredRepo;
      if (repo && typeof repo.fullName === 'string') result.set(repo.fullName.toLowerCase(), repo);
    });
    return result;
  },

  async getSyncMeta(): Promise<TelegramSyncMeta> {
    if (!canUseIndexedDB()) return { ...DEFAULT_META, pages: {} };
    try {
      const meta = await withTimeout(runGetTx<TelegramSyncMeta>(META_STORE, 5000, 'sync'), 6000);
      return normalizeMeta(meta);
    } catch (e) {
      console.warn('[telegramStorage] getSyncMeta failed:', e);
      return { ...DEFAULT_META, pages: {} };
    }
  },

  async saveSyncMeta(meta: TelegramSyncMeta): Promise<void> {
    try {
      await runWriteTx(META_STORE, 5000, (store) => {
        store.put(meta, 'sync');
      });
    } catch (e) {
      console.warn('[telegramStorage] saveSyncMeta failed:', e);
    }
  },

  /**
   * 同步轮次的原子落盘：messages + repos + meta（水位/游标）在同一个跨
   * store 读写事务中写入，任一失败整体回滚并抛出——调用方据此不推进内存
   * 游标，下轮同步会重新拉取该批消息，避免游标已推进但数据未落盘的缺口。
   */
  async saveSyncBatch(payload: {
    messages: TelegramStoredMessage[];
    repos: TelegramStoredRepo[];
    meta: TelegramSyncMeta;
  }): Promise<void> {
    if (!canUseIndexedDB()) throw new Error('IndexedDB unavailable');
    const db = await withTimeout(openDb(), 15_000);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([MESSAGES_STORE, REPOS_STORE, META_STORE], 'readwrite');
        const timer = setTimeout(() => {
          try {
            tx.abort();
          } catch {
            // 事务可能已自行结束
          }
          reject(new Error('telegramStorage timeout'));
        }, 15_000);
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        try {
          const messageStore = tx.objectStore(MESSAGES_STORE);
          for (const message of payload.messages) messageStore.put(message, message.messageId);
          const repoStore = tx.objectStore(REPOS_STORE);
          for (const repo of payload.repos) repoStore.put(repo, repo.fullName.toLowerCase());
          tx.objectStore(META_STORE).put(payload.meta, 'sync');
        } catch (e) {
          settle(() => reject(e instanceof Error ? e : new Error(String(e))));
          return;
        }
        tx.oncomplete = () => settle(resolve);
        tx.onerror = () => settle(() => reject(tx.error ?? new Error('transaction error')));
        tx.onabort = () => settle(() => reject(tx.error ?? new Error('transaction aborted')));
      });
    } finally {
      db.close();
    }
  },

  /**
   * 清空全部频道数据（设置页"删除发现页缓存/删除全部数据"调用）。
   * 错误向上抛出（调用方据此决定是否提示成功）；先清 meta：即使后续
   * store 清理失败，水位与游标已移除，下次同步退化为全量重扫可自愈。
   */
  async clearAll(): Promise<void> {
    if (!canUseIndexedDB()) return;
    await runWriteTx(META_STORE, 5000, (store) => store.clear());
    await runWriteTx(MESSAGES_STORE, 15_000, (store) => store.clear());
    await runWriteTx(REPOS_STORE, 15_000, (store) => store.clear());
  },
};
