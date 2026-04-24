import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Save, X, Plus, Lock, Unlock, RotateCcw, Bot, Edit3, FileText, Tag, FolderOpen, Info, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { Repository } from '../types';
import { useAppStore, getAllCategories } from '../store/useAppStore';
import { forceSyncToBackend } from '../services/autoSync';
import { computeCustomCategory, getAICategory, getDefaultCategory } from '../utils/categoryUtils';

interface RepositoryEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  repository: Repository | null;
}

/**
 * 数据来源类型
 * - custom: 用户自定义内容
 * - ai: AI生成的内容
 * - original: GitHub原始内容
 * - mixed: 混合来源（仅用于标签）
 * - none: 无内容（用户明确清空）
 */
type DataSource = 'custom' | 'ai' | 'original' | 'mixed' | 'none';

/**
 * 编辑意图类型 - 明确用户的操作意图
 * - keep-custom: 保持/保存为自定义内容
 * - reset-to-ai: 重置为AI内容（清除自定义）
 * - reset-to-original: 重置为原始内容（清除自定义）
 * - clear: 清空内容（保存为明确空值，显示为空）
 */
type EditIntentType = 'keep-custom' | 'reset-to-ai' | 'reset-to-original' | 'clear';

/**
 * 编辑意图状态 - 跟踪用户对描述、标签和分类的操作意图
 */
interface EditIntent {
  description: EditIntentType;
  tags: EditIntentType;
  category: EditIntentType;
}

/**
 * 来源信息显示
 */
interface SourceInfo {
  description: DataSource;
  tags: DataSource;
  category: DataSource;
}

