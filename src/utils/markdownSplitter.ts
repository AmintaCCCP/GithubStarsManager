// Markdown 分段接口定义
export interface MarkdownSegment {
  id: number;
  type: 'translatable' | 'code_block' | 'inline_code' | 'link' | 'image' | 'linked_image' | 'html_block';
  content: string;
}

// 解析结果接口
interface ParsedContent {
  segments: MarkdownSegment[];
}

// 全局分段 ID 计数器
let segmentIdCounter = 0;

// 将 Markdown 文本分割为可翻译段落
export const splitMarkdownForTranslation = (markdown: string): ParsedContent => {
  segmentIdCounter = 0;
  const segments: MarkdownSegment[] = [];

  // 组合正则表达式：匹配各类 Markdown 元素
  const combinedRegex = /(<picture[\s\S]*?<\/picture>)|(<(?:source|img|video|audio|iframe|object|embed|svg|canvas)[^>]*\/?>)|(```[\s\S]*?```)|(~~~[\s\S]*?~~~)|(`[^`\n]+`)|(\[!\[[^\]]*\]\([^)]*\)\]\([^)]+\))|(!\[([^\]]*)\]\([^)]+\))|(\[([^\]]*)\]\([^)]+\))/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let pendingPrefix = '';

  while ((match = combinedRegex.exec(markdown)) !== null) {
    // 处理匹配项之间的普通文本
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

    // 处理 picture 标签
    if (match[1]) {
      const pictureMatch = match[1];
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(pictureMatch));

      if (prefix) {
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: prefix,
        });
      }

      segments.push({
        id: segmentIdCounter++,
        type: 'html_block',
        content: pictureMatch,
      });
    } else if (match[2]) {
      // 处理其他 HTML 标签
      const htmlTagMatch = match[2];
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(htmlTagMatch));

      if (prefix) {
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: prefix,
        });
      }

      segments.push({
        id: segmentIdCounter++,
        type: 'html_block',
        content: htmlTagMatch,
      });
    } else if (match[3]) {
      // 处理 ``` 代码块
      segments.push({
        id: segmentIdCounter++,
        type: 'code_block',
        content: contentWithPrefix,
      });
    } else if (match[4]) {
      // 处理 ~~~ 代码块
      segments.push({
        id: segmentIdCounter++,
        type: 'code_block',
        content: contentWithPrefix,
      });
    } else if (match[5]) {
      // 处理行内代码
      segments.push({
        id: segmentIdCounter++,
        type: 'inline_code',
        content: contentWithPrefix,
      });
    } else if (match[6]) {
      // 处理带链接的图片
      const linkedImageMatch = match[6];
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(linkedImageMatch));

      if (prefix) {
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: prefix,
        });
      }
      // 将带链接的图片作为独立分段添加
      segments.push({
        id: segmentIdCounter++,
        type: 'linked_image',
        content: linkedImageMatch,
      });
    } else if (match[7]) {
      // 处理普通图片匹配（![alt](url)）
      const altText = match[8] || '';  // 提取图片替代文本
      const imageMatch = match[7];      // 完整的图片匹配字符串
      // 计算 URL 部分的起始和结束位置
      const urlStartIndex = imageMatch.lastIndexOf('](') + 2;
      const urlEndIndex = imageMatch.length - 1;
      const urlPart = `(${imageMatch.substring(urlStartIndex, urlEndIndex)})`;  // 提取 URL 部分
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(imageMatch));  // 前缀文本

      // 如果有替代文本，将图片拆分为可翻译部分和不可翻译的 URL 部分
      if (altText) {
        // 添加前缀文本作为可翻译分段
        if (prefix) {
          segments.push({
            id: segmentIdCounter++,
            type: 'translatable',
            content: prefix,
          });
        }
        // 添加图片标记开始符号
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: '![',
        });
        // 添加替代文本作为可翻译分段
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: `${altText}]`,
        });
        // 添加 URL 作为图片类型分段（不可翻译）
        segments.push({
          id: segmentIdCounter++,
          type: 'image',
          content: urlPart,
        });
      } else {
        // 无替代文本时，将整个图片作为不可翻译分段
        segments.push({
          id: segmentIdCounter++,
          type: 'image',
          content: contentWithPrefix,
        });
      }
    } else if (match[9]) {
      // 处理普通链接匹配（[text](url)）
      const linkText = match[10] || '';  // 提取链接文本
      const linkMatch = match[9];         // 完整的链接匹配字符串
      // 计算 URL 部分的起始和结束位置
      const urlStartIndex = linkMatch.lastIndexOf('](') + 2;
      const urlEndIndex = linkMatch.length - 1;
      const urlPart = `(${linkMatch.substring(urlStartIndex, urlEndIndex)})`;  // 提取 URL 部分
      const prefix = contentWithPrefix.substring(0, contentWithPrefix.indexOf(linkMatch));  // 前缀文本

      // 如果有链接文本，将链接拆分为可翻译部分和不可翻译的 URL 部分
      if (linkText) {
        // 添加前缀文本作为可翻译分段
        if (prefix) {
          segments.push({
            id: segmentIdCounter++,
            type: 'translatable',
            content: prefix,
          });
        }
        // 添加链接文本作为可翻译分段
        segments.push({
          id: segmentIdCounter++,
          type: 'translatable',
          content: `[${linkText}]`,
        });
        // 添加 URL 作为链接类型分段（不可翻译）
        segments.push({
          id: segmentIdCounter++,
          type: 'link',
          content: urlPart,
        });
      } else {
        // 无链接文本时，将整个链接作为不可翻译分段
        segments.push({
          id: segmentIdCounter++,
          type: 'link',
          content: contentWithPrefix,
        });
      }
    }

    // 更新最后处理的位置索引
    lastIndex = match.index + fullMatch.length;
  }
  // 处理剩余的文本内容
  if (lastIndex < markdown.length) {
    const remainingText = markdown.substring(lastIndex);
    // 如果剩余文本非空，添加为可翻译分段
    if (remainingText.trim()) {
      segments.push({
        id: segmentIdCounter++,
        type: 'translatable',
        content: remainingText,
      });
    } else if (segments.length > 0) {
      // 如果剩余文本只有空白字符，追加到最后一个分段
      segments[segments.length - 1] = {
        ...segments[segments.length - 1],
        content: segments[segments.length - 1].content + remainingText,
      };
    }
  }

  // 返回解析结果
  return { segments };
};

