const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

const isEscaped = (line: string, index: number): boolean => {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const remendLine = (line: string): string => {
  const ticks = Array.from(line.matchAll(/`/g))
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined && !isEscaped(line, index));
  if (ticks.length % 2 === 1) {
    const lastTick = ticks[ticks.length - 1]!;
    line = line.slice(0, lastTick);
  }
  const openBracket = line.lastIndexOf('[');
  const closeBracket = line.lastIndexOf(']');
  const openLink = line.lastIndexOf('](');
  const linkClosed = openLink >= 0 && line.indexOf(')', openLink + 2) >= 0;
  if (openLink >= 0 && !linkClosed) {
    const linkStart = line.lastIndexOf('[', openLink);
    if (linkStart >= 0) line = line.slice(0, linkStart);
  } else if (openBracket > closeBracket) {
    line = line.slice(0, openBracket);
  }
  return line;
};

/**
 * Keep partially streamed Markdown renderable. Incomplete inline tokens are
 * withheld until their closing delimiter arrives; an open fence is closed
 * temporarily so code does not flash as prose.
 */
export const remendStreamingMarkdown = (content: string): string => {
  let fence: { char: string; length: number } | null = null;
  const lines = content.split('\n').map((line) => {
    if (fence) {
      const close = FENCE_RE.exec(line)?.[1];
      if (close?.[0] === fence.char && close.length >= fence.length && new RegExp(`^\\s{0,3}\\${fence.char}{${fence.length},}\\s*$`).test(line)) {
        fence = null;
      }
      return line;
    }
    const marker = FENCE_RE.exec(line)?.[1];
    if (marker) {
      fence = { char: marker[0]!, length: marker.length };
      return line;
    }
    return remendLine(line);
  });
  const openFence = fence as { char: string; length: number } | null;
  if (openFence) lines.push(openFence.char.repeat(openFence.length));
  const text = lines.join('\n').replace(/\s+$/g, '');
  if (!text) return '';
  return openFence ? `${text}\n\n▍` : `${text} ▍`;
};
