import React, { memo, useMemo } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { TranslationSegment } from '../utils/markdownSplitter';

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
}> = memo(({ segment, baseUrl, headingIds, fontSize, showTranslation }) => {
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
      
      {showTranslation && hasTranslation && segment.translatedContent && (
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
