import React from 'react';
import {
  BarChart3,
  Blocks,
  BookOpen,
  Bot,
  Boxes,
  BrainCircuit,
  Cable,
  ChartNoAxesColumn,
  Clapperboard,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Crown,
  Database,
  FileText,
  FlaskConical,
  Folder,
  FolderKanban,
  Gamepad2,
  GitBranch,
  Globe2,
  GraduationCap,
  Laptop,
  Layers3,
  Lock,
  MessageCircle,
  Monitor,
  Music,
  Network,
  Newspaper,
  Package,
  Palette,
  PenTool,
  Plug,
  Rocket,
  Rss,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Timer,
  TrendingUp,
  Users,
  Video,
  WandSparkles,
  Waypoints,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

const CATEGORY_ICON_BY_KEY = {
  analytics: BarChart3,
  api: Network,
  blocks: Blocks,
  bot: Bot,
  'brain-circuit': BrainCircuit,
  cable: Cable,
  'chart-no-axes-column': ChartNoAxesColumn,
  clapperboard: Clapperboard,
  cloud: Cloud,
  code: Code2,
  compass: Compass,
  cpu: Cpu,
  crown: Crown,
  database: Database,
  'file-text': FileText,
  flask: FlaskConical,
  folder: Folder,
  'folder-kanban': FolderKanban,
  gamepad: Gamepad2,
  'git-branch': GitBranch,
  globe: Globe2,
  graduation: GraduationCap,
  laptop: Laptop,
  layers: Layers3,
  lock: Lock,
  message: MessageCircle,
  monitor: Monitor,
  music: Music,
  network: Network,
  newspaper: Newspaper,
  package: Package,
  palette: Palette,
  'pen-tool': PenTool,
  plug: Plug,
  rocket: Rocket,
  rss: Rss,
  search: Search,
  send: Send,
  settings: Settings2,
  shield: ShieldCheck,
  smartphone: Smartphone,
  sparkles: Sparkles,
  star: Star,
  tag: Tag,
  terminal: Terminal,
  timer: Timer,
  'trending-up': TrendingUp,
  users: Users,
  video: Video,
  wand: WandSparkles,
  waypoints: Waypoints,
  wrench: Wrench,
  zap: Zap,
} satisfies Record<string, LucideIcon>;

const CATEGORY_ICON_BY_ID: Record<string, LucideIcon> = {
  all: Layers3,
  web: Globe2,
  mobile: Smartphone,
  desktop: Monitor,
  database: Database,
  ai: BrainCircuit,
  devtools: Wrench,
  security: ShieldCheck,
  game: Gamepad2,
  design: Palette,
  productivity: Zap,
  education: GraduationCap,
  social: Users,
  analytics: BarChart3,
};

const CATEGORY_ICON_BY_VALUE: Record<string, LucideIcon> = {
  '📁': Folder,
  '📂': FolderKanban,
  '🌐': Globe2,
  '📱': Smartphone,
  '💻': Laptop,
  '🖥️': Monitor,
  '🗄️': Database,
  '🤖': Bot,
  '🔧': Wrench,
  '🛠️': Wrench,
  '🧰': Wrench,
  '🛡️': ShieldCheck,
  '🎮': Gamepad2,
  '🎨': Palette,
  '⚡': Zap,
  '📚': BookOpen,
  '👥': Users,
  '📊': BarChart3,
  '📈': TrendingUp,
  '📦': Package,
  '🧪': FlaskConical,
  '🚀': Rocket,
  '✨': Sparkles,
  '🔌': Plug,
  '🧠': BrainCircuit,
  '🕸️': Network,
  '🔒': Lock,
  '🔍': Search,
  '🏷️': Tag,
  '⭐': Star,
  '💬': MessageCircle,
  '📨': Send,
  '📰': Newspaper,
  '🎵': Music,
  '📹': Video,
  '🖋️': PenTool,
  '⏱️': Timer,
  '☁️': Cloud,
  '💻️': Code2,
  '🧩': Blocks,
  '🧭': Compass,
  '👑': Crown,
  '📡': Rss,
  '⌨️': Terminal,
  '🧵': Cable,
  '🧭️': Compass,
  '🔗': GitBranch,
};

const NAME_RULES: Array<[RegExp, LucideIcon]> = [
  [/(\bai\b|机器学习|人工智能)/i, BrainCircuit],
  [/(agent|智能体)/i, Bot],
  [/(mcp|协议)/i, Cable],
  [/(api|网关)/i, Network],
  [/(skill|技能)/i, Sparkles],
  [/(科学上网|网络)/i, Globe2],
  [/(媒体|视频|影视)/i, Clapperboard],
  [/(知识|阅读|文档)/i, BookOpen],
  [/(教育|学习|培训)/i, GraduationCap],
  [/(开发|编程|工具)/i, Wrench],
  [/(效率|生产力)/i, Zap],
  [/(安全)/i, ShieldCheck],
  [/(设计|创意)/i, Palette],
  [/(社交)/i, Users],
  [/(数据库)/i, Database],
  [/(数据|分析)/i, BarChart3],
  [/(web|网页)/i, Globe2],
  [/(mobile|移动|手机)/i, Smartphone],
  [/(desktop|桌面)/i, Monitor],
  [/(游戏)/i, Gamepad2],
];

const FALLBACK_GLYPHS: LucideIcon[] = [
  Boxes,
  Folder,
  Layers3,
  Package,
  Sparkles,
  Tag,
  Code2,
  Blocks,
  Database,
  Globe2,
];

const CATEGORY_ICON_CHOICE_BY_KEY: Record<string, LucideIcon> = {
  ...CATEGORY_ICON_BY_KEY,
  'book-open': BookOpen,
  blocks: Blocks,
  workflow: GitBranch,
};

const normalizeIconValue = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  return trimmed.toLowerCase().replace(/^lucide:/, '');
};

