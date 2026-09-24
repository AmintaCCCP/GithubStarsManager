import { describe, expect, it } from 'vitest';
import type { Category } from '../../types';
import {
  buildListsPushPlan,
  validateListsPushPlan,
  listNameLength,
  GITHUB_LISTS_MAX_COUNT,
  GITHUB_LISTS_NAME_MAX_LENGTH,
  type ListsPushPlanEntry,
} from './listsPushPlan';

const makeCategory = (overrides: Partial<Category> = {}): Category => ({
  id: 'web',
  name: 'Web应用',
  icon: '🌐',
  keywords: [],
  ...overrides,
});

describe('listNameLength', () => {
  it('中文等 BMP 字符按 1 计数', () => {
    expect(listNameLength('AI/机器学习')).toBe(7);
  });

  it('emoji 等增补平面字符按 UTF-16 码元计 2（从紧口径，保证两种服务端口径下都不超限）', () => {
    expect(listNameLength('🚀🚀')).toBe(4);
  });
});

describe('buildListsPushPlan', () => {
  const overrides = {};

  it('persistedId 命中远端 list 时记为 persisted', () => {
    const plan = buildListsPushPlan(
      [makeCategory()],
      [{ id: 'L_web', name: 'Web应用' }],
      { web: 'L_web' },
      overrides
    );
    expect(plan).toEqual([
      { kind: 'persisted', categoryId: 'web', listId: 'L_web', remoteName: 'Web应用', targetName: 'Web应用' },
    ]);
  });

  it('无映射但名称变体（跨语言）匹配时记为 matched', () => {
    const plan = buildListsPushPlan(
      [makeCategory({ name: 'Web Apps' })],
      [{ id: 'L_legacy', name: 'Web应用' }],
      {},
      overrides
    );
    expect(plan).toEqual([
      { kind: 'matched', categoryId: 'web', listId: 'L_legacy', remoteName: 'Web应用', targetName: 'Web Apps' },
    ]);
  });

  it('远端不存在时记为 create（名称为当前语言分类名）', () => {
    const plan = buildListsPushPlan(
      [makeCategory({ name: 'Web Apps' })],
      [],
      {},
      overrides
    );
    expect(plan).toEqual([
      { kind: 'create', categoryId: 'web', name: 'Web Apps' },
    ]);
  });

  it('persistedId 指向的远端 list 已不存在时降级为名称匹配/新建', () => {
    const plan = buildListsPushPlan(
      [makeCategory()],
      [{ id: 'L_other', name: '别的' }],
      { web: 'L_gone' },
      overrides
    );
    expect(plan[0].kind).toBe('create');
  });
});

describe('validateListsPushPlan', () => {
  it('未触发限制时返回 null', () => {
    const plan: ListsPushPlanEntry[] = [
      { kind: 'create', categoryId: 'web', name: 'Web应用' },
    ];
    expect(validateListsPushPlan(plan, 10)).toBeNull();
  });

  it('新建名称超过 32 字符时报告名称问题（同名去重）', () => {
    const longName = 'a'.repeat(GITHUB_LISTS_NAME_MAX_LENGTH + 1);
    const plan: ListsPushPlanEntry[] = [
      { kind: 'create', categoryId: 'a', name: longName },
      { kind: 'create', categoryId: 'b', name: longName },
    ];
    const issue = validateListsPushPlan(plan, 0)!;
    expect(issue.tooLongNames).toEqual([{ name: longName, length: GITHUB_LISTS_NAME_MAX_LENGTH + 1 }]);
  });

  it('名称一致的复用项不检查长度（不会写入）', () => {
    const longName = 'a'.repeat(GITHUB_LISTS_NAME_MAX_LENGTH + 1);
    const plan: ListsPushPlanEntry[] = [
      { kind: 'persisted', categoryId: 'a', listId: 'L_a', remoteName: longName, targetName: longName },
    ];
    expect(validateListsPushPlan(plan, 1)).toBeNull();
  });

  it('需改名的复用项按目标名检查长度', () => {
    const longName = 'a'.repeat(GITHUB_LISTS_NAME_MAX_LENGTH + 1);
    const plan: ListsPushPlanEntry[] = [
      { kind: 'matched', categoryId: 'a', listId: 'L_a', remoteName: 'old', targetName: longName },
    ];
    const issue = validateListsPushPlan(plan, 1)!;
    expect(issue.tooLongNames).toHaveLength(1);
  });

  it('新建数量超出剩余额度时报告数量问题', () => {
    const plan: ListsPushPlanEntry[] = [
      { kind: 'create', categoryId: 'a', name: 'A' },
      { kind: 'create', categoryId: 'b', name: 'B' },
    ];
    const issue = validateListsPushPlan(plan, GITHUB_LISTS_MAX_COUNT - 1)!;
    expect(issue.countExceeded).toEqual({ existing: GITHUB_LISTS_MAX_COUNT - 1, needed: 2, available: 1 });
  });

  it('复用与改名不占用新建额度', () => {
    const plan: ListsPushPlanEntry[] = [
      { kind: 'persisted', categoryId: 'a', listId: 'L_a', remoteName: 'A', targetName: 'A' },
      { kind: 'matched', categoryId: 'b', listId: 'L_b', remoteName: '旧名', targetName: 'B' },
    ];
    expect(validateListsPushPlan(plan, GITHUB_LISTS_MAX_COUNT)).toBeNull();
  });

  it('名称与数量问题可同时报告', () => {
    const longName = 'a'.repeat(GITHUB_LISTS_NAME_MAX_LENGTH + 1);
    const plan: ListsPushPlanEntry[] = [
      { kind: 'create', categoryId: 'a', name: longName },
    ];
    const issue = validateListsPushPlan(plan, GITHUB_LISTS_MAX_COUNT)!;
    expect(issue.tooLongNames).toHaveLength(1);
    expect(issue.countExceeded).not.toBeNull();
  });
});
