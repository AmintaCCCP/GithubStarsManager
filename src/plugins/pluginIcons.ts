import {
  Activity,
  BarChart3,
  Bell,
  Blocks,
  BookOpen,
  Bookmark,
  Bot,
  BrainCircuit,
  Cable,
  Camera,
  CheckCircle,
  Clapperboard,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileText,
  FlaskConical,
  Folder,
  FolderKanban,
  Gamepad2,
  GitBranch,
  Globe,
  GraduationCap,
  Heart,
  Key,
  Layers,
  Lock,
  MessageSquare,
  Music,
  Network,
  Newspaper,
  Package,
  Palette,
  Plug,
  Printer,
  Rocket,
  Rss,
  Search,
  Send,
  Settings,
  Share2,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Tag,
  Terminal,
  Timer,
  TrendingUp,
  Users,
  Video,
  WandSparkles,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export { PluginIcon, type PluginIconProps } from './PluginIcon';

export interface PluginIconChoice {
  key: string;
  label: string;
  labelZh: string;
  keywords: string;
  icon: LucideIcon;
}

export const PLUGIN_ICON_CHOICES: readonly PluginIconChoice[] = [
  { key: 'plug', label: 'Plug', labelZh: '插头 (默认)', keywords: 'plug connect 插头 默认 default', icon: Plug },
  { key: 'bot', label: 'Bot', labelZh: '机器人', keywords: 'bot robot ai agent 智能体 机器人', icon: Bot },
  { key: 'brain-circuit', label: 'Brain Circuit', labelZh: '人工智能', keywords: 'brain circuit ai ml 人工智能 神经', icon: BrainCircuit },
  { key: 'sparkles', label: 'Sparkles', labelZh: '魔法星光', keywords: 'sparkles magic ai clean 闪亮 星光 魔法', icon: Sparkles },
  { key: 'wand', label: 'Wand', labelZh: '魔杖', keywords: 'wand magic generate 魔法棒 生成', icon: WandSparkles },
  { key: 'zap', label: 'Zap', labelZh: '雷电 / 效率', keywords: 'zap lightning fast energy 闪电 效率 极速', icon: Zap },
  { key: 'rocket', label: 'Rocket', labelZh: '火箭 / 发布', keywords: 'rocket launch deploy release 火箭 发布 启动', icon: Rocket },
  { key: 'code', label: 'Code', labelZh: '代码', keywords: 'code program dev 开发 代码 编程', icon: Code2 },
  { key: 'terminal', label: 'Terminal', labelZh: '终端 / 命令行', keywords: 'terminal console cli shell 终端 命令行', icon: Terminal },
  { key: 'wrench', label: 'Tools', labelZh: '工具', keywords: 'wrench tools fix utility 工具 维护', icon: Wrench },
  { key: 'settings', label: 'Settings', labelZh: '设置', keywords: 'settings gear config 配置 设置 选项', icon: Settings },
  { key: 'sliders', label: 'Sliders', labelZh: '参数控制', keywords: 'sliders filter control 调优 参数 滑块', icon: Sliders },
  { key: 'cpu', label: 'Hardware', labelZh: '芯片 / 硬件', keywords: 'cpu chip processor 处理器 芯片 性能', icon: Cpu },
  { key: 'database', label: 'Database', labelZh: '数据库', keywords: 'database storage sql data 数据库 存储', icon: Database },
  { key: 'globe', label: 'Web', labelZh: '网络 / 网页', keywords: 'globe web internet 全球 网页 浏览器', icon: Globe },
  { key: 'network', label: 'Network', labelZh: '网络连接', keywords: 'network connection api 网关 网络 节点', icon: Network },
  { key: 'cable', label: 'Interface', labelZh: '接口 / 协议', keywords: 'cable wire interface mcp 接口 协议 线缆', icon: Cable },
  { key: 'blocks', label: 'Blocks', labelZh: '积木 / 组件', keywords: 'blocks lego component puzzle 积木 组件 拼装', icon: Blocks },
  { key: 'package', label: 'Package', labelZh: '软件包', keywords: 'package bundle npm artifact 软件包 依赖', icon: Package },
  { key: 'layers', label: 'Layers', labelZh: '图层 / 架构', keywords: 'layers stack architecture 图层 堆栈 架构', icon: Layers },
  { key: 'folder', label: 'Folder', labelZh: '文件夹', keywords: 'folder directory 文件夹 目录 组织', icon: Folder },
  { key: 'folder-kanban', label: 'Kanban', labelZh: '项目看板', keywords: 'folder kanban project board 看板 项目 管理', icon: FolderKanban },
  { key: 'file-text', label: 'Document', labelZh: '文档', keywords: 'file text document report 文档 报告 文件', icon: FileText },
  { key: 'book-open', label: 'Knowledge', labelZh: '知识库', keywords: 'book knowledge read wiki 书本 阅读 知识', icon: BookOpen },
  { key: 'newspaper', label: 'News', labelZh: '资讯 / 简报', keywords: 'newspaper news feed 资讯 新闻 简报', icon: Newspaper },
  { key: 'tag', label: 'Tag', labelZh: '标签', keywords: 'tag label category 标签 标记 归类', icon: Tag },
  { key: 'bookmark', label: 'Bookmark', labelZh: '书签', keywords: 'bookmark favorite save 书签 收藏 保存', icon: Bookmark },
  { key: 'star', label: 'Star', labelZh: '星标', keywords: 'star favorite rating 星标 喜爱 评级', icon: Star },
  { key: 'heart', label: 'Heart', labelZh: '喜爱', keywords: 'heart love like 喜欢 收藏 爱心', icon: Heart },
  { key: 'shield', label: 'Security', labelZh: '安全 / 防护', keywords: 'shield security protect audit 安全 防护 审核', icon: ShieldCheck },
  { key: 'lock', label: 'Lock', labelZh: '私密 / 锁定', keywords: 'lock private secure 锁定 权限 私密', icon: Lock },
  { key: 'key', label: 'Key', labelZh: '密钥 / 认证', keywords: 'key auth secret token 钥匙 密钥 认证', icon: Key },
  { key: 'search', label: 'Search', labelZh: '搜索 / 发现', keywords: 'search query find 搜索 查询 发现', icon: Search },
  { key: 'chart', label: 'Chart', labelZh: '统计图表', keywords: 'chart analytics graph metrics 统计 分析 图表', icon: BarChart3 },
  { key: 'trending-up', label: 'Trending', labelZh: '趋势', keywords: 'trending growth rise 趋势 增长 上升', icon: TrendingUp },
  { key: 'activity', label: 'Activity', labelZh: '活跃度 / 监控', keywords: 'activity pulse monitor health 动态 活跃 健康 监控', icon: Activity },
  { key: 'users', label: 'Community', labelZh: '社区 / 协作', keywords: 'users team community social 团队 成员 社区 协作', icon: Users },
  { key: 'message', label: 'Chat', labelZh: '聊天 / 讨论', keywords: 'message chat comment talk 对话 讨论 消息', icon: MessageSquare },
  { key: 'send', label: 'Send', labelZh: '发送 / 推送', keywords: 'send webhook push 传递 发送 推送', icon: Send },
  { key: 'rss', label: 'Feed', labelZh: '动态源', keywords: 'rss feed subscribe 订阅 广播 动态', icon: Rss },
  { key: 'bell', label: 'Notification', labelZh: '通知 / 提醒', keywords: 'bell alert notice 提醒 通知 订阅', icon: Bell },
  { key: 'clapperboard', label: 'Media', labelZh: '媒体 / 影音', keywords: 'clapperboard movie video media 电影 媒体 影音', icon: Clapperboard },
  { key: 'music', label: 'Music', labelZh: '音频 / 音乐', keywords: 'music audio sound 音乐 音频 声音', icon: Music },
  { key: 'video', label: 'Video', labelZh: '视频', keywords: 'video record stream 视频 录屏 直播', icon: Video },
  { key: 'camera', label: 'Snapshot', labelZh: '快照 / 截图', keywords: 'camera photo screenshot 相机 拍照 截图', icon: Camera },
  { key: 'palette', label: 'Design', labelZh: '设计 / 主题', keywords: 'palette art theme color 画板 设计 主题', icon: Palette },
  { key: 'gamepad', label: 'Gaming', labelZh: '游戏 / 互动', keywords: 'gamepad game play 游戏 娱乐 互动', icon: Gamepad2 },
  { key: 'graduation', label: 'Education', labelZh: '教育 / 学习', keywords: 'graduation study learn course 学习 教育 课程', icon: GraduationCap },
  { key: 'flask', label: 'Experiment', labelZh: '实验 / 测试', keywords: 'flask lab test experiment 实验 试用 测试', icon: FlaskConical },
  { key: 'compass', label: 'Explore', labelZh: '导航 / 探索', keywords: 'compass navigate explore 导航 探索 指南', icon: Compass },
  { key: 'timer', label: 'Timer', labelZh: '计时 / 定时', keywords: 'timer clock time schedule 计时 定时 任务', icon: Timer },
  { key: 'cloud', label: 'Cloud', labelZh: '云端同步', keywords: 'cloud sync backup 云端 备份 同步', icon: Cloud },
  { key: 'git-branch', label: 'Git Branch', labelZh: '分支 / 工作流', keywords: 'git branch workflow 分支 流程 源码', icon: GitBranch },
  { key: 'external-link', label: 'External Link', labelZh: '外链跳转', keywords: 'external link open visit 跳转 外链 打开', icon: ExternalLink },
  { key: 'download', label: 'Download', labelZh: '下载 / 导出', keywords: 'download export save 下载 导出 保存', icon: Download },
  { key: 'share', label: 'Share', labelZh: '分享 / 广播', keywords: 'share export distribute 分享 转发 扩散', icon: Share2 },
  { key: 'printer', label: 'Print', labelZh: '打印 / 生成', keywords: 'printer print pdf export 打印 导出 输出', icon: Printer },
  { key: 'eye', label: 'Preview', labelZh: '预览 / 查阅', keywords: 'eye view preview 预览 查阅 查看', icon: Eye },
  { key: 'check-circle', label: 'Check', labelZh: '校验 / 完成', keywords: 'check circle verified success 校验 成功 完成', icon: CheckCircle },
];

export const PLUGIN_ICON_MAP: Record<string, LucideIcon> = Object.fromEntries(
  PLUGIN_ICON_CHOICES.map((choice) => [choice.key, choice.icon]),
);

export const normalizePluginIconKey = (value: string | undefined | null): string => {
  if (!value) return '';
  return value.trim().toLowerCase().replace(/^lucide:/, '');
};

export const getPluginIcon = (iconKey?: string | null): LucideIcon => {
  const normalized = normalizePluginIconKey(iconKey);
  if (normalized && Object.prototype.hasOwnProperty.call(PLUGIN_ICON_MAP, normalized)) {
    return PLUGIN_ICON_MAP[normalized];
  }
  return Plug;
};
