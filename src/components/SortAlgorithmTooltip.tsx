import React from 'react';
import { Info } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DiscoveryChannelId } from '../types';
import { Button } from './ui/button';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';

interface SortAlgorithmTooltipProps {
  channelId: DiscoveryChannelId;
  language: 'zh' | 'en';
}

export const SortAlgorithmTooltip: React.FC<SortAlgorithmTooltipProps> = ({ channelId, language }) => {
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  const getAlgorithmInfo = (channel: DiscoveryChannelId): { title: string; description: string; highlight: string } => {
    switch (channel) {
      case 'trending':
        return {
          title: t('热门仓库', 'Trending Repositories'),
          highlight: t('🔥 发现近期热门的新兴项目', '🔥 Discover emerging hot projects'),
          description: t(
            '【特点】\n• 时间范围：最近30天有更新\n• Star门槛：50+\n• 排序方式：按Star数降序\n\n【适合场景】\n发现近期活跃且受欢迎的新兴项目，跟踪技术热点趋势。',
            '【Features】\n• Time range: Updated in last 30 days\n• Star threshold: 50+\n• Sort by: Stars descending\n\n【Best for】\nDiscovering emerging hot projects, tracking tech trends.'
          ),
        };
      case 'hot-release':
        return {
          title: t('热门发布', 'Hot Release'),
          highlight: t('🚀 跟踪项目最新动态', '🚀 Track latest project updates'),
          description: t(
            '【特点】\n• 时间范围：最近14天有更新\n• Star门槛：10+\n• 排序方式：按更新时间降序\n\n【适合场景】\n发现最近有更新、活跃开发中的项目，可能是刚发布新版本或有重大改进。',
            '【Features】\n• Time range: Updated in last 14 days\n• Star threshold: 10+\n• Sort by: Update time descending\n\n【Best for】\nFinding actively developed projects with recent updates or new releases.'
          ),
        };
      case 'most-popular':
        return {
          title: t('最受欢迎', 'Most Popular'),
          highlight: t('⭐ 发现经典成熟项目', '⭐ Discover classic mature projects'),
          description: t(
            '【特点】\n• 时间范围：创建超过6个月，1年内有更新\n• Star门槛：1000+\n• 排序方式：按Star数降序\n\n【适合场景】\n发现经过时间考验、广受认可的经典项目，适合寻找成熟稳定的工具和框架。',
            '【Features】\n• Time range: Created 6+ months ago, updated within 1 year\n• Star threshold: 1000+\n• Sort by: Stars descending\n\n【Best for】\nFinding time-tested, widely recognized classic projects for stable tools and frameworks.'
          ),
        };
      case 'topic':
        return {
          title: t('主题探索', 'Topic Exploration'),
          highlight: t('🏷️ 按技术主题浏览', '🏷️ Browse by tech topic'),
          description: t(
            '【特点】\n• 按选定主题标签筛选\n• Star门槛：10+\n• 排序方式：按Star数降序\n\n【适合场景】\n按特定技术领域（AI、数据库、Web开发等）浏览优质项目。',
            '【Features】\n• Filter by selected topic\n• Star threshold: 10+\n• Sort by: Stars descending\n\n【Best for】\nBrowsing quality projects by specific tech domain (AI, Database, Web, etc.).'
          ),
        };
      case 'search':
        return {
          title: t('搜索', 'Search'),
          highlight: t('🔍 自定义关键词搜索', '🔍 Custom keyword search'),
          description: t(
            '【特点】\n• 支持自定义关键词搜索\n• 多种排序方式：最佳匹配、最多Star、最多Fork\n• 可结合语言和平台过滤\n\n【适合场景】\n精确搜索特定项目或技术栈相关的仓库。',
            '【Features】\n• Custom keyword search\n• Sort options: Best match, Most stars, Most forks\n• Language and platform filters\n\n【Best for】\nPrecise search for specific projects or tech stack related repos.'
          ),
        };
      case 'weekly':
        return {
          title: t('阮一峰周刊', 'Ruanyifeng Weekly'),
          highlight: t('📰 科技爱好者周刊开源投稿精选', '📰 Open-source picks from the weekly'),
          description: t(
            '【特点】\n• 来源：ruanyf/weekly 的开源投稿 issue\n• 自动提取正文中的仓库链接\n• 排序方式：按投稿时间倒序\n• 可过滤已被周刊收录的条目\n\n【适合场景】\n浏览经人工筛选视角推荐的开源项目，发现周刊读者关注的优质仓库。',
            '【Features】\n• Source: open-source submission issues of ruanyf/weekly\n• Repo links extracted from issue bodies\n• Sort by: submission time descending\n• Filter by weekly-collected items\n\n【Best for】\nBrowsing open-source projects recommended through the weekly editorial lens.'
          ),
        };
      case 'code-search':
        return {
          title: t('代码搜索', 'Code Search'),
          highlight: t('🔍 公开仓库代码全文检索', '🔍 Full-text code search across public repos'),
          description: t(
            '【特点】\n• 模糊 / 全词 / 正则三种匹配，可叠加区分大小写\n• 仓库 / 路径 / 语言过滤器动态筛选\n• 支持只看我收藏的仓库\n\n【适合场景】\n在公开仓库代码中定位用法、配置与示例。',
            '【Features】\n• Fuzzy / whole-word / regexp modes, optional case sensitivity\n• Dynamic repo / path / language facets\n• Optional starred-only filter\n\n【Best for】\nFinding usages, configs and examples across public code.'
          ),
        };
      default:
        return {
          title: t('排序算法', 'Sorting Algorithm'),
          highlight: '',
          description: t('按默认规则排序', 'Sorted by default rules'),
        };
    }
  };

  const info = getAlgorithmInfo(channelId);
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
  }, []);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        cancelClose();
        setOpen(nextOpen);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 rounded-full text-muted-foreground dark:text-muted-foreground/70"
          aria-label={info.title}
          onMouseEnter={() => { cancelClose(); setOpen(true); }}
          onMouseLeave={scheduleClose}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        onMouseEnter={cancelClose}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[calc(100vw_-_2rem)] max-w-sm whitespace-pre-line bg-popover p-4 text-left text-popover-foreground"
      >
        <h4 className="mb-2 text-sm font-semibold">{info.title}</h4>
        {info.highlight && <p className="mb-2 text-sm font-medium text-primary">{info.highlight}</p>}
        <p className="text-xs leading-relaxed">{info.description}</p>
      </PopoverContent>
    </Popover>
  );
};
