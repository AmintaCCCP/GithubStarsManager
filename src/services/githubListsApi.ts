import { logger } from './logger';

const GITHUB_GRAPHQL_ENDPOINT = 'https://api.github.com/graphql';

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

/**
 * GitHub Lists（星标列表）GraphQL 客户端。
 *
 * 支持两种请求模式：
 * - 有后端代理：POST {backendUrl}/proxy/github/graphql，由服务端读取加密的 token 并转发；
 * - 直连模式：POST https://api.github.com/graphql，携带传入的 token。
 *
 * GraphQL 操作星标列表需要经典 PAT 的 `user` scope（或含 star lists 权限的 token）。
 */
export class GitHubListsApiService {
  private token: string;
  private backendUrl: string | null = null;
  private backendAuthToken: string | null = null;

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
   * @param toleratePartialErrors 为 true 时，若响应为 200 且包含部分 data，
   *   即使 errors 数组非空也不抛错（用于批量解析场景：个别字段失败不应丢弃已成功的结果）。
   *   鉴权类错误（401/403/scope 不足）无论何种模式都会抛出。
   */
  private async request<T>(
    query: string,
    variables: Record<string, unknown> = {},
    options: { toleratePartialErrors?: boolean; signal?: AbortSignal; timeoutMs?: number } = {}
  ): Promise<T> {
    const body = JSON.stringify({ query, variables });
    const signal = options.signal ?? AbortSignal.timeout(options.timeoutMs ?? 30_000);

    let response: Response;
    if (this.backendUrl) {
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

    let payload: GraphQLResponse<T>;
    try {
      payload = await response.json();
    } catch {
      throw new Error('GitHub GraphQL 响应解析失败（非 JSON）。');
    }

    // 速率限制：403 既可能是 scope 不足，也可能是主/次速率限制。
    // 需在鉴权分类之前判断，避免把限流误报为"缺少权限"。
    const isRateLimited =
      response.status === 403 &&
      (response.headers.get('x-ratelimit-remaining') === '0' ||
        response.headers.get('retry-after') !== null);
    if (isRateLimited) {
      const retryAfter = response.headers.get('retry-after');
      throw new Error(
        `GitHub API 触发速率限制，请稍后重试${retryAfter ? `（约 ${retryAfter} 秒后）` : ''}。`
      );
    }

    if (payload.errors && payload.errors.length > 0) {
      const error = payload.errors[0];
      const message = error.message || 'GitHub GraphQL 请求失败';
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
      // 非鉴权错误：若允许部分失败且响应 200 且存在部分 data，则保留部分结果继续；
      // 否则抛出。
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

    if (!response.ok) {
      throw new Error(`GitHub GraphQL 请求失败：${response.status} ${response.statusText}`);
    }

    if (!payload.data) {
      throw new Error('GitHub GraphQL 响应缺少 data 字段。');
    }

    return payload.data;
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
   */
  async getUserLists(login: string, signal?: AbortSignal): Promise<GitHubList[]> {
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

    // 阶段二：逐 list 分页拉取 items
    const lists: GitHubList[] = [];
    for (const summary of summaries) {
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
          { listId: summary.id, itemCursor },
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

      lists.push({
        id: summary.id,
        name: summary.name,
        description: summary.description,
        isPrivate: summary.isPrivate,
        items,
      });
    }

    logger.info('githubLists', 'Fetched user lists', { count: lists.length });
    return lists;
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
