import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const customTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: [
        'gutter',
        'control-sm',
        'control',
        'control-lg',
        'control-xl',
        'row-sidebar',
        'row-menu',
        'row-list',
        'row-list-2',
        'row-touch',
      ],
    },
    classGroups: {
      'font-size': [
        {
          text: [
            'caption',
            'label-sm',
            'label',
            'label-lg',
            'copy',
            'copy-lg',
            'title',
            'display',
            'mono-ui',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return customTwMerge(clsx(inputs));
}
