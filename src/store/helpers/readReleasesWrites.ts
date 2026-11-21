/**
 * readReleases 写入来源登记（第 12 轮审计跨域修复，finding 2）。
 *
 * 问题：乐观「全部已读」的回滚所有权此前只能按 `readReleases` 集合差值
 * 推断——`markAllReleasesAsRead()` 得到 `{10}` 后，备份恢复把集合整体替换为
 * `{10,20}` 恰好满足「size +1 且旧集合是子集」，被误判为一条并发单条已读，
 * 回滚时删掉备份带来的 `10`。
 *
 * 方案：store 侧在写入 `readReleases` 的同时登记「写入来源 + 单调版本 + 本次
 * 写入后的集合引用」。订阅方（如 useReleaseTimelineActions）按登记信息判断
 * 回滚所有权：
 * - 来源为 `single-read`（markReleaseAsRead）→ 真实单条已读，保留所有权；
 * - 其他来源（mark-all / prune）→ 整组语义变化，放弃回滚所有权；
 * - 集合引用与登记不符（未经 store action 的原始 setState，如备份整组恢复）
 *   → 视作未知的整组替换，放弃回滚所有权。
 *
 * 该登记表是 store 侧契约，不进入持久化状态；版本号只用于比较先后，
 * 重启后从 0 重新递增不会影响语义。
 */
export type ReadReleasesWriteSource =
  /** markReleaseAsRead：用户单条（latest 模式下可能连同该仓库全部 release）已读。 */
  | 'single-read'
  /** markAllReleasesAsRead：整组「全部已读」。 */
  | 'mark-all'
  /** upsertReleases / 删除仓库/Release 等派生写入：从已读集合中裁剪。 */
  | 'prune';

export interface ReadReleasesWriteInfo {
  /** 单调递增的写入版本；与上一条登记比较即可判断是否发生过新写入。 */
  revision: number;
  source: ReadReleasesWriteSource;
  /** 本次写入实际写入 store 的集合引用；用于识别未经登记的原始 setState。 */
  next: ReadonlySet<number>;
  /**
   * 第 13 轮审计修复 [106]：single-read 登记本次操作的目标 ID（普通模式为被
   * 点击的 release，latest 模式连同同仓库全部 release）。乐观「全部已读」的
   * 失败回滚据此把这些 ID 从「仅由全部已读新增」的撤销集合中排除——等待期间
   * 用户单条已读的条目不得被回滚撤销。其他来源不携带该字段。
   */
  targetIds?: ReadonlySet<number>;
}

let _readReleasesWriteRevision = 0;
let _lastReadReleasesWrite: ReadReleasesWriteInfo | null = null;

/** 由 store action 在写入 readReleases 的同一同步调用中登记写入来源。 */
export function recordReadReleasesWrite(
  source: ReadReleasesWriteSource,
  next: ReadonlySet<number>,
  targetIds?: ReadonlySet<number>,
): void {
  _readReleasesWriteRevision += 1;
  _lastReadReleasesWrite = {
    revision: _readReleasesWriteRevision,
    source,
    next,
    ...(targetIds ? { targetIds } : {}),
  };
}

/** 最近一次登记的写入信息；从未经 store action 写入过时为 null。 */
export function getLastReadReleasesWrite(): ReadReleasesWriteInfo | null {
  return _lastReadReleasesWrite;
}

/** 测试用：重置登记表（版本号回到 0）。 */
export function resetReadReleasesWriteTrackingForTest(): void {
  _readReleasesWriteRevision = 0;
  _lastReadReleasesWrite = null;
}
