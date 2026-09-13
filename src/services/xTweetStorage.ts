/**
 * X 推文频道持久化层（独立 IndexedDB，仿 weeklyIssuesStorage）。
 *
 * 发现页 discoveryRepos 是会话级数据不持久化，但推文与仓库详情的获取成本高
 * （每次刷新要跨 RSSHub 实例抓取多位博主的时间线并批量补全仓库详情），
 * 所以落在这里跨会话复用，refreshChannel 只做增量同步。
 */

import type { GitHubRepoDetailRead } from './githubApi';

/** 关注博主的推文（正文缓存供"查看原贴"离线渲染） */
export interface XStoredTweet {
  tweetId: string;
  handle: string;
  displayName: string;
  /** 推文正文（RSS 输出的 HTML 片段） */
  content: string;
  htmlUrl: string;
  createdAt: string;
  /** 推文中提取到的仓库 full_name（小写键，对应 repos store） */
  repoFullNames: string[];
}

/**
 * 推文涉及的 GitHub 仓库（按 full_name 小写去重，一仓库一条）。
 * detail 为 null 且 lastFetchedAt 非空表示仓库不可用（删除/私有），到期重试。
 */
export interface XStoredRepo {
  fullName: string;
  detail: GitHubRepoDetailRead | null;
  lastFetchedAt: string;
  /** 来源推文 = 发布时间最新的推文 */
  sourceTweetId: string;
  tweetCreatedAt: string;
}

/** 单博主的 GraphQL 翻页游标：cursor 为下一页请求参数（null = 尚未翻过页） */
export interface XTweetPageState {
  cursor: string | null;
  /** 已翻到时间线尽头（无 bottom cursor） */
  exhausted: boolean;
}

export interface XTweetSyncMeta {
  lastSyncedAt: string | null;
  /** 生成水位时的关注列表签名（规范化 handle 排序拼接）；列表变化则水位失效 */
  followsSignature: string;
  /** 鉴权指纹（不同 Cookie 切换时清理推文与仓库缓存） */
  authFingerprint?: string;
  /** 鉴权路径的分页游标（跨会话保留，"加载更多"接着上次的位置继续拉） */
  pages: Record<string, XTweetPageState>;
  /** 已解析的博主用户 ID（handle → rest_id，鉴权 GraphQL 路径复用） */
  userIds: Record<string, string>;
  /** 上次从线上 bundle 提取的 GraphQL queryId（防 queryId 轮换的缓存） */
  queryIds: Record<string, string>;
}

const createDefaultMeta = (): XTweetSyncMeta => ({
  lastSyncedAt: null,
  followsSignature: '',
  authFingerprint: '',
  pages: {},
  userIds: {},
  queryIds: {},
});

const normalizeStringRecord = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .map(([k, v]) => [k, v as string]),
  );
};

const normalizeMeta = (meta: XTweetSyncMeta | null | undefined): XTweetSyncMeta => ({
  lastSyncedAt: meta?.lastSyncedAt ?? null,
  followsSignature: typeof meta?.followsSignature === 'string' ? meta.followsSignature : '',
  authFingerprint: typeof meta?.authFingerprint === 'string' ? meta.authFingerprint : '',
  pages: meta?.pages && typeof meta.pages === 'object'
    ? Object.fromEntries(
        Object.entries(meta.pages)
          .filter(([, v]) => v && typeof v === 'object')
          .map(([k, v]) => [k, {
            cursor: typeof (v as XTweetPageState).cursor === 'string'
              ? (v as XTweetPageState).cursor : null,
            exhausted: Boolean((v as XTweetPageState).exhausted),
          }]),
      )
    : {},
  userIds: normalizeStringRecord(meta?.userIds),
  queryIds: normalizeStringRecord(meta?.queryIds),
});

const DB_NAME = 'github-stars-x-tweet';
const DB_VERSION = 1;
const TWEETS_STORE = 'tweets';
const REPOS_STORE = 'repos';
const META_STORE = 'meta';

const canUseIndexedDB = (): boolean =>
  typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';

