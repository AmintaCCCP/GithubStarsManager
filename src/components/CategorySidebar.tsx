import React from 'react';
import { 
  Folder, 
  Code, 
  Globe, 
  Smartphone, 
  Database, 
  Shield, 
  Gamepad2, 
  Palette, 
  Bot, 
  Wrench,
  BookOpen,
  Zap,
  Users,
  BarChart3
} from 'lucide-react';
import { Repository } from '../types';

interface CategorySidebarProps {
  repositories: Repository[];
  selectedCategory: string;
  onCategorySelect: (category: string) => void;
}

interface Category {
  id: string;
  name: string;
  icon: React.ComponentType<any>;
  keywords: string[];
}

const categories: Category[] = [
  {
    id: 'all',
    name: '全部分类',
    icon: Folder,
    keywords: []
  },
  {
    id: 'web',
    name: 'Web应用',
    icon: Globe,
    keywords: ['web应用', 'web', 'website', 'frontend', 'react', 'vue', 'angular']
  },
  {
    id: 'mobile',
    name: '移动应用',
    icon: Smartphone,
    keywords: ['移动应用', 'mobile', 'android', 'ios', 'flutter', 'react-native']
  },
  {
    id: 'desktop',
    name: '桌面应用',
    icon: Code,
    keywords: ['桌面应用', 'desktop', 'electron', 'gui', 'qt', 'gtk']
  },
  {
    id: 'database',
    name: '数据库',
    icon: Database,
    keywords: ['数据库', 'database', 'sql', 'nosql', 'mongodb', 'mysql', 'postgresql']
  },
  {
    id: 'ai',
    name: 'AI/机器学习',
    icon: Bot,
    keywords: ['ai工具', 'ai', 'ml', 'machine learning', 'deep learning', 'neural']
  },
  {
    id: 'devtools',
    name: '开发工具',
    icon: Wrench,
    keywords: ['开发工具', 'tool', 'cli', 'build', 'deploy', 'debug', 'test', 'automation']
  },
  {
    id: 'security',
    name: '安全工具',
    icon: Shield,
    keywords: ['安全工具', 'security', 'encryption', 'auth', 'vulnerability']
  },
  {
    id: 'game',
    name: '游戏',
    icon: Gamepad2,
    keywords: ['游戏', 'game', 'gaming', 'unity', 'unreal', 'godot']
  },
  {
    id: 'design',
    name: '设计工具',
    icon: Palette,
    keywords: ['设计工具', 'design', 'ui', 'ux', 'graphics', 'image']
  },
  {
    id: 'productivity',
    name: '效率工具',
    icon: Zap,
    keywords: ['效率工具', 'productivity', 'note', 'todo', 'calendar', 'task']
  },
  {
    id: 'education',
    name: '教育学习',
    icon: BookOpen,
    keywords: ['教育学习', 'education', 'learning', 'tutorial', 'course']
  },
  {
    id: 'social',
    name: '社交网络',
    icon: Users,
    keywords: ['社交网络', 'social', 'chat', 'messaging', 'communication']
  },
  {
    id: 'analytics',
    name: '数据分析',
    icon: BarChart3,
    keywords: ['数据分析', 'analytics', 'data', 'visualization', 'chart']
  }
];

export const CategorySidebar: React.FC<CategorySidebarProps> = ({
  repositories,
  selectedCategory,
  onCategorySelect
}) => {
  // Calculate repository count for each category
  const getCategoryCount = (category: Category) => {
    if (category.id === 'all') return repositories.length;
    
    return repositories.filter(repo => {
      // 优先使用AI标签进行匹配
      if (repo.ai_tags && repo.ai_tags.length > 0) {
        return repo.ai_tags.some(tag => 
          category.keywords.some(keyword => 
            tag.toLowerCase().includes(keyword.toLowerCase()) ||
            keyword.toLowerCase().includes(tag.toLowerCase())
          )
        );
      }
      
      // 如果没有AI标签，使用传统方式匹配
      const repoText = [
        repo.name,
        repo.description || '',
        repo.language || '',
        ...(repo.topics || []),
        repo.ai_summary || ''
      ].join(' ').toLowerCase();
      
      return category.keywords.some(keyword => 
        repoText.includes(keyword.toLowerCase())
      );
    }).length;
  };

  return (
    <div className="w-64 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 h-fit sticky top-24">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        应用分类
      </h3>
      
      <div className="space-y-1">
        {categories.map(category => {
          const count = getCategoryCount(category);
          const Icon = category.icon;
          const isSelected = selectedCategory === category.id;
          
          return (
            <button
              key={category.id}
              onClick={() => onCategorySelect(category.id)}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-colors ${
                isSelected
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <div className="flex items-center space-x-3">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-medium">{category.name}</span>
              </div>
              <span className={`text-xs px-2 py-1 rounded-full ${
                isSelected
                  ? 'bg-blue-200 text-blue-800 dark:bg-blue-800 dark:text-blue-200'
                  : 'bg-gray-200 text-gray-600 dark:bg-gray-600 dark:text-gray-400'
              }`}>
                {count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};