// 可翻译块接口定义
export interface TranslatableChunk {
  content: string;      // 块内容
  segmentIds: number[]; // 包含的分段 ID 列表
}

/**
 * 从 Markdown 分段中提取可翻译的块
 * @param segments - Markdown 分段数组
 * @param maxChunkSize - 最大块大小（字符数），默认 5000
 * @returns 可翻译块数组
 */
export const extractTranslatableChunks = (
  segments: MarkdownSegment[],
  maxChunkSize: number = 5000
): TranslatableChunk[] => {
  const chunks: TranslatableChunk[] = [];  // 存储生成的块
  let currentContent = '';                  // 当前块的内容
  let currentIds: number[] = [];            // 当前块包含的分段 ID

  // 遍历所有分段
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    // 跳过不可翻译的分段（代码块、图片等）
    if (segment.type !== 'translatable') {
      // 如果当前块有内容，先保存当前块
      if (currentContent.trim() && currentIds.length > 0) {
        chunks.push({ content: currentContent, segmentIds: [...currentIds] });
        currentContent = '';
        currentIds = [];
      }
      continue;
    }

    // 处理可翻译分段
    if (currentContent.length === 0) {
      // 当前块为空，直接添加
      currentContent = segment.content;
      currentIds = [segment.id];
    } else if (currentContent.length + segment.content.length > maxChunkSize) {
      // 超出最大块大小，保存当前块并开始新块
      chunks.push({ content: currentContent, segmentIds: [...currentIds] });
      currentContent = segment.content;
      currentIds = [segment.id];
    } else {
      // 添加到当前块
      currentContent += segment.content;
      currentIds.push(segment.id);
    }
  }

  // 保存最后一个块（如果有内容）
  if (currentContent.trim() && currentIds.length > 0) {
    chunks.push({ content: currentContent, segmentIds: currentIds });
  }

  return chunks;
};

/**
 * 根据翻译内容重建 Markdown 文本
 * @param segments - 原始 Markdown 分段
 * @param translatedContents - 翻译内容映射（分段 ID -> 翻译文本）
 * @returns 重建后的 Markdown 文本
 */
export const reconstructMarkdown = (
  segments: MarkdownSegment[],
  translatedContents: Map<number, string>
): string => {
  return segments
    .map((segment) => {
      // 只处理可翻译分段
      if (segment.type === 'translatable') {
        const translated = translatedContents.get(segment.id);
        if (translated !== undefined) {
          // 保留原始文本的首尾空白字符
          const leadingWs = segment.content.match(/^\s+/)?.[0] || '';
          const trailingWs = segment.content.match(/\s+$/)?.[0] || '';
          // 去除翻译文本的首尾空白字符
          const trimmedTranslated = translated.replace(/^\s+/, '').replace(/\s+$/, '');
          // 组合保留的空白字符和翻译内容
          return leadingWs + trimmedTranslated + trailingWs;
        }
        // 无翻译时使用原始内容
        return segment.content;
      }
      // 非可翻译分段直接使用原始内容
      return segment.content;
    })
    .join('');
};

/**
 * 合并翻译后的块到分段映射
 * @param chunks - 可翻译块数组
 * @param translations - 翻译结果数组
 * @returns 分段 ID 到翻译内容的映射
 */
export const mergeTranslatedChunks = (
  chunks: TranslatableChunk[],
  translations: string[]
): Map<number, string> => {
  const map = new Map<number, string>();  // 结果映射

  let translationIndex = 0;
  // 遍历每个块及其对应的翻译
  for (const chunk of chunks) {
    const translation = translations[translationIndex] ?? '';  // 获取对应翻译，默认为空字符串
    translationIndex++;

    // 将翻译拆分为与分段数量相等的部分
    const parts = splitTranslationToParts(translation, chunk.segmentIds.length);

    // 将各部分映射到对应的分段 ID
    chunk.segmentIds.forEach((id, index) => {
      map.set(id, parts[index] ?? '');
    });
  }

  return map;
};

/**
 * 将翻译文本拆分为指定数量的部分
 * @param translation - 翻译文本
 * @param partCount - 需要的部分数量
 * @returns 分拆后的翻译文本数组，每个元素为一个部分
 */
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

export const detectLanguage = (content: string): 'zh' | 'en' | 'unknown' => {
  const chineseCharRegex = /[\u4e00-\u9fa5]/;
  const chineseMatch = content.match(chineseCharRegex);

  if (chineseMatch && chineseMatch.length > 0) {
    return 'zh';
  }

  const englishRegex = /[a-zA-Z]/;
  const englishMatch = content.match(englishRegex);

  if (englishMatch && englishMatch.length > 0) {
    return 'en';
  }

  return 'unknown';
};

export const getTranslateDirection = (
  detected: 'zh' | 'en' | 'unknown',
  target: 'zh' | 'en'
): { from: string; to: string } => {
  const sourceLang = detected === 'unknown' ? 'auto' : detected;
  return {
    from: sourceLang,
    to: target,
  };
};