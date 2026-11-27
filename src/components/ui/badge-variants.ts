import { cva } from 'class-variance-authority';

export const badgeVariants = cva(
  'inline-flex items-center rounded-xs border px-1.5 py-0.5 text-label-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-fill-hover text-secondary',
        // Status hues are too light to read on their own 10% tint (2.7–4.3:1);
        // the tint carries the tone, the text stays at full contrast.
        destructive: 'border-transparent bg-destructive-tint text-foreground',
        outline: 'border-default text-secondary',
        success: 'border-transparent bg-success-tint text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