const openDb = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TWEETS_STORE)) db.createObjectStore(TWEETS_STORE);
      if (!db.objectStoreNames.contains(REPOS_STORE)) db.createObjectStore(REPOS_STORE);
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  const timeoutPromise = new Promise<T>((_, reject) =>
    setTimeout(() => reject(new Error('xTweetStorage timeout')), timeoutMs),
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
        reject(new Error('xTweetStorage timeout'));
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
      const timer = setTimeout(() => reject(new Error('xTweetStorage timeout')), timeoutMs);
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
        reject(new Error('xTweetStorage timeout'));
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

export const xTweetStorage = {
  /** 批量 upsert 推文（键为 tweetId）。写失败不抛出（不影响同步流程）。 */
  async saveTweets(tweets: XStoredTweet[]): Promise<void> {
    if (tweets.length === 0) return;
    try {
      await runWriteTx(TWEETS_STORE, 15_000, (store) => {
        for (const tweet of tweets) store.put(tweet, tweet.tweetId);
      });
    } catch (e) {
      console.warn('[xTweetStorage] saveTweets failed:', e);
    }
  },

  /**
   * 读取失败向上抛出（不返回半量快照）：调用方会把它当作权威内存状态，
   * 缺失的键会让已知推文被当作新推文重建，进而用空详情覆盖已落盘数据。
   */
  async getAllTweets(): Promise<Map<string, XStoredTweet>> {
    const result = new Map<string, XStoredTweet>();
    if (!canUseIndexedDB()) return result;
    await runCursorTx(TWEETS_STORE, 20_000, (value) => {
      const tweet = value as XStoredTweet;
      if (tweet && typeof tweet.tweetId === 'string') result.set(tweet.tweetId, tweet);
    });
    return result;
  },

  /** 批量 upsert 仓库（键为 full_name 小写）。写失败不抛出（不影响同步流程）。 */
  async saveRepos(repos: XStoredRepo[]): Promise<void> {
    if (repos.length === 0) return;
    try {
      await runWriteTx(REPOS_STORE, 15_000, (store) => {
        for (const repo of repos) store.put(repo, repo.fullName.toLowerCase());
      });
    } catch (e) {
      console.warn('[xTweetStorage] saveRepos failed:', e);
    }
  },

  /** 读取失败向上抛出（同 getAllTweets：不返回半量快照）。 */
  async getAllRepos(): Promise<Map<string, XStoredRepo>> {
    const result = new Map<string, XStoredRepo>();
    if (!canUseIndexedDB()) return result;
    await runCursorTx(REPOS_STORE, 15_000, (value) => {
      const repo = value as XStoredRepo;
      if (repo && typeof repo.fullName === 'string') result.set(repo.fullName.toLowerCase(), repo);
    });
    return result;
  },

  async getSyncMeta(): Promise<XTweetSyncMeta> {
    // 无 IndexedDB 环境视作记录不存在，返回全新默认值（独立嵌套对象，
    // 避免浅拷贝共享 DEFAULT_META.pages/userIds/queryIds 造成跨调用污染）；
    // 真实读取失败向上抛出，避免调用方误判游标。
    if (!canUseIndexedDB()) return createDefaultMeta();
    const meta = await withTimeout(runGetTx<XTweetSyncMeta>(META_STORE, 5000, 'sync'), 6000);
    if (meta === undefined) return createDefaultMeta();
    return normalizeMeta(meta);
  },

  async saveSyncMeta(meta: XTweetSyncMeta): Promise<void> {
    try {
      await runWriteTx(META_STORE, 5000, (store) => {
        store.put(meta, 'sync');
      });
    } catch (e) {
      console.warn('[xTweetStorage] saveSyncMeta failed:', e);
    }
  },

  /**
   * 同步轮次的原子落盘：tweets + repos + meta（水位/取尽标记）在同一个跨
   * store 读写事务中写入，任一失败整体回滚并抛出——调用方据此不推进内存
   * 游标，下轮同步会重新拉取该批推文，避免水位已推进但数据未落盘的缺口。
   */
  async saveSyncBatch(payload: {
    tweets: XStoredTweet[];
    repos: XStoredRepo[];
    meta: XTweetSyncMeta;
  }): Promise<void> {
    if (!canUseIndexedDB()) throw new Error('IndexedDB unavailable');
    const db = await withTimeout(openDb(), 15_000);
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([TWEETS_STORE, REPOS_STORE, META_STORE], 'readwrite');
        const timer = setTimeout(() => {
          try {
            tx.abort();
          } catch {
            // 事务可能已自行结束
          }
          reject(new Error('xTweetStorage timeout'));
        }, 15_000);
        let settled = false;
        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        try {
          const tweetStore = tx.objectStore(TWEETS_STORE);
          for (const tweet of payload.tweets) tweetStore.put(tweet, tweet.tweetId);
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
   * 清空全部推文数据（设置页"删除发现页缓存/删除全部数据"调用）。
   * 错误向上抛出（调用方据此决定是否提示成功）；先清 meta：即使后续
   * store 清理失败，同步水位已移除，下次同步退化为全量重扫可自愈。
   */
  async clearAll(): Promise<void> {
    if (!canUseIndexedDB()) return;
    await runWriteTx(META_STORE, 5000, (store) => store.clear());
    await runWriteTx(TWEETS_STORE, 15_000, (store) => store.clear());
    await runWriteTx(REPOS_STORE, 15_000, (store) => store.clear());
  },
};
