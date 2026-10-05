/**
 * V1.5 页面网络能力的账号标签：宿主用它给插件页面的本地缓存做身份命名空间。
 *
 * 取 Token 的 SHA-256 前 16 位十六进制（匿名请求为 'anon'）。页面只拿到这个
 * 标签、拿不到 Token；标签本身也不是凭据——它只用于「同一台机器切换 GitHub
 * 账号后，旧账号的缓存不再被新账号读到」。
 */
const accountTagCache = new Map<string, string>();

/** 解析 Token 对应的稳定账号标签（按 Token 记忆，避免重复计算）。 */
export async function resolvePluginAccountTag(token: string | null): Promise<string> {
  const key = token ?? '';
  const cached = accountTagCache.get(key);
  if (cached) return cached;
  let tag = 'anon';
  if (token) {
    try {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
      tag = Array.from(new Uint8Array(digest)).slice(0, 8)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // subtle 不可用（极旧环境）时退化为长度摘要——仍优于账号无关的缓存。
      tag = `len:${token.length}`;
    }
  }
  accountTagCache.set(key, tag);
  return tag;
}
