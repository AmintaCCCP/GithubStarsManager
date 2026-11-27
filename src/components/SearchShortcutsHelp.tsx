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
        <Button type="button" variant="ghost" size="sm" className="h-control-sm gap-1 rounded-sm px-2 text-label-sm text-tertiary hover:text-foreground">
          <Keyboard className="size-3.5" /><span>{t('searchShortcutsHelp.shortcuts')}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" closeLabel={t('searchShortcutsHelp.close')}>
        <DialogHeader>
          <div className="flex items-center gap-2"><Keyboard className="size-4 text-accent-text" /><DialogTitle>{t('searchShortcutsHelp.search-shortcuts')}</DialogTitle></div>
          <DialogDescription>{t('searchShortcutsHelp.view-the-available-keyboard-shortcuts-for-search')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {searchShortcuts.map((shortcut, index) => (
            <div key={index} className="flex items-center justify-between rounded-md bg-sunken px-3 py-2">
              <span className="text-label text-foreground">{t(`searchShortcutsHelp.shortcut-${shortcut.id}`)}</span>
              <kbd className="keycap font-mono">{shortcut.key}</kbd>
            </div>
          ))}
        </div>
        <div className="border-t border-subtle pt-3">
          <div className="flex items-start gap-2 text-label-sm text-secondary">
            <HelpCircle className="mt-0.5 size-4 shrink-0 text-tertiary" />
            <div>
              <p className="mb-1 font-medium text-foreground">{t('searchShortcutsHelp.tips')}</p>
              <ul className="space-y-1 text-label-sm text-secondary">
                <li>• {t('searchShortcutsHelp.shortcuts-work-on-any-page')}</li>
                <li>• {t('searchShortcutsHelp.press-escape-in-input-to-clear-search')}</li>
                <li>• {t('searchShortcutsHelp.use-key-to-quickly-start-searching')}</li>
              </ul>
            </div>
          </div>
        </div>
        <DialogFooter><Button type="button" variant="primary" size="md" onClick={() => setShowHelp(false)}>{t('searchShortcutsHelp.got-it')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
