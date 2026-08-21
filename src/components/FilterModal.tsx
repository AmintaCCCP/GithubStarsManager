import { Button } from './ui/button';
import { Input } from './ui/input';
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
          <label htmlFor="filter-name" className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            过滤器名称
          </label>
          <Input
            id="filter-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如: macOS"
            className="w-full px-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-white dark:bg-muted/40 text-foreground dark:text-foreground"
          />
        </div>

        {/* Keywords */}
        <div>
          <label htmlFor="filter-keywords" className="block text-sm font-medium text-foreground dark:text-foreground mb-2">
            匹配关键词
          </label>
          
          {/* Add keyword input */}
          <div className="flex space-x-2 mb-3">
            <Input
              id="filter-keywords"
              type="text"
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="输入关键词，如: mac, dmg"
              className="flex-1 px-3 py-2 border border-border dark:border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-white dark:bg-muted/40 text-foreground dark:text-foreground"
            />
            <Button
              onClick={handleAddKeyword}
              disabled={!newKeyword.trim()}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 dark:bg-primary/80 dark:hover:bg-primary disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-1 transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>添加</span>
            </Button>
          </div>

          {/* Keywords list */}
          {keywords.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground dark:text-muted-foreground">
                已添加的关键词:
              </p>
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword, index) => (
                  <div
                    key={index}
                    className="flex items-center space-x-1 px-3 py-1 bg-gray-900 text-white dark:bg-white/[0.12] dark:text-white font-medium rounded-lg text-sm"
                  >
                    <span>{keyword}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => handleRemoveKeyword(index)}
                      aria-label={`删除关键词 ${keyword}`}
                      className="text-muted-foreground hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {keywords.length === 0 && (
            <p className="text-sm text-muted-foreground dark:text-muted-foreground">
              请添加至少一个关键词用于匹配文件名
            </p>
          )}
        </div>

        {/* Help text */}
        <div className="bg-muted dark:bg-muted/40 border border-border dark:border-border rounded-lg p-3">
          <p className="text-sm text-muted-foreground dark:text-muted-foreground">
            <strong>提示:</strong> 关键词将用于匹配 GitHub Release 中的文件名。例如，添加 "mac" 和 "dmg" 关键词可以匹配包含这些字符的文件。
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex justify-end space-x-3 pt-4 border-t dark:border-border mt-4">
          <Button
            onClick={onClose}
            className="px-4 py-2 text-foreground dark:text-foreground bg-muted dark:bg-muted/40 dark:border dark:border-border rounded-lg hover:bg-accent dark:hover:bg-accent transition-colors"
          >
            取消
          </Button>
          <Button
            onClick={handleSave}
            disabled={!name.trim() || keywords.length === 0}
            className={`px-4 py-2 rounded-lg transition-colors ${(!name.trim() || keywords.length === 0) ? 'bg-gray-300 text-muted-foreground dark:bg-white/5 dark:text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground hover:bg-accent dark:bg-muted/40 dark:bg-green-600/80 dark:hover:bg-green-600 dark:bg-green-600/80 dark:hover:bg-green-600'}`}
          >
            {filter ? '保存' : '创建'}
          </Button>
        </div>
      </div>
    </Modal>
  );
};