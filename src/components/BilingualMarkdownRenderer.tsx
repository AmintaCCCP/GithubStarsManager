import React, { memo, useMemo, useState } from 'react';
import MarkdownRenderer from './MarkdownRenderer';
import { TranslationSegment } from '../utils/markdownSplitter';
import { FileText, Languages, Eye, EyeOff } from 'lucide-react';

export type DisplayMode = 'original' | 'translated' | 'bilingual';

interface BilingualMarkdownRendererProps {
  segments: TranslationSegment[];
  placeholderMap: Map<string, string>;
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  language?: 'zh' | 'en';
  defaultDisplayMode?: DisplayMode;
  onDisplayModeChange?: (mode: DisplayMode) => void;
}

const SegmentBlock: React.FC<{
  segment: TranslationSegment;
  placeholderMap: Map<string, string>;
  baseUrl?: string;
  headingIds?: Map<string, string>;
  fontSize?: 'small' | 'medium' | 'large';
  displayMode: DisplayMode;
}> = memo(({ segment, placeholderMap, baseUrl, headingIds, fontSize, displayMode }) => {
  const hasTranslation = segment.translatedContent !== null && segment.status === 'done';

  const getDisplayContent = (content: string): string => {
    if (!content || !placeholderMap.size) return content;

    let result = content;
    
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
    
    const placeholderPattern = /__[A-Z]+_\d+__/g;
    result = result.replace(placeholderPattern, (match) => {
      const coreId = match.replace(/^_+|_+$/g, '');
      const found = Array.from(placeholderMap.entries()).find(([k]) => k.replace(/^_+|_+$/g, '') === coreId);
      if (found) {
        return found[1];
      }
      return match;
    });
    
    return result;
  };

  if (displayMode === 'original') {
    return (
      <div className="segment-block mb-4">
        <MarkdownRenderer
          content={getDisplayContent(segment.originalContent)}
          baseUrl={baseUrl}
          headingIds={headingIds}
          fontSize={fontSize}
          enableHtml={true}
        />
      </div>
    );
  }

  if (displayMode === 'translated') {
    if (!hasTranslation || !segment.translatedContent) {
      return (
        <div className="segment-block mb-4">
          <MarkdownRenderer
            content={getDisplayContent(segment.originalContent)}
            baseUrl={baseUrl}
            headingIds={headingIds}
            fontSize={fontSize}
            enableHtml={true}
          />
        </div>
      );
    }

    return (
      <div className="segment-block mb-4">
        <MarkdownRenderer
          content={getDisplayContent(segment.translatedContent)}
          baseUrl={baseUrl}
          headingIds={headingIds}
          fontSize={fontSize}
          enableHtml={true}
        />
      </div>
    );
  }

  return (
    <div className="segment-block mb-4">
      <div className="original-content">
        <MarkdownRenderer
          content={getDisplayContent(segment.originalContent)}
          baseUrl={baseUrl}
          headingIds={headingIds}
          fontSize={fontSize}
          enableHtml={true}
        />
      </div>
      
      {hasTranslation && segment.translatedContent && (
        <div className="translated-content mt-2 pl-3 border-l-2 border-blue-400 dark:border-blue-500">
          <MarkdownRenderer
            content={getDisplayContent(segment.translatedContent)}
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
  placeholderMap,
  baseUrl,
  headingIds,
  fontSize = 'medium',
  language = 'zh',
  defaultDisplayMode = 'bilingual',
  onDisplayModeChange,
}) => {
  const [displayMode, setDisplayMode] = useState<DisplayMode>(defaultDisplayMode);

  const handleModeChange = (newMode: DisplayMode) => {
    setDisplayMode(newMode);
    onDisplayModeChange?.(newMode);
  };

  const renderedSegments = useMemo(() => {
    return segments.map((segment) => (
      <SegmentBlock
        key={segment.id}
        segment={segment}
        placeholderMap={placeholderMap}
        baseUrl={baseUrl}
        headingIds={headingIds}
        fontSize={fontSize}
        displayMode={displayMode}
      />
    ));
  }, [segments, placeholderMap, baseUrl, headingIds, fontSize, displayMode]);

  const modeButtons = [
    { 
      mode: 'original' as DisplayMode, 
      icon: FileText, 
      label: language === 'zh' ? '原文' : 'Original',
      active: displayMode === 'original'
    },
    { 
      mode: 'translated' as DisplayMode, 
      icon: Languages, 
      label: language === 'zh' ? '译文' : 'Translated',
      active: displayMode === 'translated'
    },
    { 
      mode: 'bilingual' as DisplayMode, 
      icon: Eye, 
      label: language === 'zh' ? '双语' : 'Bilingual',
      active: displayMode === 'bilingual'
    },
  ];

  return (
    <div className="bilingual-markdown">
      <div className="flex items-center justify-end gap-1 mb-3 pb-2 border-b border-gray-100 dark:border-white/[0.04]">
        {modeButtons.map(({ mode, icon: Icon, label, active }) => (
          <button
            key={mode}
            onClick={() => handleModeChange(mode)}
            className={`flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors ${
              active
                ? 'bg-brand-indigo/20 text-brand-violet dark:bg-brand-indigo/10'
                : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-light-surface dark:hover:bg-white/5'
            }`}
            title={label}
          >
            <Icon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      {renderedSegments}
    </div>
  );
});

BilingualMarkdownRenderer.displayName = 'BilingualMarkdownRenderer';

export default BilingualMarkdownRenderer;