const resolveCategoryGlyph = (
  icon: string | undefined,
  name: string | undefined,
  categoryId: string | undefined,
): LucideIcon | string => {
  const rawIcon = icon?.trim() ?? '';
  const iconKey = normalizeIconValue(rawIcon);
  if (rawIcon) {
    return CATEGORY_ICON_BY_VALUE[rawIcon]
      ?? CATEGORY_ICON_CHOICE_BY_KEY[iconKey]
      ?? rawIcon;
  }

  const byId = categoryId ? CATEGORY_ICON_BY_ID[categoryId] : undefined;
  const byName = name ? NAME_RULES.find(([pattern]) => pattern.test(name))?.[1] : undefined;
  if (byId || byName) {
    return byId ?? (byName as LucideIcon);
  }

  const hash = Array.from(name ?? '').reduce(
    (value, character) => value + (character.codePointAt(0) ?? 0),
    0,
  );
  return FALLBACK_GLYPHS[hash % FALLBACK_GLYPHS.length] ?? Boxes;
};

export interface CategoryGlyphProps {
  icon?: string;
  name?: string;
  categoryId?: string;
  className?: string;
  title?: string;
}

export const CategoryGlyph: React.FC<CategoryGlyphProps> = ({
  icon,
  name,
  categoryId,
  className = '',
  title,
}) => {
  const glyph = resolveCategoryGlyph(icon, name, categoryId);
  if (typeof glyph === 'string') {
    return (
      <span
        aria-hidden={title ? undefined : true}
        aria-label={title}
        className={`app-category-glyph app-category-glyph-text ${className}`.trim()}
        data-category-glyph
      >
        {glyph}
      </span>
    );
  }

  const Icon = glyph;
  return (
    <Icon
      aria-hidden={title ? undefined : true}
      aria-label={title}
      className={`app-category-glyph ${className}`.trim()}
      data-category-glyph
    />
  );
};
