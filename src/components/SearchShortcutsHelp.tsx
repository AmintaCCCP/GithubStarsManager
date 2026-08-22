import React, { useState } from 'react';
import { HelpCircle, Keyboard } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { searchShortcuts } from '../hooks/useSearchShortcuts';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';

export const SearchShortcutsHelp: React.FC = () => {
  const [showHelp, setShowHelp] = useState(false);
  const { language } = useAppStore();
  const t = (zh: string, en: string) => language === 'zh' ? zh : en;

  return (
    <Dialog open={showHelp} onOpenChange={setShowHelp}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground dark:text-muted-foreground" aria-label={t('查看搜索快捷键', 'View search shortcuts')}>
          <Keyboard className="h-3 w-3" /><span>{t('快捷键', 'Shortcuts')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-primary" /><DialogTitle>{t('搜索快捷键', 'Search Shortcuts')}</DialogTitle></div>
          <DialogDescription>{t('查看可用的搜索键盘快捷键。', 'View the available keyboard shortcuts for search.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {searchShortcuts.map((shortcut, index) => <div key={index} className="flex items-center justify-between rounded-lg bg-background px-3 py-2 dark:bg-muted/40"><div className="flex items-center space-x-3"><kbd className="rounded border border-border bg-white px-2 py-1 font-mono text-xs text-foreground dark:border-border dark:bg-card dark:text-muted-foreground">{shortcut.key}</kbd><span className="text-sm text-foreground dark:text-muted-foreground">{language === 'zh' ? shortcut.description : shortcut.descriptionEn}</span></div></div>)}
        </div>
        <div className="mt-2 border-t border-border pt-4 dark:border-border"><div className="flex items-start space-x-2 text-sm text-muted-foreground dark:text-muted-foreground"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="mb-1">{t('提示:', 'Tips:')}</p><ul className="space-y-1 text-xs"><li>• {t('快捷键在任何页面都可使用', 'Shortcuts work on any page')}</li><li>• {t('在输入框中按 Escape 清除搜索', 'Press Escape in input to clear search')}</li><li>• {t('使用 / 键快速开始搜索', 'Use / key to quickly start searching')}</li></ul></div></div></div>
        <DialogFooter><Button type="button" onClick={() => setShowHelp(false)}>{t('知道了', 'Got it')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
