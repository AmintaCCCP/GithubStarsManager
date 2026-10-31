import type { AppLanguage } from '../../i18n/languages';
import { MAX_EVIDENCE_EXCERPT_CHARS, sectionSegments, type CachedDocument } from './retrieval';

/**
 * 1.1 README/Docs 快速路径（优化方案 §1.1 / 附录 C.1）：
 * 简单 usage/general/deployment 首问在 Query Understanding 之前用确定性规则
 * 匹配根 README 章节，命中即跳过 understanding/plan/gate 直接进入回答合成，
 * 把回答前的 LLM 调用压缩到 1 次。本模块只包含纯判定与切章逻辑，不发起
 * 网络请求；读取与证据生成由 chat/loop.ts 统一完成。
 */

export type FastPathFocus = 'usage' | 'general' | 'deployment';

export const FAST_PATH_FOCI: readonly FastPathFocus[] = ['usage', 'general', 'deployment'];

/** 根目录 README（含 readme.txt / README.zh.md 等变体），快速路径唯一读取对象。 */
export const ROOT_README_PATH = /^readme(?:\.[a-z0-9_-]+)?\.(?:md|mdx|markdown|txt)$/i;

export const findRootReadmePath = (paths: string[]): string | null => paths.find((path) => ROOT_README_PATH.test(path)) ?? null;

const FAST_PATH_HEADING_PATTERNS: Record<FastPathFocus, RegExp> = {
  usage: /(?:^|\b)(?:install(?:ation)?|setup|quick\s*start|getting\s*started|usage|how\s+to\s+use|use|requirements|prerequisites|dependencies)(?:\b|$)|安装|快速开始|快速上手|使用(?:方法|指南|说明)?|开始使用|环境要求|前置条件|依赖/i,
  general: /(?:^|\b)(?:what\s+it\s+does|overview|introduction|features?|about|highlights?|why)(?:\b|$)|简介|介绍|功能(?:特性)?|这是什么|核心能力|特性/i,
  deployment: /(?:^|\b)(?:deploy(?:ment)?|docker|self[-\s]?host(?:ing)?|production|hosting|compose)(?:\b|$)|部署|容器化|自托管|生产环境/i,
};

/**
 * 判定本轮是否允许快速路径：设置开关未显式关闭，且任务深度不是
 * deep/unlimited（深入档位以全面取证为目标，快速路径默认关闭）。
 */
export const resolveFastPathEnabled = (input: { fastPath?: boolean; taskDepth?: 'default' | 'quick' | 'deep' | 'unlimited' }): boolean =>
  input.fastPath !== false && input.taskDepth !== 'deep' && input.taskDepth !== 'unlimited';

/**
 * 追问判定：本轮消息（末尾一条是当前问题）之前已存在助手回答时视为追问，
 * 交给完整循环处理，不走快速路径。
 */
export const hasPriorAssistantTurn = (messages: ReadonlyArray<{ role: string }>): boolean =>
  messages.slice(0, -1).some((message) => message.role === 'assistant');

const questionTerms = (question: string): string[] => Array.from(new Set(
  question
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((term) => term.length >= 2),
));

const headingRelevance = (title: string, terms: string[]): number => {
  const collapsed = title.toLowerCase();
  return terms.reduce((score, term) => score + (collapsed.includes(term) ? 1 : 0), 0);
};

/**
 * 从 README 大纲中挑选与高频意图直接匹配的章节，最多返回 3 段（方案 §1.1）：
 * - 主 focus 的标题模式之外，问题原话同时命中其他快速路径意图时一并纳入
 *   （如“如何安装并部署”同时取 Install 与 Deployment 章节，避免单一意图漏证据）；
 * - 命中章节按问题词与标题的重合度在全量匹配标题上排序（审计意见：仅按类别
 *   取前三段会让排在第四位的真正相关章节进不了证据）；带 rankByTitle 的
 *   sectionSegments 调用不施加 6 段上限，意图保留与 3 段最终截断都作用于
 *   同一份全量排序结果——任何上限不得先于意图保留生效，否则多意图问题里
 *   得分并列且文档靠后的章节会在截取处被丢弃且无法补救；
 * - 每个命中的意图保留章节名额：未被已选章节覆盖的意图先取其得分最高的
 *   匹配章节（同一章节可覆盖多个意图，已覆盖的意图不占新名额），剩余名额
 *   按得分补足到 3 段，避免多意图问题只保留单一意图的章节；
 * - general 意图同时带上首个标题前的导语段；导语段与意图保留章节一并参与
 *   名额分配（名额有余直接入选并固定占据 segments[0]，名额已满只挤出排序
 *   最低的填充章节）。截断优先级：意图保留章节 > 导语段 > 未被意图保留的
 *   填充章节——已保留的意图章节不会被导语段或低分填充章节挤出；意图保留
 *   章节占满 3 个名额的极端组合下导语段让位。
 */
