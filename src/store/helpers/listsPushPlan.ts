import type { Category } from '../../types';
import { defaultCategories } from '../schema';
import { getCategoryNameVariants } from './categoryHelpers';

/**
 * GitHub 用户 Lists 的服务端硬限制。官方文档未列出，为社区实测确认
 * （github.com/dead-claudia/github-limits、orgs/community discussions #8633 / #113251）。
 * 回写前先在本地预校验，避免推送中途被服务端拒绝、留下半完成状态。
 */
export const GITHUB_LISTS_MAX_COUNT = 32;
export const GITHUB_LISTS_NAME_MAX_LENGTH = 32;

/** 回写时用于匹配的远端 list 摘要（不含成员） */
export interface RemoteListSummary {
  id: string;
  name: string;
}

/**
 * 回写计划项：先把"每个分类最终落到哪个 list"全部判定为纯本地计算，
 * 校验通过后才逐项执行（改名 / 新建），保证触发硬限制时零写入。
 * - persisted：categoryListIdMap 指向的既有远端 list
 * - matched：按规范名/语言变体匹配到的既有远端 list
 * - create：远端不存在，需要新建
 * targetName 始终为当前语言下的分类名（写入 GitHub 的最终名称）。
 */
export type ListsPushPlanEntry =
  | { kind: 'persisted'; categoryId: string; listId: string; remoteName: string; targetName: string }
  | { kind: 'matched'; categoryId: string; listId: string; remoteName: string; targetName: string }
  | { kind: 'create'; categoryId: string; name: string };

/**
 * 构建回写计划（不发任何请求）。匹配语义与既有推送流程一致：
 * 优先持久化映射，其次规范名/语言变体大小写不敏感匹配，最后新建。
 */
export function buildListsPushPlan(
  categories: Category[],
  currentLists: RemoteListSummary[],
  categoryListIdMap: Record<string, string>,
  defaultCategoryOverrides: Record<string, Partial<Category>>
): ListsPushPlanEntry[] {
  const plan: ListsPushPlanEntry[] = [];
  for (const cat of categories) {
    const persistedId = categoryListIdMap[cat.id];
    const existing = persistedId ? currentLists.find(l => l.id === persistedId) : undefined;
    if (persistedId && existing) {
      plan.push({ kind: 'persisted', categoryId: cat.id, listId: persistedId, remoteName: existing.name, targetName: cat.name });
      continue;
    }
    // 规范名：默认分类用其稳定中文名（除非被用户覆盖），自定义分类用其自身名称
    const defaultCat = defaultCategories.find(d => d.id === cat.id);
    const canonicalName = defaultCat ? defaultCat.name : cat.name;
    const overrideName = defaultCategoryOverrides[cat.id]?.name;
    const nameVariants = getCategoryNameVariants(canonicalName, overrideName);
    const matchedList = currentLists.find(l =>
      nameVariants.some(v => v.toLowerCase() === l.name.toLowerCase())
    );
    if (matchedList) {
      plan.push({ kind: 'matched', categoryId: cat.id, listId: matchedList.id, remoteName: matchedList.name, targetName: cat.name });
      continue;
    }
    plan.push({ kind: 'create', categoryId: cat.id, name: cat.name });
  }
  return plan;
}

export interface ListsPushPlanIssue {
  /** 将被写入 GitHub 的分类名超出长度上限（同名去重后） */
  tooLongNames: Array<{ name: string; length: number }>;
  /** 新建后将超出 list 总数上限 */
  countExceeded: { existing: number; needed: number; available: number } | null;
}

/**
 * 名称长度按 UTF-16 码元计数（JS 的 string.length，与 GitHub 网页端创建 List
 * 表单 maxlength 口径一致）。服务端按"字符"校验的口径未文档化：UTF-16 ≤ 32
 * 必然推出码点数 ≤ 32，因此在"按码点"与"按码元"两种可能口径下都不会被
 * 服务端拒绝；按码点计数则可能在 emoji 等增补平面字符上漏判。
 */
export const listNameLength = (name: string): number => name.length;

/**
 * 校验回写计划是否触发 GitHub Lists 硬限制。仅检查会被写入的名称：
 * 新建必然写入；改名仅在与远端名称不同时写入，名称一致的复用项不检查。
 * 未触发返回 null。
 */
export function validateListsPushPlan(plan: ListsPushPlanEntry[], remoteListCount: number): ListsPushPlanIssue | null {
  const tooLongByName = new Map<string, number>();
  for (const entry of plan) {
    if (entry.kind !== 'create' && entry.remoteName === entry.targetName) continue;
    const writtenName = entry.kind === 'create' ? entry.name : entry.targetName;
    const length = listNameLength(writtenName);
    if (length > GITHUB_LISTS_NAME_MAX_LENGTH) {
      tooLongByName.set(writtenName, length);
    }
  }

  const needed = plan.filter(entry => entry.kind === 'create').length;
  const available = Math.max(0, GITHUB_LISTS_MAX_COUNT - remoteListCount);
  const countExceeded = needed > available
    ? { existing: remoteListCount, needed, available }
    : null;

  if (tooLongByName.size === 0 && !countExceeded) return null;
  return {
    tooLongNames: [...tooLongByName].map(([name, length]) => ({ name, length })),
    countExceeded,
  };
}
