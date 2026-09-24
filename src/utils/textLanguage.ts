import type { AppLanguage } from '../i18n/languages';

/**
 * 轻量级「文本是否已是目标语言」启发式判断。
 *
 * 自动翻译仓库描述前先粗判一遍：明显同语言的文本直接跳过，避免对整页
 * 卡片发起大量无谓的翻译请求（尤其 AI 引擎按额度计费）。只做书写系统
 * 与常用虚词级别的判断，不求精确——
 * - 误判为「不同语言」的代价只是多一次无害的翻译请求；
 * - 误判为「相同语言」主要发生在拉丁语系内部虚词平手时，按英文兜底
 *   （技术类描述以英文为主），同样只是少翻译一次边缘文本。
 */
const countMatches = (text: string, pattern: RegExp): number =>
  (text.match(pattern) ?? []).length;

// 主要书写系统的字符区间（覆盖扩展区）。
const HAN_PATTERN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g;
const KANA_PATTERN = /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/g;
const HANGUL_PATTERN = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF]/g;
const CYRILLIC_PATTERN = /[\u0400-\u04FF]/g;
// 拉丁字母：基础区 + 扩展区（法/德/西/葡的变音字母）。
const LATIN_PATTERN = /[A-Za-z\u00C0-\u024F]/g;
// 拉丁扩展区（波兰/捷克/土耳其/越南语等）：应用支持的 5 种拉丁语言都不使用。
const LATIN_EXTENDED_PATTERN = /[\u0100-\u024F\u1E00-\u1EFF]/g;
// 变音字母区（含法语 Œ/œ 连字）：英文从不使用，法/德/西/葡自身在用。
const ACCENTED_LATIN_PATTERN = /[\u00C0-\u00FF\u0152\u0153]/g;

// 拉丁语系常用虚词（整词匹配）。英法德西葡虚词高度重合（de/la/in 等
// 跨语言共享），只在某语言「严格胜出」时采信，平手按英文兜底。
const LATIN_STOPWORD_PATTERNS: Array<{ lang: 'en' | 'fr' | 'de' | 'es' | 'pt-BR'; pattern: RegExp }> = [
  { lang: 'en', pattern: /\b(?:the|and|for|with|your|from|this|that|are|into|not|you|can|will)\b/gi },
  { lang: 'fr', pattern: /\b(?:les|des|une|pour|avec|dans|est|sur|aux|cette|votre|sont)\b/gi },
  { lang: 'de', pattern: /\b(?:der|die|das|und|für|mit|von|den|dem|ein|eine|ist|sich|auf)\b/gi },
  { lang: 'es', pattern: /\b(?:los|las|una|del|que|más|como|pero|sus|son|este)\b/gi },
  { lang: 'pt-BR', pattern: /\b(?:dos|das|uma|não|você|vocês|então|também|pelo|pelos|são)\b/gi },
];

/**
 * 判断文本是否「很可能」已经是目标语言（true = 无需翻译）。
 * 判断不了的复杂场景一律返回 false，交给翻译引擎处理。
 */
export const isLikelySameLanguage = (text: string, target: AppLanguage): boolean => {
  const trimmed = text.trim();
  if (!trimmed) return true;

  const han = countMatches(trimmed, HAN_PATTERN);
  const kana = countMatches(trimmed, KANA_PATTERN);
  const hangul = countMatches(trimmed, HANGUL_PATTERN);
  const cyrillic = countMatches(trimmed, CYRILLIC_PATTERN);
  const latin = countMatches(trimmed, LATIN_PATTERN);
  const nonLatin = han + kana + hangul + cyrillic;

  // CJK / 西里尔目标语言按主导书写系统判断。
  if (target === 'ja') return kana > 0;
  // 简繁变体不做区分：中文描述对 zh/zh-TW 用户都可读，不值得为此翻一遍。
  if (target === 'zh' || target === 'zh-TW') return han > 0 && kana === 0 && hangul === 0;
  if (target === 'ko') return hangul > 0;
  if (target === 'ru') return cyrillic > 0 && cyrillic >= latin;

  // 拉丁字母目标语言（en/fr/de/es/pt-BR）：文本以非拉丁为主时交给翻译。
  if (latin === 0 || latin < nonLatin) return false;
  // 出现扩展区字符即视为不同语言（见 LATIN_EXTENDED_PATTERN 注释）。
  if (countMatches(trimmed, LATIN_EXTENDED_PATTERN) > 0) return false;
  // en 不使用变音字母：带变音符的拉丁文本对 en 一律交给翻译，
  // 避免无虚词的法/德/西等描述被误判为英文而漏翻。
  if (target === 'en' && countMatches(trimmed, ACCENTED_LATIN_PATTERN) > 0) return false;

  const scores = LATIN_STOPWORD_PATTERNS.map(({ lang, pattern }) => ({
    lang,
    score: countMatches(trimmed, pattern),
  }));
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const second = scores[1]?.score ?? 0;

  // 无虚词信号或并列第一：无法可靠区分，按英文兜底。
  if (!top || top.score === 0 || second === top.score) {
    return target === 'en';
  }
  return top.lang === target;
};
