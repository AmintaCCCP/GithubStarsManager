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
      // Registering the elevation scale keeps `shadow-elev-1` in the shadow
      // *size* group, so `shadow-black` only recolours it instead of
      // swallowing it as a competing shadow colour.
      shadow: ['elev-0', 'elev-1', 'elev-2', 'elev-3'],
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
