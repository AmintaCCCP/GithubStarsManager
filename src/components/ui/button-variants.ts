import { cva } from 'class-variance-authority';

export const buttonVariants = cva(
  // Instant hover-in (0ms), 100ms hover-out & press physics (.motion-press) with crisp focus-visible ring.
  'motion-press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md text-label font-medium whitespace-nowrap select-none outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  {
    variants: {
      variant: {
        default:
          'state-overlay bg-primary text-primary-foreground disabled:opacity-100 disabled:bg-fill-selected disabled:text-tertiary disabled:shadow-elev-0',
        primary:
          'state-overlay bg-accent-solid text-on-accent disabled:opacity-100 disabled:bg-fill-selected disabled:text-tertiary disabled:shadow-elev-0',
        destructive:
          'state-overlay bg-destructive text-destructive-foreground focus-visible:ring-destructive/40 disabled:opacity-100 disabled:bg-fill-selected disabled:text-tertiary disabled:shadow-elev-0',
        'danger-solid':
          'state-overlay bg-destructive-solid text-on-destructive focus-visible:ring-destructive/40 disabled:opacity-100 disabled:bg-fill-selected disabled:text-tertiary disabled:shadow-elev-0',
        danger: 'text-destructive hover:bg-destructive-tint active:bg-destructive-tint focus-visible:ring-destructive/40',
        outline: 'bg-raised text-foreground shadow-elev-1 hover:bg-fill-hover active:bg-fill-pressed',
        secondary: 'bg-secondary text-secondary-foreground shadow-elev-0 hover:bg-fill-hover active:bg-fill-pressed',
        ghost: 'text-foreground hover:bg-fill-hover active:bg-fill-pressed data-[state=open]:bg-fill-hover',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-control px-2.5 text-label has-[>svg]:px-2',
        md: 'h-control px-2.5 text-label has-[>svg]:px-2',
        sm: 'h-control-sm gap-1 rounded-sm px-2 text-label-sm has-[>svg]:px-1.5',
        lg: 'h-control-lg rounded-md px-3 text-label has-[>svg]:px-2.5',
        xl: 'h-control-xl rounded-md px-4 text-label-lg',
        icon: 'size-control',
        'icon-sm': 'size-control-sm rounded-sm',
        'icon-lg': 'size-control-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
