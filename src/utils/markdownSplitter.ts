export interface MarkdownSegment {
  id: number;
  type: 'translatable' | 'code_block' | 'inline_code' | 'link' | 'image';
  content: string;
}

interface ParsedContent {
  segments: MarkdownSegment[];
}

let segmentIdCounter = 0;

export const splitMarkdownForTranslation = (markdown: string): ParsedContent => {
  segmentIdCounter = 0;
  const segments: MarkdownSegment[] = [];

  const combinedRegex = /(```[\s\S]*?```)|(~~~[\s\S]*?~~~)|(`[^`\n]+`)|(!\[([^\]]*)\]\([^)]+\))|(\[([^\]]*)\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pendingPrefix = '';

  while ((match = combinedRegex.exec(markdown)) !== null) {
    if (match.index > lastIndex) {
      const textBetween = markdown.substring(lastIndex, match.index);
      if (textBetween.trim()) {
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: textBetween,
        });
      } else {
        pendingPrefix += textBetween;
      }
    }

    const fullMatch = match[0];
    const contentWithPrefix = pendingPrefix + fullMatch;
    pendingPrefix = '';

    if (match[1]) {
      segments.push({
        id: segmentIdCounter++,
        type: 'code_block',
        content: contentWithPrefix,
      });
    } else if (match[2]) {
      segments.push({
        id: segmentIdCounter++,
        type: 'code_block',
        content: contentWithPrefix,
      });
    } else if (match[3]) {
      segments.push({
        id: segmentIdCounter++,
        type: 'inline_code',
        content: contentWithPrefix,
      });
    } else if (match[4]) {
      const altText = match[5] || '';
      const imageMatch = match[4];
      const urlPart = imageMatch.substring(imageMatch.lastIndexOf(']('));
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(imageMatch));
      
      if (altText) {
        if (prefix) {
          segments.push({
            id: segmentIdCounter++,
            type: 'translatable',
            content: prefix,
          });
        }
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: '![',
        });
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: altText,
        });
        segments.push({
          id: segmentIdCounter++,
          type: 'image',
          content: urlPart,
        });
      } else {
        segments.push({
          id: segmentIdCounter++,
          type: 'image',
          content: contentWithPrefix,
        });
      }
    } else if (match[6]) {
      const linkText = match[7] || '';
      const linkMatch = match[6];
      const urlPart = linkMatch.substring(linkMatch.lastIndexOf(']('));
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(linkMatch));
      
      if (linkText) {
        if (prefix) {
          segments.push({
            id: segmentIdCounter++,
            type: 'translatable',
            content: prefix,
          });
        }
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: '[',
        });
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: linkText,
        });
        segments.push({
          id: segmentIdCounter++,
          type: 'link',
          content: urlPart,
        });
      } else {
        segments.push({
          id: segmentIdCounter++,
          type: 'link',
          content: contentWithPrefix,
        });
      }
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < markdown.length) {
    const remainingText = markdown.substring(lastIndex);
    if (remainingText.trim()) {
      segments.push({
        id: segmentIdCounter++,
        type: 'translatable',
        content: remainingText,
      });
    } else if (segments.length > 0) {
      segments[segments.length - 1] = {
        ...segments[segments.length - 1],
        content: segments[segments.length - 1].content + remainingText,
      };
    }
  }

  return { segments };
};

export interface TranslatableChunk {
  content: string;
  segmentIds: number[];
}

export const extractTranslatableChunks = (
  segments: MarkdownSegment[],
  maxChunkSize: number = 5000
): TranslatableChunk[] => {
  const chunks: TranslatableChunk[] = [];
  let currentContent = '';
  let currentIds: number[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    if (segment.type !== 'translatable') {
      if (currentContent.trim() && currentIds.length > 0) {
        chunks.push({ content: currentContent, segmentIds: [...currentIds] });
        currentContent = '';
        currentIds = [];
      }
      continue;
    }

    if (currentContent.length === 0) {
      currentContent = segment.content;
      currentIds = [segment.id];
    } else if (currentContent.length + segment.content.length > maxChunkSize) {
      chunks.push({ content: currentContent, segmentIds: [...currentIds] });
      currentContent = segment.content;
      currentIds = [segment.id];
    } else {
      currentContent += segment.content;
      currentIds.push(segment.id);
    }
  }

  if (currentContent.trim() && currentIds.length > 0) {
    chunks.push({ content: currentContent, segmentIds: currentIds });
  }

  return chunks;
};

export const reconstructMarkdown = (
  segments: MarkdownSegment[],
  translatedContents: Map<number, string>
): string => {
  return segments
    .map((segment) => {
      if (segment.type === 'translatable') {
        const translated = translatedContents.get(segment.id);
        if (translated !== undefined) {
          const leadingWs = segment.content.match(/^\s+/)?.[0] || '';
          const trailingWs = segment.content.match(/\s+$/)?.[0] || '';
          const trimmedTranslated = translated.replace(/^\s+/, '').replace(/\s+$/, '');
          return leadingWs + trimmedTranslated + trailingWs;
        }
        return segment.content;
      }
      return segment.content;
    })
    .join('');
};

export const mergeTranslatedChunks = (
  chunks: TranslatableChunk[],
  translations: string[]
): Map<number, string> => {
  const map = new Map<number, string>();

  let translationIndex = 0;
  for (const chunk of chunks) {
    const translation = translations[translationIndex] ?? '';
    translationIndex++;

    const parts = splitTranslationToParts(translation, chunk.segmentIds.length);

    chunk.segmentIds.forEach((id, index) => {
      map.set(id, parts[index] ?? '');
    });
  }

  return map;
};

const splitTranslationToParts = (translation: string, partCount: number): string[] => {
  if (partCount <= 1) return [translation];

  const parts: string[] = [];

  const paragraphs = translation.split(/\n\n+/);

  if (paragraphs.length >= partCount) {
    const ratio = paragraphs.length / partCount;
    for (let i = 0; i < partCount; i++) {
      const start = Math.round(i * ratio);
      const end = Math.round((i + 1) * ratio);
      parts.push(paragraphs.slice(start, end).join('\n\n'));
    }
  } else {
    const mid = Math.floor(paragraphs.length / 2);
    parts.push(paragraphs.slice(0, mid).join('\n\n'));
    parts.push(paragraphs.slice(mid).join('\n\n'));

    while (parts.length < partCount) {
      parts.push('');
    }
  }

  return parts.slice(0, partCount);
};

export const detectLanguage = (text: string): 'zh' | 'en' | 'unknown' => {
  const chineseRegex = /[\u4e00-\u9fa5]/g;
  const chineseMatches = text.match(chineseRegex);
  const chineseCount = chineseMatches ? chineseMatches.length : 0;

  const englishRegex = /[a-zA-Z]/g;
  const englishMatches = text.match(englishRegex);
  const englishCount = englishMatches ? englishMatches.length : 0;

  const totalLetters = chineseCount + englishCount;
  if (totalLetters === 0) return 'unknown';

  const chineseRatio = chineseCount / totalLetters;

  if (chineseRatio > 0.3) return 'zh';
  if (chineseRatio < 0.1) return 'en';
  return 'unknown';
};

export const getTranslateDirection = (sourceLang: 'zh' | 'en' | 'unknown', targetLang: 'zh' | 'en'): { from: string; to: string } => {
  if (sourceLang === 'unknown') {
    return { from: '', to: targetLang === 'zh' ? 'zh-Hans' : 'en' };
  }

  if (sourceLang === targetLang) {
    return { from: sourceLang === 'zh' ? 'zh-Hans' : 'en', to: sourceLang === 'zh' ? 'en' : 'zh-Hans' };
  }

  return {
    from: sourceLang === 'zh' ? 'zh-Hans' : 'en',
    to: targetLang === 'zh' ? 'zh-Hans' : 'en',
  };
};
