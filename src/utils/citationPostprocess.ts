const INLINE_CODE_RE = /(?<!`)`([^`\n]+)`(?!`)/g;
const CITATION_RE = /^\/?([^\s`]+)\s*[-—–]\s+(\d+)(?:\s*-\s*(\d+))?$/;

type InlineCode = { start: number; end: number; token: string; key: string };
export type FenceMarker = { char: string; length: number };

export const fenceMarker = (line: string): FenceMarker | null => {
  const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return match?.[1] ? { char: match[1][0]!, length: match[1].length } : null;
};

export const isClosingFence = (line: string, fence: FenceMarker): boolean => {
  const match = /^ {0,3}(`{3,}|~{3,})\s*$/.exec(line);
  return Boolean(match?.[1] && match[1][0] === fence.char && match[1].length >= fence.length);
};

const isTableSeparatorRow = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.includes('-') && /^[\s|:-]+$/.test(trimmed);
};

const isSetextUnderline = (lines: string[], index: number): boolean => {
  if (index < 1 || !/^ {0,3}(?:=+|-+)\s*$/.test(lines[index] ?? '')) return false;
  const previous = lines[index - 1] ?? '';
  return Boolean(previous.trim())
    && !/^ {0,3}#{1,6}\s+/.test(previous)
    && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(previous);
};

const isThematicBreak = (line: string): boolean => /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);

/** 返回以 end 结束的 Markdown 表格的表头行；普通含竖线正文不算表格。 */
const tableHeaderStart = (lines: string[], end: number): number | null => {
  if (end < 1 || !lines[end]?.includes('|')) return null;
  let start = end;
  while (start >= 0 && lines[start]?.trim() && lines[start]!.includes('|')) start -= 1;
  start += 1;
  for (let index = start + 1; index <= end; index += 1) {
    if (isTableSeparatorRow(lines[index]!)) return index - 1;
  }
  return null;
};

const citationKey = (token: string): string | null => {
  const match = CITATION_RE.exec(token.trim());
  if (!match) return null;
  const [, rawPath, start, end] = match;
  if (token.includes('://') || (!rawPath!.includes('/') && !rawPath!.includes('.'))) return null;
  const path = rawPath!.replace(/^\/+/, '');
  return `${path}:${start}-${end ?? start}`;
};

const inlineCodes = (line: string): InlineCode[] => Array.from(line.matchAll(INLINE_CODE_RE)).flatMap((match) => {
  const token = match[1]?.trim();
  const key = token ? citationKey(token) : null;
  if (!token || !key || match.index === undefined) return [];
  return [{ start: match.index, end: match.index + match[0].length, token: match[0], key }];
});

const mapOutsideFences = (markdown: string, transform: (line: string) => string): string => {
  let fence: FenceMarker | null = null;
  return markdown.split('\n').map((line) => {
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      return line;
    }
    const opened = fenceMarker(line);
    if (opened) {
      fence = opened;
      return line;
    }
    return transform(line);
  }).join('\n');
};

const appendMissingTokens = (line: string, tokens: string[]): string => {
  const existing = new Set(inlineCodes(line).map((item) => item.key));
  const additions = tokens.filter((token) => {
    const key = citationKey(token.replace(/^`+|`+$/g, ''));
    if (!key || existing.has(key)) return false;
    existing.add(key);
    return true;
  });
  return additions.length > 0 ? `${line.trimEnd()} ${additions.join(' ')}` : line;
};

const removeInlineCode = (line: string, match: InlineCode): string => {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? '';
  const before = line.slice(0, match.start);
  const after = line.slice(match.end);
  if (!before.slice(indent.length).trim()) return `${indent}${after.replace(/^[ \t]*/, '')}`;
  const beforeTrimmed = before.trimEnd();
  const afterTrimmed = after.replace(/^[ \t]*/, '');
  if (!afterTrimmed) return beforeTrimmed;
  const separated = /[ \t]$/.test(before) || /^[ \t]/.test(after);
  return `${beforeTrimmed}${separated && !/^[.,;:!?)\]}]/.test(afterTrimmed) ? ' ' : ''}${afterTrimmed}`;
};

const standaloneTokens = (line: string): string[] => {
  const matches = inlineCodes(line);
  if (matches.length === 0) return [];
  let cursor = 0;
  for (const match of matches) {
    if (!/^[\s,，、]*$/.test(line.slice(cursor, match.start))) return [];
    cursor = match.end;
  }
  return /^[\s,，、]*$/.test(line.slice(cursor)) ? matches.map((match) => match.token) : [];
};

/** 把代码块/表格后的独立引用行移到引出该块的正文末尾；列表后的引用落到列表末项。 */
export const liftStandaloneCitationLines = (markdown: string): string => {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let fence: FenceMarker | null = null;
  let currentFenceStart = -1;
  const closedFenceStarts = new Map<number, number>();
  for (const line of lines) {
    if (fence) {
      output.push(line);
      if (isClosingFence(line, fence)) {
        closedFenceStarts.set(output.length - 1, currentFenceStart);
        fence = null;
      }
      continue;
    }
    const opened = fenceMarker(line);
    if (opened) {
      currentFenceStart = output.length;
      output.push(line);
      fence = opened;
      continue;
    }
    const tokens = standaloneTokens(line);
    if (tokens.length === 0) {
      output.push(line);
      continue;
    }
    let target = output.length - 1;
    for (;;) {
      while (target >= 0 && output[target]!.trim() === '') target -= 1;
      if (isSetextUnderline(output, target)) {
        target -= 1;
        continue;
      }
      if (target >= 0 && isThematicBreak(output[target]!)) {
        target -= 1;
        continue;
      }
      const tableStart = tableHeaderStart(output, target);
      if (tableStart !== null) {
        target = tableStart - 1;
        continue;
      }
      const fenceStart = closedFenceStarts.get(target);
      if (fenceStart === undefined) break;
      target = fenceStart - 1;
    }
    if (target < 0 || /^\s{0,3}#{1,6}\s+/.test(output[target]!)) {
      output.push(line);
      continue;
    }
    output[target] = appendMissingTokens(output[target]!, tokens);
    while (output.length > 0 && output[output.length - 1]!.trim() === '') output.pop();
    output.push('');
  }
  return output.join('\n').replace(/^\n+|\n+$/g, '');
};

/** 连续多个引用去重，最多保留 3 个不同来源。 */
export const collapseCitationRuns = (markdown: string): string => mapOutsideFences(markdown, (line) => {
  const matches = inlineCodes(line);
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (let index = 0; index < matches.length;) {
    let end = index + 1;
    while (end < matches.length && /^[\s,，、]*$/.test(line.slice(matches[end - 1]!.end, matches[end]!.start))) end += 1;
    if (end - index > 1) {
      const seen = new Set<string>();
      const tokens = matches.slice(index, end).flatMap((match) => {
        if (seen.has(match.key)) return [];
        seen.add(match.key);
        return [match.token];
      }).slice(0, 3);
      replacements.push({ start: matches[index]!.start, end: matches[end - 1]!.end, text: tokens.join(' ') });
    }
    index = end;
  }
  return replacements.reverse().reduce((result, replacement) => (
    `${result.slice(0, replacement.start)}${replacement.text}${result.slice(replacement.end)}`
  ), line);
});

/** 相邻重复引用去重；段落级重复由 postprocessCitationLayout 再处理。 */
export const dedupeAdjacentCitations = (markdown: string): string => collapseCitationRuns(markdown);

const dedupeParagraph = (paragraph: string): string => {
  const lines = paragraph.split('\n');
  const matches: Array<{ lineIndex: number; match: InlineCode }> = [];
  let fence: FenceMarker | null = null;
  lines.forEach((line, lineIndex) => {
    if (fence) {
      if (isClosingFence(line, fence)) fence = null;
      return;
    }
    const opened = fenceMarker(line);
    if (opened) {
      fence = opened;
      return;
    }
    inlineCodes(line).forEach((match) => matches.push({ lineIndex, match }));
  });
  const lastIndexByKey = new Map<string, number>();
  matches.forEach(({ match }, index) => lastIndexByKey.set(match.key, index));
  const removals = new Map<number, InlineCode[]>();
  matches.forEach(({ lineIndex, match }, index) => {
    if (lastIndexByKey.get(match.key) === index) return;
    const lineRemovals = removals.get(lineIndex) ?? [];
    lineRemovals.push(match);
    removals.set(lineIndex, lineRemovals);
  });
  const withoutDuplicates = lines.map((line, lineIndex) => {
    let result = line;
    for (const match of (removals.get(lineIndex) ?? []).sort((left, right) => right.start - left.start)) {
      result = removeInlineCode(result, match);
    }
    return result;
  }).join('\n');
  return withoutDuplicates;
};

const dedupeParagraphCitations = (markdown: string): string => {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let paragraph: string[] = [];
  let fence: FenceMarker | null = null;
  const flush = () => {
    if (paragraph.length > 0) output.push(dedupeParagraph(paragraph.join('\n')));
    paragraph = [];
  };
  for (const line of lines) {
    if (fence) {
      paragraph.push(line);
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }
    const opened = fenceMarker(line);
    if (opened) {
      paragraph.push(line);
      fence = opened;
      continue;
    }
    if (!line.trim()) {
      flush();
      output.push(line);
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return output.join('\n');
};

/**
 * 统一整理最终回答和流式回答中的引用布局：独立引用行上移、连续引用去重、
 * 同一段重复来源只保留最后一次。
 */
export const postprocessCitationLayout = (markdown: string): string => {
  if (!markdown.trim()) return markdown;
  const lifted = liftStandaloneCitationLines(markdown);
  const collapsed = dedupeAdjacentCitations(lifted);
  // 模型偶尔把区间写成 `1-以24`；只修掉区间前缀的杂字符，保留其中的数字。
  const repairedRanges = mapOutsideFences(collapsed, (line) => line.replace(
    /(\/[^`\n]+?\s*[-—–]\s*\d+)-[^\d`\s]+(\d+)`/g,
    '$1-$2`',
  ));
  // 被校验器移除的无效来源会留下空括号（`... on TTYs ()`），清掉这段残留。
  const withoutEmptyParens = mapOutsideFences(repairedRanges, (line) => line.replace(/[ \t]*\(\s*\)/g, ''));
  return dedupeParagraphCitations(withoutEmptyParens)
    .replace(/^\n+|\n+$/g, '');
};
