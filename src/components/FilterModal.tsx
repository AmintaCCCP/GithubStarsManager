import React, { useState, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Modal } from './Modal';
import { AssetFilter } from '../types';

interface FilterModalProps {
  isOpen: boolean;
  onClose: () => void;
  filter?: AssetFilter;
  onSave: (filter: AssetFilter) => void;
}

export const FilterModal: React.FC<FilterModalProps> = ({
  isOpen,
  onClose,
  filter,
  onSave
}) => {
  const [name, setName] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  useEffect(() => {
    if (filter) {
      setName(filter.name);
      setKeywords([...filter.keywords]);
    } else {
      setName('');
      setKeywords([]);
    }
    setNewKeyword('');
  }, [filter, isOpen]);

  const handleAddKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed]);
      setNewKeyword('');
    }
  };

  const handleRemoveKeyword = (index: number) => {
    setKeywords(keywords.filter((_, i) => i !== index));
  };

  const handleSave = () => {
    if (!name.trim() || keywords.length === 0) {
      return;
    }

    const savedFilter: AssetFilter = {
      id: filter?.id || Date.now().toString(),
      name: name.trim(),
      keywords: keywords.filter(k => k.trim())
    };

    onSave(savedFilter);
    onClose();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword();
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={filter ? '编辑过滤器' : '新建过滤器'}>
      <div className="space-y-4">
        {/* Filter Name */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-text-primary mb-2">
            过滤器名称
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: macOS"
            className="w-full px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
          />
        </div>

        {/* Keywords */}
        <div>
          <label className="block text-sm font-medium text-gray-900 dark:text-text-primary mb-2">
            匹配关键词
          </label>
          
          {/* Add keyword input */}
          <div className="flex space-x-2 mb-3">
            <input
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入关键词，如: mac, dmg"
              className="flex-1 px-3 py-2 border border-black/[0.06] dark:border-white/[0.04] rounded-lg focus:ring-2 focus:ring-brand-violet focus:border-transparent bg-white dark:bg-white/[0.04] text-gray-900 dark:text-text-primary"
            />
            <button
              onClick={handleAddKeyword}
              disabled={!newKeyword.trim()}
              className="px-4 py-2 bg-brand-indigo text-white rounded-lg hover:bg-brand-hover dark:bg-brand-indigo/80 dark:hover:bg-brand-indigo disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>添加</span>
            </button>
          </div>

          {/* Keywords list */}
          {keywords.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-700 dark:text-text-secondary">
                已添加的关键词:
              </p>
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-1 px-3 py-1 bg-gray-900 text-white dark:bg-white/[0.12] dark:text-white font-medium rounded-lg text-sm"
                  >
                    <span>{keyword}</span>
                    <button
                      onClick={() => handleRemoveKeyword(index)}
                      className="text-gray-500 hover:text-gray-900 dark:text-text-tertiary dark:hover:text-text-primary transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keywords.length === 0 && (
            <p className="text-sm text-gray-500 dark:text-text-tertiary">
              请添加至少一个关键词用于匹配文件名
            </p>
          )}
        </div>

        {/* Help text */}
        <div className="bg-light-surface dark:bg-white/[0.04] border border-black/[0.06] dark:border-white/[0.04] rounded-lg p-3">
          <p className="text-sm text-gray-700 dark:text-text-secondary">
            <strong>提示:</strong> 关键词将用于匹配 GitHub Release 中的文件名。例如，添加 "mac" 和 "dmg" 关键词可以匹配包含这些字符的文件。
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t dark:border-white/[0.04] mt-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-900 dark:text-text-primary bg-light-surface dark:bg-white/[0.04] dark:border dark:border-white/[0.04] rounded-lg hover:bg-gray-200 dark:hover:bg-white/10 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim() || keywords.length === 0}
            className={`px-4 py-2 rounded-lg transition-colors ${(!name.trim() || keywords.length === 0) ? 'bg-gray-300 text-gray-500 dark:bg-white/5 dark:text-text-tertiary cursor-not-allowed' : 'bg-brand-indigo text-white hover:bg-gray-100 dark:bg-white/[0.04] dark:bg-status-emerald/80 dark:hover:bg-status-emerald dark:bg-status-emerald/80 dark:hover:bg-status-emerald'}`}
          >
            {filter ? '保存' : '创建'}
          </button>
        </div>
      </div>
    </Modal>
  );
};