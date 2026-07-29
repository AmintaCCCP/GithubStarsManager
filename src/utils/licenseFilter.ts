/**
 * License 过滤与归一化工具。
 *
 * 仓库元数据中 license 存为 SPDX id 字符串（如 "MIT"、"Apache-2.0"）或 null。
 * GitHub 对未声明 / 无法识别许可证的仓库返回 `{ key: 'Other', spdx_id: 'NOASSERTION' }`，
 * 我们存 spdx_id 即 `'NOASSERTION'`。为让过滤面板提供一个「无/未声明」聚合项，
 * 统一把这些情形归一化为 {@link NO_LICENSE_SENTINEL}。
 *
 * 本模块同时被前端 UI、过滤求值、MCP 等多处复用；服务端 MCP 因无法 import src/ 树，
 * 在 server/src/mcp/repoSearch.ts 内保留一份相同实现，改这里时请一并同步。
 */

/** 「无 license」聚合哨兵：用于过滤器把 null / NOASSERTION / Other 等归并为一项。 */
export const NO_LICENSE_SENTINEL = '__NO_LICENSE__';

/**
 * 视作「无/未声明 license」的值集合（大小写不敏感比对，覆盖常见 GitHub/SPDX 写法）。
 * - `''` 空串
 * - `'noassertion'` GitHub「无 SPDX 断言」的 spdx_id（NOASSERTION）
 * - `'other'` GitHub license.key（Other，无 SPDX 时）
 * - `'none'` SPDX「无 license」（NONE）
 * - `'no-license'` 兜底串
 */
const NOASSERTION_KEYS = new Set(['', 'noassertion', 'other', 'none', 'no-license']);

/**
 * 把仓库的 license 值归一化为「SPDX id」或「无 license 哨兵」。
 * 比对大小写不敏感，以收敛历史备份/第三方源写入的小写变体（如 'other'、'none'）。
 * @param v 原始 license 值（SPDX id / 哨兵值 / null / undefined / 空串）
 * @returns 归一化后的字符串；无 license 时返回 {@link NO_LICENSE_SENTINEL}
 */
export function normalizeLicense(v: string | null | undefined): string {
  if (!v) return NO_LICENSE_SENTINEL;
  return NOASSERTION_KEYS.has(v.toLowerCase()) ? NO_LICENSE_SENTINEL : v;
}
