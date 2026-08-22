import { Button } from './ui/button';
import React, { useState } from 'react';
import { Search, Bot, Lightbulb, Play, CheckCircle } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';

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
  const { language } = useAppStore();
  const [selectedExample, setSelectedExample] = useState<SearchExample | null>(null);
  const [showDemo, setShowDemo] = useState(false);

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const handleExampleClick = (example: SearchExample) => {
    setSelectedExample(example);
    // 这里可以触发实际的搜索演示
    console.log(`演示搜索: ${example.query} (${example.type})`);
  };

  if (!showDemo) {
    return (
      <div className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl border border-border dark:border-border dark:border-border dark:border-border p-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-primary/20 dark:bg-primary/20 rounded-lg">
              <Lightbulb className="w-5 h-5 text-primary dark:text-primary" />
            </div>
            <div>
              <h3 className="font-medium text-foreground dark:text-foreground">
                {t('搜索功能升级', 'Search Feature Upgrade')}
              </h3>
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                {t('体验全新的实时搜索和AI语义搜索功能', 'Experience new real-time and AI semantic search features')}
              </p>
            </div>
          </div>
          <Button
            onClick={() => setShowDemo(true)}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
          >
            <Play className="w-4 h-4" />
            <span>{t('查看演示', 'View Demo')}</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-card rounded-xl border border-border dark:border-border p-6 mb-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-gradient-to-r from-blue-500 to-purple-500 rounded-lg">
            <Search className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-foreground dark:text-foreground">
              {t('搜索功能演示', 'Search Feature Demo')}
            </h3>
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('点击下方示例体验不同的搜索模式', 'Click examples below to experience different search modes')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setShowDemo(false)}
          aria-label={t('关闭搜索演示', 'Close search demo')}
          className="text-muted-foreground dark:text-muted-foreground/70 hover:text-muted-foreground dark:text-muted-foreground dark:hover:text-gray-300 transition-colors"
        >
          ×
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* 实时搜索示例 */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2 mb-3">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            <h4 className="font-medium text-foreground dark:text-foreground">
              {t('实时搜索', 'Real-time Search')}
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
                className={`w-full h-auto flex-col items-start justify-start p-3 text-left rounded-lg border transition-all ${
                  selectedExample?.query === example.query
                    ? 'border-primary bg-muted dark:bg-muted/40 dark:bg-primary/20'
                    : 'border-border dark:border-border hover:border-border dark:border-border dark:hover:border-border dark:border-border'
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <Search className="w-4 h-4 text-primary" />
                  <code className="text-sm font-mono bg-muted dark:bg-muted/40 px-2 py-1 rounded">
                    {example.query}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  {example.description}
                </p>
              </Button>
            ))}
        </div>

        {/* AI搜索示例 */}
        <div className="space-y-3">
          <div className="flex items-center space-x-2 mb-3">
            <Bot className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            <h4 className="font-medium text-foreground dark:text-foreground">
              {t('AI语义搜索', 'AI Semantic Search')}
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
                className={`w-full h-auto flex-col items-start justify-start p-3 text-left rounded-lg border transition-all ${
                  selectedExample?.query === example.query
                    ? 'border-border dark:border-border bg-muted dark:bg-muted/40 '
                    : 'border-border dark:border-border hover:border-border dark:border-border dark:hover:border-border dark:border-border'
                }`}
              >
                <div className="flex items-center space-x-2 mb-1">
                  <Bot className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
                  <code className="text-sm font-mono bg-muted dark:bg-muted/40 px-2 py-1 rounded">
                    {example.query}
                  </code>
                </div>
                <p className="text-xs text-muted-foreground dark:text-muted-foreground">
                  {example.description}
                </p>
              </Button>
            ))}
        </div>
      </div>

      {/* 选中示例的详细信息 */}
      {selectedExample && (
        <div className="bg-background dark:bg-muted/20 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-3">
            {selectedExample.type === 'realtime' ? (
              <div className="w-2 h-2 bg-primary rounded-full animate-pulse"></div>
            ) : (
              <Bot className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
            )}
            <h5 className="font-medium text-foreground dark:text-foreground">
              {selectedExample.description}
            </h5>
          </div>
          
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              {t('预期结果:', 'Expected Results:')}
            </p>
            <ul className="space-y-1">
              {selectedExample.expectedResults.map((result, index) => (
                <li key={index} className="flex items-center space-x-2 text-sm text-foreground dark:text-muted-foreground">
                  <CheckCircle className="w-3 h-3 text-muted-foreground dark:text-muted-foreground flex-shrink-0" />
                  <span>{result}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 p-3 bg-muted dark:bg-muted/40 dark:bg-primary/20 rounded-lg">
            <p className="text-sm text-muted-foreground dark:text-muted-foreground ">
              {selectedExample.type === 'realtime' ? (
                t(
                  '💡 实时搜索会在您输入时立即显示匹配的仓库名称，响应速度极快。',
                  '💡 Real-time search instantly shows matching repository names as you type, with extremely fast response.'
                )
              ) : (
                t(
                  '🤖 AI搜索使用语义理解，能够跨语言匹配并智能排序结果，适合复杂查询。',
                  '🤖 AI search uses semantic understanding, can match across languages and intelligently rank results, perfect for complex queries.'
                )
              )}
            </p>
          </div>
        </div>
      )}

      {/* 使用提示 */}
      <div className="mt-6 pt-6 border-t border-border dark:border-border">
        <h4 className="font-medium text-foreground dark:text-foreground mb-3">
          {t('使用技巧', 'Usage Tips')}
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-primary rounded-full"></div>
              <span className="font-medium text-foreground dark:text-muted-foreground">
                {t('实时搜索', 'Real-time Search')}
              </span>
            </div>
            <ul className="space-y-1 text-muted-foreground dark:text-muted-foreground ml-4">
              <li>• {t('输入时自动触发', 'Automatically triggered while typing')}</li>
              <li>• {t('匹配仓库名称', 'Matches repository names')}</li>
              <li>• {t('支持中文输入法', 'Supports Chinese IME')}</li>
              <li>• {t('响应速度快', 'Fast response time')}</li>
            </ul>
          </div>
          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-muted-foreground dark:text-muted-foreground" />
              <span className="font-medium text-foreground dark:text-muted-foreground">
                {t('AI语义搜索', 'AI Semantic Search')}
              </span>
            </div>
            <ul className="space-y-1 text-muted-foreground dark:text-muted-foreground ml-6">
              <li>• {t('点击AI搜索按钮触发', 'Click AI Search button to trigger')}</li>
              <li>• {t('支持自然语言查询', 'Supports natural language queries')}</li>
              <li>• {t('跨语言匹配', 'Cross-language matching')}</li>
              <li>• {t('智能结果排序', 'Intelligent result ranking')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};