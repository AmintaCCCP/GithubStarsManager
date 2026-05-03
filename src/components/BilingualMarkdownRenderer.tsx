import React, { memo, useMemo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { TranslationSegment } from '../utils/markdownSplitter';
import { Loader2 } from 'lucide-react';

interface BilingualMarkdownRendererProps {
  segments: TranslationSegment[];
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  showTranslation?: boolean;
  language?: 'zh' | 'en';
}

const SegmentBlock: React.FC<{
  segment: TranslationSegment;
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  showTranslation: boolean;
  language: 'zh' | 'en';
}> = memo(({ segment, baseUrl, headingIds, fontSize, showTranslation, language }) => {
  const isTranslating = segment.status === 'translating';
  const hasTranslation = segment.translatedContent !== null && segment.status === 'done';

  return (
    <div className="segment-block mb-4">
      <div className="original-content">
        <MarkdownRenderer
          content={segment.originalContent}
          baseUrl={baseUrl}
          headingIds={headingIds}
          fontSize={fontSize}
          enableHtml={true}
        />
      </div>
      
      {showTranslation && (
        <>
          {isTranslating && (
            <div className="translated-content mt-2 pl-3 border-l-2 border-blue-400/50">
              <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-text-quaternary">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>{language === 'zh' ? '翻译中...' : 'Translating...'}</span>
              </div>
            </div>
          )}
          
          {hasTranslation && segment.translatedContent && (
            <div className="translated-content mt-2 pl-3 border-l-2 border-blue-400 dark:border-blue-500">
              <MarkdownRenderer
                content={segment.translatedContent}
                baseUrl={baseUrl}
                headingIds={headingIds}
                fontSize={fontSize}
                enableHtml={true}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
});

SegmentBlock.displayName = 'SegmentBlock';

const BilingualMarkdownRenderer: React.FC<BilingualMarkdownRendererProps> = memo(({
  segments,
  baseUrl,
  headingIds,
  fontSize = 'medium',
  showTranslation = true,
  language = 'zh',
}) => {
  const renderedSegments = useMemo(() => {
    return segments.map((segment) => (
      <SegmentBlock
        key={segment.id}
        segment={segment}
        baseUrl={baseUrl}
        headingIds={headingIds}
        fontSize={fontSize}
        showTranslation={showTranslation}
        language={language}
      />
    ));
  }, [segments, baseUrl, headingIds, fontSize, showTranslation, language]);

  return (
    <div className="bilingual-markdown">
      {renderedSegments}
    </div>
  );
});

BilingualMarkdownRenderer.displayName = 'BilingualMarkdownRenderer';

export default BilingualMarkdownRenderer;
