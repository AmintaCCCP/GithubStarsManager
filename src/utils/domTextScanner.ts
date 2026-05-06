export interface DomBlockSegment {
  id: number;
  element: HTMLElement;
  text: string;
  blockType: 'heading' | 'paragraph' | 'list-item' | 'blockquote' | 'table-cell' | 'other';
  tagName: string;
  hasVisualContent: boolean;
  hasInlineCode: boolean;
}

const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, li, blockquote, th, td, dt, dd, figcaption, summary';

function getBlockType(tagName: string): DomBlockSegment['blockType'] {
  if (/^H[1-6]$/.test(tagName)) return 'heading';
  if (tagName === 'LI') return 'list-item';
  if (tagName === 'BLOCKQUOTE') return 'blockquote';
  if (tagName === 'TH' || tagName === 'TD') return 'table-cell';
  if (tagName === 'P') return 'paragraph';
  return 'other';
}

function hasVisualContent(element: HTMLElement): boolean {
  return element.querySelectorAll('img, svg, pre, video, iframe, picture').length > 0;
}

interface ExtractedText {
  text: string;
  hasInlineCode: boolean;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function extractTextPreservingInlineCode(element: HTMLElement): ExtractedText {
  let result = '';
  let hasInlineCode = false;

  function walk(node: Node): void {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent || '';
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === 'pre' || tag === 'img' || tag === 'svg' || tag === 'input' || tag === 'video' || tag === 'iframe' || tag === 'picture') {
      return;
    }

    if (el.hasAttribute('data-translate') && el.getAttribute('data-translate') === 'false') {
      return;
    }

    if (tag === 'code' && !el.closest('pre')) {
      hasInlineCode = true;
      result += `<code>${escapeHtml(el.textContent || '')}</code>`;
      return;
    }

    const blockTags = /^(p|h[1-6]|li|blockquote|th|td|dt|dd|figcaption|summary)$/i;
    if (blockTags.test(tag) && result.length > 0 && !result.endsWith('\n\n')) {
      result += '\n\n';
    }

    for (let i = 0; i < el.childNodes.length; i++) {
      walk(el.childNodes[i]);
    }
  }

  walk(element);
  return { text: result.trim(), hasInlineCode };
}

function isInsideSkippedElement(element: HTMLElement, root: HTMLElement): boolean {
  let parent = element.parentElement;
  while (parent && parent !== root) {
    const tag = parent.tagName;
    if (tag === 'PRE' || tag === 'CODE') return true;
    parent = parent.parentElement;
  }
  return false;
}

function filterOutermostBlocks(elements: HTMLElement[], container: HTMLElement): HTMLElement[] {
  const elementSet = new Set(elements);
  return elements.filter(el => {
    let parent = el.parentElement;
    while (parent && parent !== container) {
      if (elementSet.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

export function scanDomForTranslation(container: HTMLElement): DomBlockSegment[] {
  const segments: DomBlockSegment[] = [];
  let idCounter = 0;

  const allElements = Array.from(container.querySelectorAll(BLOCK_SELECTOR)) as HTMLElement[];
  const elements = filterOutermostBlocks(allElements, container);

  for (const element of elements) {
    if (isInsideSkippedElement(element, container)) continue;

    const extracted = extractTextPreservingInlineCode(element);
    if (!extracted.text) continue;

    segments.push({
      id: idCounter++,
      element,
      text: extracted.text,
      blockType: getBlockType(element.tagName),
      tagName: element.tagName,
      hasVisualContent: hasVisualContent(element),
      hasInlineCode: extracted.hasInlineCode,
    });
  }

  return segments;
}

export function wrapTextNodesWithAttr(element: HTMLElement, attr: string, value: string): HTMLElement[] {
  const spans: HTMLElement[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const replacements: { textNode: Text; parent: HTMLElement }[] = [];

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent) continue;
    if (parent.tagName === 'CODE' || parent.tagName === 'PRE' || parent.closest('pre')) continue;
    if (parent.closest('[data-translate="false"]')) continue;
    if (!node.textContent?.trim()) continue;
    replacements.push({ textNode: node as Text, parent });
  }

  for (const { textNode, parent } of replacements) {
    const span = document.createElement('span');
    span.setAttribute(attr, value);
    parent.replaceChild(span, textNode);
    span.textContent = textNode.textContent;
    spans.push(span);
  }

  return spans;
}

export function unwrapSpans(spans: HTMLElement[]): void {
  for (const span of spans) {
    const parent = span.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(span.textContent || ''), span);
    }
  }
}

export const ATTR_ORIGINAL = 'data-bi-original';
export const ATTR_TRANSLATION = 'data-bi-translation';
