import { logger } from './logger';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

/**
 * 阶段二在各 list 之间并发拉取 items 的并发度。
 * 取值兼顾：远低于 GitHub GraphQL 并发上限避免触发次级速率限制（实测 6
 * 在部分时段会触发 503），同时保留并行收益。配合 request 内的 5xx/
 * 限流指数退避重试，进一步吸收 GitHub 临时过载。
 */
const LIST_ITEMS_CONCURRENCY = 3;

/**
 * 受控并发映射：对 items 中每个元素调用 mapper，至多 concurrency 个并发执行，
 * 保持结果顺序与输入一致。任一 mapper 抛错会向上抛出（整体失败语义，与原串行
 * 实现一致——单 list 拉取失败即视为本次同步失败）。
 * 支持 AbortSignal：若 signal 已取消则立即抛出 AbortError，已在途的请求仍会
 * 完成（fetch 由其自身的 signal 控制中止）。
 */
async function mapPool<T, R>(
  items: readonly T[],
  mapper: (item: T, index: number) => Promise<R>,
  concurrency: number,
  signal?: AbortSignal
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  };
  const workers: Promise<void>[] = [];
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  for (let i = 0; i < n; i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

/**
 * 组合外部信号与超时，返回单个 AbortController。
 * 不依赖 AbortSignal.timeout / AbortSignal.any（Chrome<124 / Safari<16 不支持），
 * 用原生 AbortController 实现等价语义：任一来源中止即中止。
 * controller 中止后清理定时器与监听，避免泄漏。
 */
function createCombinedAbortController(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortController {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  const onParentAbort = () => controller.abort();
  parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  controller.signal.addEventListener('abort', () => {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener('abort', onParentAbort);
  }, { once: true });
  return controller;
}

/**
 * 标记"瞬时、可重试"的错误。request 外层退避循环捕获后等待重试。
 * retryAfterMs 优先（来自 Retry-After 头），否则用指数退避序列。
 */
class RetriableError extends Error {
  readonly retryAfterMs?: number;
  constructor(message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'RetriableError';
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * 后端代理返回"未配置 GitHub token"（400 GITHUB_TOKEN_NOT_CONFIGURED）。
 * 前端始终持有 token，此时应切换到直连模式重试，无需退避等待。
 */
class BackendTokenMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackendTokenMissingError';
  }
}

export interface GitHubList {
  id: string;
  name: string;
  description?: string;
  isPrivate: boolean;
  /** 该 list 内仓库的 full_name 集合 */
  items: string[];
}

export interface GitHubListSummary {
  id: string;
  name: string;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string; type?: string; extensions?: { code?: string } }>;
}

/** 后端代理 /api/proxy/github/* 失败时的响应体（proxyService 兜底与上游错误透传）。 */
interface BackendProxyErrorBody {
  error?: string;
  code?: string;
  details?: string;
}

/**
 * GitHub Lists（星标列表）GraphQL 客户端。
 *
 * 支持两种请求模式：
 * - 有后端代理：POST {backendUrl}/proxy/github/graphql，由服务端读取加密的 token 并转发；
 * - 直连模式：POST https://api.github.com/graphql，携带传入的 token。
 *
 * 后端代理路径一旦失败（网络/5xx/token 缺失），自动切换到直连模式并保持到本次同步结束，
 * 避免同一批次的每个查询都先撞击一次失败的代理。直连要求浏览器能直接访问 GitHub。
 *
 * GraphQL 操作星标列表需要经典 PAT 的 `user` scope（或含 star lists 权限的 token）。
 */
export class GitHubListsApiService {
  private token: string;
  private backendUrl: string | null = null;
  private backendAuthToken: string | null = null;
  /** 后端代理路径失败后置位，本实例剩余请求走直连（幂等切换，不重复尝试代理）。 */
  private proxyFailed = false;

  constructor(token: string) {
    this.token = token;
  }

  setBackendUrl(url: string | null): void {
    this.backendUrl = url;
  }

  setBackendAuthToken(token: string | null): void {
    this.backendAuthToken = token;
  }

  private getBackendHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.backendAuthToken) {
      headers.Authorization = `Bearer ${this.backendAuthToken}`;
    }
    return headers;
  }

  /**
   * 发送 GraphQL 请求。query 支持 $variables 占位。
   * 权限不足/未授权时抛出带可读信息的错误。
   *
   * 对 GitHub 侧瞬时错误做指数退避重试：
   * - 5xx（502/503/504，含上游网关超时与负载过载）
   * - 限流 403（x-ratelimit-remaining=0 或带 Retry-After；次级速率限制也会用 403）
   * - 网络异常（fetch reject，如瞬时连接重置）
   * 重试尊重 Retry-After 头，最多 4 次，退避 1→2→4→8s（与 Retry-After 取较大者）。
   * 鉴权类错误（401/403 scope 不足）、业务错误（GraphQL errors）、4xx 不重试。
   *
   * 后端代理模式下，代理路径一旦失败（网络/5xx/token 缺失）即切换到直连重试并保持到
   * 本次同步结束；直连模式失败则按正常退避序列重试。
   *
   * @param toleratePartialErrors 为 true 时，若响应为 200 且包含部分 data，
   *   即使 errors 数组非空也不抛错（用于批量解析场景：个别字段失败不应丢弃已成功的结果）。
   *   鉴权类错误（401/403 scope 不足）无论何种模式都会抛出。
   */
  private async request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: { toleratePartialErrors?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });
    const parentSignal = options.signal;

    const MAX_ATTEMPTS = 4;
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (parentSignal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }
      // 每次尝试独立超时：超时上限不被重试+退避消耗，也不会中止退避等待
      //（否则 sleep 抛出 AbortError，掩盖最终的 RetriableError）。退避只受 parentSignal 控制。
      const controller = createCombinedAbortController(parentSignal, options.timeoutMs ?? 30_000);
      try {
        // 后端代理路径一旦失败（网络/5xx/token 缺失）即切直连，并保持到本次同步结束：
        // 避免同一批次的每个查询都先撞击一次失败的代理。
        const useProxy = this.backendUrl !== null && !this.proxyFailed;
        return await this.attemptRequest<T>(query, body, controller.signal, options, useProxy);
      } catch (e) {
        if (e instanceof RetriableError) {
          lastError = e;
          // 后端代理瞬时失败（5xx/网络/限流）：切直连后继续按原退避重试同一查询；
          // 直连模式失败则按正常退避序列重试（不再改模式）。
          if (this.backendUrl && !this.proxyFailed) {
            this.proxyFailed = true;
            logger.warn('githubLists', 'Backend proxy failed, falling back to direct connection', { error: e.message });
          }
          // 最后一次不再等待，直接抛出
          if (attempt === MAX_ATTEMPTS - 1) break;
          const backoffMs = e.retryAfterMs ?? (1000 * Math.pow(2, attempt));
          await this.sleep(backoffMs, parentSignal);
          continue;
        }
        if (e instanceof BackendTokenMissingError) {
          // 后端未配置 token（如首次同步前尚未同步成功），前端持有 token，直连即可，无需退避。
          lastError = e;
          this.proxyFailed = true;
          logger.warn('githubLists', 'Backend token missing, falling back to direct connection');
          continue;
        }
        // 不可重试（鉴权/业务/AbortError 等），直接抛
        throw e;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('GitHub GraphQL 请求在多次重试后仍失败。');
  }

  /**
   * 可退避等待：尊重 signal 中止；中止时立即抛出 AbortError。
   */
  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        const err = new Error('Aborted');
        err.name = 'AbortError';
        reject(err);
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /**
   * 单次 GraphQL 请求尝试。瞬时错误抛 RetriableError 供外层重试，
   * 永久错误（鉴权/业务/缺 data）直接抛出。
   * @param useProxy true 走后端代理；false 走直连（浏览器 token 直连 GitHub）。
   */
  private async attemptRequest<T>(
    query: string,
    body: string,
    signal: AbortSignal,
    options: { toleratePartialErrors?: boolean },
    useProxy: boolean
  ): Promise<T> {
    let response: Response;
    try {
      if (useProxy && this.backendUrl) {
        const proxyUrl = `${this.backendUrl}/proxy/github/graphql`;
        response = await fetch(proxyUrl, {
          method: 'POST',
          headers: this.getBackendHeaders(),
          signal,
          body: JSON.stringify({
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.parse(body),
          }),
        });
      } else {
        response = await fetch(GITHUB_GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          signal,
          body,
        });
      }
    } catch (e) {
      // 网络层异常：AbortError 不重试，其余（连接重置/超时一类）瞬时性重试
      if (e instanceof DOMException && e.name === 'AbortError') {
        const abortErr = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }
      throw new RetriableError(
        `GitHub GraphQL 网络请求失败：${e instanceof Error ? e.message : String(e)}`,
        undefined
      );
    }

    let payload: GraphQLResponse<T>;
    try {
      payload = await response.json();
    } catch {
      // 非 JSON 响应：5xx 时网关可能返回 HTML 错误页，按瞬时错误重试
      if (response.status >= 500 && response.status <= 599) {
        throw new RetriableError(
          `GitHub GraphQL 响应解析失败（HTTP ${response.status}）。`,
          this.parseRetryAfterMs(response)
        );
      }
      throw new Error('GitHub GraphQL 响应解析失败（非 JSON）。');
    }

    // 后端未配置 token（400 GITHUB_TOKEN_NOT_CONFIGURED）：前端持有 token，直连即可。
    // 抛专用错误由 request 切到直连模式重试（无需退避）。
    if (useProxy && response.status === 400 && (payload as unknown as BackendProxyErrorBody).code === 'GITHUB_TOKEN_NOT_CONFIGURED') {
      throw new BackendTokenMissingError('后端未配置 GitHub token，切换到直连模式重试。');
    }

    // 速率限制：403 既可能是 scope 不足，也可能是主/次速率限制。
    // 需在鉴权分类之前判断，避免把限流误报为"缺少权限"。
    const isRateLimited =
      response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.get('retry-after') !== null);
    if (isRateLimited) {
      // 次级/主速率限制是瞬时的：尊重 Retry-After 重试而非直接抛错给用户。
      // 若未提供 Retry-After，凭退避序列退避。
      throw new RetriableError(
        `GitHub API 触发速率限制（HTTP 403）。`,
        this.parseRetryAfterMs(response)
      );
    }

    if (payload.errors && payload.errors.length > 0) {
      const error = payload.errors[0];
      const message = error.message || 'GitHub GraphQL 请求失败';
      // 上游 5xx 无条件视为瞬时错误：即使错误文本疑似鉴权（如 502 网关错误里出现
      // "authorized"/"permission"），也应走重试/切直连，而非误判为权限不足。
      if (response.status >= 500 && response.status <= 599) {
        throw new RetriableError(message, this.parseRetryAfterMs(response));
      }
      // 鉴权类错误：GraphQL 通常返回 "401 Unauthorized" 或错误信息包含 scope/权限相关字眼。
      // 无论是否容忍部分失败，鉴权错误都必须抛出，不能静默吞掉。
      if (response.status === 401 || response.status === 403 || /scope|permission|authorized|not granted/i.test(message)) {
        throw new Error(
          '当前 GitHub Token 缺少操作星标列表（star lists）的权限。\n\n' +
          '请按以下任一方式修复：\n' +
          '· 经典 Token：为其添加 `user` scope\n' +
          '· 终端执行：gh auth refresh -h github.com -s user\n' +
          '· 或改用含 star lists 权限的 token 重新登录。'
        );
      }
      // 非鉴权错误：若允许部分失败且响应 200 且存在部分 data，则保留部分结果继续；否则抛出。
      if (options.toleratePartialErrors && response.status === 200 && payload.data) {
        return payload.data;
      }
      throw new Error(message);
    }

    if (response.status === 401 || response.status === 403) {
      throw new Error(
        '当前 GitHub Token 缺少操作星标列表（star lists）的权限。\n\n' +
        '请按以下任一方式修复：\n' +
        '· 经典 Token：为其添加 `user` scope\n' +
        '· 终端执行：gh auth refresh -h github.com -s user\n' +
        '· 或改用含 star lists 权限的 token 重新登录。'
      );
    }

    // 5xx（502/503/504）：GitHub 过载/网关超时，或后端代理自身不可达，瞬时性错误，可重试。
    // 后端代理失败时透传其 code/details，便于区分"后端容器连不上 GitHub"与"GitHub 本身 5xx"。
    if (response.status >= 500 && response.status <= 599) {
      const proxyErr = payload as unknown as Partial<BackendProxyErrorBody>;
      const details = typeof proxyErr.details === 'string' && proxyErr.details ? `：${proxyErr.details}` : '';
      const diagnostics = proxyErr.code ? `（后端代理：${proxyErr.code}${details}）` : '';
      throw new RetriableError(
        `GitHub GraphQL 请求失败：${response.status} ${response.statusText}${diagnostics}`,
        this.parseRetryAfterMs(response)
      );
    }

    if (!response.ok) {
      throw new Error(`GitHub GraphQL 请求失败：${response.status} ${response.statusText}`);
    }

    if (!payload.data) {
      throw new Error('GitHub GraphQL 响应缺少 data 字段。');
    }

    return payload.data;
  }

  /**
   * 解析 Retry-After 头（秒）为等待毫秒数；不存在或非法返回 undefined。
   */
  private parseRetryAfterMs(response: Response): number | undefined {
    const raw = response.headers.get('retry-after');
    if (!raw) return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    // 限流 Retry-After 可能较大；封顶 60s 避免单次退避过长拖累整体同步。
    return Math.min(Math.round(n * 1000), 60_000);
  }

  /**
   * 获取当前用户的全部 Lists（含每 list 内仓库的 full_name）。
   *
   * 实现采用"先取摘要、再逐 list 取 items"的两阶段策略：
   * - 阶段一：分页拉取 lists 摘要（id/name/description/isPrivate），单次请求轻量，稳定不超时；
   * - 阶段二：对每个 list 通过 node(id:) 分页拉取 items（每页 100）。
   *
   * 不能像早期实现那样在列表查询里直接内联 items：当 lists 数量较多（约 15-20 个以上）
   * 且每个 list 内含大量仓库时，单个 GraphQL 请求响应体过大，GitHub 侧会超时返回 502/504。
   *
   * 阶段二在各 list 间并发（受 LIST_ITEMS_CONCURRENCY 控制），每个 list 内部
   * 仍串行分页（页间有游标依赖）。实测 22 个 list、2533 个仓库较串行显著降低墙钟时间，
   * 且并发度远低于 GitHub GraphQL 并发上限，不触发次级速率限制。
   *
   * @param options.concurrency 阶段二 list 间并发数（默认 LIST_ITEMS_CONCURRENCY）
   */
  async getUserLists(
    login: string,
    signal?: AbortSignal,
    options: { concurrency?: number } = {}
  ): Promise<GitHubList[]> {
    logger.info('githubLists', 'Fetching user lists', { login });

    const summaries: Array<{ id: string; name: string; description?: string; isPrivate: boolean }> = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const data = await this.request<{
        user: {
          lists: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{ id: string; name: string; description?: string; isPrivate: boolean }>;
          };
        } | null;
      }>(
        `query($login: String!, $cursor: String) {
          user(login: $login) {
            lists(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id name description isPrivate }
            }
          }
        }`,
        { login, cursor },
        { signal }
      );

      // user 为 null 表示该 login 不存在或当前 token 无权访问
      if (!data.user) {
        throw new Error(`GitHub 用户 "${login}" 不存在或当前 token 无权访问。`);
      }

      summaries.push(...data.user.lists.nodes);
      hasNextPage = data.user.lists.pageInfo.hasNextPage;
      const nextCursor = data.user.lists.pageInfo.endCursor;
      // 防御：若 hasNextPage 为 true 但游标为空或未前进，终止分页避免死循环/重复页
      if (!nextCursor || nextCursor === cursor) {
        hasNextPage = false;
      } else {
        cursor = nextCursor;
      }
    }

    // 阶段二：各 list 间并发分页拉取 items，每个 list 内部串行分页。
    const concurrency = Math.max(1, options.concurrency ?? LIST_ITEMS_CONCURRENCY);
    const results = await mapPool(
      summaries,
      async (summary) => {
        const items = await this.fetchListItems(summary.id, signal);
        return {
          id: summary.id,
          name: summary.name,
          description: summary.description,
          isPrivate: summary.isPrivate,
          items,
        } satisfies GitHubList;
      },
      concurrency,
      signal
    );

    logger.info('githubLists', 'Fetched user lists', { count: results.length });
    return results;
  }

  /**
   * 分页拉取单个 list 的 items（每页 100），返回仓库的 nameWithOwner 列表。
   * 单个 list 内部分页必须串行：后一页的 itemCursor 依赖前一页的 endCursor。
   */
  private async fetchListItems(listId: string, signal?: AbortSignal): Promise<string[]> {
    const items: string[] = [];
    let itemHasNext = true;
    let itemCursor: string | null = null;
    while (itemHasNext) {
      const itemPage = await this.request<{
        node: {
          items: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{ __typename?: string; id?: string; nameWithOwner?: string }>;
          };
        } | null;
      }>(
        `query($listId: ID!, $itemCursor: String) {
          node(id: $listId) {
            ... on UserList {
              items(first: 100, after: $itemCursor) {
                pageInfo { hasNextPage endCursor }
                nodes {
                  __typename
                  ... on Repository { id nameWithOwner }
                }
              }
            }
          }
        }`,
        { listId, itemCursor },
        { signal }
      );
      if (!itemPage.node) break;
      for (const item of itemPage.node.items.nodes) {
        if (item.nameWithOwner) items.push(item.nameWithOwner);
      }
      itemHasNext = itemPage.node.items.pageInfo.hasNextPage;
      const nextItemCursor = itemPage.node.items.pageInfo.endCursor;
      // 防御：游标为空或未前进时终止分页，避免死循环/重复页
      if (!nextItemCursor || nextItemCursor === itemCursor) {
        itemHasNext = false;
      } else {
        itemCursor = nextItemCursor;
      }
    }
    return items;
  }

  /** 获取当前用户全部 Lists 的 id 与名称（不含成员），用于回写前的同名检测。 */
  async getUserListSummaries(login: string, signal?: AbortSignal): Promise<GitHubListSummary[]> {
    const summaries: GitHubListSummary[] = [];
    let hasNextPage = true;
    let cursor: string | null = null;

    while (hasNextPage) {
      const data = await this.request<{
        user: {
          lists: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: Array<{ id: string; name: string }>;
          };
        } | null;
      }>(
        `query($login: String!, $cursor: String) {
          user(login: $login) {
            lists(first: 100, after: $cursor) {
              pageInfo { hasNextPage endCursor }
              nodes { id name }
            }
          }
        }`,
        { login, cursor },
        { signal }
      );
      if (!data.user) {
        throw new Error(`GitHub 用户 "${login}" 不存在或当前 token 无权访问。`);
      }
      summaries.push(...data.user.lists.nodes);
      hasNextPage = data.user.lists.pageInfo.hasNextPage;
      const nextCursor = data.user.lists.pageInfo.endCursor;
      // 防御：若 hasNextPage 为 true 但游标为空或未前进，终止分页避免死循环/重复页
      if (!nextCursor || nextCursor === cursor) {
        hasNextPage = false;
      } else {
        cursor = nextCursor;
      }
    }

    return summaries;
  }

  /** 创建新 List，返回其 id。 */
  async createUserList(name: string, isPrivate = true, description?: string): Promise<string> {
    const data = await this.request<{
      createUserList: { list: { id: string; name: string } };
    }>(
      `mutation($name: String!, $isPrivate: Boolean!, $description: String) {
        createUserList(input: { name: $name, isPrivate: $isPrivate, description: $description }) {
          list { id name }
        }
      }`,
      { name, isPrivate, description: description ?? null }
    );
    return data.createUserList.list.id;
  }

  /** 删除 List。 */
  async deleteUserList(listId: string): Promise<void> {
    await this.request<{ deleteUserList: { clientMutationId: string | null } }>(
      `mutation($listId: ID!) {
        deleteUserList(input: { listId: $listId }) {
          clientMutationId
        }
      }`,
      { listId }
    );
  }

  /**
   * 将某仓库（itemId 为 GraphQL node id）加入指定 list 集合。
   * 注意：该操作会整体替换仓库所属的 list 集合（覆盖语义）。
   * 传入空数组表示将该仓库从所有 list 中移除（用于清理过期成员关系）。
   */
  async updateUserListsForItem(itemId: string, listIds: string[]): Promise<void> {
    await this.request<{ updateUserListsForItem: { clientMutationId: string | null } }>(
      `mutation($itemId: ID!, $listIds: [ID!]!) {
        updateUserListsForItem(input: { itemId: $itemId, listIds: $listIds }) {
          clientMutationId
        }
      }`,
      { itemId, listIds }
    );
  }

  /**
   * 通过 GraphQL 批量解析仓库的 node id（itemId）。
   * @param ownerNamePairs 仓库的 owner/name（保持 GitHub 原始大小写传入，GraphQL 匹配区分大小写）
   * @returns Map<full_name 小写, node_id> —— 以小写为键便于调用方统一查找
   */
  async resolveRepositoryNodeIds(ownerNamePairs: Array<{ owner: string; name: string }>, signal?: AbortSignal): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const BATCH = 50;

    for (let i = 0; i < ownerNamePairs.length; i += BATCH) {
      const batch = ownerNamePairs.slice(i, i + BATCH);
      const aliases: string[] = [];
      const variables: Record<string, string> = {};
      batch.forEach(({ owner, name }, idx) => {
        const alias = `r${idx}`;
        const ownerVar = `${alias}Owner`;
        const nameVar = `${alias}Name`;
        variables[ownerVar] = owner;
        variables[nameVar] = name;
        aliases.push(
          `${alias}: repository(owner: $${ownerVar}, name: $${nameVar}) { id nameWithOwner }`
        );
      });

      const variableDecls = Object.keys(variables).map(v => `$${v}: String!`).join(', ');
      const data = await this.request<Record<string, { id?: string; nameWithOwner?: string } | null>>(
        `query(${variableDecls}) { ${aliases.join(' ')} }`,
        variables,
        // 容忍部分失败：个别仓库解析失败（如已被删除/改名）不应丢弃整批已成功的结果。
        // 鉴权类错误仍会抛出。
        { toleratePartialErrors: true, signal }
      );

      for (const key of Object.keys(data)) {
        const node = data[key];
        if (node?.id && node.nameWithOwner) {
          // 以 full_name 的小写为 key，便于调用方统一查找
          result.set(node.nameWithOwner.toLowerCase(), node.id);
        }
      }
    }

    return result;
  }
}