export const RepositoryEditModal: React.FC<RepositoryEditModalProps> = ({
  isOpen,
  onClose,
  repository
}) => {
  const { updateRepository, language, customCategories, hiddenDefaultCategoryIds, defaultCategoryOverrides } = useAppStore();

  const [formData, setFormData] = useState({
    description: '',
    tags: [] as string[],
    category: '',
    categoryLocked: false
  });
  const [newTag, setNewTag] = useState('');

  // 记录初始值，用于检测是否有修改
  const initialDataRef = useRef({
    description: '',
    tags: [] as string[],
    category: '',
    categoryLocked: false
  });

  /**
   * 编辑意图状态 - 核心改进
   * 用于明确用户的操作意图，决定保存时的行为
   */
  const [editIntent, setEditIntent] = useState<EditIntent>({
    description: 'keep-custom',
    tags: 'keep-custom',
    category: 'keep-custom'
  });

  const initialEditIntentRef = useRef<EditIntent>({
    description: 'keep-custom',
    tags: 'keep-custom',
    category: 'keep-custom'
  });



  const allCategories = useMemo(() => getAllCategories(customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides), [customCategories, language, hiddenDefaultCategoryIds, defaultCategoryOverrides]);

  // 获取仓库当前所属的分类
  const getCurrentCategory = useCallback((repo: Repository) => {
    // 如果有自定义分类，直接返回
    if (repo.custom_category) {
      return repo.custom_category;
    }

    // 否则根据AI标签或其他信息推断当前分类
    const aiCat = getAICategory(repo, allCategories);
    if (aiCat) {
      return aiCat;
    }

    const defaultCat = getDefaultCategory(repo, allCategories);
    if (defaultCat) {
      return defaultCat;
    }

    return '';
  }, [allCategories]);

  // 确定数据来源（基于实际显示的内容，而非存储的值）
  const determineSource = useCallback((repo: Repository): SourceInfo => {
    // 描述来源：基于显示优先级判断实际显示的内容来源
    // 优先级: custom_description(非undefined) > ai_summary > description
    // custom_description === '' 表示用户明确清空，来源为 'none'
    let descSource: DataSource;
    if (repo.custom_description !== undefined && repo.custom_description !== null) {
      if (repo.custom_description.trim() !== '') {
        descSource = 'custom';
      } else {
        descSource = 'none';
      }
    } else if (repo.ai_summary && repo.ai_summary.trim() !== '') {
      descSource = 'ai';
    } else if (repo.description && repo.description.trim() !== '') {
      descSource = 'original';
    } else {
      descSource = 'none';
    }

    // 标签来源：基于显示优先级判断实际显示的内容来源
    // 优先级: custom_tags(非空数组) > custom_tags(空数组=明确清空) > ai_tags > topics
    let tagsSource: DataSource;
    // 检查是否有自定义标签：区分 undefined（无自定义）和 []（明确清空）
    if (repo.custom_tags !== undefined) {
      // custom_tags 是数组（可能是空数组或包含标签）
      if (repo.custom_tags.length > 0) {
        tagsSource = 'custom';
      } else {
        // 空数组表示用户明确清空了标签
        tagsSource = 'none';
      }
    } else if (repo.ai_tags && repo.ai_tags.length > 0) {
      tagsSource = 'ai';
    } else if (repo.topics && repo.topics.length > 0) {
      tagsSource = 'original';
    } else {
      tagsSource = 'none';
    }

    // 分类来源
    let categorySource: DataSource;
    if (repo.custom_category && repo.custom_category.trim() !== '') {
      categorySource = 'custom';
    } else if (getAICategory(repo, allCategories) !== '') {
      categorySource = 'ai';
    } else if (getDefaultCategory(repo, allCategories) !== '') {
      categorySource = 'original';
    } else {
      categorySource = 'none';
    }

    return { description: descSource, tags: tagsSource, category: categorySource };
  }, [allCategories]);

  /**
   * 获取当前实际显示的内容（与 RepositoryCard 显示逻辑保持一致）
   */
  const getEffectiveDisplayContent = useCallback((repo: Repository) => {
    // 描述：优先级 custom_description(非undefined) > ai_summary > description
    // custom_description === '' 表示用户明确清空，表单中显示为空
    // custom_description === undefined 表示无自定义，回退到AI/原始
    let effectiveDescription = '';
    if (repo.custom_description !== undefined && repo.custom_description !== null) {
      effectiveDescription = repo.custom_description;
    } else if (repo.ai_summary && repo.ai_summary.trim() !== '') {
      effectiveDescription = repo.ai_summary;
    } else if (repo.description && repo.description.trim() !== '') {
      effectiveDescription = repo.description;
    }

    // 标签：优先级 custom_tags(非空数组) > custom_tags(空数组=明确清空) > ai_tags > topics
    let effectiveTags: string[] = [];
    // 检查是否有自定义标签：区分 undefined（无自定义）和 []（明确清空）
    if (repo.custom_tags !== undefined) {
      // custom_tags 是数组（可能是空数组或包含标签）
      effectiveTags = repo.custom_tags;
    } else if (repo.ai_tags && repo.ai_tags.length > 0) {
      effectiveTags = repo.ai_tags;
    } else if (repo.topics && repo.topics.length > 0) {
      effectiveTags = repo.topics;
    }

    return { effectiveDescription, effectiveTags };
  }, []);

  /**
   * 初始化表单数据
   * 当模态框打开时，根据仓库当前状态初始化表单
   */
  useEffect(() => {
    if (repository && isOpen) {
      const currentCategory = getCurrentCategory(repository);
      const source = determineSource(repository);

      // 获取当前实际显示的内容
      const { effectiveDescription, effectiveTags } = getEffectiveDisplayContent(repository);

      /**
       * 确定初始编辑意图
       * 基于实际显示的内容来源决定意图
       */
      const initialIntent: EditIntent = {
        description: source.description === 'custom' ? 'keep-custom' :
                     source.description === 'ai' ? 'reset-to-ai' :
                     source.description === 'original' ? 'reset-to-original' : 'clear',
        tags: source.tags === 'custom' ? 'keep-custom' :
              source.tags === 'ai' ? 'reset-to-ai' :
              source.tags === 'original' ? 'reset-to-original' : 'clear',
        category: source.category === 'custom' ? 'keep-custom' :
                  source.category === 'ai' ? 'reset-to-ai' :
                  source.category === 'original' ? 'reset-to-original' : 'clear'
      };
      setEditIntent(initialIntent);
      initialEditIntentRef.current = { ...initialIntent };

      // 表单初始值 - 使用实际显示的内容初始化
      const initialData = {
        description: effectiveDescription,
        tags: effectiveTags,
        category: currentCategory,
        categoryLocked: !!repository.category_locked
      };

      setFormData(initialData);
      initialDataRef.current = JSON.parse(JSON.stringify(initialData));
    }
  }, [repository, isOpen, allCategories, determineSource, getEffectiveDisplayContent, getCurrentCategory]);

  /**
   * 保存处理 - 根据编辑意图决定如何保存
   * 核心改进：明确区分"保存自定义"、"重置为某来源"、"清除"三种操作
   * 确保保存后的数据与UI显示逻辑一致
   */
  const handleSave = async () => {
    if (!repository) return;

    // 构建更新对象
    const updatedRepo = { ...repository };

    /**
     * 描述字段处理逻辑
     * 目标：确保保存后 RepositoryCard 的显示逻辑能正确显示用户期望的内容
     */
    switch (editIntent.description) {
      case 'reset-to-ai':
        // 重置为AI总结：清除自定义描述，让显示逻辑回退到AI
        updatedRepo.custom_description = undefined;
        break;

      case 'reset-to-original':
        // 重置为原始描述：清除自定义描述，让显示逻辑回退到原始
        updatedRepo.custom_description = undefined;
        break;

      case 'clear':
        // 清空描述：保存空字符串表示用户明确清空
        // undefined 表示无自定义（回退到AI/原始），'' 表示明确清空
        updatedRepo.custom_description = '';
        break;

      case 'keep-custom':
      default: {
        // 保持自定义：检查内容是否与原始来源一致
        const descTrimmed = (formData.description || '').trim();

        // 如果内容为空，视为清除
        if (descTrimmed === '') {
          updatedRepo.custom_description = '';
        }
        // 如果与AI总结一致，清除自定义描述（让显示逻辑回退到AI）
        else if (descTrimmed === (repository.ai_summary || '').trim()) {
          updatedRepo.custom_description = undefined;
        }
        // 如果与原始描述一致，清除自定义描述（让显示逻辑回退到原始）
        else if (descTrimmed === (repository.description || '').trim()) {
          updatedRepo.custom_description = undefined;
        }
        // 否则保存为自定义
        else {
          updatedRepo.custom_description = descTrimmed;
        }
        break;
      }
    }

    /**
     * 标签字段处理逻辑
     * 目标：确保保存后 RepositoryCard 的显示逻辑能正确显示用户期望的标签
     */
    switch (editIntent.tags) {
      case 'reset-to-ai':
        // 重置为AI标签：清除自定义标签
        updatedRepo.custom_tags = undefined;
        break;

      case 'reset-to-original':
        // 重置为Topics：清除自定义标签
        updatedRepo.custom_tags = undefined;
        break;

      case 'clear':
        // 清空标签：保存空数组作为明确清空的标记
        updatedRepo.custom_tags = [];
        break;

      case 'keep-custom':
      default: {
        // 保持自定义：检查标签是否与原始来源一致
        const aiTags = repository.ai_tags || [];
        const topics = repository.topics || [];
        const currentTags = formData.tags;

        // 如果标签数组为空，保存为空数组（明确清空）
        if (currentTags.length === 0) {
          updatedRepo.custom_tags = [];
        }
        // 如果与AI标签完全一致，清除自定义标签
        else if (JSON.stringify([...currentTags].sort()) === JSON.stringify([...aiTags].sort())) {
          updatedRepo.custom_tags = undefined;
        }
        // 如果与Topics完全一致，清除自定义标签
        else if (JSON.stringify([...currentTags].sort()) === JSON.stringify([...topics].sort())) {
          updatedRepo.custom_tags = undefined;
        }
        // 否则保存为自定义
        else {
          updatedRepo.custom_tags = currentTags;
        }
        break;
      }
    }

    /**
     * 分类字段处理逻辑
     * 
     * 核心逻辑：
     * - 自定义状态显示：只看是否与AI/默认一致（在 RepositoryCard 中判断）
     * - 分类锁定：独立设置，锁定时需要保存分类值
     */
    const aiCat = getAICategory(repository, allCategories);
    const defaultCat = getDefaultCategory(repository, allCategories);
    const currentCat = formData.category;

    // 锁定是独立设置
    if (formData.categoryLocked && currentCat) {
      // 用户锁定分类：保存分类值以便锁定生效
      updatedRepo.custom_category = currentCat;
      updatedRepo.category_locked = true;
    } else {
      // 用户未锁定分类：使用通用函数计算，与AI/默认一致时清除自定义标记
      updatedRepo.custom_category = computeCustomCategory(currentCat, aiCat, defaultCat);

      if (updatedRepo.custom_category === undefined || updatedRepo.custom_category === '') {
        updatedRepo.category_locked = false;
      } else {
        updatedRepo.category_locked = formData.categoryLocked;
      }
    }

    // 更新编辑时间
    updatedRepo.last_edited = new Date().toISOString();

    updateRepository(updatedRepo);
    await forceSyncToBackend();
    onClose();
  };

  const handleClose = () => {
    setFormData({
      description: '',
      tags: [],
      category: '',
      categoryLocked: false
    });
    setNewTag('');
    onClose();
  };

  /**
   * 添加标签
   * 用户手动修改标签时，设置编辑意图为 'keep-custom'
   */
  const handleAddTag = () => {
    if (newTag.trim() && !formData.tags.includes(newTag.trim())) {
      setFormData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag.trim()]
      }));
      setNewTag('');
      // 用户手动编辑，意图变为保持自定义
      setEditIntent(prev => ({ ...prev, tags: 'keep-custom' }));
    }
  };

  /**
   * 移除标签
   * 用户手动修改标签时，设置编辑意图为 'keep-custom'
   */
  const handleRemoveTag = (tagToRemove: string) => {
    setFormData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
    // 用户手动编辑，意图变为保持自定义
    setEditIntent(prev => ({ ...prev, tags: 'keep-custom' }));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  /**
   * 检测是否有修改
   * 同时考虑表单值变化和编辑意图变化
   */
  const hasChanges = useMemo(() => {
    const formChanged = formData.description !== initialDataRef.current.description ||
           JSON.stringify(formData.tags) !== JSON.stringify(initialDataRef.current.tags) ||
           formData.category !== initialDataRef.current.category ||
           formData.categoryLocked !== initialDataRef.current.categoryLocked;

    // 与初始意图对比，而非与 'keep-custom' 对比
    // 初始意图可能是 'reset-to-ai' 等，只有当意图实际发生变化时才算有修改
    const intentChanged = editIntent.description !== initialEditIntentRef.current.description ||
                          editIntent.tags !== initialEditIntentRef.current.tags ||
                          editIntent.category !== initialEditIntentRef.current.category;

    return formChanged || intentChanged;
  }, [formData, editIntent]);

  /**
   * 计算保存后的自定义状态
   * 根据当前表单值和原始值对比，判断哪些字段会被标记为【自定义】
   */
  const customStatus = useMemo(() => {
    if (!repository) return { description: false, tags: false, category: false };

    const isDescCustom = editIntent.description === 'keep-custom' &&
      (formData.description || '').trim() !== '' &&
      (formData.description || '').trim() !== (repository.ai_summary || '').trim() &&
      (formData.description || '').trim() !== (repository.description || '').trim();

    const aiTags = repository.ai_tags || [];
    const topics = repository.topics || [];
    const currentTags = formData.tags;

    const isTagsCustom = editIntent.tags === 'keep-custom' &&
      currentTags.length > 0 &&
      JSON.stringify([...currentTags].sort()) !== JSON.stringify([...aiTags].sort()) &&
      JSON.stringify([...currentTags].sort()) !== JSON.stringify([...topics].sort());

    const aiCategory = getAICategory(repository, allCategories);
    const defaultCategory = getDefaultCategory(repository, allCategories);

    const isCategoryCustom = editIntent.category === 'keep-custom' &&
      formData.category !== '' &&
      formData.category !== aiCategory &&
      formData.category !== defaultCategory;

    return { description: isDescCustom, tags: isTagsCustom, category: isCategoryCustom };
  }, [formData, repository, allCategories, editIntent]);

  /**
   * 重置为AI总结
   * 设置编辑意图为 'reset-to-ai'，保存时会清除 custom_description
   */
  const resetToAI = () => {
    if (!repository) return;
    if (repository.ai_summary) {
      setFormData(prev => ({ ...prev, description: repository.ai_summary! }));
      setEditIntent(prev => ({ ...prev, description: 'reset-to-ai' }));
    }
  };

  /**
   * 重置为原始描述
   * 设置编辑意图为 'reset-to-original'，保存时会清除 custom_description
   */
  const resetToOriginal = () => {
    if (!repository) return;
    if (repository.description) {
      setFormData(prev => ({ ...prev, description: repository.description! }));
      setEditIntent(prev => ({ ...prev, description: 'reset-to-original' }));
    }
  };

  /**
   * 清除自定义描述
   * 设置编辑意图为 'clear'，保存时会保存空字符串标记
   */
  const clearDescription = () => {
    setFormData(prev => ({ ...prev, description: '' }));
    setEditIntent(prev => ({ ...prev, description: 'clear' }));
  };

  /**
   * 重置标签为AI标签
   * 设置编辑意图为 'reset-to-ai'，保存时会清除 custom_tags
   */
  const resetTagsToAI = () => {
    if (!repository) return;
    if (repository.ai_tags && repository.ai_tags.length > 0) {
      setFormData(prev => ({ ...prev, tags: repository.ai_tags! }));
      setEditIntent(prev => ({ ...prev, tags: 'reset-to-ai' }));
    }
  };

  /**
   * 重置标签为Topics
   * 设置编辑意图为 'reset-to-original'，保存时会清除 custom_tags
   */
  const resetTagsToTopics = () => {
    if (!repository) return;
    if (repository.topics && repository.topics.length > 0) {
      setFormData(prev => ({ ...prev, tags: repository.topics! }));
      setEditIntent(prev => ({ ...prev, tags: 'reset-to-original' }));
    }
  };

  /**
   * 清除自定义标签
   * 设置编辑意图为 'clear'，保存时会保存空数组
   */
  const clearTags = () => {
    setFormData(prev => ({ ...prev, tags: [] }));
    setEditIntent(prev => ({ ...prev, tags: 'clear' }));
  };

  /**
   * 重置分类为AI推断的分类
   * 设置编辑意图为 'reset-to-ai'，保存时会清除 custom_category
   */
  const resetCategoryToAI = () => {
    if (!repository) return;
    const aiCat = getAICategory(repository, allCategories);
    if (aiCat) {
      setFormData(prev => ({ ...prev, category: aiCat, categoryLocked: false }));
      setEditIntent(prev => ({ ...prev, category: 'reset-to-ai' }));
    }
  };

  /**
   * 重置分类为默认分类（基于仓库信息匹配）
   * 设置编辑意图为 'reset-to-original'，保存时会清除 custom_category
   */
  const resetCategoryToDefault = () => {
    if (!repository) return;
    const defaultCat = getDefaultCategory(repository, allCategories);
    if (defaultCat) {
      setFormData(prev => ({ ...prev, category: defaultCat, categoryLocked: false }));
      setEditIntent(prev => ({ ...prev, category: 'reset-to-original' }));
    }
  };

  /**
   * 清除自定义分类
   * 设置编辑意图为 'clear'，保存时会保存空值
   */
  const clearCategory = () => {
    setFormData(prev => ({ ...prev, category: '', categoryLocked: false }));
    setEditIntent(prev => ({ ...prev, category: 'clear' }));
  };

  // 处理关闭 - 直接关闭，不再二次确认
  const handleCloseWithConfirm = () => {
    handleClose();
  };

  if (!repository) return null;

  // 统一的卡片样式
  const sectionClass = "p-5 bg-white dark:bg-panel-dark rounded-xl border border-black/[0.06] dark:border-white/[0.04]";
  const labelClass = "flex items-center space-x-2 text-sm font-medium text-gray-900 dark:text-text-primary mb-3";
  const inputClass = "w-full px-3 py-2 bg-light-bg dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg text-gray-900 dark:text-text-primary placeholder-gray-400 dark:placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-brand-violet focus:border-transparent transition-all";
  const buttonSecondaryClass = "flex items-center space-x-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all";
  const tagClass = "inline-flex items-center px-2.5 py-1 bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary border-transparent rounded-md text-sm border border-black/[0.06] dark:border-white/[0.04] dark:border-white/[0.04]";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('编辑仓库信息', 'Edit Repository Info')}
      maxWidth="max-w-2xl"
    >
      <div className="space-y-5">
        {/* Repository Info Header */}
        <div className="flex items-center space-x-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:bg-brand-indigo/10 dark:from-transparent dark:to-transparent rounded-xl border border-black/[0.06] dark:border-white/[0.04] dark:border-brand-violet/20">
          <img
            src={repository.owner.avatar_url}
            alt={repository.owner.login}
            className="w-10 h-10 rounded-full border-2 border-white dark:border-white/[0.04] shadow-sm"
          />
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-gray-900 dark:text-text-primary truncate">
              {repository.name}
            </h4>
            <p className="text-sm text-gray-500 dark:text-text-secondary">
              {repository.owner.login}
            </p>
          </div>
          {repository.description && (
            <div className="hidden sm:block text-xs text-gray-500 dark:text-text-secondary max-w-xs truncate">
              {repository.description}
            </div>
          )}
        </div>

        {/* Description Section */}
        <div className={sectionClass}>
          <div className={labelClass}>
            <Edit3 className="w-4 h-4 text-brand-violet dark:text-brand-violet" />
            <span>{t('描述', 'Description')}</span>
            {customStatus.description && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                {t('自定义', 'Custom')}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400 dark:text-text-tertiary">
              {formData.description.length > 0 ? `${formData.description.length} ${t('字符', 'chars')}` : t('无内容', 'Empty')}
            </span>
          </div>

          {/* Source Indicator */}
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-gray-500 dark:text-text-secondary">{t('当前来源:', 'Source:')}</span>
            {editIntent.description === 'keep-custom' && (formData.description || '').trim() !== '' ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                <Edit3 className="w-3 h-3 mr-1" />
                {t('自定义', 'Custom')}
              </span>
            ) : editIntent.description === 'keep-custom' && (formData.description || '').trim() === '' ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                <AlertTriangle className="w-3 h-3 mr-1" />
                {t('将回退', 'Will fallback')}
              </span>
            ) : editIntent.description === 'reset-to-ai' ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                <Bot className="w-3 h-3 mr-1" />
                {t('AI总结', 'AI Summary')}
              </span>
            ) : editIntent.description === 'reset-to-original' ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-light-surfacetext-gray-900 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                <FileText className="w-3 h-3 mr-1" />
                {t('原始描述', 'Original')}
              </span>
            ) : editIntent.description === 'clear' ? (
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                <X className="w-3 h-3 mr-1" />
                {t('已清空', 'Cleared')}
              </span>
            ) : null}
          </div>

          <textarea
            value={formData.description}
            onChange={(e) => {
              setFormData(prev => ({ ...prev, description: e.target.value }));
              setEditIntent(prev => ({ ...prev, description: 'keep-custom' }));
            }}
            className={`${inputClass} resize-none`}
            rows={3}
            placeholder={t('输入自定义描述...', 'Enter custom description...')}
          />

          {/* Save Effect Info - always visible */}
          {editIntent.description === 'clear' ? (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-status-red flex items-start">
                <AlertTriangle className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '描述已清空，保存后将显示"（无描述）"。即使有AI总结或原始描述也不会显示。',
                    'Description cleared. "(No description)" will be shown after saving, even if AI summary or original description exists.'
                  )}
                </span>
              </p>
            </div>
          ) : editIntent.description === 'reset-to-ai' ? (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-brand-violet flex items-start">
                <Bot className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '保存后将清除自定义描述，显示AI总结。如果AI重新分析，描述可能随之变化。',
                    'Custom description will be cleared after saving, showing AI summary. Description may change if AI re-analyzes.'
                  )}
                </span>
              </p>
            </div>
          ) : editIntent.description === 'reset-to-original' ? (
            <div className="mt-3 p-3 bg-light-bg dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary flex items-start">
                <FileText className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '保存后将清除自定义描述，显示GitHub原始描述。',
                    'Custom description will be cleared after saving, showing the original GitHub description.'
                  )}
                </span>
              </p>
            </div>
          ) : editIntent.description === 'keep-custom' && (formData.description || '').trim() === '' ? (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-status-amber flex items-start">
                <AlertTriangle className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {repository?.ai_summary
                    ? t('当前编辑为空，保存后将显示AI总结。如需清空请点击"清除描述"。', 'Currently empty. AI summary will be shown after saving. Click "Clear" to explicitly clear.')
                    : repository?.description
                      ? t('当前编辑为空，保存后将显示原始描述。如需清空请点击"清除描述"。', 'Currently empty. Original description will be shown after saving. Click "Clear" to explicitly clear.')
                      : t('无可用描述来源。', 'No description source available.')}
                </span>
              </p>
            </div>
          ) : editIntent.description === 'keep-custom' && customStatus.description ? (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-brand-violet flex items-start">
                <Info className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '保存后将使用此自定义描述，优先级高于AI总结和原始描述。',
                    'This custom description will be used after saving, with higher priority than AI summary and original description.'
                  )}
                </span>
              </p>
            </div>
          ) : editIntent.description === 'keep-custom' && formData.description.trim() !== '' && !customStatus.description ? (
            <div className="mt-3 p-3 bg-light-bg dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary flex items-start">
                <Info className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '当前内容与AI总结或原始描述一致，保存后将使用自动推断的来源。',
                    'Current content matches AI summary or original description. Auto-inferred source will be used after saving.'
                  )}
                </span>
              </p>
            </div>
          ) : null}

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            {repository.ai_summary && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetToAI();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.description === 'reset-to-ai'
                    ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                    : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为AI总结', 'Reset to AI')}</span>
              </button>
            )}
            {repository.description && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetToOriginal();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.description === 'reset-to-original'
                    ? 'bg-light-surfacetext-gray-900border-black/[0.06] dark:bg-white/10 dark:text-text-primary dark:border-white/20'
                    : 'bg-white text-gray-700border-black/[0.06] hover:bg-light-bg dark:bg-white/[0.04] dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/10 dark:hover:text-gray-900'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为原始描述', 'Reset to Original')}</span>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearDescription();
              }}
              className={`${buttonSecondaryClass} ${
                editIntent.description === 'clear'
                  ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                  : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
              }`}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              <span>{t('清除描述', 'Clear')}</span>
            </button>
          </div>

          {/* Feature Tip */}
          <div className="mt-3 p-3 bg-light-bg dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.04] rounded-lg">
            <p className="text-[11px] text-gray-500 dark:text-text-secondary flex items-start">
              <Info className="w-3.5 h-3.5 mr-1.5 mt-0.5 flex-shrink-0 text-gray-400 dark:text-text-tertiary" />
              <span>
                {t(
                  '描述优先级：自定义描述 > AI总结 > 原始描述。"重置"会清除自定义并回退到对应来源，"清除"会明确清空描述（不显示任何来源）。',
                  'Description priority: Custom > AI Summary > Original. "Reset" clears custom and falls back to the source. "Clear" explicitly empties the description (no source shown).'
                )}
              </span>
            </p>
          </div>
        </div>

        {/* Category Section */}
        <div className={sectionClass}>
          <div className={labelClass}>
            <FolderOpen className="w-4 h-4 text-status-emerald " />
            <span>{t('分类', 'Category')}</span>
            {customStatus.category && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                {t('自定义', 'Custom')}
              </span>
            )}
          </div>

          <select
            value={formData.category}
            onChange={(e) => {
              const newCategory = e.target.value;
              setFormData(prev => ({
                ...prev,
                category: newCategory,
                categoryLocked: newCategory ? prev.categoryLocked : false
              }));
              setEditIntent(prev => ({ ...prev, category: 'keep-custom' }));
            }}
            className={inputClass}
          >
            <option value="">{t('选择分类...', 'Select category...')}</option>
            {allCategories.filter(cat => cat.id !== 'all').map(category => (
              <option key={category.id} value={category.name}>
                {category.icon} {category.name}
              </option>
            ))}
          </select>

          {/* Category Action Buttons */}
          <div className="flex flex-wrap gap-2 mt-3">
            {repository && getAICategory(repository, allCategories) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetCategoryToAI();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.category === 'reset-to-ai'
                    ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                    : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为AI分类', 'Reset to AI Category')}</span>
              </button>
            )}
            {repository && getDefaultCategory(repository, allCategories) && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetCategoryToDefault();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.category === 'reset-to-original'
                    ? 'bg-light-surfacetext-gray-900border-black/[0.06] dark:bg-white/10 dark:text-text-primary dark:border-white/20'
                    : 'bg-white text-gray-700border-black/[0.06] hover:bg-light-bg dark:bg-white/[0.04] dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/10'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为默认分类', 'Reset to Default')}</span>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearCategory();
              }}
              className={`${buttonSecondaryClass} ${
                editIntent.category === 'clear'
                  ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                  : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
              }`}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              <span>{t('清除分类', 'Clear Category')}</span>
            </button>
          </div>

          {/* Custom Category Selection Info */}
          {editIntent.category === 'keep-custom' && formData.category && (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-brand-violet flex items-start">
                <Info className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '已选择自定义分类。保存后仓库将固定显示在此分类中，不会随AI分析结果自动变化。建议同时开启分类锁定以防止同步时被覆盖。',
                    'Custom category selected. The repository will be fixed in this category after saving and will not change with AI analysis results. It is recommended to enable category lock to prevent being overwritten during sync.'
                  )}
                </span>
              </p>
            </div>
          )}

          {/* Reset Category Info */}
          {editIntent.category === 'reset-to-ai' && (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-brand-violet flex items-start">
                <Info className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '重置为AI分类将清除自定义分类设置，系统会根据AI标签自动推断分类。如果AI标签变化，分类可能会随之改变。',
                    'Resetting to AI category will clear custom category settings. The system will auto-infer category based on AI tags. Category may change if AI tags change.'
                  )}
                </span>
              </p>
            </div>
          )}

          {editIntent.category === 'reset-to-original' && (
            <div className="mt-3 p-3 bg-light-bg dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary flex items-start">
                <Info className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '重置为默认分类将清除自定义分类设置，系统会根据仓库信息（名称、描述、语言等）自动匹配分类。',
                    'Resetting to default category will clear custom category settings. The system will auto-match based on repository info (name, description, language, etc.).'
                  )}
                </span>
              </p>
            </div>
          )}

          {/* Clear Category Warning */}
          {editIntent.category === 'clear' && (
            <div className="mt-3 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-status-red flex items-start">
                <AlertTriangle className="w-4 h-4 mr-1.5 mt-0.5 flex-shrink-0" />
                <span>
                  {t(
                    '清除分类后，仓库将不再有明确的分类归属。系统会尝试根据AI标签自动匹配分类，如果没有匹配到则可能显示在默认分类中。',
                    'After clearing the category, the repository will no longer have a specific category. The system will try to auto-match based on AI tags, or show in default categories if no match is found.'
                  )}
                </span>
              </p>
            </div>
          )}

          {/* Category Lock */}
          <div className="mt-4 p-4 bg-gray-100 dark:bg-white/[0.04] dark:bg-status-amber/10 rounded-lg border border-black/[0.06] dark:border-white/[0.04] dark:border-status-amber/20">
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0 mt-0.5">
                {formData.categoryLocked && formData.category ? (
                  <Lock className="w-4 h-4 text-gray-700 dark:text-text-secondary dark:text-status-amber" />
                ) : (
                  <Unlock className="w-4 h-4 text-gray-400 dark:text-text-tertiary" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-text-primary">
                    {t('分类锁定', 'Category Lock')}
                  </span>
                  <label className={`inline-flex items-center ${!formData.category ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={formData.categoryLocked && !!formData.category}
                      onChange={(e) => {
                        if (!formData.category) return;
                        setFormData(prev => ({ ...prev, categoryLocked: e.target.checked }));
                      }}
                      disabled={!formData.category}
                      className="sr-only peer"
                    />
                    <div className="relative w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-brand-violet rounded-full peer dark:bg-white/10 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-black/[0.06] after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-white/[0.04] peer-checked:bg-status-amber peer-disabled:opacity-50 peer-disabled:cursor-not-allowed"></div>
                  </label>
                </div>
                <p className="text-xs text-gray-700 dark:text-text-secondary">
                  {!formData.category
                    ? t('请先选择分类才能启用锁定。', 'Select a category first to enable locking.')
                    : formData.categoryLocked
                      ? t('已锁定：同步时将保持当前分类不变。', 'Locked: Category will remain unchanged during sync.')
                      : t('未锁定：同步时可能会被AI自动重新分类。', 'Unlocked: Category may be auto-reclassified by AI during sync.')
                  }
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Tags Section */}
        <div className={sectionClass}>
          <div className={labelClass}>
            <Tag className="w-4 h-4 text-gray-700 dark:text-text-secondary " />
            <span>{t('标签', 'Tags')}</span>
            {customStatus.tags && (
              <span className="ml-2 px-2 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-700 dark:bg-white/[0.04] dark:text-text-secondary rounded-full">
                {t('自定义', 'Custom')}
              </span>
            )}
            <span className="ml-auto text-xs text-gray-400 dark:text-text-tertiary">
              {formData.tags.length > 0 ? `${formData.tags.length} ${t('个标签', 'tags')}` : t('无标签', 'No tags')}
            </span>
          </div>

          {/* Tags Display */}
          {formData.tags.length > 0 ? (
            <div className="flex flex-wrap gap-2 mb-4">
              {formData.tags.map((tag, index) => (
                <span key={index} className={tagClass}>
                  {tag}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveTag(tag);
                    }}
                    className="ml-1.5 p-0.5 hover:bg-gray-200 dark:hover:bg-white/10 hover:text-gray-900 dark:text-text-primary dark:hover:text-text-primary rounded transition-colors"
                    title={t('移除', 'Remove')}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="mb-4">
              <span className="text-sm text-gray-400 dark:text-text-tertiary">{t('暂无标签', 'No tags')}</span>
            </div>
          )}

          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2 mb-4">
            {repository.ai_tags && repository.ai_tags.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetTagsToAI();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.tags === 'reset-to-ai'
                    ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                    : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
                }`}
              >
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为AI标签', 'Reset to AI')}</span>
              </button>
            )}
            {repository.topics && repository.topics.length > 0 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  resetTagsToTopics();
                }}
                className={`${buttonSecondaryClass} ${
                  editIntent.tags === 'reset-to-original'
                    ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                    : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
                }`}
              >
                <FileText className="w-3.5 h-3.5 mr-1.5" />
                <span>{t('重置为Topics', 'Reset to Topics')}</span>
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearTags();
              }}
              className={`${buttonSecondaryClass} ${
                editIntent.tags === 'clear'
                  ? 'bg-gray-100 text-gray-900 border-transparent dark:bg-white/[0.08] dark:text-text-primary dark:border-transparent'
                  : 'bg-white text-gray-700 border-black/[0.06] hover:bg-gray-50 dark:bg-transparent dark:text-text-secondary dark:border-white/[0.04] dark:hover:bg-white/5 dark:hover:text-text-primary'
              }`}
            >
              <X className="w-3.5 h-3.5 mr-1.5" />
              <span>{t('清除标签', 'Clear')}</span>
            </button>
          </div>

          {/* Status Alert */}
          {formData.tags.length === 0 && (
            <div className="mb-4 p-3 bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg">
              <p className="text-xs text-gray-700 dark:text-text-secondary dark:text-status-amber flex items-center">
                {editIntent.tags === 'clear' ? (
                  <>
                    <span className="mr-1">⚠️</span>
                    {t('标签已清空。保存后将不显示任何标签。', 'Tags cleared. No tags will be shown after saving.')}
                  </>
                ) : editIntent.tags === 'reset-to-ai' ? (
                  <>
                    <span className="mr-1 text-status-emerald">✓</span>
                    {t('将显示AI标签。', 'AI tags will be shown.')}
                  </>
                ) : editIntent.tags === 'reset-to-original' ? (
                  <>
                    <span className="mr-1 text-status-emerald">✓</span>
                    {t('将显示GitHub Topics。', 'GitHub Topics will be shown.')}
                  </>
                ) : repository?.ai_tags && repository.ai_tags.length > 0 ? (
                  <>
                    <span className="mr-1">⚠️</span>
                    {t('当前无自定义标签。保存后将显示AI标签。', 'No custom tags. AI tags will be shown after saving.')}
                  </>
                ) : repository?.topics && repository.topics.length > 0 ? (
                  <>
                    <span className="mr-1">⚠️</span>
                    {t('当前无自定义标签。保存后将显示GitHub Topics。', 'No custom tags. GitHub Topics will be shown after saving.')}
                  </>
                ) : (
                  <>
                    <span className="mr-1">⚠️</span>
                    {t('无可用标签。', 'No tags available.')}
                  </>
                )}
              </p>
            </div>
          )}

          {/* Add New Tag */}
          <div className="flex space-x-2">
            <input
              type="text"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyPress={handleKeyPress}
              className={inputClass}
              placeholder={t('添加自定义标签...', 'Add custom tag...')}
            />
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleAddTag();
              }}
              disabled={!newTag.trim()}
              className="flex items-center px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>

        </div>

        {/* Action Buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t border-black/[0.06] dark:border-white/[0.04]">
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleCloseWithConfirm();
            }}
            className="flex items-center space-x-2 px-4 py-2 text-gray-900 dark:text-text-primary bg-light-surface dark:bg-white/[0.04] rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 dark:border dark:border-white/[0.04] transition-colors"
          >
            <X className="w-4 h-4" />
            <span>{t('取消', 'Cancel')}</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              void handleSave();
            }}
            disabled={!hasChanges}
            className="flex items-center space-x-2 px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover  disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            <span>{t('保存', 'Save')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
