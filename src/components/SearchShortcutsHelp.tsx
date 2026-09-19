import { useT } from "../i18n/useT";
import React, { useState } from 'react';
import { HelpCircle, Keyboard } from 'lucide-react';
import { searchShortcuts } from '../hooks/useSearchShortcuts';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';

export const SearchShortcutsHelp: React.FC = () => {
  const [showHelp, setShowHelp] = useState(false);
  const t = useT('app');

  return (
    <Dialog open={showHelp} onOpenChange={setShowHelp}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground dark:text-muted-foreground">
          <Keyboard className="h-3 w-3" /><span>{t('searchShortcutsHelp.shortcuts')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" closeLabel={t('searchShortcutsHelp.close')}>
        <DialogHeader>
          <div className="flex items-center gap-2"><Keyboard className="h-5 w-5 text-primary" /><DialogTitle>{t('searchShortcutsHelp.search-shortcuts')}</DialogTitle></div>
          <DialogDescription>{t('searchShortcutsHelp.view-the-available-keyboard-shortcuts-for-search')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {searchShortcuts.map((shortcut, index) => <div key={index} className="flex items-center justify-between rounded-lg bg-background px-3 py-2 dark:bg-muted/40"><div className="flex items-center space-x-3"><kbd className="rounded border border-border bg-card px-2 py-1 font-mono text-xs text-foreground dark:border-border dark:bg-card dark:text-muted-foreground">{shortcut.key}</kbd><span className="text-sm text-foreground dark:text-muted-foreground">{t(`searchShortcutsHelp.shortcut-${shortcut.id}`)}</span></div></div>)}
        </div>
        <div className="mt-2 border-t border-border pt-4 dark:border-border"><div className="flex items-start space-x-2 text-sm text-muted-foreground dark:text-muted-foreground"><HelpCircle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="mb-1">{t('searchShortcutsHelp.tips')}</p><ul className="space-y-1 text-xs"><li>• {t('searchShortcutsHelp.shortcuts-work-on-any-page')}</li><li>• {t('searchShortcutsHelp.press-escape-in-input-to-clear-search')}</li><li>• {t('searchShortcutsHelp.use-key-to-quickly-start-searching')}</li></ul></div></div></div>
        <DialogFooter><Button type="button" onClick={() => setShowHelp(false)}>{t('searchShortcutsHelp.got-it')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
