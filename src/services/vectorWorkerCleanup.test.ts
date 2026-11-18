import { describe, expect, it, vi } from 'vitest';

/**
 * R5 审计修复（CodeRabbit 发现 2）：/cleanup 的账号范围约定回归。
 *
 * 多账号共享同一 VECTORIZE 索引时，向量 ID 为 `${accountId}:${repoId}` 前缀
 * 形态，单租户时代遗留 legacy 无前缀向量。Worker /cleanup 必须支持：
 * - accountPrefix：只删除该账号前缀的向量，其他账号前缀向量一律保留；
 * - includeLegacy=true：才允许删除 legacy 无前缀向量；
 * - 两个参数都不携带：只清理 legacy 无前缀向量（带前缀向量归属不可证明）。
 * /status 仅在部署方声明 accountId 元数据索引就绪时携带 accountScopedCleanup: true。
 *
 * 两份部署产物（Dashboard 粘贴版 worker.js 与 wrangler 入口 src/index.ts）
 * 必须保持同一契约，这里用同一组用例参数化覆盖。
 */

interface CleanupEnv {
  VECTORIZE: {
    describe: () => Promise<{ vectorCount: number; dimensions: number }>;
    query: () => Promise<{ matches: Array<{ id: string; score: number }> }>;
    deleteByIds: (ids: string[]) => Promise<void>;
    upsert: (vectors: unknown[]) => Promise<void>;
  };
  AUTH_TOKEN: string;
  ACCOUNT_METADATA_INDEXED?: string;
}

type WorkerModule = {
  default: {
    fetch: (request: Request, env: CleanupEnv, ctx?: unknown) => Promise<Response>;
  };
};

const loadWorker = async (modulePath: string): Promise<WorkerModule> => (
  // 运行时动态加载部署产物；路径仅为字符串参数，TS 不做模块解析（产物在
  // 仓库根 cloudflare-worker/ 下，不在前端 tsconfig 项目内）。
  await (vi as unknown as { importActual: (path: string) => Promise<unknown> })
    .importActual(modulePath) as WorkerModule
);

const workerEntrypoints = [
  { name: 'cloudflare-worker/worker.js (Dashboard 粘贴版)', path: '../../cloudflare-worker/worker.js' },
  { name: 'cloudflare-worker/src/index.ts (wrangler 入口)', path: '../../cloudflare-worker/src/index.ts' },
] as const;

const AUTHED_HEADERS = { Authorization: 'Bearer worker-token', 'Content-Type': 'application/json' };

const makeEnv = (indexIds: string[]): CleanupEnv & { deleted: string[]; queries: number } => {
  const deleted: string[] = [];
  let queries = 0;
  return {
    AUTH_TOKEN: 'worker-token',
    ACCOUNT_METADATA_INDEXED: 'true',
    deleted,
    queries,
    get VECTORIZE() {
      return {
        describe: async () => ({ vectorCount: indexIds.length, dimensions: 3 }),
        query: async () => {
          queries += 1;
          // 零向量采样：返回当前索引中尚未被删除的向量（模拟采样轮次收敛）
          return { matches: indexIds.filter((id) => !deleted.includes(id)).map((id) => ({ id, score: 0.01 })) };
        },
        deleteByIds: async (ids: string[]) => {
          deleted.push(...ids);
        },
        upsert: async () => undefined,
      };
    },
  } as CleanupEnv & { deleted: string[]; queries: number };
};

const postCleanup = async (worker: WorkerModule, env: CleanupEnv, body: unknown): Promise<{ deleted: number }> => {
  const request = new Request('https://worker.example.com/cleanup', {
    method: 'POST',
    headers: AUTHED_HEADERS,
    body: JSON.stringify(body),
  });
  const response = await worker.default.fetch(request, env);
  expect(response.status).toBe(200);
  const payload = await response.json() as { success: boolean; deleted: number };
  expect(payload.success).toBe(true);
  return payload;
};

const getStatus = async (worker: WorkerModule, env: CleanupEnv): Promise<{ accountScopedCleanup?: boolean }> => {
  const request = new Request('https://worker.example.com/status', { headers: AUTHED_HEADERS });
  const response = await worker.default.fetch(request, env);
  const payload = await response.json() as { success: boolean } & { accountScopedCleanup?: boolean };
  expect(payload.success).toBe(true);
  return payload;
};

