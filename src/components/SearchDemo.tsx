



import { useT } from '../i18n/useT';
import { Button } from './ui/button';
import React, { useState } from 'react';
import { Search, Bot, Lightbulb, Play, CheckCircle } from 'lucide-react';

interface SearchExample {
  query: string;
  type: 'realtime' | 'ai';
  description: string;
  expectedResults: string[];
}

const searchExamples: SearchExample[] = [
  {
    query: 'react',
    type: 'realtime',
    description: '实时搜索仓库名称',
    expectedResults: ['匹配名称包含"react"的仓库']
  },
  {
    query: 'vue',
    type: 'realtime', 
    description: '快速匹配Vue相关仓库',
    expectedResults: ['Vue.js相关项目']
  },
  {
    query: '查找所有笔记应用',
    type: 'ai',
    description: 'AI语义搜索中文查询',
    expectedResults: ['Obsidian', 'Notion', 'Logseq等笔记工具']
  },
  {
    query: 'find machine learning frameworks',
    type: 'ai',
    description: 'AI跨语言搜索',
    expectedResults: ['TensorFlow', 'PyTorch', 'scikit-learn等ML框架']
  },
  {
    query: '代码编辑器',
    type: 'ai',
    description: 'AI理解中文意图',
    expectedResults: ['VSCode', 'Vim', 'Emacs等编辑器']
  },
  {
    query: 'web development tools',
    type: 'ai',
    description: 'AI匹配开发工具',
    expectedResults: ['Webpack', 'Vite', 'React等前端工具']
  }
];

