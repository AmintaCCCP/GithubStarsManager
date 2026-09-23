/**
 * 字节数的展示格式化。
 *
 * 从 `RepositoryReleaseSheet` 内的局部实现提取出来，供 Release 资产表与
 * 可安装资产推荐块共用同一套口径（同一份数据不应该在两个地方显示成不同大小）。
 */

/**
 * 把字节数格式化为人类可读字符串。
 *
 * @param bytes 字节数；`null` 返回破折号（表示未知，例如 Source code 条目）。
 * @returns 例如 `0 B`、`1.5 KB`、`12.0 MB`。
 */
export function formatFileSize(bytes: number | null): string {
  if (bytes === null) return '—';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