describe.each(workerEntrypoints)('vector worker /cleanup account scoping — $name', ({ path }) => {
  it('deletes only the account-prefixed vectors when accountPrefix is provided', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv([
      '1:101', '1:102',          // 当前账号（发起 cleanup 的设备）
      '2:201', '2:202',          // 其他设备上传的其他账号向量——绝不删除
      '999:301',                 // 本机未登记的账号前缀——绝不删除
    ]);
    const result = await postCleanup(worker, env, {
      keepIds: ['1:101'],        // 102 已被 unstar → 可删除
      accountPrefix: '1',
    });

    expect(result.deleted).toBe(1);
    expect(env.deleted).toEqual(['1:102']);
  });

  it('never deletes legacy unscoped vectors unless includeLegacy=true', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101', '42', '43']);
    const scoped = await postCleanup(worker, env, {
      keepIds: ['1:101'],
      accountPrefix: '1',
    });
    // legacy 向量属于单租户时代的唯一所有者：未显式授权时保留
    expect(scoped.deleted).toBe(0);
    expect(env.deleted).toEqual([]);

    const withLegacy = await postCleanup(worker, env, {
      keepIds: ['1:101', '42'],
      accountPrefix: '1',
      includeLegacy: true,
    });
    expect(withLegacy.deleted).toBe(1);
    expect(env.deleted).toEqual(['43']);
  });

  it('keeps sampling when a round misses the stale vector instead of reporting complete', async () => {
    const worker = await loadWorker(path);
    const indexIds = ['1:101', '1:102', '1:103', '1:104'];
    const deleted: string[] = [];
    let queries = 0;
    const env = {
      AUTH_TOKEN: 'worker-token',
      VECTORIZE: {
        describe: async () => ({ vectorCount: indexIds.length, dimensions: 3 }),
        query: async () => {
          queries += 1;
          const remaining = indexIds.filter((id) => !deleted.includes(id));
          // 第一轮采样故意漏掉陈旧向量 1:104：旧逻辑会直接 break 并返回 0
          const window = queries === 1 ? remaining.filter((id) => id !== '1:104') : remaining;
          return { matches: window.map((id) => ({ id, score: 0 })) };
        },
        deleteByIds: async (ids: string[]) => {
          deleted.push(...ids);
        },
        upsert: async () => undefined,
      },
    } as CleanupEnv;

    const result = await postCleanup(worker, env, {
      keepIds: ['1:101', '1:102', '1:103'],
      accountPrefix: '1',
    });

    expect(result.deleted).toBe(1);
    expect(deleted).toEqual(['1:104']);
  });

  it('keeps other accounts untouched even with includeLegacy=true', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101', '2:201', '2:202']);
    const result = await postCleanup(worker, env, {
      keepIds: [],
      accountPrefix: '1',
      includeLegacy: true,
    });
    expect(result.deleted).toBe(1);
    expect(env.deleted).toEqual(['1:101']);
  });

  it('deletes only legacy unscoped ids when no scoping params are sent', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101', '2:201', '42']);
    const result = await postCleanup(worker, env, { keepIds: ['1:101'] });
    // 旧客户端没有账号范围：带前缀的向量归属不可证明，只能清理 legacy 无前缀 ID
    expect(result.deleted).toBe(1);
    expect(env.deleted).toEqual(['42']);
  });

  it('treats includeLegacy without accountPrefix as legacy-only cleanup', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101', '2:201', '42']);
    const result = await postCleanup(worker, env, { keepIds: [], includeLegacy: true });
    expect(result.deleted).toBe(1);
    expect(env.deleted).toEqual(['42']);
  });

  it('keeps keepIds regardless of their prefix or legacy shape', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101', '2:201', '42']);
    const result = await postCleanup(worker, env, {
      keepIds: ['1:101', '2:201', '42'],
      accountPrefix: '1',
      includeLegacy: true,
    });
    expect(result.deleted).toBe(0);
    expect(env.deleted).toEqual([]);
  });

  it('rejects cleanup without keepIds', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101']);
    const request = new Request('https://worker.example.com/cleanup', {
      method: 'POST',
      headers: AUTHED_HEADERS,
      body: JSON.stringify({ accountPrefix: '1' }),
    });
    const response = await worker.default.fetch(request, env);
    expect(response.status).toBe(400);
  });

  it('advertises accountScopedCleanup on /status for capability probing', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101']);
    const status = await getStatus(worker, env);
    expect(status.accountScopedCleanup).toBe(true);
  });

  it('does not advertise accountScopedCleanup until the metadata index is ready', async () => {
    const worker = await loadWorker(path);
    const env = makeEnv(['1:101']);
    delete env.ACCOUNT_METADATA_INDEXED;
    const status = await getStatus(worker, env);
    expect(status.accountScopedCleanup).toBe(false);
  });
});