export const selectFastPathSegments = (
  document: CachedDocument,
  focus: FastPathFocus,
  question: string,
): Array<{ lineStart: number; lineEnd: number; excerpt: string; label: string }> => {
  const intents = [focus, ...FAST_PATH_FOCI.filter((candidate) => candidate !== focus && FAST_PATH_HEADING_PATTERNS[candidate].test(question))];
  const patterns = intents.map((candidate) => FAST_PATH_HEADING_PATTERNS[candidate]);
  const matchedTitles = document.headings
    .filter((heading) => patterns.some((pattern) => pattern.test(heading.title)))
    .map((heading) => heading.title);
  const terms = questionTerms(question);
  const rankByTitle = (title: string): number => headingRelevance(title, terms);
  const ranked = sectionSegments(document, matchedTitles, rankByTitle)
    .map((segment) => ({ segment, score: rankByTitle(segment.label) }))
    .sort((left, right) => right.score - left.score || left.segment.lineStart - right.segment.lineStart);
  // 先按意图保名额，再按得分补足到 3 段；导语段的名额分配在补足之后进行，
  // 只能挤占填充章节（见上方截断优先级），因此无需再对结果做 slice 截断。
  // 输出保持相关度排序（导语段固定在最前，其后得分降序、行号升序）。
  const reserved = new Set<(typeof ranked)[number]>();
  for (const intent of intents) {
    const covered = Array.from(reserved).some((item) => FAST_PATH_HEADING_PATTERNS[intent].test(item.segment.label));
    if (covered) continue;
    const best = ranked.find((item) => !reserved.has(item) && FAST_PATH_HEADING_PATTERNS[intent].test(item.segment.label));
    if (best) reserved.add(best);
  }
  const chosen = new Set(reserved);
  for (const item of ranked) {
    if (chosen.size >= 3) break;
    chosen.add(item);
  }
  let intro: { lineStart: number; lineEnd: number; excerpt: string; label: string } | null = null;
  if (focus === 'general') {
    const lines = document.content.split('\n');
    const firstHeading = document.headings.find((heading) => heading.level <= 2 && heading.lineStart > 1);
    const introEnd = Math.min(lines.length, (firstHeading?.lineStart ?? lines.length + 1) - 1, 80);
    if (introEnd >= 3 && !Array.from(chosen).some((item) => item.segment.lineStart <= 3)) {
      const introSegment = {
        lineStart: 1,
        lineEnd: introEnd,
        excerpt: lines.slice(0, introEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
        label: 'Overview',
      };
      if (chosen.size >= 3) {
        // 名额已满：只牺牲排序最低的填充章节给导语段让位；填充章节为空
        // （意图保留章节占满名额）时导语段让位，绝不挤占保留章节。
        const fillerItems = ranked.filter((item) => chosen.has(item) && !reserved.has(item));
        if (fillerItems.length > 0) {
          chosen.delete(fillerItems[fillerItems.length - 1]);
          intro = introSegment;
        }
      } else {
        intro = introSegment;
      }
    }
  }
  const segments = ranked.filter((item) => chosen.has(item)).map((item) => item.segment);
  return intro ? [intro, ...segments] : segments;
};

/**
 * 快速路径回答的补充说明：允许模型声明“README 未覆盖 X”，不因可选需求
 * 缺失而臆测（方案 §1.1）。追加在 buildUserPrompt 之后，随回答提示词下发。
 */
export const fastPathAnswerNote = (language: AppLanguage): string => language === 'zh'
  ? '\n\n本轮为快速路径：证据仅来自根 README 的相关章节。若 README 未覆盖用户问题的某个部分，直接说明“未在已读取文件中找到：X”即可；不要为了补全可选需求继续检索，也不得臆测。'
  : '\n\nThis turn used the fast path: evidence comes only from the matched root README sections. If the README does not cover part of the question, state “not found in the files read: X” instead of retrieving further or guessing.';
