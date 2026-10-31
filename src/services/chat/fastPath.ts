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
 * - 命中章节按问题词与标题的重合度排序后再截取前三段（审计意见：仅按类别
 *   取前三段会让排在第四位的真正相关章节进不了证据）；
 * - general 意图同时带上首个标题前的导语段。
 */
export const selectFastPathSegments = (
  document: CachedDocument,
  focus: FastPathFocus,
  question: string,
): Array<{ lineStart: number; lineEnd: number; excerpt: string; label: string }> => {
  const extraFoci = FAST_PATH_FOCI.filter((candidate) => candidate !== focus && FAST_PATH_HEADING_PATTERNS[candidate].test(question));
  const patterns = [FAST_PATH_HEADING_PATTERNS[focus], ...extraFoci.map((candidate) => FAST_PATH_HEADING_PATTERNS[candidate])];
  const matchedTitles = document.headings
    .filter((heading) => patterns.some((pattern) => pattern.test(heading.title)))
    .map((heading) => heading.title);
  const terms = questionTerms(question);
  const segments = sectionSegments(document, matchedTitles)
    .map((segment) => ({ segment, score: headingRelevance(segment.label, terms) }))
    .sort((left, right) => right.score - left.score || left.segment.lineStart - right.segment.lineStart)
    .slice(0, 3)
    .map((item) => item.segment);
  if (focus === 'general') {
    const lines = document.content.split('\n');
    const firstHeading = document.headings.find((heading) => heading.level <= 2 && heading.lineStart > 1);
    const introEnd = Math.min(lines.length, (firstHeading?.lineStart ?? lines.length + 1) - 1, 80);
    if (introEnd >= 3 && !segments.some((segment) => segment.lineStart <= 3)) {
      segments.unshift({
        lineStart: 1,
        lineEnd: introEnd,
        excerpt: lines.slice(0, introEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
        label: 'Overview',
      });
    }
  }
  return segments.slice(0, 3);
};

/**
 * 快速路径回答的补充说明：允许模型声明“README 未覆盖 X”，不因可选需求
 * 缺失而臆测（方案 §1.1）。追加在 buildUserPrompt 之后，随回答提示词下发。
 */
export const fastPathAnswerNote = (language: AppLanguage): string => language === 'zh'
  ? '\n\n本轮为快速路径：证据仅来自根 README 的相关章节。若 README 未覆盖用户问题的某个部分，直接说明“未在已读取文件中找到：X”即可；不要为了补全可选需求继续检索，也不得臆测。'
  : '\n\nThis turn used the fast path: evidence comes only from the matched root README sections. If the README does not cover part of the question, state “not found in the files read: X” instead of retrieving further or guessing.';
