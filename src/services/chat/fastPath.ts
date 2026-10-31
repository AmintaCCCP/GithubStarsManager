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
  //   覆盖候选 `### Features detail`）：候选起点落在父章节截断后仍覆盖的有效
  //   区间（excerpt 截断行与已入选嵌套章节前缀终点的较小值）内才跳过，不重复
  //   输出父章节内容（nitpick 场景不回归）；落在截断点之后（父章节正文超
  //   24,000 字符后 excerpt 截断、子章节内容在其后，审计 U7mZ）则照常参与名额
  //   分配，输出阶段把父章节截断为该子章节之前的前缀——保留父前缀并纳入子
  //   章节，两段零重叠。截断后前缀只剩标题行（除标题行外无正文）时父章节整体
  //   丢弃，不输出纯标题段。
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
  const headingLinePattern = /^\s{0,3}#{1,6}\s/;
  // 有效性下限（与导语段一致）：区间内除标题行外至少一行非空正文。
  const rangeHasBodyContent = (lineStart: number, lineEnd: number): boolean =>
    lines.slice(lineStart - 1, lineEnd).some((line) => line.trim() !== '' && !headingLinePattern.test(line));
  type RankedItem = (typeof ranked)[number];
  // 章节 excerpt 按 MAX_EVIDENCE_EXCERPT_CHARS 截断后仍覆盖到的最后一行（审计
  // U7mZ）：第 L 行在章节拼接文本中的起始偏移等于其前各行长度与换行符之和，
  // 起始偏移小于上限的最后一行即 excerpt 实际覆盖到的行。章节正文超上限时，
  // 截断点之后的行不出现在 excerpt 里，不能视作已被该章节的证据覆盖。
  const excerptCoveredLineEnd = (item: RankedItem): number => {
    let offset = 0;
    let coveredEnd = item.segment.lineStart;
    for (let line = item.segment.lineStart; line <= item.segment.lineEnd; line += 1) {
      if (offset >= MAX_EVIDENCE_EXCERPT_CHARS) break;
      coveredEnd = line;
      offset += lines[line - 1].length + 1;
    }
    return coveredEnd;
  };
  // 处置结果：null 无有效重叠；'contained' 被包含方向（跳过）；prefixEnd 为包含
  // 方向前缀的末行（最早的被包含已选章节起始行之前，多个被包含章节取最早）。
  // 被包含方向的判定基准是父章节截断后仍覆盖的有效区间（审计 U7mZ）：取
  // excerpt 截断覆盖行与已入选嵌套章节的前缀截断终点的较小值——候选起点落在
  // 有效区间内才跳过；落在截断点之后（父章节正文超 24,000 字符后的嵌套子章节）
  // 则照常参与名额分配，由输出阶段把父章节截断为该子章节之前的前缀。
  const overlapDisposition = (candidate: RankedItem, pool: ReadonlySet<RankedItem>): null | 'contained' | { prefixEnd: number } => {
    let prefixEnd: number | null = null;
    for (const item of pool) {
      if (candidate.segment.lineStart > item.segment.lineStart && candidate.segment.lineStart <= item.segment.lineEnd) {
        let effectiveEnd = excerptCoveredLineEnd(item);
        for (const nested of pool) {
          if (nested !== item && nested.segment.lineStart > item.segment.lineStart && nested.segment.lineStart <= item.segment.lineEnd) {
            effectiveEnd = Math.min(effectiveEnd, nested.segment.lineStart - 1);
          }
        }
        if (candidate.segment.lineStart <= effectiveEnd) return 'contained';
      }
      if (candidate.segment.lineStart < item.segment.lineStart && item.segment.lineStart <= candidate.segment.lineEnd) {
        prefixEnd = prefixEnd === null ? item.segment.lineStart - 1 : Math.min(prefixEnd, item.segment.lineStart - 1);
      }
    }
    return prefixEnd === null ? null : { prefixEnd };
  };
  // 审计 U7mc：无重叠候选同样要求正文——纯标题章节（如紧跟同级标题、自身无
  // 正文的 `## Installation`）不得进入证据，否则快速路径会以空章节作答并通过
  // 核验直接返回，不再执行完整检索。
  const admits = (candidate: RankedItem, pool: ReadonlySet<RankedItem>): boolean => {
    const disposition = overlapDisposition(candidate, pool);
    if (disposition === null) return rangeHasBodyContent(candidate.segment.lineStart, candidate.segment.lineEnd);
    if (disposition === 'contained') return false;
    return rangeHasBodyContent(candidate.segment.lineStart, disposition.prefixEnd);
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
    // 或首章节标题）时照旧跳过第 1 行。
    const leadHasContentBeyondHeading = (lineEnd: number): boolean =>
      lines.slice(firstLineIsHeading ? 1 : 0, lineEnd).some((line) => line.trim() !== '' && !headingLinePattern.test(line));
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
  // 不变量：纯标题段一律不入证据）。
  const leftoverCandidates: Array<{ score: number; segment: OutputSegment }> = [];
  for (const run of leftoverRuns) {
    for (const heading of document.headings) {
      if (heading.lineStart < run.lineStart || heading.lineStart > run.lineEnd) continue;
      const next = document.headings.find((candidate) => candidate.lineStart > heading.lineStart && candidate.level <= heading.level);
      const sectionEnd = Math.max(heading.lineStart, (next?.lineStart ?? lines.length + 1) - 1);
      const lineEnd = Math.min(sectionEnd, run.lineEnd);
      if (lineEnd < heading.lineStart) continue;
      const preceding = leftoverCandidates.filter((entry) => entry.segment.lineEnd >= heading.lineStart);
      if (preceding.length > 0) continue;
      if (!rangeHasBodyContent(heading.lineStart, lineEnd)) continue;
      leftoverCandidates.push({
        score: rankByTitle(heading.title),
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
  let slotBudget = 3 - outputEntries.length - (lead ? 1 : 0);
  for (const candidate of leftoverCandidates) {
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
