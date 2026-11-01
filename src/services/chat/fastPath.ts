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
 * - general 意图同时带上文档开头的前导段，前导段有两种互斥形态：README 首行
 *   是 H1（或首个标题不在第 1 行）时为首个标题前的导语段（Overview）；README
 *   首行即二级或更低层级标题时为首个章节本身，以该章节自身标题作为 label
 *   （内容不误标 Overview，也不因跳过导语而丢失）。前导段与意图保留章节一并
 *   参与名额分配（名额有余直接入选并固定占据 segments[0]，名额已满只挤出
 *   排序最低的填充章节）。截断优先级：意图保留章节 > 前导段 > 未被意图保留
 *   的填充章节——已保留的意图章节不会被前导段或低分填充章节挤出；意图保留
 *   章节占满 3 个名额的极端组合下前导段让位。首章节前导段只在有匹配章节
 *   （chosen 非空）且名额未满（chosen < 3）时入选：无匹配章节时不以无关首
 *   章节充当证据（快速路径回落完整检索循环），三个匹配章节占满名额时前导段
 *   让位，已匹配章节绝不被未命中的首章节挤出。Overview 导语段边界为首个
 *   位于第 1 行之后的任意层级标题（不限于 H1/H2），且只截取到第一个已选
 *   章节之前，导语内容不与已选章节重复；有效性下限为标题行之外至少一行
 *   非空内容（审计 Ucta：纯标题 + 空行的导语段不生成，该名额不消耗，最低分
 *   填充章节不被挤掉）。首章节前导段截断到嵌套已选章节之前（审计 UctX），
 *   任意两段输出行号区间两两不重叠。
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
  const lines = document.content.split('\n');
  // 先按意图保名额，再按得分补足到 3 段；导语段的名额分配在补足之后进行，
  // 只能挤占填充章节（见上方截断优先级），因此无需再对结果做 slice 截断。
  // 输出保持相关度排序（导语段固定在最前，其后得分降序、行号升序）。
  // 全局不变量：任意两段输出的行号区间两两不重叠。sectionSegments 在同层级或
  // 更高层级标题处切章，嵌套章节（如 `## Installation` 下的 `### Deployment`）
  // 的区间完整落在外层章节区间内，候选与已选区间重叠时按双向语义处置（审计
  // Up04 + nitpick + U7mZ），让实现本身满足该不变量，而非依赖测试 oracle：
  // - 被包含方向（候选起始行落在某个已选章节行区间内，如已选 `## Features`
  //   覆盖候选 `### Features detail`）：候选起点严格早于父章节截断后仍覆盖的
  //   有效区间末行（excerpt 截断行与已入选嵌套章节前缀终点的较小值）才跳过，
  //   不重复输出父章节内容（nitpick 场景不回归）；起点恰为末行（子章节标题是
  //   父章节截断后 excerpt 覆盖的最后一行，审计 VWe7：子章节正文仍在截断点
  //   之后、未出现在父章节可见摘录中）或落在末行之后（父章节正文超 24,000
  //   字符后 excerpt 截断、子章节内容在其后，审计 U7mZ）时，子章节视为未覆盖
  //   候选照常参与名额分配，输出阶段把父章节截断为该子章节之前的前缀——保留
  //   父前缀并纳入子章节，两段零重叠。候选自身包含已入选嵌套章节时按包含方向
  //   前缀处置（admits 按前缀可见范围校验正文），不浪费名额。截断后前缀只剩
  //   标题行（除标题行外无正文）时父章节整体丢弃，不输出纯标题段。
  // - 包含方向（候选起始行早于某个已选章节起始行，如候选 `## Installation`
  //   覆盖已选 `### Deployment`）：候选截断为该已选章节起始行之前的前缀，前缀
  //   除标题行外无非空正文时整体跳过（不产出纯标题段），否则前缀作为证据段
  //   保留——label 仍为候选章节自身标题，安装说明等前缀正文不因子章节入选而
  //   丢失。被包含方向优先：候选起点已落在已选有效区间内时，任何截断都无法
  //   避免重叠，只能整体跳过。
  // - 包含方向截断后，位于截断点之后、父章节原区间内、未被任何已选段覆盖的
  //   其余小节（如 `### macOS`，审计 U7mi）不匹配任何快速路径意图、其他检索
  //   路径也不会选中它们，而快速路径接受部分引用的回答、不回落完整流程——
  //   它们作为独立候选段补入名额（优先级：意图保留 > 前导段 > 填充 > 剩余
  //   小节），受 3 段上限与正文校验约束，行区间与全部已选段两两不重叠。
  //   剩余枚举内部亦然（第 12 轮审计）：上一剩余候选覆盖嵌套标题且该标题位于
  //   其可见摘录之外时，上一候选截断到该标题之前、该标题作为独立候选参选，
  //   内容不因“既不在摘录、也不成独立候选”而丢失。
  // 标题行及其截断残段都不计入正文：完整标题行（'#' 后接空白或行尾）与摘录
  // 截断在标题行的 '#' 序列与标题文字之间时的可见前缀（只剩空白与 '#'，如残段
  // '#'、'##'——不满足“'#' 后接空白”的完整标题形态）都按标题处理；若残段按
  // 普通文本处理会被误判为正文，使可见摘录只有标题与空白的章节通过校验。
  const headingOrTruncatedFragmentPattern = /^\s{0,3}#{1,6}(?:\s|$)/;
  const isHeadingOrFragmentLine = (line: string): boolean =>
    line.trim() === '' || headingOrTruncatedFragmentPattern.test(line);
  const hasBodyContent = (excerpt: string): boolean => {
    let lineStart = 0;
    while (lineStart <= excerpt.length) {
      const lineEnd = excerpt.indexOf('\n', lineStart);
      const end = lineEnd === -1 ? excerpt.length : lineEnd;
      if (!isHeadingOrFragmentLine(excerpt.slice(lineStart, end))) return true;
      if (lineEnd === -1) break;
      lineStart = lineEnd + 1;
    }
    return false;
  };
  let documentLineOffsets: number[] | null = null;
  const documentLineOffset = (lineNumber: number): number => {
    if (documentLineOffsets === null) {
      documentLineOffsets = new Array(lines.length);
      let offset = 0;
      for (let index = 0; index < lines.length; index += 1) {
        documentLineOffsets[index] = offset;
        offset += lines[index].length + 1;
      }
    }
    return documentLineOffsets[lineNumber - 1];
  };
  // 有效性下限（与导语段一致）：区间内除标题行外至少一行非空正文。第 12 轮审计：
  // 正文判定只基于截断后的可见摘录——先把区间行拼接并限制在
  // MAX_EVIDENCE_EXCERPT_CHARS 内再按行检查（与 leadHasContentBeyondHeading 同一
  // 构造方式）。行首空白跨过截断点（该行在摘录内的可见前缀只有空白）、正文整体
  // 位于截断点之后、或摘录末尾只剩标题截断残段的行不计入正文，防止可见摘录
  // 只有标题与空白的章节入选并直接作答。
  const rangeHasBodyContent = (lineStart: number, lineEnd: number): boolean =>
    hasBodyContent(lines.slice(lineStart - 1, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS));
  type RankedItem = (typeof ranked)[number];
  // 行区间 [lineStart, lineEnd] 的拼接文本按 MAX_EVIDENCE_EXCERPT_CHARS 截断后
  // 仍覆盖到的最后一行（审计 U7mZ）：第 L 行在拼接文本中的起始偏移等于其前各
  // 行长度与换行符之和，起始偏移小于上限的最后一行即 excerpt 实际覆盖到的行。
  // 正文超上限时，截断点之后的行不出现在 excerpt 里——既不能视作已被该章节的
  // 证据覆盖，也不能作为“章节有可见正文”的依据（审计 VWfA，见 admits）。
  const excerptCoveredLineEnd = (lineStart: number, lineEnd: number): number => {
    let offset = 0;
    let coveredEnd = lineStart;
    for (let line = lineStart; line <= lineEnd; line += 1) {
      if (offset >= MAX_EVIDENCE_EXCERPT_CHARS) break;
      coveredEnd = line;
      offset += lines[line - 1].length + 1;
    }
    return coveredEnd;
  };
  // 处置结果：null 无有效重叠；'contained' 被包含方向（跳过）；prefixEnd 为包含
  // 方向前缀的末行（最早的被包含已选章节起始行之前，多个被包含章节取最早）。
  // 被包含方向的判定基准是父章节截断后仍覆盖的有效区间（审计 U7mZ）：取
  // excerpt 截断覆盖行与已入选嵌套章节的前缀截断终点的较小值——候选起点严格
  // 早于有效区间末行才跳过；起点恰为末行（子章节标题是父章节截断后摘录覆盖的
  // 最后一行，审计 VWe7：其正文仍在截断点之后、未出现在父章节可见摘录里）或
  // 落在末行之后（父章节正文超 24,000 字符后的嵌套子章节）时照常参与名额分配，
  // 由输出阶段把父章节截断为该子章节之前的前缀（父章节的截断终点取含该子章节
  // 在内的最早嵌套已选章节起始行之前，两段零重叠、不重复输出）。候选自身包含
  // 已入选嵌套章节时落入包含方向前缀处置，admits 按前缀可见范围做正文校验，
  // 前缀摘录不可见即拒绝，不浪费名额。
  const overlapDisposition = (candidate: RankedItem, pool: ReadonlySet<RankedItem>): null | 'contained' | { prefixEnd: number } => {
    let prefixEnd: number | null = null;
    for (const item of pool) {
      if (candidate.segment.lineStart > item.segment.lineStart && candidate.segment.lineStart <= item.segment.lineEnd) {
        let effectiveEnd = excerptCoveredLineEnd(item.segment.lineStart, item.segment.lineEnd);
        for (const nested of pool) {
          if (nested !== item && nested.segment.lineStart > item.segment.lineStart && nested.segment.lineStart <= item.segment.lineEnd) {
            effectiveEnd = Math.min(effectiveEnd, nested.segment.lineStart - 1);
          }
        }
        if (candidate.segment.lineStart < effectiveEnd) return 'contained';
      }
      if (candidate.segment.lineStart < item.segment.lineStart && item.segment.lineStart <= candidate.segment.lineEnd) {
        prefixEnd = prefixEnd === null ? item.segment.lineStart - 1 : Math.min(prefixEnd, item.segment.lineStart - 1);
      }
    }
    return prefixEnd === null ? null : { prefixEnd };
  };
  // 审计 U7mc：无重叠候选同样要求正文——纯标题章节（如紧跟同级标题、自身无
  // 正文的 `## Installation`）不得进入证据，否则快速路径会以空章节作答并通过
  // 核验直接返回，不再执行完整检索。审计 VWfA：正文校验以截断后仍可见的摘录
  // 范围为准——正文完全落在 24,000 字符截断点之后的章节（可见摘录只剩标题与
  // 空白）不得入选且不前导作答；包含方向前缀按同一可见范围校验，保证入选段的
  // 摘录必含非标题正文。
  const admits = (candidate: RankedItem, pool: ReadonlySet<RankedItem>): boolean => {
    const disposition = overlapDisposition(candidate, pool);
    const visibleEnd = Math.min(candidate.segment.lineEnd, excerptCoveredLineEnd(candidate.segment.lineStart, candidate.segment.lineEnd));
    if (disposition === null) return rangeHasBodyContent(candidate.segment.lineStart, visibleEnd);
    if (disposition === 'contained') return false;
    return rangeHasBodyContent(candidate.segment.lineStart, Math.min(disposition.prefixEnd, visibleEnd));
  };
  const reserved = new Set<RankedItem>();
  for (const intent of intents) {
    const covered = Array.from(reserved).some((item) => FAST_PATH_HEADING_PATTERNS[intent].test(item.segment.label));
    if (covered) continue;
    const best = ranked.find((item) => !reserved.has(item) && FAST_PATH_HEADING_PATTERNS[intent].test(item.segment.label) && admits(item, reserved));
    if (best) reserved.add(best);
  }
  const chosen = new Set<RankedItem>(reserved);
  for (const item of ranked) {
    if (chosen.size >= 3) break;
    if (chosen.has(item)) continue;
    if (!admits(item, chosen)) continue;
    chosen.add(item);
  }
  // 前导段（导语位）：general 焦点证据的固定开头，两种形态按首个标题位置互斥。
  // (a) README 首行即为二级或更低层级标题（如 `## License`、`## Example Project`）：
  //     第 1 行已是章节起点，其后内容属于该章节而非导语。守卫分支改为选中首个
  //     章节（审计 ULc4：其描述内容不得因跳过 Overview 导语而丢失），并以该章节
  //     自身标题（如 `License`、`Example Project`）作为 label（审计 UEIs：不得把
  //     章节内容误标为 Overview）。章节边界复用 sectionSegments 的切章语义，与其
  //     他证据段完全一致；首个章节本身已是选中章节（如 `## Features` 开头且被
  //     命中）时不再重复入选。审计 UctX：已选章节还可能嵌套在开头章节内部
  //     （sectionSegments 只在同层级或更高层级标题处切章，`## License` 段完整
  //     覆盖其下 `### Features` 的行区间）——前导段截断到最早的嵌套已选章节
  //     起始行之前，保证与任意已选章节零重叠；截断后除标题行外再无非空内容时
  //     前导段让位（与 Overview 导语同一有效性下限）。入选条件统一走名额模型：
  //     chosen 非空（审计 UVhl：无匹配章节时不得以无关首章节如 License 充当证据
  //     跳过完整检索，应回落完整循环）且 chosen < 3（审计 UVhx：三个匹配章节
  //     占满名额时前导段让位，未命中的首章节绝不挤掉已匹配章节）。入选后总段数
  //     ≤ 3，无需再让位。
  // (b) 首行为 H1（`# 标题`）或首个标题不在第 1 行：首个标题之前的行是真正的
  //     导语，按原有逻辑生成 Overview 导语段。导语边界为首个位于第 1 行之后的
  //     任意层级标题（审计 UVhp：不再限于 H1/H2，H1 后的 H3 章节内容不混入导语
  //     段、不与后续选中章节重复），且只截取到第一个已选章节之前（审计 UVht：
  //     第 2–3 行的三级标题不再使第 1–2 行的标题与描述被整体丢弃）。审计 Ucta：
  //     下限不只是行数——标题行之后必须至少存在一行非空内容，仅含标题与空行的
  //     导语段不生成，该名额不消耗，最低分填充章节不被挤掉；审计 Up06：导语下限
  //     放宽为 introEnd >= 1（首行为说明文字、第 2 行紧接标题的布局导语只有 1 行），
  //     且首行不是标题时有效性检查从第 1 行开始——首行说明文字 + 空行 + 标题的
  //     布局不再因检查跳过首行而丢失导语。
  // 同一 README 只会命中其中一种形态，不会既出 Overview 导语又出首个章节的
  // 重复内容；两种形态的前导段都满足“与任意已选章节零重叠”与“标题行之外
  // 至少一行非空内容”的全局不变量。
  let lead: { lineStart: number; lineEnd: number; excerpt: string; label: string } | null = null;
  // 形态 (a) 前导段的源章节原区间终点：前导段是开头章节被嵌套已选章节截断后的
  // 前缀，其原区间内截断点之后的其余小节同样按 U7mi 补入剩余名额。
  let leadSourceOriginalEnd: number | null = null;
  if (focus === 'general') {
    const openingHeading = document.headings[0];
    const opensWithLowerLevelHeading = openingHeading !== undefined && openingHeading.lineStart === 1 && openingHeading.level > 1;
    // 首行是否为标题行（审计 Up06）：首行为普通说明文字时，第 1 行本身就是
    // 导语内容，有效性下限不得把它排除在检查之外。
    const firstLineIsHeading = openingHeading?.lineStart === 1;
    // 前导段有效性下限（审计 Ucta + U7mX）：除标题行之外至少一行非空正文；
    // 标题行不计入内容（U7mX：`## License` → `### Metadata` → `### Features`
    // 布局中仅含标题的导语段不得保留），与 rangeHasBodyContent 判定一致。
    // 首行不是标题时从第 1 行开始检查（Up06：首行说明文字紧接标题、或隔空行
    // 再接标题的布局不再因检查起点跳过首行而误判为空导语）；首行是标题（H1
    // 或首章节标题）时照旧跳过第 1 行。审计 VWfC：检查基于截断后的摘录——
    // 说明文字前有超长空白行时，按 24,000 字符截断后的摘录只含标题与空白，
    // 该前导段不得占名额；摘录构造与下方 excerpt 字段的实际输出完全一致。
    const leadHasContentBeyondHeading = (lineEnd: number): boolean => {
      const excerptLines = lines.slice(0, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS).split('\n');
      return excerptLines.slice(firstLineIsHeading ? 1 : 0).some((line) => !isHeadingOrFragmentLine(line));
    };
    if (openingHeading && opensWithLowerLevelHeading) {
      const openingSection = sectionSegments(document, [openingHeading.title])
        .find((segment) => segment.lineStart === openingHeading.lineStart) ?? null;
      if (
        openingSection
        && chosen.size > 0
        && chosen.size < 3
        && !Array.from(chosen).some((item) => item.segment.lineStart === openingHeading.lineStart)
      ) {
        // 审计 UctX：嵌套已选章节起始于开头章节行范围内时，前导段截断到该章节
        // 起始行之前（而非整体跳过，保留嵌套章节之上的章节自述内容）。
        const nestedChosenLineStart = Array.from(chosen).reduce(
          (min, item) => (item.segment.lineStart > openingSection.lineStart && item.segment.lineStart <= openingSection.lineEnd
            ? Math.min(min, item.segment.lineStart)
            : min),
          Number.POSITIVE_INFINITY,
        );
        const lineEnd = Math.min(openingSection.lineEnd, nestedChosenLineStart - 1);
        if (leadHasContentBeyondHeading(lineEnd)) {
          lead = {
            lineStart: openingSection.lineStart,
            lineEnd,
            excerpt: lines.slice(0, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
            label: openingSection.label,
          };
          leadSourceOriginalEnd = openingSection.lineEnd;
        }
      }
    } else {
      const firstHeading = document.headings.find((heading) => heading.lineStart > 1);
      const firstChosenLineStart = Array.from(chosen).reduce(
        (min, item) => Math.min(min, item.segment.lineStart),
        Number.POSITIVE_INFINITY,
      );
      const introEnd = Math.min(
        lines.length,
        (firstHeading?.lineStart ?? lines.length + 1) - 1,
        firstChosenLineStart - 1,
        80,
      );
      // 审计 U7mU：无任何匹配章节（chosen 为空）时不产出 Overview 前导段——
      // 否则首行说明文字 + 仅无关标题的布局会以前导段单独回答并跳过完整检索，
      // 应返回空数组回落完整循环。与形态 (a) 的 chosen.size > 0 条件语义一致。
      if (introEnd >= 1 && chosen.size > 0 && leadHasContentBeyondHeading(introEnd)) {
        lead = {
          lineStart: 1,
          lineEnd: introEnd,
          excerpt: lines.slice(0, introEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
          label: 'Overview',
        };
      }
    }
    if (lead) {
      if (chosen.size >= 3) {
        // 名额已满：只牺牲排序最低的填充章节给前导段让位；填充章节为空
        // （意图保留章节占满名额）时前导段让位，绝不挤占保留章节。
        // （形态 (a) 的入选条件已保证 chosen < 3，此分支只作用于 Overview 导语。）
        const fillerItems = ranked.filter((item) => chosen.has(item) && !reserved.has(item));
        if (fillerItems.length > 0) {
          chosen.delete(fillerItems[fillerItems.length - 1]);
        } else {
          lead = null;
        }
      }
    }
  }
  // 包含方向截断（审计 Up04）在此落地：已选章节可能覆盖更早入选的其他已选章节
  // （如 Installation 先于 Deployment 入选且完整覆盖它），输出前把覆盖者的行区间
  // 截断到被覆盖章节起始行之前，保证任意两段输出零重叠；截断后的 excerpt 同步
  // 重建（只含前缀正文）。选择阶段的 admits 已保证不会选出被包含方向的重叠组合，
  // 且覆盖者的截断终点在入选时即已确定（后入章节只会被 contained 跳过或经 U7mZ
  // 有效区间判定入选），故此处重算与选择阶段的前缀一致。
  const chosenItems = Array.from(chosen);
  type OutputSegment = { lineStart: number; lineEnd: number; excerpt: string; label: string };
  const effectiveSegments = new Map<RankedItem, OutputSegment>();
  for (const item of chosenItems) {
    const nestedLineStarts = chosenItems
      .filter((other) => other !== item
        && other.segment.lineStart > item.segment.lineStart
        && other.segment.lineStart <= item.segment.lineEnd)
      .map((other) => other.segment.lineStart);
    if (nestedLineStarts.length === 0) continue;
    const lineEnd = Math.min(...nestedLineStarts) - 1;
    effectiveSegments.set(item, {
      lineStart: item.segment.lineStart,
      lineEnd,
      excerpt: lines.slice(item.segment.lineStart - 1, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
      label: item.segment.label,
    });
  }
  // 全局不变量（纯标题段不入证据）：截断后除标题行外无正文的段整体丢弃，不
  // 输出纯标题段（与前导段截断的 UctX 下限一致）。
  const outputEntries: Array<{ score: number; segment: OutputSegment }> = [];
  for (const item of chosenItems) {
    const segment = effectiveSegments.get(item) ?? item.segment;
    if (!rangeHasBodyContent(segment.lineStart, segment.lineEnd)) continue;
    outputEntries.push({ score: item.score, segment });
  }
  // 审计 U7mi：包含方向截断（父章节为嵌套已选章节让位、或开头章节作为形态 (a)
  // 前导段让位）后，截断点之后、原区间之内、未被任何已选段覆盖的其余小节不得
  // 静默丢弃。这些小节作为独立候选段补入名额（优先级：意图保留 > 前导段 >
  // 填充 > 剩余小节），受 3 段上限与正文校验约束；行区间与全部已选段及相互
  // 之间两两不重叠。
  const leftoverScopes: Array<{ scanStart: number; scanEnd: number }> = [];
  for (const item of chosenItems) {
    const segment = effectiveSegments.get(item) ?? item.segment;
    if (segment.lineEnd >= item.segment.lineEnd) continue;
    leftoverScopes.push({ scanStart: segment.lineEnd + 1, scanEnd: item.segment.lineEnd });
  }
  if (lead && leadSourceOriginalEnd !== null) {
    leftoverScopes.push({ scanStart: lead.lineEnd + 1, scanEnd: leadSourceOriginalEnd });
  }
  const isCovered = (line: number): boolean =>
    outputEntries.some((entry) => line >= entry.segment.lineStart && line <= entry.segment.lineEnd);
  // 未覆盖行段：已选章节原区间两两嵌套或不相交（sectionSegments 切章语义），
  // 同一段未覆盖区间会被内层章节与其外层章节重复枚举——按起点排序后合并相交
  // 行段，只保留最大行段。
  const rawRuns: Array<{ lineStart: number; lineEnd: number }> = [];
  for (const scope of leftoverScopes) {
    let line = scope.scanStart;
    while (line <= scope.scanEnd) {
      if (isCovered(line)) {
        line += 1;
        continue;
      }
      let runEnd = line;
      while (runEnd + 1 <= scope.scanEnd && !isCovered(runEnd + 1)) runEnd += 1;
      rawRuns.push({ lineStart: line, lineEnd: runEnd });
      line = runEnd + 1;
    }
  }
  rawRuns.sort((left, right) => left.lineStart - right.lineStart);
  const leftoverRuns: Array<{ lineStart: number; lineEnd: number }> = [];
  for (const run of rawRuns) {
    const last = leftoverRuns[leftoverRuns.length - 1];
    if (last && run.lineStart <= last.lineEnd) {
      last.lineEnd = Math.max(last.lineEnd, run.lineEnd);
      continue;
    }
    leftoverRuns.push({ lineStart: run.lineStart, lineEnd: run.lineEnd });
  }
  // 每个最大未覆盖行段内按文档顺序枚举章节（切章边界与 sectionSegments 一致，
  // 收敛到行段内；已被前一段覆盖的标题跳过），无正文的章节不入证据（全局
  // 不变量：纯标题段一律不入证据）。审计 VWfA：正文校验按同一可见摘录范围
  // 执行——剩余小节摘录同样受 24,000 字符上限截断，可见范围内无正文的章节
  // 不入证据。审计 VWfE（性能）：切章边界改由一次反向单调栈扫描预计算
  // （headings 按行号严格递增，栈内自顶向底为行号递减、level 非降的序列，
  // 弹出所有 level 更大的标题后栈顶即“下一个同级或更高级标题”，与逐标题从
  // document.headings 头部 `.find` 的 O(H²/2) 结果完全等价）；preceding 覆盖
  // 检查只比较最后一个候选——候选按行号递增加入且两两不重叠（新候选要求
  // 之前无候选覆盖其起始行），更早候选的区间终点必然早于当前标题行，只有
  // 最后一个候选可能覆盖当前标题。第 12 轮审计（剩余枚举）：上一候选覆盖
  // 当前标题时，只有该标题位于上一候选的可见摘录之内（起点严格早于摘录覆盖
  // 末行，与被包含方向处置的 VWe7 边界一致）才沿用覆盖跳过；标题在摘录之外
  // 时上一候选按输出层同一截断语义截断到该标题之前（重建 excerpt 不丢失任何
  // 已可见正文），该标题作为独立候选参与名额分配——其内容不再“既不在任何
  // 摘录中、也不成独立候选”而丢失。截断只缩小上一候选区间，候选仍按行号
  // 递增且两两不重叠，与被包含/包含方向处置及 3 段上限协调、不重复输出。
  const nextSameOrHigherLevelLineStart: number[] = new Array(document.headings.length);
  const boundaryStack: Array<{ level: number; lineStart: number }> = [];
  for (let index = document.headings.length - 1; index >= 0; index -= 1) {
    const heading = document.headings[index];
    while (boundaryStack.length > 0 && boundaryStack[boundaryStack.length - 1].level > heading.level) boundaryStack.pop();
    nextSameOrHigherLevelLineStart[index] = boundaryStack.length > 0
      ? boundaryStack[boundaryStack.length - 1].lineStart
      : lines.length + 1;
    boundaryStack.push({ level: heading.level, lineStart: heading.lineStart });
  }
  const leftoverCandidates: Array<{ score: number; visibleEnd: number; segment: OutputSegment }> = [];
  for (const run of leftoverRuns) {
    for (let headingIndex = 0; headingIndex < document.headings.length; headingIndex += 1) {
      const heading = document.headings[headingIndex];
      if (heading.lineStart < run.lineStart || heading.lineStart > run.lineEnd) continue;
      const sectionEnd = Math.max(heading.lineStart, nextSameOrHigherLevelLineStart[headingIndex] - 1);
      const lineEnd = Math.min(sectionEnd, run.lineEnd);
      if (lineEnd < heading.lineStart) continue;
      const visibleEnd = excerptCoveredLineEnd(heading.lineStart, lineEnd);
      const lastLeftover = leftoverCandidates[leftoverCandidates.length - 1];
      if (lastLeftover && lastLeftover.segment.lineEnd >= heading.lineStart) {
        // 上一候选覆盖该标题：仅当标题位于其可见摘录之内且摘录内确有正文时才
        // 跳过；标题后只有空白、正文位于截断点之后时，该标题照常独立参选。
        const headingOffset = documentLineOffset(heading.lineStart) - documentLineOffset(lastLeftover.segment.lineStart);
        if (
          heading.lineStart < lastLeftover.visibleEnd
          && hasBodyContent(lastLeftover.segment.excerpt.slice(headingOffset))
        ) continue;
        // 标题在可见摘录之外：上一候选截断到该标题之前（输出层同一截断语义，
        // 重建 excerpt 与原摘录一致，不丢失已可见正文），该标题作为独立候选
        // 参与名额分配。visibleEnd 同步收敛到截断后的区间（重建摘录未再触达
        // 截断点时以更小者为准）。
        const truncatedEnd = heading.lineStart - 1;
        lastLeftover.segment = {
          lineStart: lastLeftover.segment.lineStart,
          lineEnd: truncatedEnd,
          excerpt: lines.slice(lastLeftover.segment.lineStart - 1, truncatedEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
          label: lastLeftover.segment.label,
        };
        lastLeftover.visibleEnd = Math.min(lastLeftover.visibleEnd, truncatedEnd);
      }
      if (!rangeHasBodyContent(heading.lineStart, visibleEnd)) continue;
      leftoverCandidates.push({
        score: rankByTitle(heading.title),
        visibleEnd,
        segment: {
          lineStart: heading.lineStart,
          lineEnd,
          excerpt: lines.slice(heading.lineStart - 1, lineEnd).join('\n').slice(0, MAX_EVIDENCE_EXCERPT_CHARS),
          label: heading.title,
        },
      });
    }
  }
  // 名额分配：意图保留章节与前导段优先，剩余小节仅在名额有余时补足（3 段上限）。
  // 审计 VWfH：剩余小节先按得分降序（同分按行号升序）排列再分配名额——按文档
  // 顺序分配会让零分章节挤掉与问题词重合的章节（如得分 0 的 `### Linux` 挤掉
  // 问题提到 Windows 时的 `### Windows`），快速路径接受该回答且不回落完整循环，
  // 高分说明因此缺失。得分排序与最终输出排序使用同一比较规则。
  const rankedLeftovers = [...leftoverCandidates].sort((left, right) => right.score - left.score || left.segment.lineStart - right.segment.lineStart);
  let slotBudget = 3 - outputEntries.length - (lead ? 1 : 0);
  for (const candidate of rankedLeftovers) {
    if (slotBudget <= 0) break;
    outputEntries.push(candidate);
    slotBudget -= 1;
  }
  // 输出保持相关度排序（导语段固定在最前，其后得分降序、行号升序），剩余小节
  // 候选按同一比较规则并入。
  outputEntries.sort((left, right) => right.score - left.score || left.segment.lineStart - right.segment.lineStart);
  const segments = outputEntries.map((entry) => entry.segment);
  return lead ? [lead, ...segments] : segments;
};

/**
 * 快速路径回答的补充说明：允许模型声明“README 未覆盖 X”，不因可选需求
 * 缺失而臆测（方案 §1.1）。追加在 buildUserPrompt 之后，随回答提示词下发。
 */
export const fastPathAnswerNote = (language: AppLanguage): string => language === 'zh'
  ? '\n\n本轮为快速路径：证据仅来自根 README 的相关章节。若 README 未覆盖用户问题的某个部分，直接说明“未在已读取文件中找到：X”即可；不要为了补全可选需求继续检索，也不得臆测。'
  : '\n\nThis turn used the fast path: evidence comes only from the matched root README sections. If the README does not cover part of the question, state “not found in the files read: X” instead of retrieving further or guessing.';
