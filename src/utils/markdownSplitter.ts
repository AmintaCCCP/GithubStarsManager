export interface TranslationSegment {
  id: number;
  originalContent: string;
  translatedContent: string | null;
  status: 'pending' | 'translating' | 'done' | 'error';
  hasCodeBlock: boolean;
  hasImage: boolean;
}

interface SplitResult {
  segments: TranslationSegment[];
  placeholderMap: Map<string, string>;
}

let segmentIdCounter = 0;

export const splitMarkdownSimple = (markdown: string): SplitResult => {
  segmentIdCounter = 0;
  const placeholderMap = new Map<string, string>();
  let placeholderIndex = 0;

  const createPlaceholder = (type: string, content: string): string => {
    const key = `__${type}_${placeholderIndex++}__`;
    placeholderMap.set(key, content);
    return key;
  };

  let processed = markdown;

  processed = processed.replace(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g, (match) => {
    return createPlaceholder('CODE', match);
  });

  processed = processed.replace(/!\[[^\]]*\]\([^)]+\)/g, (match) => {
    return createPlaceholder('IMG', match);
  });

  processed = processed.replace(/<a[^>]*>\s*<img[^>]*>[\s\S]*?<\/a>/gi, (match) => {
    return createPlaceholder('LINKED_IMG', match);
  });

  processed = processed.replace(/<img[^>]*>/gi, (match) => {
    return createPlaceholder('HTML_IMG', match);
  });

  const paragraphs = processed.split(/\n\n+/);

  const segments: TranslationSegment[] = paragraphs
    .filter(p => p.trim())
    .map((paragraph) => {
      const hasCodeBlock = paragraph.includes('__CODE_');
      const hasImage = paragraph.includes('__IMG_');
      
      return {
        id: segmentIdCounter++,
        originalContent: paragraph,
        translatedContent: null,
        status: 'pending' as const,
        hasCodeBlock,
        hasImage,
      };
    });

  return { segments, placeholderMap };
};

export const restorePlaceholders = (
  text: string,
  placeholderMap: Map<string, string>
): string => {
  if (!text || !placeholderMap.size) return text;
  
  let result = text;
  
  const entries = Array.from(placeholderMap.entries());
  
  for (const [key, value] of entries) {
    if (result.includes(key)) {
      result = result.split(key).join(value);
      continue;
    }
    
    const coreId = key.replace(/^_+|_+$/g, '');
    const pattern = new RegExp(`_+${coreId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_+`, 'gi');
    
    if (pattern.test(result)) {
      result = result.replace(pattern, value);
    }
  }
  
  return result.trim();
};

export const detectLanguage = (content: string): 'zh' | 'en' | 'unknown' => {
  const chineseCharRegex = /[\u4e00-\u9fa5]/g;
  const englishCharRegex = /[a-zA-Z]/g;
  
  const chineseChars = content.match(chineseCharRegex);
  const englishChars = content.match(englishCharRegex);
  
  const chineseCount = chineseChars ? chineseChars.length : 0;
  const englishCount = englishChars ? englishChars.length : 0;
  
  if (chineseCount === 0 && englishCount === 0) {
    return 'unknown';
  }
  
  const chineseRatio = chineseCount / (chineseCount + englishCount);
  
  if (chineseRatio > 0.3) {
    return 'zh';
  }
  
  return 'en';
};

export const getTranslateDirection = (
  detected: 'zh' | 'en' | 'unknown',
  target: 'zh' | 'en'
): { from?: string; to: string } => {
  if (detected === 'unknown') {
    return { to: target };
  }
  return {
    from: detected,
    to: target,
  };
};

export const segmentsToMarkdown = (segments: TranslationSegment[]): string => {
  return segments
    .map(s => s.translatedContent || s.originalContent)
    .join('\n\n');
};

export const cleanTranslatedText = (text: string): string => {
  if (!text) return text;
  
  let cleaned = text;
  
  cleaned = cleaned.replace(/\u200B/g, '');
  cleaned = cleaned.replace(/\u200C/g, '');
  cleaned = cleaned.replace(/\u200D/g, '');
  cleaned = cleaned.replace(/\uFEFF/g, '');
  cleaned = cleaned.replace(/\u00A0/g, ' ');
  
  cleaned = cleaned.replace(/[\uFF08\uFF09]/g, (match) => match === '\uFF08' ? '(' : ')');
  cleaned = cleaned.replace(/[\uFF3B\uFF3D]/g, (match) => match === '\uFF3B' ? '[' : ']');
  
  const chinesePunctuation = '[。，、；：？！》《〕」』】）…—～·]';
  cleaned = cleaned.replace(
    new RegExp(`(https?://[^\\s<>${chinesePunctuation}]*)(${chinesePunctuation})`, 'gi'),
    '$1 $2'
  );
  
  return cleaned;
};