export const SearchDemo: React.FC = () => {
  const [selectedExample, setSelectedExample] = useState<SearchExample | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  const t = useT('app');

  const handleExampleClick = (example: SearchExample) => {
    setSelectedExample(example);
    // 这里可以触发实际的搜索演示
    console.log(`演示搜索: ${example.query} (${example.type})`);
  };

  if (!showDemo) {
    return (
      <div className="mb-4 rounded-lg bg-raised p-4 shadow-elev-1">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="inline-grid size-control-lg place-items-center rounded-md bg-accent-tint text-accent-text">
              <Lightbulb className="size-4" />
            </div>
            <div>
              <h3 className="text-label-lg font-semibold text-foreground">
                {t('searchDemo.search-feature-upgrade')}
              </h3>
              <p className="text-label-sm text-secondary">
                {t('searchDemo.experience-new-real-time-and-ai-semantic-search')}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={() => setShowDemo(true)}
            className="h-control shrink-0 rounded-md"
          >
            <Play className="size-3.5" />
            <span>{t('searchDemo.view-demo')}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-lg bg-raised p-5 shadow-elev-1">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="inline-grid size-control-lg place-items-center rounded-md bg-accent-tint text-accent-text">
            <Search className="size-4" />
          </div>
          <div>
            <h3 className="text-label-lg font-semibold text-foreground">
              {t('searchDemo.search-feature-demo')}
            </h3>
            <p className="text-label-sm text-secondary">
              {t('searchDemo.click-examples-below-to-experience-different-sea')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShowDemo(false)}
          aria-label={t('searchDemo.close-search-demo')}
          className="size-control rounded-md text-tertiary hover:text-foreground"
        >
          ×
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* 实时搜索示例 */}
        <div className="space-y-2">
          <div className="mb-2 flex items-center gap-2">
            <div className="size-1.5 rounded-full bg-accent-solid animate-pulse" />
            <h4 className="text-label font-medium text-foreground">
              {t('searchDemo.real-time-search')}
            </h4>
          </div>
          {searchExamples
            .filter(example => example.type === 'realtime')
            .map((example, index) => (
              <Button
                key={index}
                type="button"
                variant="ghost"
                aria-pressed={selectedExample?.query === example.query}
                onClick={() => handleExampleClick(example)}
                className={`h-auto w-full flex-col items-start justify-start rounded-md p-2.5 text-left transition-[background-color,box-shadow] ${
                  selectedExample?.query === example.query
                    ? 'bg-fill-selected shadow-[inset_0_0_0_1px_var(--focus-ring)]'
                    : 'bg-sunken shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:bg-fill-hover'
                }`}
              >
                <span className="mb-1 flex items-center gap-2">
                  <Search className="size-3.5 text-accent-text" />
                  <code className="rounded-xs bg-raised px-1.5 py-0.5 font-mono text-mono-ui text-foreground">
                    {example.query}
                  </code>
                </span>
                <span className="block text-label-sm font-normal text-secondary">
                  {example.description}
                </span>
              </Button>
            ))}
        </div>

        {/* AI搜索示例 */}
        <div className="space-y-2">
          <div className="mb-2 flex items-center gap-2">
            <Bot className="size-3.5 text-tertiary" />
            <h4 className="text-label font-medium text-foreground">
              {t('searchDemo.ai-semantic-search')}
            </h4>
          </div>
          {searchExamples
            .filter(example => example.type === 'ai')
            .map((example, index) => (
              <Button
                key={index}
                type="button"
                variant="ghost"
                aria-pressed={selectedExample?.query === example.query}
                onClick={() => handleExampleClick(example)}
                className={`h-auto w-full flex-col items-start justify-start rounded-md p-2.5 text-left transition-[background-color,box-shadow] ${
                  selectedExample?.query === example.query
                    ? 'bg-fill-selected shadow-[inset_0_0_0_1px_var(--focus-ring)]'
                    : 'bg-sunken shadow-[inset_0_0_0_1px_var(--border-subtle)] hover:bg-fill-hover'
                }`}
              >
                <span className="mb-1 flex items-center gap-2">
                  <Bot className="size-3.5 text-tertiary" />
                  <code className="rounded-xs bg-raised px-1.5 py-0.5 font-mono text-mono-ui text-foreground">
                    {example.query}
                  </code>
                </span>
                <span className="block text-label-sm font-normal text-secondary">
                  {example.description}
                </span>
              </Button>
            ))}
        </div>
      </div>

      {/* 选中示例的详细信息 */}
      {selectedExample && (
        <div className="rounded-md bg-sunken p-3.5">
          <div className="mb-2 flex items-center gap-2">
            {selectedExample.type === 'realtime' ? (
              <div className="size-1.5 rounded-full bg-accent-solid animate-pulse" />
            ) : (
              <Bot className="size-3.5 text-tertiary" />
            )}
            <h5 className="text-label font-medium text-foreground">
              {selectedExample.description}
            </h5>
          </div>

          <div className="space-y-1.5">
            <p className="text-label-sm text-secondary">
              {t('searchDemo.expected-results')}
            </p>
            <ul className="space-y-1">
              {selectedExample.expectedResults.map((result, index) => (
                <li key={index} className="flex items-center gap-2 text-label-sm text-foreground">
                  <CheckCircle className="size-3.5 shrink-0 text-tertiary" />
                  <span>{result}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-3 rounded-sm bg-fill-hover p-2.5">
            <p className="text-label-sm text-secondary">
              {selectedExample.type === 'realtime' ? (
                t('searchDemo.real-time-search-instantly-shows-matching-reposi')
              ) : (
                t('searchDemo.ai-search-uses-semantic-understanding-can-match')
              )}
            </p>
          </div>
        </div>
      )}

      {/* 使用提示 */}
      <div className="mt-5 border-t border-subtle pt-4">
        <h4 className="mb-2.5 text-label font-medium text-foreground">
          {t('searchDemo.usage-tips')}
        </h4>
        <div className="grid grid-cols-1 gap-4 text-label-sm md:grid-cols-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <div className="size-1.5 rounded-full bg-accent-solid" />
              <span className="font-medium text-foreground">
                {t('searchDemo.real-time-search')}
              </span>
            </div>
            <ul className="ml-3.5 space-y-1 text-secondary">
              <li>• {t('searchDemo.automatically-triggered-while-typing')}</li>
              <li>• {t('searchDemo.matches-repository-names')}</li>
              <li>• {t('searchDemo.supports-chinese-ime')}</li>
              <li>• {t('searchDemo.fast-response-time')}</li>
            </ul>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Bot className="size-3.5 text-tertiary" />
              <span className="font-medium text-foreground">
                {t('searchDemo.ai-semantic-search')}
              </span>
            </div>
            <ul className="ml-5 space-y-1 text-secondary">
              <li>• {t('searchDemo.click-ai-search-button-to-trigger')}</li>
              <li>• {t('searchDemo.supports-natural-language-queries')}</li>
              <li>• {t('searchDemo.cross-language-matching')}</li>
              <li>• {t('searchDemo.intelligent-result-ranking')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};